import events from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import {worldTime} from './zwift.mjs';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as rpc from './rpc.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import * as report from '../shared/report.mjs';
import * as zwift from './zwift.mjs';
import {getApp} from './main.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));


const monotonic = performance.now;
const roadDistEstimates = {};
const allSegments = new Map();


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


function getRoadSig(courseId, roadId, reverse) {
    return courseId << 18 | roadId << 1 | reverse;
}


class DataCollector {
    constructor(Klass, periods, options={}) {
        this._maxValue = 0;
        if (options._cloning) {
            return;
        }
        this.round = options.round;
        const defOptions = {idealGap: 1, maxGap: 15, active: true};
        this._bufferedStart = 0;
        this._bufferedEnd = 0;
        this._bufferedSum = 0;
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

    flushBuffered() {
        if (!this._bufferedLen) {
            return 0;
        }
        const value = this._bufferedSum / this._bufferedLen;
        const count = this._add(this._bufferedEnd, this.round ? Math.round(value) : value);
        this._bufferedLen = 0;
        this._bufferedSum = 0;
        return count;
    }

    add(time, value) {
        let count = 0;
        if (time - this._bufferedStart >= this.roll.idealGap) {
            count = this.flushBuffered();
            this._bufferedStart = time;
        }
        this._bufferedEnd = time;
        this._bufferedSum += value;
        this._bufferedLen++;
        return count;
    }

    _add(time, value) {
        const len = this.roll._length;
        this.roll.add(time, value);
        if (value > this._maxValue) {
            this._maxValue = value;
        }
        this._resizePeriodized();
        return this.roll._length - len;
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

    getStats(wtOffset, extra) {
        const peaks = {};
        const smooth = {};
        for (const [p, {roll, peak}] of this.periodized.entries()) {
            peaks[p] = {
                avg: peak ? peak.avg() : null,
                ts: peak ? worldTime.toTime(wtOffset + (peak.lastTime() * 1000)): null
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


const _segmentsByRoadSig = {};
const _segmentsByWorld = {};
function getNearbySegments(courseId, roadSig) {
    if (_segmentsByRoadSig[roadSig] === undefined) {
        const worldId = zwift.courseToWorldIds[courseId];
        if (_segmentsByWorld[worldId] === undefined) {
            const fname = path.join(__dirname, `../shared/deps/data/segments-${worldId}.json`);
            try {
                _segmentsByWorld[worldId] = JSON.parse(fs.readFileSync(fname));
            } catch(e) {
                _segmentsByWorld[worldId] = [];
            }
            for (const x of _segmentsByWorld[worldId]) {
                for (const dir of ['Forward', 'Reverse']) {
                    if (x['id' + dir]) {
                        const reverse = dir === 'Reverse';
                        const segSig = getRoadSig(courseId, x.roadId, reverse);
                        if (!_segmentsByRoadSig[segSig]) {
                            _segmentsByRoadSig[segSig] = [];
                        }
                        const segment = {
                            ...x,
                            reverse,
                            id: x['id' + dir],
                            distance: x['distance' + dir],
                            friendlyName: x['friendlyName' + dir],
                            roadStart: x['roadStart' + dir],
                        };
                        _segmentsByRoadSig[segSig].push(segment);
                        allSegments.set(segment.id, segment);
                    }
                }
            }
        }
        if (_segmentsByRoadSig[roadSig] === undefined) {
            _segmentsByRoadSig[roadSig] = null;
        }
    }
    return _segmentsByRoadSig[roadSig];
}


export class StatsProcessor extends events.EventEmitter {
    constructor(options={}) {
        super();
        this.zwiftAPI = options.zwiftAPI;
        this.gameMonitor = options.gameMonitor;
        this.disableGameMonitor = options.args.disableMonitor;
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
        this._markedIds = new Set();
        this._followingIds = new Set();
        this._followerIds = new Set();
        const app = getApp();
        this._autoResetEvents = !!app.getSetting('autoResetEvents');
        this._autoLapEvents = !!app.getSetting('autoLapEvents');
        const autoLap = !!app.getSetting('autoLap');
        this._autoLapMetric = autoLap ? app.getSetting('autoLapMetric') : undefined;
        const autoLapFactor = this._autoLapMetric === 'distance' ? 1000 : 60;
        this._autoLapInterval = autoLap ? app.getSetting('autoLapInterval') * autoLapFactor : undefined;
        this._autoLap = !!(autoLap && this._autoLapMetric && this._autoLapInterval);
        rpc.register(this.updateAthlete, {scope: this});
        rpc.register(this.startLap, {scope: this});
        rpc.register(this.resetStats, {scope: this});
        rpc.register(this.exportFIT, {scope: this});
        rpc.register(this.getAthlete, {scope: this});
        rpc.register(this.getFollowingAthletes, {scope: this});
        rpc.register(this.getFollowerAthletes, {scope: this});
        rpc.register(this.getMarkedAthletes, {scope: this});
        rpc.register(this.searchAthletes, {scope: this});
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
        rpc.register(this.getAthleteStats, {scope: this});
        rpc.register(this.getAthleteLaps, {scope: this});
        rpc.register(this.getAthleteSegments, {scope: this});
        rpc.register(this.getAthleteStreams, {scope: this});
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
            this._athleteData.set(this.athleteId, this._createAthleteData(this.athleteId), worldTime.now());
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
            if (x.eventSubgroup) {
                const sg = this._recentEventSubgroups.get(x.eventSubgroup);
                if (sg.invitedLeaders && sg.invitedLeaders.includes(x.from)) {
                    x.eventLeader = true;
                }
                if (sg.invitedSweepers && sg.invitedSweepers.includes(x.from)) {
                    x.eventSweeper = true;
                }
            }
            return x;
        });
    }

    getAthletesData() {
        return Array.from(this._athleteData.values()).map(this._formatAthleteStats.bind(this));
    }

    _realAthleteId(ident) {
        return ident === 'self' ?
            this.athleteId :
            ident === 'watching' ?
                this.watching : Number(ident);
    }

    getAthleteStats(id) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        return ad ? this._formatAthleteStats(ad) : null;
    }

    getAthleteLaps(id) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        const athlete = this.loadAthlete(ad.athleteId);
        return ad.laps.map(x => this._formatLapish(x, ad, athlete));
    }

    getAthleteSegments(id) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        const athlete = this.loadAthlete(ad.athleteId);
        return ad.segments.map(x => this._formatLapish(x, ad, athlete,
            {segment: allSegments.get(x.id)}));
    }

    _formatLapish(lapish, ad, athlete, extra) {
        return {
            stats: this._getCollectorStats(lapish, ad, athlete),
            startIndex: lapish.power.roll._offt,
            endIndex: lapish.power.roll._length - 1,
            start: lapish.start,
            end: lapish.end,
            sport: lapish.sport,
            ...extra,
        };
    }

    getAthleteStreams(id) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        const cs = ad.collectors;
        return {
            time: cs.power.roll.times(),
            power: cs.power.roll.values(),
            speed: cs.speed.roll.values(),
            hr: cs.hr.roll.values(),
            cadence: cs.cadence.roll.values(),
            draft: cs.draft.roll.values(),
            ...ad.streams,
        };
    }

