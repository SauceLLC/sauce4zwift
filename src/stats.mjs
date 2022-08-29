import events from 'node:events';
import path from 'node:path';
import protobuf from 'protobufjs';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as rpc from './rpc.mjs';
import * as zwift from './zwift.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import {captureExceptionOnce} from '../shared/sentry-util.mjs';
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


function headingConv(microRads) {
    const halfCircle = 1000000 * Math.PI;
    return (((microRads + halfCircle) / (2 * halfCircle)) * 360) % 360;
}


function crowDistance(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 100;  // roughly meters
}


function estGap(a, b, dist) {
    dist = dist !== undefined ? dist : crowDistance(a, b);
    return dist / ((a.speed || b.speed || 1) * 1000 / 3600);
}


class DataCollector {
    constructor(Klass, periods, options={}) {
        this._maxPower = 0;
        if (options._cloning) {
            return;
        }
        const defOptions = {idealGap: 1, maxGap: 15, active: true};
        this._precision = options.precision;
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
            instance._maxPower = this._maxPower;
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
            let adjValue = totV / this._bufferedLen;
            // XXX check perf and maybe replace with 1 second idealized version as micro opt
            // XXX2 sometimes this will be the same ts and the prev entry.  If there is a gap and we only have a few datapoints
            // then we will round down. Maybe we can always round up?  More testing!
            const adjTime = Math.round(this._bufferedTimes[this._bufferedLen - 1] / idealGap) * idealGap;
            if (this._precision) {
                adjValue = Number(adjValue.toFixed(this._precision));
            } else {
                adjValue = Math.round(adjValue);
            }
            this._add(adjTime, adjValue);
            this._bufferedTimes[0] = time;
            this._bufferedValues[0] = value;
            this._bufferedLen = 1;
        }
    }

    _add(time, value) {
        this.roll.add(time, value);
        if (value > this._maxPower) {
            this._maxPower = value;
        }
        this._resizePeriodized();
    }

    resize() {
        this.roll.resize();
        const value = this.roll.valueAt(-1);
        if (value > this._maxPower) {
            this._maxPower = value;
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
            max: this._maxPower,
            peaks,
            smooth,
            ...extra,
        };
    }
}


export class StatsProcessor extends events.EventEmitter {
    constructor(options={}) {
        super();
        this.zwiftAPI = options.zwiftAPI;
        this.gameMonitor = options.gameMonitor;
        this.setMaxListeners(100);
        this._athleteData = new Map();
        this.athleteId = null;
        this.watching = null;
        this._athletesCache = new Map();
        this._stateProcessCount = 0;
        this._stateDupCount = 0;
        this._stateStaleCount = 0;
        this._profileFetchIds = new Set();
        this._pendingProfileFetches = [];
        this._profileFetchCount = 0;
        this._chatHistory = [];
        this._events = new Map();
        this._subGroupEvents = new Map();
        this._mostRecentNearby = [];
        this._mostRecentGroups = [];
        rpc.register(this.updateAthlete, {scope: this});
        rpc.register(this.startLap, {scope: this});
        rpc.register(this.resetStats, {scope: this});
        rpc.register(this.exportFIT, {scope: this});
        rpc.register(this.getAthlete, {scope: this});
        rpc.register(this.getEvent, {scope: this});
        rpc.register(this.getSubGroupEvent, {scope: this});
        rpc.register(this.resetAthletesDB, {scope: this});
        rpc.register(this.getChatHistory, {scope: this});
        rpc.register(this.setFollowing, {scope: this});
        rpc.register(this.setNotFollowing, {scope: this});
        rpc.register(this.giveRideon, {scope: this});
    }

    getEvent(id) {
        return this._events.get(id);
    }

    getSubGroupEvent(id) {
        const eid = this._subGroupEvents.get(id);
        if (eid) {
            return this._events.get(eid);
        }
    }

