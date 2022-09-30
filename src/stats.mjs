import events from 'node:events';
import path from 'node:path';
import protobuf from 'protobufjs';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as rpc from './rpc.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import * as report from '../shared/report.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _case = protobuf.parse.defaults.keepCase;
protobuf.parse.defaults.keepCase = true;
export const protos = protobuf.loadSync([path.join(__dirname, 'zwift.proto')]).root;
protobuf.parse.defaults.keepCase = _case;


const monotonic = performance.now;
const roadDistEstimates = {};


let _db;
function getDB() {
    if (_db) {
        return _db;
    }
    _db = new SqliteDatabase('athletes', {
        tables: {
            athletes: {
                id: 'INTEGER PRIMARY KEY',
                data: 'TEXT',
            }
        }
    });
    return _db;
}


async function resetDB() {
    if (_db) {
        _db.close();
    }
    _db = null;
    await deleteDatabase('athletes');
}


function splitNameAndTeam(name) {
    if (!name || !name.match) {
        return [name];
    }
    const m = name.match(/\[(?<t1>.*?)\]|\((?<t2>.*?)\)/);
    if (!m) {
        return [name];
    }
    const team = m.groups.t1 || m.groups.t2;
    if (!team) {
        return [name];
    }
    name = [
        name.substr(0, m.index).trim(),
        name.substr(m.index + m[0].length).trim()
    ].filter(x => x).join(' ');
    return [name, team];
}


function highPrecTimeConv(ts) {
    // As seen on payload timestamps.
    const dv = new DataView(new Uint32Array([ts.low, ts.high]).buffer);
    const ns = dv.getBigUint64(0, /*le*/ true);
    return +`${ns / 1000n}.${ns % 1000n}`; // Lossless conv to ms
}


function makeExpWeighted(period) {
    const c = 1 - Math.exp(-1 / 100);
    let w;
    return x => (w = w === undefined ? x : (w * (1 - c)) + (x * c));
}


const _roadDistExpFuncs = {};
function adjRoadDistEstimate(sig, raw) {
    if (!_roadDistExpFuncs[sig]) {
        _roadDistExpFuncs[sig] = makeExpWeighted(100);
    }
    return roadDistEstimates[sig] = _roadDistExpFuncs[sig](raw);
}


class DataCollector {
    constructor(Klass, periods, options={}) {
        this._maxValue = 0;
        if (options._cloning) {
            return;
        }
        const defOptions = {idealGap: 1, maxGap: 15, active: true};
        this._bufferedTimes = new Array();
        this._bufferedValues = new Array();
        this._bufferedLen = 0;
        this.roll = new Klass(null, {...defOptions, ...options});
        this.periodized = new Map(periods.map(period => [period, {
            roll: this.roll.clone({period}),
            peak: null,
        }]));
    }

    clone({reset}={}) {
        const instance = new this.constructor(null, null, {_cloning: true});
        if (!reset) {
            instance._maxValue = this._maxValue;
        }
        instance.roll = this.roll.clone({reset});
        instance.periodized = new Map();
        for (const [period, {roll, peak}] of this.periodized.entries()) {
            instance.periodized.set(period, {
                roll: roll.clone({reset}),
                peak: reset ? null : peak,
            });
        }
        return instance;
    }

    add(time, value) {
        const elapsed = this._bufferedLen ? time - this._bufferedTimes[0] : 0;
        const idealGap = this.roll.idealGap;
        if (elapsed < idealGap) {
            const i = this._bufferedLen++;
            this._bufferedTimes[i] = time;
            this._bufferedValues[i] = value;
        } else {
            let totV = 0;
            for (let i = 0; i < this._bufferedLen; i++) {
                totV += this._bufferedValues[i];
            }
            // XXX check perf and maybe replace with 1 second idealized version as micro opt
            // XXX2 sometimes this will be the same ts and the prev entry.  If there is a gap and we only have a few datapoints
            // then we will round down. Maybe we can always round up?  More testing!
            const adjTime = Math.round(this._bufferedTimes[this._bufferedLen - 1] / idealGap) * idealGap;
            const adjValue = Math.round(totV / this._bufferedLen);
            this._add(adjTime, adjValue);
            this._bufferedTimes[0] = time;
            this._bufferedValues[0] = value;
            this._bufferedLen = 1;
        }
    }

    _add(time, value) {
        this.roll.add(time, value);
        if (value > this._maxValue) {
            this._maxValue = value;
        }
        this._resizePeriodized();
    }

    resize() {
        this.roll.resize();
        const value = this.roll.valueAt(-1);
        if (value > this._maxValue) {
            this._maxValue = value;
        }
        this._resizePeriodized();
    }

    _resizePeriodized() {
        for (const x of this.periodized.values()) {
            x.roll.resize();
            if (x.roll.full()) {
                const avg = x.roll.avg();
                if (x.peak === null || avg >= x.peak.avg()) {
                    x.peak = x.roll.clone();
                }
            }
        }
    }

    getStats(tsOffset, extra) {
        const peaks = {};
        const smooth = {};
        for (const [p, {roll, peak}] of this.periodized.entries()) {
            peaks[p] = {
                avg: peak ? peak.avg() : null,
                ts: peak ? tsOffset + (peak.lastTime() * 1000): null
            };
            smooth[p] = roll.avg();
        }
        return {
            avg: this.roll.avg(),
            max: this._maxValue,
            peaks,
            smooth,
            ...extra,
        };
    }
}


class ExtendedRollingPower extends sauce.power.RollingPower {
    setWPrime(cp, wPrime) {
        this._wBalIncrementor = sauce.power.makeIncWPrimeBalDifferential(cp, wPrime);
        for (const v of this.values()) {
            this.wBal = this._wBalIncrementor(v);
        }
        if (this.wBal === undefined) {
            this.wBal = wPrime;
        }
    }

    _add(time, value) {
        const r = super._add(time, value);
        if (this._wBalIncrementor) {
            // NOTE This doesn't not support any resizing
            this.wBal = this._wBalIncrementor(value);
        }
        return r;
    }
}