    getNearbyData() {
        return Array.from(this._mostRecentNearby);
    }

    getGroupsData() {
        return Array.from(this._mostRecentGroups);
    }

    startLap() {
        console.debug("Starting new lap...");
        for (const x of this._athleteData.values()) {
            this.startAthleteLap(x);
        }
    }

    startAthleteLap(ad) {
        const now = monotonic();
        const lastLap = ad.laps[ad.laps.length - 1];
        lastLap.end = now;
        Object.assign(lastLap, this.cloneDataCollectors(lastLap));
        ad.laps.push(this.cloneDataCollectors(ad.collectors, {reset: true}));
    }

    startSegment(ad, id) {
        const segment = this.cloneDataCollectors(ad.collectors, {reset: true});
        segment.id = id;
        ad.segments.push(segment);
        ad.activeSegments.set(id, segment);
        return segment;
    }

    stopSegment(ad, id) {
        const segment = ad.activeSegments.get(id);
        segment.end = monotonic();
        ad.activeSegments.delete(id);
    }

    resetStats() {
        console.debug("Reseting stats...");
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
        const {laps, wtOffset, mostRecentState} = this._athleteData.get(athleteId);
        const sport = {
            0: 'cycling',
            1: 'running',
        }[mostRecentState ? mostRecentState.sport : 0] || 'generic';
        fitParser.addMessage('event', {
            event: 'timer',
            event_type: 'start',
            event_group: 0,
            timestamp: wtOffset,
            data: 'manual',
        });
        let lapNumber = 0;
        let lastTS;
        for (const {power, speed, cadence, hr} of laps) {
            if ([speed, cadence, hr].some(x => x.roll.size() !== power.roll.size())) {
                throw new Error("Assertion failure about roll sizes being equal");
            }
            for (let i = 0; i < power.roll.size(); i++) {
                lastTS = wtOffset + (power.roll.timeAt(i) * 1000);
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
                start_time: wtOffset + (power.roll.firstTime() * 1000),
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
        const elapsed = (lastTS - wtOffset) / 1000;
        fitParser.addMessage('session', {
            timestamp: lastTS,
            event: 'session',
            event_type: 'stop',
            start_time: wtOffset,
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
        const minor = p.privacy && p.privacy.minor;
        const o = {
            firstName: p.firstName,
            lastName: p.lastName,
            ftp: p.ftp,
            type: p.playerType,
            countryCode: p.countryCode, // iso 3166
            avatar: !minor ? p.imageSrcLarge || p.imageSrc : undefined,
            weight: !minor && p.weight ? p.weight / 1000 : undefined,
            height: !minor && p.height ? p.height / 10 : undefined,
            gender: !minor && p.male === false ? 'female' : 'male',
            age: !minor && p.privacy && p.privacy.displayAge ? p.age : null,
            level: p.achievementLevel ? Math.floor(p.achievementLevel / 100) : undefined,
            powerMeter,
        };
        if (p.socialFacts) {
            o.follower = p.socialFacts.followeeStatusOfLoggedInPlayer === 'IS_FOLLOWING';
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
        if (data.marked !== undefined) {
            if (data.marked) {
                this._markedIds.add(id);
            } else {
                this._markedIds.delete(id);
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

    updateAthleteWPrime(id, {ftp, wPrime}) {
        const ad = this._athleteData.get(id);
        if (!ad || !ftp || !wPrime) {
            return;
        }
        ad.collectors.power.roll.setWPrime(ftp, wPrime);
    }

    async getAthlete(id, options={}) {
        id = this._realAthleteId(id);
        if (options.refresh && this.zwiftAPI.isAuthenticated()) {
            const updating = this.zwiftAPI.getProfile(id).then(p =>
                (p && this.updateAthlete(id, this._profileToAthlete(p))));
            if (!options.noWait) {
                await updating;
            }
        }
        const athlete = this.loadAthlete(id);
        if (athlete) {
            const ad = this._athleteData.get(id);
            const hideFTP = ad && ad.privacy.hideFTP;
            return hideFTP ? {...athlete, ftp: null} : athlete;
        }
    }

    async searchAthletes(searchText, options) {
        const profiles = await this.zwiftAPI.searchProfiles(searchText, options);
        return profiles.map(x => ({
            id: x.id,
            profile: x,
            athlete: this.loadAthlete(x.id),
        }));
    }

    async getFollowerAthletes() {
        return Array.from(this._followerIds).map(id => ({id, athlete: this.loadAthlete(id)}));
    }

    async getFollowingAthletes() {
        return Array.from(this._followingIds).map(id => ({id, athlete: this.loadAthlete(id)}));
    }

    async getMarkedAthletes() {
        return Array.from(this._markedIds).map(id => ({id, athlete: this.loadAthlete(id)}));
    }

    _loadMarkedAthletes() {
        const stmt = this.athletesDB.prepare(
            `SELECT athletes.id ` +
            `FROM athletes, json_each(athletes.data, '$.marked') ` +
            `WHERE json_each.value`);
        this._markedIds.clear();
        for (const x of stmt.iterate()) {
            this._markedIds.add(x.id);
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
            if (x.payloadType) {
                if (x.payloadType === 'PayloadChatMessage') {
                    const ts = x.ts.toNumber() / 1000;
                    this.handleChatPayload(x.payload, ts);
                } else if (x.payloadType === 'PayloadRideOn') {
                    this.handleRideOnPayload(x.payload);
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

    handleRideOnPayload(payload) {
        this.emit('rideon', payload);
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
        const sg = chat.eventSubgroup && this._recentEventSubgroups.get(chat.eventSubgroup);
        if (sg) {
            if (sg.invitedLeaders && sg.invitedLeaders.includes(chat.from)) {
                chat.eventLeader = true;
            }
            if (sg.invitedSweepers && sg.invitedSweepers.includes(chat.from)) {
                chat.eventSweeper = true;
            }
        }
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
        if (this._chatHistory.length > 1000) {
            this._chatHistory.length = 1000;
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
        return getRoadSig(state.courseId, state.roadId, state.reverse);
    }

    _getCollectorStats(cs, ad, athlete) {
        const end = cs.end || monotonic();
        const elapsedTime = (end - cs.start) / 1000;
        const np = cs.power.roll.np({force: true});
        const wBal = ad.privacy.hideWBal ? undefined : cs.power.roll.wBal;
        const activeTime = cs.power.roll.active();
        const tss = (!ad.privacy.hideFTP && np && athlete && athlete.ftp) ?
            sauce.power.calcTSS(np, activeTime, athlete.ftp) :
            undefined;
        return {
            elapsedTime,
            activeTime,
            power: cs.power.getStats(ad.wtOffset, {np, tss, wBal}),
            speed: cs.speed.getStats(ad.wtOffset),
            hr: cs.hr.getStats(ad.wtOffset),
            cadence: cs.cadence.getStats(ad.wtOffset),
            draft: cs.draft.getStats(ad.wtOffset),
        };
    }

    makeDataCollectors(sport='cycling') {
        const periods = [5, 15, 60, 300, 1200];
        const longPeriods = periods.filter(x => x >= 60);
        return {
            start: monotonic(),
            sport,
            power: new DataCollector(ExtendedRollingPower, periods, {inlineNP: true, round: true}),
            speed: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true}),
            hr: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true, round: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true, round: true}),
            draft: new DataCollector(sauce.data.RollingAverage, longPeriods, {round: true}),
        };
    }

    cloneDataCollectors(collectors, options={}) {
        const types = ['power', 'speed', 'hr', 'cadence', 'draft'];
        const bucket = {
            start: options.reset ? monotonic() : collectors.start,
            sport: collectors.sport,
        };
        for (const x of types) {
            bucket[x] = collectors[x].clone(options);
        }
        return bucket;
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

    _createAthleteData(athleteId, wtOffset, sport='cycling') {
        const collectors = this.makeDataCollectors(sport);
        return {
            wtOffset,
            athleteId,
            privacy: {},
            mostRecentState: null,
            streams: {
                distance: [],
                coordinates: [],
            },
            roadHistory: {
                sig: null,
                prevSig: null,
                timeline: [],
                prevTimeline: null,
            },
            collectors,
            laps: [this.cloneDataCollectors(collectors, {reset: true})],
            activeSegments: new Map(),
            segments: [],
        };
    }

    _resetAthleteData(ad, wtOffset) {
        const sport = ad.mostRecentState ? ad.mostRecentState.sport : 'cycling';
        const collectors = this.makeDataCollectors(sport);
        Object.assign(ad, {
            wtOffset,
            collectors,
            laps: [this.cloneDataCollectors(collectors, {reset: true})],
        });
        ad.activeSegments.clear();
        ad.segments.length = 0;
        for (const x of Object.values(ad.streams)) {
            x.length = 0;
        }
    }

    triggerEventStart(ad, state) {
        ad.eventStartPending = false;
        if (this._autoResetEvents) {
            console.warn("Event start triggering reset for:", ad.athleteId);
            this._resetAthleteData(ad, state.worldTime);
        } else if (this._autoLapEvents) {
            console.warn("Event start triggering lap for:", ad.athleteId);
            this.startAthleteLap(ad);
        }
    }

    triggerEventEnd(ad, state) {
        if (this._autoResetEvents || this._autoLapEvents) {
            console.warn("Event end triggering lap for:", ad.athleteId);
            this.startAthleteLap(ad);
        }
    }

    processState(state) {
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId,
                this._createAthleteData(state.athleteId, state.worldTime, state.sport));
        }
        const ad = this._athleteData.get(state.athleteId);
        const prevState = ad.mostRecentState;
        if (prevState) {
            if (prevState.worldTime > state.worldTime) {
                this._stateStaleCount++;
                return false;
            } else if (prevState.worldTime === state.worldTime) {
                this._stateDupCount++;
                return false;
            }
        }
        const noSubgroup = null;
        const sg = state.eventSubgroupId &&
            this._recentEventSubgroups.get(state.eventSubgroupId) ||
            noSubgroup;
        if (sg) {
            if (!ad.eventSubgroup || sg.id !== ad.eventSubgroup.id) {
                ad.eventSubgroup = sg;
                ad.privacy = {};
                if (state.athleteId !== this.athleteId) {
                    ad.privacy.hideWBal = sg.allTags.has('hidewbal');
                    ad.privacy.hideFTP = sg.allTags.has('hideftp');
                }
                ad.disabled = sg.allTags.has('hidethehud') || sg.allTags.has('nooverlays');
                if (state.time) {
                    this.triggerEventStart(ad, state);
                } else {
                    ad.eventStartPending = true;
                }
            } else if (ad.eventStartPending && state.time) {
                this.triggerEventStart(ad, state);
            }
        } else if (ad.eventSubgroup) {
            ad.eventSubgroup = noSubgroup;
            ad.privacy = {};
            ad.disabled = false;
            ad.eventStartPending = false;
            this.triggerEventEnd(ad, state);
        }
        if (ad.disabled) {
            return;
        }
        const roadSig = this._roadSig(state);
        if (this._autoLap) {
            this._autoLapCheck(state, ad);
        }
        this._activeSegmentCheck(state, ad, roadSig);
        this._recordAthleteRoadHistory(state, ad, roadSig);
        this._recordAthleteStats(state, ad);
        ad.mostRecentState = state;
        ad.updated = monotonic();
        this._stateProcessCount++;
        if (this.watching === state.athleteId && this.listenerCount('athlete/watching')) {
            this.emit('athlete/watching', this._formatAthleteStats(ad));
        }
        if (this.athleteId === state.athleteId && this.listenerCount('athlete/self')) {
            this.emit('athlete/self', this._formatAthleteStats(ad));
        }
        if (this.listenerCount(`athlete/${state.athleteId}`)) {
            this.emit(`athlete/${state.athleteId}`, this._formatAthleteStats(ad));
        }
    }

    _autoLapCheck(state, ad) {
        const mark = this._autoLapMetric === 'distance' ? state.distance : state.time;
        if (ad.autoLapMark === undefined) {
            ad.autoLapMark = mark;
        } else if (mark - ad.autoLapMark >= this._autoLapInterval) {
            console.debug("Auto lap triggered for:", ad.athleteId);
            ad.autoLapMark = mark;
            this.startAthleteLap(ad);
        }
    }

    _recordAthleteRoadHistory(state, ad, roadSig) {
        const prevState = ad.mostRecentState;
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
            wt: state.worldTime,
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
                adjRoadDistEstimate(roadSig, 1e6 / rlDelta * mDelta);
            }
        }
    }

    _recordAthleteStats(state, ad) {
        if (!state.power && !state.speed) {
            const addCount = ad.collectors.power.flushBuffered();
            if (addCount) {
                ad.collectors.speed.flushBuffered();
                ad.collectors.hr.flushBuffered();
                ad.collectors.draft.flushBuffered();
                ad.collectors.cadence.flushBuffered();
                for (let i = 0; i < addCount; i++) {
                    ad.streams.distance.push(state.distance);
                    ad.streams.coordinates.push({x: state.x, y: state.y, z: state.altitude});
                }
            }
            return;
        }
        const time = (state.worldTime - ad.wtOffset) / 1000;
        const addCount = ad.collectors.power.add(time, state.power);
        ad.collectors.speed.add(time, state.speed);
        ad.collectors.hr.add(time, state.heartrate);
        ad.collectors.draft.add(time, state.draft);
        ad.collectors.cadence.add(time, state.cadence);
        for (let i = 0; i < addCount; i++) {
            ad.streams.distance.push(state.distance);
            ad.streams.coordinates.push({x: state.x, y: state.y, z: state.altitude});
        }
        const curLap = ad.laps[ad.laps.length - 1];
        curLap.power.resize(time);
        curLap.speed.resize(time);
        curLap.hr.resize(time);
        curLap.draft.resize(time);
        curLap.cadence.resize(time);
        for (const s of ad.activeSegments.values()) {
            s.power.resize(time);
            s.speed.resize(time);
            s.hr.resize(time);
            s.draft.resize(time);
            s.cadence.resize(time);
        }
    }

    _activeSegmentCheck(state, ad, roadSig) {
        const segments = getNearbySegments(state.courseId, roadSig);
        if (!segments || !segments.length) {
            return;
        }
        const p = (state.roadLocation - 5000) / 1e6;
        for (let i = 0; i < segments.length; i++) {
            const x = segments[i];
            let progress;
            if (state.reverse) {
                progress = (p >= x.roadFinish && p <= x.roadStart) ?
                    1 - (p - x.roadFinish) / (x.roadStart - x.roadFinish) : null;
            } else {
                progress = (p <= x.roadFinish && p >= x.roadStart) ?
                    1 - (x.roadFinish - p) / (x.roadFinish - x.roadStart) : null;
            }
            if (ad.activeSegments.has(x.id)) {
                if (progress == null) {
                    this.stopSegment(ad, x.id);
                }
            } else if (progress != null && progress < 0.05) {
                this.startSegment(ad, x.id);
            }
        }
    }

    _formatNearbySegments(ad, roadSig) {
        const state = ad.mostRecentState;
        const segments = getNearbySegments(state.courseId, roadSig);
        if (!segments || !segments.length) {
            return [];
        }
        const p = (state.roadLocation - 5000) / 1e6;
        const relSegments = segments.map(x => {
            let progress, proximity;
            if (state.reverse) {
                progress = (p >= x.roadFinish && p <= x.roadStart) ?
                    1 - (p - x.roadFinish) / (x.roadStart - x.roadFinish) : null;
                proximity = progress !== null ? 0 : p < x.roadFinish ? p - x.roadFinish : x.roadStart - p;
            } else {
                progress = (p <= x.roadFinish && p >= x.roadStartForward) ?
                    1 - (x.roadFinish - p) / (x.roadFinish - x.roadStart) : null;
                proximity = progress !== null ? 0 : p > x.roadFinish ? p - x.roadFinish : x.roadStart - p;
            }
            return {...x, progress, proximity};
        });
        relSegments.sort((a, b) => a.proximity - b.proximity);
        return relSegments;
    }

    async resetAthletesDB() {
        await resetDB();
        this._athletesCache.clear();
        this.initAthletesDB();
    }

    initAthletesDB() {
        this.athletesDB = getDB();
        this.getAthleteStmt = this.athletesDB.prepare('SELECT data FROM athletes WHERE id = ?');
        queueMicrotask(() => this._loadMarkedAthletes());
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
        if (!this.disableGameMonitor) {
            this.gameMonitor.on('inPacket', this.onIncoming.bind(this));
            this.gameMonitor.on('watching-athlete', this.setWatching.bind(this));
            this.gameMonitor.start();
        }
        this._zwiftMetaRefresh = 60000;
        this._zwiftMetaId = setTimeout(() => this._zwiftMetaSync(), 0);
        if (this._autoResetEvents) {
            console.info("Auto reset for events enabled");
        } else if (this._autoLapEvents) {
            console.info("Auto lap for events enabled");
        }
        if (this._autoLap) {
            console.info("Auto interval lap enabled:", this._autoLapMetric, this._autoLapInterval);
        }
    }

    async stop() {
        this._active = false;
        clearInterval(this._gcInterval);
        clearTimeout(this._zwiftMetaId);
        this._gcInterval = null;
        try {
            await this._statesJob;
        } finally {
            this._nearybyJob = null;
        }
    }

    _parseEventTags(eventOrSubgroup) {
        const tags = new Set(eventOrSubgroup.tags || []);
        const desc = eventOrSubgroup.description;
        if (desc) {
            for (const x of desc.matchAll(/\B#([a-z]+[a-z0-9]*)\b/gi)) {
                tags.add(x[1].toLowerCase());
            }
        }
        return tags;
    }

    _zwiftMetaSync() {
        if (!this._active || !this.zwiftAPI.isAuthenticated()) {
            console.warn("Skipping social network update because not logged into zwift");
            return;
        }
        this.__zwiftMetaSync().finally(() => {
            // The event feed APIs are horribly broken so we need to refresh more often
            // at startup to try and fill in the gaps.
            this._zwiftMetaId = setTimeout(() => this._zwiftMetaSync(), this._zwiftMetaRefresh);
            this._zwiftMetaRefresh = Math.min(30 * 60 * 1000, this._zwiftMetaRefresh * 2);
        });
    }

    async __zwiftMetaSync() {
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
            x.allTags = this._parseEventTags(x);
            this._recentEvents.set(x.id, x);
            if (x.eventSubgroups) {
                for (const sg of x.eventSubgroups) {
                    const route = this._routes.get(sg.routeId);
                    if (route) {
                        sg.routeDistance = this._getRouteDistance(route, sg.laps);
                        sg.routeClimbing = this._getRouteClimbing(route, sg.laps);
                    }
                    sg.startOffset = +(new Date(sg.eventSubgroupStart)) - +(new Date(x.eventStart));
                    sg.allTags = new Set([...this._parseEventTags(sg), ...x.allTags]);
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
            x.allTags = this._parseEventTags(x);
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
        let backoff = 100;
        let absent = new Set(this._followingIds);
        await this.zwiftAPI.getFollowing(this.athleteId, {
            pageLimit: 0,
            onPage: async page => {
                const updates = [];
                for (const x of page) {
                    const p = x.followeeProfile;
                    if (p) {
                        this._followingIds.add(p.id);
                        absent.delete(p.id);
                        updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
                    }
                }
                if (updates.length) {
                    this.saveAthletes(updates);
                }
                await sauce.sleep(backoff *= 1.5);
            }
        });
        for (const x of absent) {
            this._followingIds.delete(x);
        }
        backoff = 100;
        absent = new Set(this._followerIds);
        await this.zwiftAPI.getFollowers(this.athleteId, {
            pageLimit: 0,
            onPage: async page => {
                const updates = [];
                for (const x of page) {
                    const p = x.followerProfile;
                    if (p) {
                        this._followerIds.add(p.id);
                        absent.delete(p.id);
                        updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
                    }
                }
                if (updates.length) {
                    this.saveAthletes(updates);
                }
                await sauce.sleep(backoff *= 1.5);
            }
        });
        for (const x of absent) {
            this._followerIds.delete(x);
        }
        console.info(`Updated meta data for ${this._followingIds.size} following, ` +
            `${this._followerIds.size} followers, ${someEvents.length} events, ` +
            `${someMeetups.length} meetups`);
    }

    async setFollowing(athleteId) {
        const resp = await this.zwiftAPI._setFollowing(athleteId, this.athleteId);
        const following = resp.status === 'IS_FOLLOWING';
        if (following) {
            this._followingIds.add(Number(athleteId));
        }
        return this.updateAthlete(athleteId, {
            following,
            followRequest: resp.status === 'REQUESTS_TO_FOLLOW',
        });
    }

    async setNotFollowing(athleteId) {
        this._followingIds.delete(Number(athleteId));
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
                const gapDistance = (1e6 + d) / 1e6 * roadDist;
                return {reversed: false, previous: true, gapDistance};
            } else if (d > 500000 && b.prevSig === a.sig) {
                const gapDistance = (1e6 - d) / 1e6 * roadDist;
                return {reversed: true, previous: true, gapDistance};
            } else if (d > 0) {
                const gapDistance = d / 1e6 * roadDist;
                return {reversed: false, previous: false, gapDistance};
            } else if (d < 0) {
                const gapDistance = -d / 1e6 * roadDist;
                return {reversed: true, previous: false, gapDistance};
            } else if (aTail.wt < bTail.wt) {
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
                    const gapDistance = (d / 1e6 * roadDist) + (bTail.distance - bPrevTail.distance);
                    return {reversed: true, previous: true, gapDistance};
                }
            }
            if (d2 !== undefined) {
                // We can probably move this up tino the first d2 block once we validate the above condition
                // is not relevant.  Probably need to check on something funky like crit city or japan.
                const aPrevTail = a.prevTimeline[a.prevTimeline.length - 1];
                const roadDist = roadDistEstimates[a.prevSig] || 0;
                const gapDistance = (d2 / 1e6 * roadDist) + (aTail.distance - aPrevTail.distance);
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
                    const time = prev.wt - x.wt;
                    offt = (bTail.roadCompletion - x.roadCompletion) / dist * time;
                }
                return Math.abs((bTail.wt - x.wt - offt) / 1000);
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

    _getEventOrRouteInfo(state) {
        const sg = state.eventSubgroupId && this._recentEventSubgroups.get(state.eventSubgroupId);
        if (sg) {
            const eventLeader = sg.invitedLeaders && sg.invitedLeaders.includes(state.athleteId);
            const eventSweeper = sg.invitedSweepers && sg.invitedSweepers.includes(state.athleteId);
            if (sg.durationInSeconds) {
                const eventEnd = +(new Date(sg.eventSubgroupStart || sg.eventStart)) + (sg.durationInSeconds * 1000);
                return {
                    eventLeader,
                    eventSweeper,
                    remaining: (eventEnd - Date.now()) / 1000,
                    remainingMetric: 'time',
                    remainingType: 'event',
                };
            } else {
                const distance = sg.distanceInMeters || this._getRouteDistance(sg.route, sg.laps);
                return {
                    eventLeader,
                    eventSweeper,
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

    _formatAthleteStats(ad, extra) {
        let athlete = this.loadAthlete(ad.athleteId);
        if (athlete) {
            if (ad.privacy.hideFTP) {
                athlete = {...athlete, ftp: null};
            } else if (ad.collectors.power.roll.wBal == null && athlete.ftp && athlete.wPrime) {
                // Lazy update w' since athlete data is async..
                ad.collectors.power.roll.setWPrime(athlete.ftp, athlete.wPrime);
            }
        }
        const state = ad.mostRecentState;
        let lap, lastLap;
        if (ad.laps.length > 1) {
            lap = this._getCollectorStats(ad.laps[ad.laps.length - 1], ad, athlete);
            lastLap = this._getCollectorStats(ad.laps[ad.laps.length - 2], ad, athlete);
        }
        return {
            athleteId: state.athleteId,
            athlete,
            stats: this._getCollectorStats(ad.collectors, ad, athlete),
            lap,
            lastLap,
            state: this._cleanState(state),
            eventPosition: ad.eventPosition,
            eventParticipants: ad.eventParticipants,
            gameState: ad.gameState,
            gap: ad.gap,
            ...this._getEventOrRouteInfo(state),
            ...extra,
        };
    }

    _formatNearbyEntry({ad, isGapEst, rp, gap}) {
        return this._formatAthleteStats(ad, {
            gap,
            gapDistance: rp.gapDistance,
            isGapEst: isGapEst ? true : undefined,
            watching: ad.athleteId === this.watching ? true : undefined,
        });
    }

    _computeNearby() {
        const watchingData = this._athleteData.get(this.watching);
        if (!watchingData || !watchingData.mostRecentState) {
            for (const ad of this._athleteData.values()) {
                ad.gap = undefined;
            }
            return [];
        }
        const watching = {ad: watchingData, gap: 0, isGapEst: false, rp: {gapDistance: 0}};
        // We need to use a speed value for estimates and just using one value is
        // dangerous, so we use a weighted function that's seeded (skewed) to the
        // the watching rider.
        const refSpeedForEstimates = makeExpWeighted(10); // maybe mv up and reuse? XXX
        const watchingSpeed = watchingData.mostRecentState.speed;
        if (watchingSpeed > 1) {
            refSpeedForEstimates(watchingSpeed);
        }
        // Only filter stopped riders if we are moving.
        const filterStopped = !!watchingSpeed;
        const ahead = [];
        const behind = [];
        for (const ad of this._athleteData.values()) {
            ad.gap = undefined;
            if (ad.athleteId !== this.watching) {
                const age = monotonic() - ad.updated;
                if ((filterStopped && !ad.mostRecentState.speed) || age > 10000) {
                    continue;
                }
                const rp = this.compareRoadPositions(ad, watchingData);
                if (rp === null) {
                    continue;
                }
                const gap = this._realGap(rp, ad, watchingData);
                if (rp.reversed) {
                    behind.push({ad, rp, gap});
                } else {
                    ahead.push({ad, rp, gap});
                }
            }
            this.maybeUpdateAthleteFromServer(ad.athleteId);
        }

        ahead.sort((a, b) => b.rp.gapDistance - a.rp.gapDistance);
        behind.sort((a, b) => a.rp.gapDistance - b.rp.gapDistance);

        for (let i = ahead.length - 1; i >= 0; i--) {
            const x = ahead[i];
            const adjacent = ahead[i + 1] || watching;
            const speedRef = refSpeedForEstimates(x.ad.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(x.ad, adjacent.ad);
                if (incGap == null) {
                    const incGapDist = x.rp.gapDistance - adjacent.rp.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap - incGap;
            } else {
                x.gap = -x.gap;
                x.isGapEst = false;
            }
            x.ad.gap = x.gap; // XXX we can unify this with some eval
            x.rp.gapDistance = -x.rp.gapDistance;
        }
        for (let i = 0; i < behind.length; i++) {
            const x = behind[i];
            const adjacent = behind[i - 1] || watching;
            const speedRef = refSpeedForEstimates(x.ad.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(adjacent.ad, x.ad);
                if (incGap == null) {
                    const incGapDist = x.rp.gapDistance - adjacent.rp.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap + incGap;
            } else {
                x.isGapEst = false;
            }
            x.ad.gap = x.gap; // XXX we can unify this with some eval
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
                    x.collectors.power.roll.size() +
                    x.collectors.speed.roll.size() +
                    x.collectors.hr.roll.size() +
                    x.collectors.draft.roll.size() +
                    x.collectors.cadence.roll.size() +
                    x.streams.distance.length +
                    x.streams.coordinates.length)
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this._athletesCache.size,
        };
    }
}