    getChatHistory() {
        return this._chatHistory.map(x => {
            const athlete = this._athletesCache.get(x.from);
            x.muted = (athlete && athlete.muted != null) ? athlete.muted : x.muted;
            return x;
        });
    }

    _fmtAthleteData(x) {
        return {
            athleteId: x.athleteId,
            mostRecentState: this._cleanState(x.mostRecentState),
            profile: this.loadAthlete(x.athleteId),
        };
    }

    getAthletesData() {
        return Array.from(this._athleteData.values()).map(this._fmtAthleteData.bind(this));
    }

    getAthleteData(id) {
        const data = this._athleteData.get(id);
        return data ? this._fmtAthleteData(data) : null;
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
        for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
                d[k] = v;
            }
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
            captureExceptionOnce(e);
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
            debugger; // XXX
        }
        if (packet.udpConfigVOD2) {
            debugger; // XXX
        }
        if (packet.playerStates2.length) {
            debugger; // XXX
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
                console.warn("Deduping chat message:", ts, payload.from);
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
        return [state.courseId, state.roadId, state.reverse].join();
    }

    _getCollectorStats(data, athlete) {
        const end = data.end || monotonic();
        const elapsed = (end - data.start) / 1000;
        const np = data.power.roll.np({force: true});
        const tss = np && athlete && athlete.ftp ?
            sauce.power.calcTSS(np, data.power.roll.active(), athlete.ftp) :
            undefined;
        return {
            elapsed,
            power: data.power.getStats(data.tsOffset, {np, tss}),
            speed: data.speed.getStats(data.tsOffset),
            hr: data.hr.getStats(data.tsOffset),
            draft: data.draft.getStats(data.tsOffset),
            cadence: data.cadence.getStats(data.tsOffset),
        };
    }

    makeDataCollectors() {
        const periods = [5, 15, 60, 300, 1200];
        return {
            power: new DataCollector(sauce.power.RollingPower, periods, {inlineNP: true}),
            speed: new DataCollector(sauce.data.RollingAverage, periods,
                {ignoreZeros: true, precision: 1}),
            hr: new DataCollector(sauce.data.RollingAverage, periods, {ignoreZeros: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true}),
            draft: new DataCollector(sauce.data.RollingAverage, []),
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

    maybeUpdateAthletesFromServer(nearby) {
        for (const {athleteId} of nearby) {
            if (this._profileFetchIds.has(athleteId)) {
                continue;
            }
            this._profileFetchIds.add(athleteId);
            this._pendingProfileFetches.push(athleteId);
        }
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
        const periods = [5, 15, 60, 300, 1200];
        const collectors = {
            power: new DataCollector(sauce.power.RollingPower, periods, {inlineNP: true}),
            speed: new DataCollector(sauce.data.RollingAverage, periods, {ignoreZeros: true}),
            hr: new DataCollector(sauce.data.RollingAverage, periods, {ignoreZeros: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true}),
            draft: new DataCollector(sauce.data.RollingAverage, []),
        };
        const start = monotonic();
        return {
            start,
            tsOffset,
            athleteId,
            mostRecentState: null,
            roadHistory: {
                sig: null,
                prevSig: null,
                timeline: null,
                prevTimeline: null,
            },
            laps: [{
                start,
                ...this.cloneDataCollectors(collectors, {reset: true})
            }],
            ...collectors,
        };
    }

    _roadLengthConst = 1 - Math.exp(-1 / 1000);
    _roadLengths = new Map();

    learnRoadLength(sig, m) {
        let l = this._roadLengths.get(sig) || m;
        const c = this._roadLengthConst;
        l = (l * (1 - c)) + (m * c);
        this._roadLengths.set(sig, l);
        return l;
    }

    processState(state) {
        state.ts = +zwift.worldTimeToDate(state._worldTime);
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId, this._createAthleteData(state.athleteId, state.ts));
        }
        if (state._progress & 0xffff0000) {
            console.debug("unexpected progress value, examine:",
                state.athleteId, state._progress.toString(16), state._progress >> 8 & 0xff);
        }
        state.progress = (state._progress >> 8 & 0xff) / 0xff;
        state.workoutZone = (state._progress & 0xF) || null;
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
        state.joinTime = +zwift.worldTimeToDate(state._joinTime);
        Object.assign(state, zwift.decodePlayerStateFlags1(state._flags1));
        Object.assign(state, zwift.decodePlayerStateFlags2(state._flags2));
        state.kj = state._mwHours / 1000 / (1000 / 3600);
        state.heading = headingConv(state._heading);  // degrees
        state.speed = state._speed / 1000000;  // km/h
        state.cadence = state._cadenceUHz ? state._cadenceUHz / 1000000 * 60 : 0;  // rpm
        state.roadCompletion = !state.reverse ? 1000000 - state.roadLocation : state.roadLocation;
        state.distanceWithLateral = state._distanceWithLateral / 100;  // cm -> m
        ad.mostRecentState = state;
        const roadSig = this._roadSig(state);
        if (roadSig !== ad.roadHistory.sig) {
            const keepHistory = prevState &&
                prevState.courseId === state.courseId &&
                state.roadId !== prevState.roadId; // ie. not reversing
            if (keepHistory) {
                ad.roadHistory.prevSig = ad.roadHistory.sig;
                ad.roadHistory.prevTimeline = ad.roadHistory.timeline;
            } else {
                ad.roadHistory.prevSig = null;
                ad.roadHistory.prevTimeline = null;
            }
            ad.roadHistory.sig = roadSig;
            ad.roadHistory.timeline = [];
        } else if (prevState) {
            const d = state.distance - prevState.distance;
            const meters = (1 / ((state.roadCompletion - prevState.roadCompletion) / 1000000)) * d;
            if (roadSig === this._watchingRoadSig) {
                console.log("road length", this.learnRoadLength(roadSig, meters), meters);
            } else {
                this.learnRoadLength(roadSig, meters);
            }
        }
        const last = ad.roadHistory.timeline[ad.roadHistory.timeline.length - 1];
        if (last && state.roadCompletion < last.roadCompletion) {
            // This can happen when lapping a single road segment or if your avatar
            // Is stopped and sort of wiggling backwards. For safety we just nuke hist.
            ad.roadHistory.timeline.length = 0;
        }
        ad.roadHistory.timeline.push({ts: state.ts, roadCompletion: state.roadCompletion});
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
        if (this.watching === state.athleteId) {
            const athlete = this.loadAthlete(state.athleteId);
            this.emit('watching', {
                athleteId: state.athleteId,
                athlete,
                stats: this._getCollectorStats(ad, athlete),
                laps: ad.laps.map(x => this._getCollectorStats(x, athlete)),
                state: this._cleanState(state),
            });
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
            captureExceptionOnce(e);
            this.resetAthletesDB();
        }
        this._statesJob = this._statesProcessor();
        this._gcInterval = setInterval(this.gcStates.bind(this), 32768);
        this.athleteId = this.zwiftAPI.profile.id;
        this.gameMonitor.on('inPacket', this.onIncoming.bind(this));
        this.gameMonitor.on('watching-athlete', this.setWatching.bind(this));
        this.gameMonitor.start();
        queueMicrotask(() => this._zwiftMetaSync());
    }

    async stop() {
        this._active = false;
        super.stop();
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
        setTimeout(this._zwiftMetaSync.bind(this), 1200 * 1000);
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
        const events = await this.zwiftAPI.getEventFeed();
        for (const x of events) {
            this._events.set(x.id, x);
            if (x.eventSubgroups) {
                for (const sg of x.eventSubgroups) {
                    this._subGroupEvents.set(sg.id, x.id);
                }
            }
        }
        const meetups = await this.zwiftAPI.getPrivateEventFeed();
        for (const x of meetups) {
            this._events.set(x.id, x);
            if (x.eventSubgroupId) {
                this._subGroupEvents.set(x.eventSubgroupId, x.id);
            }
        }
        console.debug(`Updated zwift data for ${updates.length} followees, ${events.length} events, ` +
            `${meetups.length} meetups`);
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

    realGap(a, b) {
        const aSig = a.roadHistory.sig;
        const bSig = b.roadHistory.sig;
        let leaderTimeline;
        let trailingState;
        if (aSig === bSig) {
            if (a.mostRecentState.roadCompletion > b.mostRecentState.roadCompletion) {
                leaderTimeline = a.roadHistory.timeline;
                trailingState = b.mostRecentState;
            } else if (a.mostRecentState.roadCompletion < b.mostRecentState.roadCompletion) {
                leaderTimeline = b.roadHistory.timeline;
                trailingState = a.mostRecentState;
            } else {
                return 0;
            }
        } else {
            if (a.roadHistory.prevSig === bSig) {
                leaderTimeline = a.roadHistory.prevTimeline;
                trailingState = b.mostRecentState;
            } else if (b.roadHistory.prevSig === aSig) {
                leaderTimeline = b.roadHistory.prevTimeline;
                trailingState = a.mostRecentState;
            }
        }
        if (!trailingState) {
            return null;
        }
        if (a.mostRecentState.roadCompletion == null || b.mostRecentState.roadCompletion == null) {
            debugger;
            throw new TypeError("Internal error");
        }
        let prev;
        // TODO: Use binary search or at least use a normal for loop and walk backwards
        // with out doing a reverse, and for of .geez guy
        for (const x of Array.from(leaderTimeline).reverse()) {  // newest to oldest...
            if (x.roadCompletion <= trailingState.roadCompletion) {
                let offt = 0;
                if (prev) {
                    const dist = prev.roadCompletion - x.roadCompletion;
                    const time = prev.ts - x.ts;
                    offt = (trailingState.roadCompletion - x.roadCompletion) / dist * time;
                }
                return Math.abs((trailingState.ts - x.ts - offt) / 1000);
            }
            prev = x;
        }
        return null;
    }

    isFirstLeadingSecond(a, b) {
        const aSig = a.roadHistory.sig;
        const bSig = b.roadHistory.sig;
        if (aSig === bSig) {
            return a.mostRecentState.roadCompletion > b.mostRecentState.roadCompletion;
        } else {
            if (a.roadHistory.prevSig === bSig) {
                return true;
            } else {
                if (b.roadHistory.prevSig === aSig) {
                    return false;
                }
            }
        }
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
                captureExceptionOnce(e);
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

    _computeNearby() {
        const nearby = [];
        let watchingData = this._athleteData.get(this.watching);
        if (!watchingData) {
            return nearby;
        }
        // Only filter stopped riders if we are moving.
        const filterStopped = !!watchingData.mostRecentState.speed;
        for (const [aId, aData] of this._athleteData.entries()) {
            if (((filterStopped && !aData.mostRecentState.speed) || monotonic() - aData.updated > 15000) &&
                aId !== this.watching) {
                continue;
            }
            let gapDistance, gap, isGapEst;
            const watching = aId === this.watching;
            if (!watching) {
                const leading = this.isFirstLeadingSecond(watchingData, aData);
                if (leading == null) {
                    continue;  // Not on same road (usually reverse direction)
                }
                const sign = leading ? 1 : -1;
                gap = this.realGap(watchingData, aData);
                isGapEst = gap == null;
                gapDistance = crowDistance(watchingData.mostRecentState, aData.mostRecentState);
                if (isGapEst) {
                    gap = estGap(watchingData.mostRecentState, aData.mostRecentState, gapDistance);
                }
                gap *= sign;
                gapDistance *= sign;
            } else {
                gapDistance = gap = 0;
                isGapEst = false;
            }
            const athlete = this.loadAthlete(aId);
            nearby.push({
                athleteId: aId,
                gapDistance,
                gap,
                isGapEst,
                watching,
                athlete,
                stats: this._getCollectorStats(aData, athlete),
                laps: aData.laps.map(x => this._getCollectorStats(x, athlete)),
                state: this._cleanState(aData.mostRecentState),
                _data: aData,
            });
        }
        nearby.sort((a, b) => {
            const aInFront = this.isFirstLeadingSecond(a._data, b._data);
            return aInFront ? -1 : 1;
        });
        const watchingIdx = nearby.findIndex(x => x.watching);
        for (let i = watchingIdx - 1; i >= 0; i--) {
            const x = nearby[i];
            if (x.isGapEst) {
                const behind = nearby[i + 1];
                if (!behind) {
                    debugger;
                }
                let gap = this.realGap(behind._data, x._data);
                const gapDistance = crowDistance(behind.state, x.state);
                if (gap == null) {
                    gap = estGap(behind.state, x.state, gapDistance);
                } else {
                    if (!behind.isGapEst) {
                        x.isGapEst = false;
                    }
                }
                //console.log('up', x.gap, '=>', behind.gap - gap);
                //console.log('up', x.gapDistance, '=>', behind.gapDistance - gapDistance);
                x.gap = behind.gap - gap;
                x.gapDistance = behind.gapDistance - gapDistance;
            }
        }
        for (let i = watchingIdx + 1; i < nearby.length; i++) {
            const x = nearby[i];
            if (x.isGapEst) {
                const ahead = nearby[i - 1];
                if (!ahead) {
                    debugger;
                }
                let gap = this.realGap(x._data, ahead._data);
                const gapDistance = crowDistance(x.state, ahead.state);
                if (gap == null) {
                    gap = estGap(x.state, ahead.state, gapDistance);
                } else {
                    if (!ahead.isGapEst) {
                        x.isGapEst = false;
                    }
                }
                //console.log('down', x.gap, '=>', ahead.gap + gap);
                //console.log('down', x.gapDistance, '=>', ahead.gapDistance + gapDistance);
                x.gap = ahead.gap + gap;
                x.gapDistance = ahead.gapDistance + gapDistance;
            }
        }
        //nearby.sort((a, b) => a.gap - b.gap);
        this.maybeUpdateAthletesFromServer(nearby);
        return nearby;
    }

    _computeGroups(nearby) {
        const groups = [];
        if (!nearby.length) {
            return groups;
        }
        let curGroup;
        for (const x of nearby) {
            if (!curGroup) {
                curGroup = {athletes: [x]};
            } else {
                const last = curGroup.athletes.at(-1);
                const gap = x.gap - last.gap;
                if (gap > 2) {
                    curGroup.innerGap = gap;
                    groups.push(curGroup);
                    curGroup = {athletes: []};
                }
                curGroup.athletes.push(x);
            }
            curGroup.watching = curGroup.watching || x.athleteId === this.watching;
        }
        if (curGroup && curGroup.athletes.length) {
            groups.push(curGroup);
        }
        const watchingIdx = groups.findIndex(x => x.watching);
        if (watchingIdx === -1) {
            debugger; // Bug
        }
        for (let i = 0; i < groups.length; i++) {
            const x = groups[i];
            x.power = sauce.data.avg(x.athletes.map(x => x.state.power));
            x.draft = sauce.data.avg(x.athletes.map(x => x.state.draft));
            x.speed = sauce.data.median(x.athletes.map(x => x.state.speed));
            x.heartrate = sauce.data.avg(x.athletes.map(x => x.state.heartrate).filter(x => x));
            if (watchingIdx !== i) {
                const edge = watchingIdx < i ? x.athletes[0] : x.athletes.at(-1);
                x.isGapEst = edge.isGapEst;
                x.gap = edge.gap;
                if (i < groups.length - 1 && x.gap - groups[i + 1] < 2) {
                    debugger;
                }
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
                .map(x => x.power.roll.size() + x.speed.roll.size() + x.hr.roll.size() + x.hr.roll.size() + x.draft.roll.size())
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this._athletesCache.size,
        };
    }
}