export class StatsProcessor extends events.EventEmitter {
    constructor(options={}) {
        super();
        this.zwiftAPI = options.zwiftAPI;
        this.gameMonitor = options.gameMonitor;
        this.setMaxListeners(100);
        this.athleteId = null;
        this.watching = null;
        this._athleteData = new Map();
        this._athletesCache = new Map();
        this._stateProcessCount = 0;
        this._stateDupCount = 0;
        this._stateStaleCount = 0;
        this._profileFetchIds = new Set();
        this._pendingProfileFetches = [];
        this._profileFetchCount = 0;
        this._chatHistory = [];
        this._recentEvents = new Map();
        this._recentEventSubgroups = new Map();
        this._routes = new Map();
        this._mostRecentNearby = [];
        this._mostRecentGroups = [];
        rpc.register(this.updateAthlete, {scope: this});
        rpc.register(this.startLap, {scope: this});
        rpc.register(this.resetStats, {scope: this});
        rpc.register(this.exportFIT, {scope: this});
        rpc.register(this.getAthlete, {scope: this});
        rpc.register(this.getEvent, {scope: this});
        rpc.register(this.getEvents, {scope: this});
        rpc.register(this.getEventSubgroup, {scope: this});
        rpc.register(this.getEventSubgroupEntrants, {scope: this});
        rpc.register(this.getRoute, {scope: this});
        rpc.register(this.resetAthletesDB, {scope: this});
        rpc.register(this.getChatHistory, {scope: this});
        rpc.register(this.setFollowing, {scope: this});
        rpc.register(this.setNotFollowing, {scope: this});
        rpc.register(this.giveRideon, {scope: this});
        rpc.register(this.getPlayerState, {scope: this});
        rpc.register(this.getNearbyData, {scope: this});
        rpc.register(this.getGroupsData, {scope: this});
        rpc.register(this.getAthleteData, {scope: this});
        this._athleteSubs = new Map();
        if (options.gameConnection) {
            const gc = options.gameConnection;
            gc.on('status', ({connected}) => this.onGameConnectionStatusChange(connected));
            gc.on('powerup-activate', this.onPowerupActivate.bind(this));
            gc.on('powerup-set', this.onPowerupSet.bind(this));
            gc.on('custom-action-button', this.onCustomActionButton.bind(this));
        }
    }

    onGameConnectionStatusChange(connected) {
        const data = this._athleteData.get(this.athleteId);
        if (data) {
            data.gameState = {};
        }
    }

    _getGameState() {
        if (!this._athleteData.has(this.athleteId)) {
            this._athleteData.set(this.athleteId, this._createAthleteData(this.athleteId), Date.now());
            debugger;
        }
        const data = this._athleteData.get(this.athleteId);
        if (!data.gameState) {
            data.gameState = {};
        }
        return data.gameState;
    }
        
    onPowerupSet({powerup}) {
        const s = this._getGameState();
        if (s) {
            s.powerup = powerup;
        }
    }

    onPowerupActivate() {
        const s = this._getGameState();
        if (s) {
            s.powerup = null;
        }
    }

    onCustomActionButton(info, command) {
        const s = this._getGameState();
        if (s) {
            if (!s.buttons) {
                s.buttons = {};
            }
            s.buttons[info.button] = info.state;
        }
    }

    getEvent(id) {
        return this._recentEvents.get(id);
    }

    getEvents() {
        return Array.from(this._recentEvents.values()).sort((a, b) => a.ts - b.ts);
    }

    getEventSubgroup(id) {
        return this._recentEventSubgroups.get(id);
    }

    async getEventSubgroupEntrants(id) {
        const profiles = await this.zwiftAPI.getEventSubgroupEntrants(id);
        const entrants = [];
        for (const p of profiles) {
            entrants.push({
                id: p.id,
                athlete: this.updateAthlete(p.id, this._profileToAthlete(p)),
                likelyInGame: p.likelyInGame,
            });
        }
        return entrants;
    }

    getRoute(id) {
        return this._routes.get(id);
    }

    getChatHistory() {
        return this._chatHistory.map(x => {
            const athlete = this._athletesCache.get(x.from);
            x.muted = (athlete && athlete.muted != null) ? athlete.muted : x.muted;
            return x;
        });
    }

    getAthletesData() {
        return Array.from(this._athleteData.values()).map(this._formatAthleteEntry.bind(this));
    }

    getAthleteData(id) {
        const data = this._athleteData.get(id);
        return data ? this._formatAthleteEntry(data) : null;
    }

    getNearbyData() {
        return Array.from(this._mostRecentNearby);
    }

    getGroupsData() {
        return Array.from(this._mostRecentGroups);
    }

    startLap() {
        console.debug("User requested lap start");
        const now = monotonic();
        for (const data of this._athleteData.values()) {
            const lastLap = data.laps.at(-1);
            lastLap.end = now;
            Object.assign(lastLap, this.cloneDataCollectors(lastLap));
            data.laps.push({
                start: now,
                ...this.cloneDataCollectors(data, {reset: true}),
            });
        }
    }

    resetStats() {
        console.debug("User requested stats reset");
        this._athleteData.clear();
    }

    async exportFIT(athleteId) {
        console.debug("Exporting FIT file for:", athleteId);
        if (athleteId == null) {
            throw new TypeError('athleteId required');
        }
        if (!this._athleteData.has(athleteId)) {
            throw new TypeError('no data for athlete');
        }
        const fit = await import('jsfit');
        const fitParser = new fit.FitParser();
        fitParser.addMessage('file_id', {
            type: 'activity',
            manufacturer: 0,
            product: 0,
            time_created: new Date(),
            serial_number: 0,
            number: null,
            product_name: 'Sauce for Zwift',
        });
        const [vmajor, vminor] = pkg.version.split('.');
        fitParser.addMessage('file_creator', {
            software_version: Number([vmajor.slice(0, 2),
                vminor.slice(0, 2).padStart(2, '0')].join('')),
            hardware_version: null,
        });
        const athlete = this.loadAthlete(athleteId);
        if (athlete) {
            fitParser.addMessage('user_profile', {
                friendly_name: athlete.fullname,
                gender: athlete.gender || 'male',
                weight: athlete.weight || 0,
                weight_setting: 'metric',
            });
        }
        const {laps, tsOffset, mostRecentState} = this._athleteData.get(athleteId);
        const sport = {
            0: 'cycling',
            1: 'running',
        }[mostRecentState ? mostRecentState.sport : 0] || 'generic';
        fitParser.addMessage('event', {
            event: 'timer',
            event_type: 'start',
            event_group: 0,
            timestamp: tsOffset,
            data: 'manual',
        });
        let lapNumber = 0;
        let lastTS;
        for (const {power, speed, cadence, hr} of laps) {
            if ([speed, cadence, hr].some(x => x.roll.size() !== power.roll.size())) {
                throw new Error("Assertion failure about roll sizes being equal");
            }
            for (let i = 0; i < power.roll.size(); i++) {
                lastTS = tsOffset + (power.roll.timeAt(i) * 1000);
                const record = {timestamp: lastTS};
                record.speed = speed.roll.valueAt(i) * 1000 / 3600;
                record.heart_rate = +hr.roll.valueAt(i);
                record.cadence = Math.round(cadence.roll.valueAt(i));
                record.power = Math.round(power.roll.valueAt(i));
                fitParser.addMessage('record', record);
            }
            const elapsed = power.roll.lastTime() - power.roll.firstTime();
            const lap = {
                message_index: lapNumber++,
                lap_trigger: lapNumber === laps.length ? 'session_end' : 'manual',
                event: 'lap',
                event_type: 'stop',
                sport,
                timestamp: lastTS,
                start_time: tsOffset + (power.roll.firstTime() * 1000),
                total_elapsed_time: elapsed,
                total_timer_time: elapsed, // We can't really make a good assessment.
            };
            fitParser.addMessage('lap', lap);
        }
        fitParser.addMessage('event', {
            event: 'timer',
            event_type: 'stop_all',
            event_group: 0,
            timestamp: lastTS,
            data: 'manual',
        });
        const elapsed = (lastTS - tsOffset) / 1000;
        fitParser.addMessage('session', {
            timestamp: lastTS,
            event: 'session',
            event_type: 'stop',
            start_time: tsOffset,
            sport,
            sub_sport: 'generic',
            total_elapsed_time: elapsed,
            total_timer_time: elapsed,  // We don't really know
            first_lap_index: 0,
            num_laps: laps.length,
            trigger: 'activity_end',
        });
        fitParser.addMessage('activity', {
            timestamp: lastTS,
            total_timer_time: elapsed,  // We don't really know
            num_sessions: 1,
            type: 'manual',
            event: 'activity',
            event_type: 'stop',
        });
        return Array.from(fitParser.encode());
    }

    _profileToAthlete(p) {
        const powerMeterSources = ['Power Meter', 'Smart Trainer'];
        const powerMeter = powerMeterSources.includes(p.powerSourceModel);
        const o = {
            firstName: p.firstName,
            lastName: p.lastName,
            ftp: p.ftp,
            type: p.playerType,
            countryCode: p.countryCode, // iso 3166
            avatar: p.imageSrcLarge || p.imageSrc,
            weight: p.weight ? p.weight / 1000 : undefined,
            height: p.height ? p.height / 10 : undefined,
            gender: p.male === false ? 'female' : 'male',
            age: (p.privacy && p.privacy.displayAge) ? p.age : null,
            level: p.achievementLevel ? Math.floor(p.achievementLevel / 100) : undefined,
            powerMeter,
        };
        if (p.socialFacts) {
            o.following = p.socialFacts.followerStatusOfLoggedInPlayer === 'IS_FOLLOWING';
            o.followRequest = p.socialFacts.followerStatusOfLoggedInPlayer === 'REQUESTS_TO_FOLLOW';
            o.favorite = p.socialFacts.isFavoriteOfLoggedInPlayer;
        }
        return o;
    }

    updateAthlete(id, data) {
        const fullData = this._updateAthlete(id, data);
        this.saveAthletes([[id, fullData]]);
        return fullData;
    }

    _updateAthlete(id, data) {
        const d = this.loadAthlete(id) || {};
        d.id = id;
        d.updated = Date.now();
        d.name = (data.firstName || data.lastName) ? [data.firstName, data.lastName].map(x =>
            (x && x.trim) ? x.trim() : null).filter(x => x) : d.name;
        d.fullname = d.name && d.name.join(' ');
        let saniFirst;
        let saniLast;
        if (d.name && d.name.length) {
            const edgeJunk = /^[.*_#\-\s]+|[.*_#\-\s]+$/g;
            saniFirst = d.name[0].replace(edgeJunk, '');
            const idx = d.name.length - 1;
            const [name, team] = splitNameAndTeam(d.name[idx]);
            if (idx > 0) {
                saniLast = name && name.replace(edgeJunk, '');
            } else {
                // User only set a last name, sometimes because this looks better in game.
                saniFirst = name;
            }
            d.team = team;
        }
        d.sanitizedName = (saniFirst || saniLast) ? [saniFirst, saniLast].filter(x => x) : null;
        d.sanitizedFullname = d.sanitizedName && d.sanitizedName.join(' ');
        d.initials = d.sanitizedName ? d.sanitizedName.map(x => x[0]).join('').toUpperCase() : null;
        if (d.wPrime === undefined && data.wPrime === undefined) {
            data.wPrime = 20000; // Po-boy migration
        }
        const wPrimeUpdated = data.wPrime !== undefined && data.wPrime !== d.wPrime;
        for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
                d[k] = v;
            }
        }
        if (wPrimeUpdated) {
            this.updateAthleteWPrime(id, d);
        }
        return d;
    }

    loadAthlete(id) {
        const a = this._athletesCache.get(id);
        if (a !== undefined) {
            return a;
        }
        const r = this.getAthleteStmt.get(id);
        if (r) {
            const data = JSON.parse(r.data);
            this._athletesCache.set(id, data);
            return data;
        } else {
            this._athletesCache.set(id, null);
        }
    }

    updateAthleteWPrime(id, {ftp, wPrime}) {
        const ad = this._athleteData.get(id);
        if (!ad || !ftp || !wPrime) {
            return;
        }
        ad.power.roll.setWPrime(ftp, wPrime);
    }

    async getAthlete(id, options={}) {
        if (this.zwiftAPI.isAuthenticated()) {
            if (!options.refresh) {
                return this.loadAthlete(id);
            } else {
                const p = await this.zwiftAPI.getProfile(id);
                if (p) {
                    return this.updateAthlete(p.id, this._profileToAthlete(p));
                }
            }
        } else {
            return this.loadAthlete(id);
        }
    }

    saveAthletes(records) {
        const stmt = this.athletesDB.prepare('INSERT OR REPLACE INTO athletes (id, data) VALUES(?, ?)');
        this.athletesDB.transaction(() => {
            for (const [id, data] of records) {
                this._athletesCache.set(id, data);
                stmt.run(id, JSON.stringify(data));
            }
        })();
    }

    onIncoming(...args) {
        try {
            this._onIncoming(...args);
        } catch(e) {
            report.errorOnce(e);
        }
    }

    _onIncoming(packet) {
        for (const x of packet.worldUpdates) {
            x.payloadType = protos.WorldUpdatePayloadType[x._payloadType];
            if (!x.payloadType) {
                console.warn("No enum type for:", x._payloadType);
            } else if (x.payloadType[0] !== '_') {
                const PayloadMsg = protos.get(x.payloadType);
                if (!PayloadMsg) {
                    throw new Error("Missing protobuf for type:", x.payloadType);
                }
                x.payload = PayloadMsg.decode(x._payload);
                const ts = highPrecTimeConv(x.ts);
                if (x.payloadType === 'PayloadChatMessage') {
                    this.handleChatPayload(x.payload, ts);
                } else if (x.payloadType === 'PayloadRideOn') {
                    this.handleRideOnPayload(x.payload, ts);
                } else {
                    console.debug(x.payloadType, x.payload.toJSON());
                }
            }
        }
        for (const x of packet.playerStates) {
            if (this.processState(x) === false) {
                continue;
            }
            if (x.athleteId === this.watching) {
                this._watchingRoadSig = this._roadSig(x);
            }
        }
        if (packet.playerSummaries) {
            debugger;
        }
        if (packet.expungeReason) {
            console.error("Expunged:", packet.expungeReason);
            debugger;
        }
        if (packet.eventPositions) {
            const ep = packet.eventPositions;
            if (ep.position && this._athleteData.has(ep.watchingAthleteId)) {
                const ad = this._athleteData.get(ep.watchingAthleteId);
                ad.eventPosition = ep.position;
                ad.eventParticipants = ep.activeAthleteCount;
            }
            // There are several groups of fields on eventPositions, but I don't understand them.
            for (const x of ep.players10) {
                const ad = this._athleteData.get(x.athleteId);
                if (ad) {
                    ad.eventPosition = x.position;
                    ad.eventParticipants = ep.activeAthleteCount;
                }
            }
        }
    }

    handleRideOnPayload(payload, ts) {
        this.emit('rideon', {...payload, ts});
        console.debug("RideOn:", payload);
    }

    handleChatPayload(payload, ts) {
        for (let i = 0; i < this._chatHistory.length && i < 10; i++) {
            const x = this._chatHistory[i];
            if (x.ts === ts && x.from === payload.from) {
                console.warn("Deduping chat message:", ts, payload.from, payload.message);
                return;
            }
        }
        const athlete = this.loadAthlete(payload.from);
        const chat = {...payload, ts};
        if (athlete) {
            // back compat with old dbs
            const nameArr = athlete.sanitizedName || athlete.name || ['', ''];
            Object.assign(chat, {
                muted: athlete.muted,
                firstName: nameArr[0],
                lastName: nameArr[1],
                team: athlete.team,
            });
        }
        console.debug('Chat:', chat.firstName || '', chat.lastName || '', chat.message);
        this._chatHistory.unshift(chat);
        if (this._chatHistory.length > 50) {
            this._chatHistory.length = 50;
        }
        this.emit('chat', chat);
    }

    setWatching(athleteId) {
        if (athleteId === this.watching) {
            return;
        }
        console.info("Now watching:", athleteId);
        this.watching = athleteId;
        this._pendingProfileFetches.length = 0;
        this.emit('watching-athlete-change', athleteId);
    }

    _roadSig(state) {
        return `${state.courseId},${state.roadId},${state.reverse}`;
    }

    _getCollectorStats(data, athlete, isLap) {
        const end = data.end || monotonic();
        const elapsed = (end - data.start) / 1000;
        const np = data.power.roll.np({force: true});
        if (!isLap && data.power.roll.wBal === undefined && athlete && athlete.ftp && athlete.wPrime) {
            data.power.roll.setWPrime(athlete.ftp, athlete.wPrime);
        }
        const wBal = data.power.roll.wBal;
        const tss = np && athlete && athlete.ftp ?
            sauce.power.calcTSS(np, data.power.roll.active(), athlete.ftp) :
            undefined;
        return {
            elapsed,
            power: data.power.getStats(data.tsOffset, {np, tss, wBal}),
            speed: data.speed.getStats(data.tsOffset),
            hr: data.hr.getStats(data.tsOffset),
            draft: data.draft.getStats(data.tsOffset),
            cadence: data.cadence.getStats(data.tsOffset),
        };
    }

    makeDataCollectors() {
        const periods = [5, 15, 60, 300, 1200];
        const longPeriods = periods.filter(x => x >= 60);
        return {
            power: new DataCollector(ExtendedRollingPower, periods, {inlineNP: true}),
            speed: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true}),
            hr: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true}),
            draft: new DataCollector(sauce.data.RollingAverage, longPeriods),
        };
    }

    cloneDataCollectors(collectors, options={}) {
        return {
            power: collectors.power.clone(options),
            speed: collectors.speed.clone(options),
            hr: collectors.hr.clone(options),
            cadence: collectors.cadence.clone(options),
            draft: collectors.draft.clone(options),
        };
    }

    maybeUpdateAthleteFromServer(athleteId) {
        if (this._profileFetchIds.has(athleteId)) {
            return;
        }
        this._profileFetchIds.add(athleteId);
        this._pendingProfileFetches.push(athleteId);
        if (!this._athleteProfileUpdater && this._pendingProfileFetches.length) {
            this._athleteProfileUpdater = this.runAthleteProfileUpdater().finally(() =>
                this._athleteProfileUpdater = null);
        }
    }

    async _updateAthleteProfilesFromServer(batch) {
        const updates = [];
        let allowRefetchAfter = 1000; // err
        try {
            for (const p of await this.zwiftAPI.getProfiles(batch)) {
                if (p) {
                    updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
                }
            }
            // Could probably extend this if we integrated player update handling effectively.
            allowRefetchAfter = 300 * 1000;
        } finally {
            setTimeout(() => {
                for (const x of batch) {
                    this._profileFetchIds.delete(x);
                }
            }, allowRefetchAfter);
        }
        if (updates.length) {
            this.saveAthletes(updates);
        }
    }

    async runAthleteProfileUpdater() {
        while (this._pendingProfileFetches.length) {
            const batch = Array.from(this._pendingProfileFetches);
            this._pendingProfileFetches.length = 0;
            this._profileFetchCount += batch.length;
            try {
                await this._updateAthleteProfilesFromServer(batch);
            } catch(e) {
                console.error("Error while collecting profiles from server:", e);
            }
            await sauce.sleep(100);
        }
    }

    _createAthleteData(athleteId, tsOffset) {
        const collectors = this.makeDataCollectors();
        const start = monotonic();
        return {
            start,
            tsOffset,
            athleteId,
            mostRecentState: null,
            roadHistory: {
                sig: null,
                prevSig: null,
                timeline: [],
                prevTimeline: null,
            },
            laps: [{
                start,
                ...this.cloneDataCollectors(collectors, {reset: true})
            }],
            ...collectors,
        };
    }

    processState(state) {
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId, this._createAthleteData(state.athleteId, state.ts));
        }
        const ad = this._athleteData.get(state.athleteId);
        const prevState = ad.mostRecentState;
        if (prevState && prevState.ts >= state.ts) {
            if (prevState.ts === state.ts) {
                this._stateDupCount++;
            } else {
                this._stateStaleCount++;
            }
            return false;
        }
        if (state.eventSubgroupId) {
            const sg = this._recentEventSubgroups.get(state.eventSubgroupId);
            if (sg && sg.tags && sg.tags.includes('hidethehud')) {
                return;
            }
        }
        ad.mostRecentState = state;
        const roadSig = this._roadSig(state);
        if (prevState) {
            let shiftHistory;
            if (roadSig !== ad.roadHistory.sig) {
                shiftHistory = prevState.courseId === state.courseId;
            } else {
                const last = ad.roadHistory.timeline[ad.roadHistory.timeline.length - 1];
                const delta = state.roadCompletion - last.roadCompletion;
                if (delta < 0) { // unlikely
                    if (delta < -10000) {
                        shiftHistory = true;
                    } else {
                        // Stopped and wiggling backwards. For safety we just nuke hist.
                        console.debug('Wiggler detected:', delta, state.athleteId);
                        ad.roadHistory.timeline.length = 0;
                    }
                }
            }
            if (shiftHistory) {
                ad.roadHistory.prevSig = ad.roadHistory.sig;
                ad.roadHistory.prevTimeline = ad.roadHistory.timeline;
                ad.roadHistory.timeline = [];
            } else if (shiftHistory === false) {
                ad.roadHistory.prevSig = null;
                ad.roadHistory.prevTimeline = null;
            }
            if (ad.eventPosition && (!state.eventSubgroupId ||
                prevState.eventSubgroupId !== state.eventSubgroupId)) {
                delete ad.eventPosition;
                delete ad.eventParticipants;
            }
        }
        ad.roadHistory.sig = roadSig;
        ad.roadHistory.timeline.push({
            ts: state.ts,
            roadCompletion: state.roadCompletion,
            distance: state.distance,
        });
        const tl = ad.roadHistory.timeline;
        if (tl.length === 5 || tl.length % 25 === 0) {
            const hist = tl[tl.length - 50] || tl[0];
            const cur = tl[tl.length - 1];
            const mDelta = cur.distance - hist.distance;
            const rlDelta = cur.roadCompletion - hist.roadCompletion;
            if (mDelta && rlDelta) {
                adjRoadDistEstimate(roadSig, 1000000 / rlDelta * mDelta);
            }
        }
        const time = (state.ts - ad.tsOffset) / 1000;
        ad.power.add(time, state.power);
        ad.speed.add(time, state.speed);
        ad.hr.add(time, state.heartrate);
        ad.draft.add(time, state.draft);
        ad.cadence.add(time, state.cadence);
        const curLap = ad.laps[ad.laps.length - 1];
        curLap.power.resize(time);
        curLap.speed.resize(time);
        curLap.hr.resize(time);
        curLap.draft.resize(time);
        curLap.cadence.resize(time);
        ad.updated = monotonic();
        if (this.watching === state.athleteId && this.listenerCount('athlete/watching')) {
            this.emit('athlete/watching', this._formatAthleteEntry(ad));
        }
        if (this.athleteId === state.athleteId && this.listenerCount('athlete/self')) {
            this.emit('athlete/self', this._formatAthleteEntry(ad));
        }
        if (this.listenerCount(`athlete/${state.athleteId}`)) {
            this.emit(`athlete/${state.athleteId}`, this._formatAthleteEntry(ad));
        }
        this._stateProcessCount++;
    }

    async resetAthletesDB() {
        await resetDB();
        this._athletesCache.clear();
        this.initAthletesDB();
    }

    initAthletesDB() {
        this.athletesDB = getDB();
        this.getAthleteStmt = this.athletesDB.prepare('SELECT data FROM athletes WHERE id = ?');
    }

    start() {
        this._active = true;
        try {
            this.initAthletesDB();
        } catch(e) {
            report.errorOnce(e);
            this.resetAthletesDB();
        }
        this._statesJob = this._statesProcessor();
        this._gcInterval = setInterval(this.gcStates.bind(this), 32768);
        this.athleteId = this.zwiftAPI.profile.id;
        this.gameMonitor.on('inPacket', this.onIncoming.bind(this));
        this.gameMonitor.on('watching-athlete', this.setWatching.bind(this));
        this.gameMonitor.start();
        this._zwiftMetaRefresh = 60000;
        queueMicrotask(() => this._zwiftMetaSync());
    }

    async stop() {
        this._active = false;
        clearInterval(this._gcInterval);
        this._gcInterval = null;
        try {
            await this._statesJob;
        } finally {
            this._nearybyJob = null;
        }
    }

    async _zwiftMetaSync() {
        if (!this._active || !this.zwiftAPI.isAuthenticated()) {
            console.warn("Skipping social network update because not logged into zwift");
            return;
        }
        // The event feed APIs are horribly broken so we need to refresh more often
        // at startup to try and fill in the gaps.
        setTimeout(this._zwiftMetaSync.bind(this), this._zwiftMetaRefresh);
        this._zwiftMetaRefresh = Math.min(30 * 60 * 1000, this._zwiftMetaRefresh * 2);
        const followees = await this.zwiftAPI.getFollowees(this.athleteId);
        const updates = [];
        for (const x of followees) {
            const p = x.followeeProfile;
            if (p) {
                updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
            }
        }
        if (updates.length) {
            this.saveAthletes(updates);
        }
        if (!this._routes.size) {
            const gameInfo = await this.zwiftAPI.getGameInfo();
            for (const x of gameInfo.maps) {
                for (const xx of x.routes) {
                    this._routes.set(xx.id, {world: x.name, ...xx});
                }
            }
        }
        const someEvents = await this.zwiftAPI.getEventFeed(); // This API is wonky
        for (const x of someEvents) {
            const route = this._routes.get(x.routeId);
            if (route) {
                x.routeDistance = this._getRouteDistance(route, x.laps);
                x.routeClimbing = this._getRouteClimbing(route, x.laps);
            }
            x.ts = new Date(x.eventStart).getTime();
            this._recentEvents.set(x.id, x);
            if (x.eventSubgroups) {
                for (const sg of x.eventSubgroups) {
                    const route = this._routes.get(sg.routeId);
                    if (route) {
                        sg.routeDistance = this._getRouteDistance(route, sg.laps);
                        sg.routeClimbing = this._getRouteClimbing(route, sg.laps);
                    }
                    this._recentEventSubgroups.set(sg.id, {
                        event: x,
                        route: this._routes.get(sg.routeId),
                        ...sg
                    });
                }
            }
        }
        const someMeetups = await this.zwiftAPI.getPrivateEventFeed(); // This API is wonky
        for (const x of someMeetups) {
            x.routeDistance = this.getRouteDistance(x.routeId, x.laps);
            x.type = 'EVENT_TYPE_MEETUP';
            x.totalEntrantCount = x.acceptedTotalCount;
            x.eventSubgroups = [];
            x.ts = new Date(x.eventStart).getTime();
            this._recentEvents.set(x.id, x);
            if (x.eventSubgroupId) {
                // Meetups are basicaly a hybrid event/subgroup
                this._recentEventSubgroups.set(x.eventSubgroupId, {
                    event: x,
                    route: this._routes.get(x.routeId),
                    ...x
                });
            }
        }
        console.info(`Updated zwift data for ${updates.length} followees, ` +
            `${someEvents.length} events, ${someMeetups.length} meetups`);
    }

    async setFollowing(athleteId) {
        const resp = await this.zwiftAPI._setFollowing(athleteId, this.athleteId);
        return this.updateAthlete(athleteId, {
            following: resp.status === 'IS_FOLLOWING',
            followRequest: resp.status === 'REQUESTS_TO_FOLLOW',
        });
    }

    async setNotFollowing(athleteId) {
        await this.zwiftAPI._setNotFollowing(athleteId, this.athleteId);
        return this.updateAthlete(athleteId, {
            following: false,
            followRequest: false,
        });
    }

    async giveRideon(athleteId, activity=0) {
        return await this.zwiftAPI._giveRideon(athleteId, this.athleteId, activity);
    }

    async getPlayerState(athleteId) {
        let state;
        if (this._athleteData.has(athleteId)) {
            state = this._athleteData.get(athleteId).mostRecentState;
        } else {
            state = await this.zwiftAPI.getPlayerState(athleteId);
        }
        if (state) {
            return this._cleanState(state);
        }
    }

    compareRoadPositions(aData, bData) {
        const a = aData.roadHistory;
        const b = bData.roadHistory;
        const aTail = a.timeline[a.timeline.length - 1];
        const bTail = b.timeline[b.timeline.length - 1];
        const aComp = aTail.roadCompletion;
        const bComp = bTail.roadCompletion;
        // Is A currently leading B or vice versa...
        if (a.sig === b.sig) {
            const d = aComp - bComp;
            // Test for lapping cases where inverted is closer
            const roadDist = roadDistEstimates[a.sig] || 0;
            if (d < -500000 && a.prevSig === b.sig) {
                const gapDistance = (1000000 + d) / 1000000 * roadDist;
                return {reversed: false, previous: true, gapDistance};
            } else if (d > 500000 && b.prevSig === a.sig) {
                const gapDistance = (1000000 - d) / 1000000 * roadDist;
                return {reversed: true, previous: true, gapDistance};
            } else if (d > 0) {
                const gapDistance = d / 1000000 * roadDist;
                return {reversed: false, previous: false, gapDistance};
            } else if (d < 0) {
                const gapDistance = -d / 1000000 * roadDist;
                return {reversed: true, previous: false, gapDistance};
            } else if (aTail.ts < bTail.ts) {
                return {reversed: false, previous: false, gapDistance: 0};
            } else {
                return {reversed: true, previous: false, gapDistance: 0};
            }
        } else {
            let d2;
            // Is B trailing A on a prev road...
            if (a.prevSig === b.sig) {
                const d = a.prevTimeline[a.prevTimeline.length - 1].roadCompletion - bComp;
                if (d >= 0) {
                    d2 = d;
                }
            }
            // Is A trailing B on a prev road...
            if (b.prevSig === a.sig) {
                const bPrevTail = b.prevTimeline[b.prevTimeline.length - 1];
                const d = bPrevTail.roadCompletion - aComp;
                if (d >= 0 && (d2 === undefined || d < d2)) {
                    const roadDist = roadDistEstimates[b.prevSig] || 0;
                    const gapDistance = (d / 1000000 * roadDist) + (bTail.distance - bPrevTail.distance);
                    return {reversed: true, previous: true, gapDistance};
                }
            }
            if (d2 !== undefined) {
                // We can probably move this up tino the first d2 block once we validate the above condition
                // is not relevant.  Probably need to check on something funky like crit city or japan.
                const aPrevTail = a.prevTimeline[a.prevTimeline.length - 1];
                const roadDist = roadDistEstimates[a.prevSig] || 0;
                const gapDistance = (d2 / 1000000 * roadDist) + (aTail.distance - aPrevTail.distance);
                return {reversed: false, previous: true, gapDistance};
            }
        }
        return null;
    }

    realGap(a, b) {
        const rp = this.compareRoadPositions(a, b);
        return rp && this._realGap(rp, a, b);
    }

    _realGap({reversed, previous}, a, b) {
        if (reversed) {
            [a, b] = [b, a];
        }
        const aTimeline = previous ? a.roadHistory.prevTimeline : a.roadHistory.timeline;
        const bTail = b.roadHistory.timeline[b.roadHistory.timeline.length - 1];
        let prev;
        // TODO: Check if binary search is a win despite end of array locality
        for (let i = aTimeline.length - 1; i >= 0; i--) {
            const x = aTimeline[i];
            if (x.roadCompletion <= bTail.roadCompletion) {
                let offt = 0;
                if (prev) {
                    const dist = prev.roadCompletion - x.roadCompletion;
                    const time = prev.ts - x.ts;
                    offt = (bTail.roadCompletion - x.roadCompletion) / dist * time;
                }
                return Math.abs((bTail.ts - x.ts - offt) / 1000);
            }
            prev = x;
        }
        return null;
    }

    gcStates() {
        const now = monotonic();
        const expiration = now - 300 * 1000;
        for (const [k, {updated}] of this._athleteData.entries()) {
            if (updated < expiration) {
                this._athleteData.delete(k);
                this._athletesCache.delete(k);
            }
        }
    }

    async _statesProcessor() {
        let errBackoff = 1;
        const interval = 1000;
        // Useful for testing as it puts us on a perfect boundry.
        await sauce.sleep(interval - (Date.now() % interval));
        // Use a incrementing target to provide skew resistent intervals
        // I.e. make it emulate the typcial realtime nature of a head unit
        // which most of our stats code performs best with.
        let target = monotonic();
        while (this._active) {
            let skipped = 0;
            while (monotonic() > (target += interval)) {
                skipped++;
            }
            if (skipped) {
                console.warn("States processor skipped:", skipped);
            }
            await sauce.sleep(target - monotonic());
            if (this.watching == null) {
                continue;
            }
            try {
                const nearby = this._mostRecentNearby = this._computeNearby();
                const groups = this._mostRecentGroups = this._computeGroups(nearby);
                queueMicrotask(() => this.emit('nearby', nearby));
                queueMicrotask(() => this.emit('groups', groups));
            } catch(e) {
                report.errorThrottled(e);
                target += errBackoff++ * interval;
            }
        }
    }

    _cleanState(raw) {
        const o = {};
        const keys = Object.keys(raw);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k[0] !== '_') {
                o[k] = raw[k];
            }
        }
        return o;
    }

    getRouteDistance(routeId, laps=1) {
        const route = this._routes.get(routeId);
        if (route) {
            return this._getRouteDistance(route, laps);
        }
    }

    _getRouteDistance(route, laps=1) {
        if (route.distanceInMetersFromEventStart) {
            console.warn("Investiagate dist from event start value",
                route.distanceInMetersFromEventStart);
            // Probably we need to add this to the distance. XXX
            debugger;
        }
        return route.leadinDistanceInMeters + (route.distanceInMeters * (laps || 1));
    }

    getRouteClimbing(routeId, laps=1) {
        const route = this._routes.get(routeId);
        if (route) {
            return this._getRouteClimbing(route, laps);
        }
    }

    _getRouteClimbing(route, laps=1) {
        return route.leadinAscentInMeters + (route.ascentInMeters * (laps || 1));
    }

    _getRemaining(state) {
        const sg = state.eventSubgroupId && this._recentEventSubgroups.get(state.eventSubgroupId);
        if (sg) {
            if (sg.durationInSeconds) {
                const eventEnd = +(new Date(sg.eventSubgroupStart || sg.eventStart)) +
                    (sg.durationInSeconds * 1000);
                return {
                    remaining: (eventEnd - Date.now()) / 1000,
                    remainingMetric: 'time',
                    remainingType: 'event',
                };
            } else {
                const distance = sg.distanceInMeters || this._getRouteDistance(sg.route, sg.laps);
                return {
                    remaining: distance - state.eventDistance,
                    remainingMetric: 'distance',
                    remainingType: 'event',
                };
            }
        } else if (state.routeId) {
            const route = this._routes.get(state.routeId);
            if (route) {
                const distance = this._getRouteDistance(route);
                return {
                    remaining: distance - (state.progress * distance),
                    remainingMetric: 'distance',
                    remainingType: 'route',
                };
            }
        }
    }

    _formatAthleteEntry(data, extra) {
        const athlete = this.loadAthlete(data.athleteId);
        const state = data.mostRecentState;
        return {
            athleteId: state.athleteId,
            athlete,
            stats: this._getCollectorStats(data, athlete),
            laps: data.laps.map(x => this._getCollectorStats(x, athlete, /*isLap*/ true)),
            state: this._cleanState(state),
            latency: (Date.now() - state.ts) / 1000,
            eventPosition: data.eventPosition,
            eventParticipants: data.eventParticipants,
            gameState: data.gameState,
            ...this._getRemaining(state),
            ...extra,
        };
    }

    _formatNearbyEntry({data, isGapEst, rp, gap}) {
        return this._formatAthleteEntry(data, {
            gap,
            gapDistance: rp.gapDistance,
            isGapEst: isGapEst ? true : undefined,
            watching: data.athleteId === this.watching ? true : undefined,
        });
    }

    _computeNearby() {
        const watchingData = this._athleteData.get(this.watching);
        if (!watchingData) {
            return [];
        }
        const watching = {data: watchingData, gap: 0, isGapEst: false, rp: {gapDistance: 0}};
        // We need to use a speed value for estimates and just using one value is
        // dangerous, so we use a weighted function that's seeded (skewed) to the
        // the watching rider.
        const refSpeedForEstimates = makeExpWeighted(10); // maybe mv up and reuse? XXX
        const watchingSpeed = watching.data.mostRecentState.speed;
        if (watchingSpeed > 1) {
            refSpeedForEstimates(watchingSpeed);
        }
        // Only filter stopped riders if we are moving.
        const filterStopped = !!watchingSpeed;
        const ahead = [];
        const behind = [];
        for (const data of this._athleteData.values()) {
            if (data.athleteId !== this.watching) {
                const age = monotonic() - data.updated;
                if ((filterStopped && !data.mostRecentState.speed) || age > 10000) {
                    continue;
                }
                const rp = this.compareRoadPositions(data, watching.data);
                if (rp === null) {
                    continue;
                }
                const gap = this._realGap(rp, data, watching.data);
                if (rp.reversed) {
                    behind.push({data, rp, gap});
                } else {
                    ahead.push({data, rp, gap});
                }
            }
            this.maybeUpdateAthleteFromServer(data.athleteId);
        }

        ahead.sort((a, b) => b.rp.gapDistance - a.rp.gapDistance);
        behind.sort((a, b) => a.rp.gapDistance - b.rp.gapDistance);

        for (let i = ahead.length - 1; i >= 0; i--) {
            const x = ahead[i];
            const adjacent = ahead[i + 1] || watching;
            const speedRef = refSpeedForEstimates(x.data.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(x.data, adjacent.data);
                if (incGap == null) {
                    const incGapDist = x.rp.gapDistance - adjacent.rp.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap - incGap;
            } else {
                x.gap = -x.gap;
                x.isGapEst = false;
            }
            x.rp.gapDistance = -x.rp.gapDistance;
        }
        for (let i = 0; i < behind.length; i++) {
            const x = behind[i];
            const adjacent = behind[i - 1] || watching;
            const speedRef = refSpeedForEstimates(x.data.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(adjacent.data, x.data);
                if (incGap == null) {
                    const incGapDist = x.rp.gapDistance - adjacent.rp.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap + incGap;
            } else {
                x.isGapEst = false;
            }
        }

        const nearby = [];
        const maxGap = 15 * 60;
        for (let i = 0; i < ahead.length; i++) {
            if (ahead[i].gap > -maxGap) {
                nearby.push(this._formatNearbyEntry(ahead[i]));
            }
        }
        nearby.push(this._formatNearbyEntry(watching));
        for (let i = 0; i < behind.length; i++) {
            if (behind[i].gap < maxGap) {
                nearby.push(this._formatNearbyEntry(behind[i]));
            }
        }
        nearby.sort((a, b) => a.gap - b.gap);
        return nearby;
    }

    _computeGroups(nearby) {
        const groups = [];
        if (!nearby.length) {
            return groups;
        }
        let watchingIdx;
        let curGroup = {
            athletes: [],
            weight: 0,
            weightCount: 0,
            power: 0,
            draft: 0,
            heartrate: 0,
            heartrateCount: 0,
        };
        for (let i = 0, prevGap; i < nearby.length; i++) {
            const x = nearby[i];
            const innerGap = prevGap !== undefined ? x.gap - prevGap : 0;
            if (innerGap > 2) {
                curGroup.innerGap = innerGap;
                groups.push(curGroup);
                curGroup = {
                    athletes: [],
                    weight: 0,
                    weightCount: 0,
                    power: 0,
                    draft: 0,
                    heartrate: 0,
                    heartrateCount: 0,
                };
            }
            curGroup.athletes.push(x);
            const weight = x.athlete && x.athlete.weight || 0;
            curGroup.weight += weight;
            curGroup.weightCount += !!weight;
            curGroup.power += x.state.power || 0;
            curGroup.draft += x.state.draft || 0;
            curGroup.heartrate += x.state.heartrate || 0;
            curGroup.heartrateCount += !!x.state.heartrate;
            if (x.athleteId === this.watching) {
                curGroup.watching = true;
                watchingIdx = groups.length;
            }
            prevGap = x.gap;
        }
        groups.push(curGroup);
        for (let i = 0; i < groups.length; i++) {
            const x = groups[i];
            x.weight /= x.weightCount;
            x.power /= x.athletes.length;
            x.draft /= x.athletes.length;
            x.speed = sauce.data.median(x.athletes.map(x => x.state.speed));
            x.heartrate /= x.heartrateCount;
            if (watchingIdx !== i) {
                const edge = watchingIdx < i ? x.athletes[0] : x.athletes[x.athletes.length - 1];
                x.isGapEst = edge.isGapEst;
                x.gap = edge.gap;
            } else {
                x.gap = 0;
                x.isGapEst = false;
            }
        }
        return groups;
    }

    getDebugInfo() {
        return {
            pendingZwiftProfileFetches: this._pendingProfileFetches.length,
            zwiftProfileFetchCount: this._profileFetchCount,
            stateProcessCount: this._stateProcessCount,
            stateDupCount: this._stateDupCount,
            stateStaleCount: this._stateStaleCount,
            activeAthletesSize: this._athleteData.size,
            activeAthleteDataPoints: Array.from(this._athleteData.values())
                .map(x =>
                    x.power.roll.size() +
                    x.speed.roll.size() +
                    x.hr.roll.size() +
                    x.hr.roll.size() +
                    x.draft.roll.size())
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this._athletesCache.size,
        };
    }
}
