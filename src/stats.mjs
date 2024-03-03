/* global setImmediate */
import events from 'node:events';
import path from 'node:path';
import {nextTick} from 'node:process';
import {worldTimer} from './zwift.mjs';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as rpc from './rpc.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import * as report from '../shared/report.mjs';
import * as zwift from './zwift.mjs';
import * as env from './env.mjs';
import * as curves from '../shared/curves.mjs';
import {expWeightedAvg} from '../shared/sauce/data.mjs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const roadDistances = new Map();
const wPrimeDefault = 20000;


function monotonic() {
    return performance.timeOrigin + performance.now();
}


function nextMacrotask() {
    // NOTE: setImmediate is much slower in electron.
    return new Promise(nextTick);
}


const _hrSleepState = {
    latency: 10,
    latencyRoll: expWeightedAvg(10, 10 ** 2),
};
async function highResSleepTill(deadline) {
    // NOTE: V8 can and does wake up early.
    // NOTE: GC pauses can and will cause delays.
    const t = monotonic();
    return sauce.sleep(deadline - t);
    const state = _hrSleepState;
    const origDelay = deadline - t;
    // Re Math.ceil: setTimeout only has 1ms precision and uses Math.trunc()..
    const macroDelay = Math.ceil((deadline - t) - (state.latency * 2));
    if (macroDelay > 1) {
        await new Promise(r => setTimeout(r, macroDelay));
        const timerLatency = (monotonic() - t) - macroDelay;
        if (timerLatency > 0) {
            state.latency = Math.sqrt(state.latencyRoll((timerLatency + 1) ** 2));
        }
        state.timerLatency = timerLatency;
    }
    let macro = 0;
    const remaining = deadline - monotonic();
    if (remaining < 0) {
        console.error("You messed up or GC got us:", remaining, state.timerLatency, origDelay, macroDelay, );
    }
    while (monotonic() < deadline) {
        await nextMacrotask();
        macro++;
    }
    state.macro = macro;
    state.macroPerSec = macro / remaining * 1000;
}

setInterval(() => {
    console.log({..._hrSleepState, latencyRoll: undefined});
}, 5000);


function updateRoadDistance(courseId, roadId) {
    let distance;
    const road = env.getRoad(courseId, roadId);
    if (road) {
        const curveFunc = {
            CatmullRom: curves.catmullRomPath,
            Bezier: curves.cubicBezierPath,
        }[road.splineType];
        const curvePath = curveFunc(road.path, {loop: road.looped, road: true});
        distance = curvePath.distance() / 100;
    } else {
        distance = null;
    }
    roadDistances.set(env.getRoadSig(courseId, roadId, /*reverse*/ false), distance);
    roadDistances.set(env.getRoadSig(courseId, roadId, /*reverse*/ true), distance);
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
            if (peak) {
                const time = peak.lastTime();
                peaks[p] = {
                    avg: peak.avg(),
                    time,
                    ts: worldTimer.toLocalTime(wtOffset + (time * 1000)),
                };
            } else {
                peaks[p] = {avg: null, time: null, ts: null};
            }
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


class TimeSeriesAccumulator {
    constructor() {
        this.reset();
        this._value = null;
    }

    reset() {
        this._timeOffset = NaN;
    }

    get() {
        return this._value;
    }

    configure(...args) {
        throw new Error("Pure Virtual");
    }

    accumulate(time) {
        this._timeOffset = time;
    }
}


class WBalAccumulator extends TimeSeriesAccumulator {
    reset() {
        super.reset();
        this.cp = undefined;
        this.wPrime = undefined;
        this._accumulator = this._accumulatorAbsent;
    }

    _accumulatorAbsent() {
        return null;
    }

    configure(cp, wPrime) {
        this.cp = cp;
        this.wPrime = wPrime;
        if (!cp || !wPrime) {
            this.reset();
            return;
        }
        this._accumulator = sauce.power.makeIncWPrimeBalDifferential(cp, wPrime);
        this._value = wPrime;
    }

    accumulate(time, value) {
        const elapsed = (time - this._timeOffset) || 0;
        this._value = this._accumulator(value, elapsed);
        super.accumulate(time);
        return this._value;
    }
}


class ZonesAccumulator extends TimeSeriesAccumulator {
    reset() {
        super.reset();
        this.ftp = undefined;
        this._zones = [];
    }

    configure(ftp, zones) {
        this.ftp = ftp;
        if (!zones) {
            this.reset();
            return;
        }
        // Move overlapping zones (sweetspot) to bottom so we can break sooner in accumulator
        this._zones = zones.map(x => ({...x, from: x.from || 0, to: x.to || Infinity}));
        this._zones.sort((a, b) => a.overlap && !b.overlap ? 1 : 0);
        this._value = this._zones.map(x => ({zone: x.zone, time: 0}));
    }

    accumulate(time, value) {
        const elapsed = (time - this._timeOffset) || 0;
        for (let i = this._zones.length - 1; i >= 0; i--) {
            const z = this._zones[i];
            if (value > z.from && value <= z.to) {
                this._value[i].time += elapsed;
                if (!z.overlap) {
                    break;
                }
            }
        }
        super.accumulate(time);
    }
}


export class StatsProcessor extends events.EventEmitter {
    constructor(options={}) {
        super();
        this.setMaxListeners(100);
        this.zwiftAPI = options.zwiftAPI;
        this.gameMonitor = options.gameMonitor;
        this.exclusions = options.exclusions || new Set();
        this.athleteId = options.athleteId || this.gameMonitor?.gameAthleteId;
        this._userDataPath = options.userDataPath;
        this.watching = null;
        this.emitStatesMinRefresh = 200;
        this._athleteData = new Map();
        this._athletesCache = new Map();
        this._stateProcessCount = 0;
        this._stateDupCount = 0;
        this._stateStaleCount = 0;
        this._profileFetchIds = new Set();
        this._pendingProfileFetches = [];
        this._profileFetchCount = 0;
        this._profileFetchBackoff = 100;
        this._chatHistory = [];
        this._recentEvents = new Map();
        this._recentEventSubgroups = new Map();
        this._mostRecentNearby = [];
        this._mostRecentGroups = [];
        this._markedIds = new Set();
        this._followingIds = new Set();
        this._followerIds = new Set();
        this._pendingEgressStates = [];
        this._lastEgressStates = 0;
        this._timeoutEgressStates = null;
        const app = options.app;
        this._autoResetEvents = !!app.getSetting('autoResetEvents');
        this._autoLapEvents = !!app.getSetting('autoLapEvents');
        const autoLap = !!app.getSetting('autoLap');
        this._autoLapMetric = autoLap ? app.getSetting('autoLapMetric') : undefined;
        const autoLapFactor = this._autoLapMetric === 'distance' ? 1000 : 60;
        this._autoLapInterval = autoLap ? app.getSetting('autoLapInterval') * autoLapFactor : undefined;
        this._autoLap = !!(autoLap && this._autoLapMetric && this._autoLapInterval);
        this.powerZonesType = app.getSetting('powerZonesType', 'coggan');
        this.sweetspotType = app.getSetting('sweetspotType');
        try {
            const cpzRaw = app.getSetting('customPowerZones');
            this._customPowerZones = cpzRaw ? JSON.parse(cpzRaw) : null;
        } catch(e) {
            console.error("Custom power zones are invalid:", e);
            this._customPowerZones = null;
        }
        rpc.register(this.getPowerZones, {scope: this});
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
        rpc.register(this.getCachedEvent, {scope: this});
        rpc.register(this.getCachedEvents, {scope: this});
        rpc.register(this.getEventSubgroup, {scope: this});
        rpc.register(this.getEventSubgroupEntrants, {scope: this});
        rpc.register(this.getEventSubgroupResults, {scope: this});
        rpc.register(this.addEventSubgroupSignup, {scope: this});
        rpc.register(this.deleteEventSignup, {scope: this});
        rpc.register(this.loadOlderEvents, {scope: this});
        rpc.register(this.loadNewerEvents, {scope: this});
        rpc.register(this.resetAthletesDB, {scope: this});
        rpc.register(this.getChatHistory, {scope: this});
        rpc.register(this.setFollowing, {scope: this});
        rpc.register(this.setNotFollowing, {scope: this});
        rpc.register(this.giveRideon, {scope: this});
        rpc.register(this.getPowerProfile, {scope: this});
        rpc.register(this.getPlayerState, {scope: this});
        rpc.register(this.getNearbyData, {scope: this});
        rpc.register(this.getGroupsData, {scope: this});
        rpc.register(this.getAthleteStats, {scope: this}); // DEPRECATED
        rpc.register(this.getAthleteData, {scope: this});
        rpc.register(this.getAthletesData, {scope: this});
        rpc.register(this.updateAthleteStats, {scope: this}); // DEPRECATED
        rpc.register(this.updateAthleteData, {scope: this});
        rpc.register(this.getAthleteLaps, {scope: this});
        rpc.register(this.getAthleteSegments, {scope: this});
        rpc.register(this.getAthleteStreams, {scope: this});
        rpc.register(this.getSegment, {scope: this});
        rpc.register(this.getSegments, {scope: this});
        rpc.register(this.getSegmentsForRoad, {scope: this});
        rpc.register(this.getSegmentResults, {scope: this});
        rpc.register(this.putState, {scope: this});
        this._athleteSubs = new Map();
        if (options.gameConnection) {
            const gc = options.gameConnection;
            gc.on('status', ({connected}) => this.onGameConnectionStatusChange(connected));
            gc.on('powerup-activate', this.onPowerupActivate.bind(this));
            gc.on('powerup-set', this.onPowerupSet.bind(this));
            gc.on('custom-action-button', this.onCustomActionButton.bind(this));
        }
        if (options.debugGameFields) {
            this._cleanState = obj => obj;
        }
    }

    getPowerZones(ftp) {
        const baseZonesFunc = {
            coggan: sauce.power.cogganZones,
            polarized: sauce.power.polarizedZones,
            custom: this._getCustomPowerZones.bind(this),
        }[this.powerZonesType] || sauce.power.cogganZones;
        const zones = baseZonesFunc(ftp);
        if (this.sweetspotType) {
            zones.push(sauce.power.sweetspotZone(ftp, {type: this.sweetspotType}));
        }
        return zones;
    }

    _getCustomPowerZones(ftp) {
        return this._customPowerZones ? this._customPowerZones.map(x => ({
            zone: x.zone,
            from: x.from == null ? 0 : x.from * ftp,
            to: x.to == null ? Infinity : x.to * ftp,
        })) : sauce.power.cogganZones(ftp);
    }

    onGameConnectionStatusChange(connected) {
        const data = this._athleteData.get(this.athleteId);
        if (data) {
            data.gameState = {};
        }
    }

    _getGameState() {
        if (!this._athleteData.has(this.athleteId)) {
            return;
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

    getCachedEvent(id) {
        return this._recentEvents.get(id);
    }

    async getEvent(id) {
        if (!this._recentEvents.has(id)) {
            const event = await this.zwiftAPI.getEvent(id);
            if (event) {
                this._addEvent(event);
            }
        }
        return this._recentEvents.get(id);
    }

    getCachedEvents() {
        return Array.from(this._recentEvents.values()).sort((a, b) => a.ts - b.ts);
    }

    getEventSubgroup(id) {
        return this._recentEventSubgroups.get(id);
    }

    async getEventSubgroupEntrants(id, options={}) {
        const profiles = await this.zwiftAPI.getEventSubgroupEntrants(id, options);
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

    async getEventSubgroupResults(id) {
        const missingProfiles = new Set();
        const results = await this.zwiftAPI.getEventSubgroupResults(id);
        for (const x of results) {
            const athlete = this._getAthlete(x.profileId);
            if (!athlete) {
                missingProfiles.add(x.profileId);
            }
        }
        if (missingProfiles.size) {
            const updates = [];
            for (const p of await this.zwiftAPI.getProfiles(missingProfiles)) {
                if (p) {
                    updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
                }
            }
            if (updates.length) {
                this.saveAthletes(updates);
            }
        }
        for (const x of results) {
            x.athlete = this._getAthlete(x.profileId) || {};
        }
        return results;
    }

    async addEventSubgroupSignup(id) {
        await this.zwiftAPI.addEventSubgroupSignup(id);
        await this.refreshEventSignups();
    }

    async deleteEventSignup(id) {
        await this.zwiftAPI.deleteEventSignup(id);
        // Patch local cache of events until server updates (it's only eventually consistent)
        const event = this._recentEvents.get(id);
        if (event && event.eventSubgroups) {
            for (const sg of event.eventSubgroups) {
                sg.signedUp = false;
            }
        }
        await this.refreshEventSignups();
    }

    async refreshEventSignups() {
        const upcoming = await this.zwiftAPI.getUpcomingEvents();
        const ourSignups = new Set(upcoming.filter(x => x.profileId === this.zwiftAPI.profile.id)
            .map(x => x.eventSubgroupId));
        for (const x of this._recentEventSubgroups.values()) {
            if (ourSignups.has(x.id)) {
                x.signedUp = true;
            }
        }
    }

    async loadOlderEvents() {
        const range = 1.5 * 3600 * 1000;
        const to = this._lastLoadOlderEventsTS || worldTimer.serverNow();
        const from = to - range;
        this._lastLoadOlderEventsTS = from;
        let zEvents = await this.zwiftAPI.getEventFeed({from, to});
        if (!zEvents || !zEvents.length || zEvents.every(x => this._recentEvents.has(x.id))) {
            console.warn("Exhausted recent event feed, resorting to buggy event feed:", {from, to});
            // Need to double range to fill in possible gaps from boundary
            zEvents = await this.zwiftAPI.getEventFeedFullRangeBuggy({from, to: to + range});
        }
        return zEvents ? zEvents.map(x => this._addEvent(x)) : [];
    }

    async loadNewerEvents() {
        const range = 3 * 3600 * 1000;
        const from = this._lastLoadNewerEventsTS || worldTimer.serverNow();
        const to = from + range;
        this._lastLoadNewerEventsTS = +to;
        let zEvents = await this.zwiftAPI.getEventFeed({from, to});
        if (!zEvents || !zEvents.length || zEvents.every(x => this._recentEvents.has(x.id))) {
            console.warn("Exhausted recent event feed, resorting to buggy event feed:", {from, to});
            // Need to double range to fill in possible gaps from boundary
            zEvents = await this.zwiftAPI.getEventFeedFullRangeBuggy({from: from - range, to});
        }
        return zEvents ? zEvents.map(x => this._addEvent(x)) : [];
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

    _realAthleteId(ident) {
        return ident === 'self' ?
            this.athleteId :
            ident === 'watching' ?
                this.watching : Number(ident);
    }

    getAthleteStats(id) {
        console.warn("DEPRECATED: use `getAthleteData`");
        return this.getAthleteData(id);
    }

    getAthletesData(ids) {
        return ids ?
            ids.map(x => this.getAthleteData(x)) :
            Array.from(this._athleteData.values()).map(x => this._formatAthleteData(x));
    }

    getAthleteData(id) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        return ad ? this._formatAthleteData(ad) : null;
    }

    updateAthleteStats(id, updates) {
        console.warn("DEPRECATED: use `updateAthleteData`");
        return this.updateAthleteData(id, updates);
    }

    updateAthleteData(id, updates) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        if (!ad.extra) {
            ad.extra = {};
        }
        Object.assign(ad.extra, updates);
        return this._formatAthleteData(ad);
    }

    getAthleteLaps(id, {startTime, active}={}) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        let laps = ad.laps;
        if (startTime !== undefined) {
            laps = laps.filter(x => x.power.roll._times[x.power.roll._offt] >= startTime);
        }
        if (laps.length && !active && laps[laps.length - 1].end == null) {
            laps = laps.slice(0, -1);
        }
        const athlete = this.loadAthlete(ad.athleteId);
        return laps.map(x => this._formatLapish(x, ad, athlete));
    }

    getAthleteSegments(id, {startTime, active}={}) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        let segments = ad.segments;
        if (startTime !== undefined) {
            segments = segments.filter(x => x.power.roll._times[x.power.roll._offt] >= startTime);
        }
        if (segments.length && !active && segments[segments.length - 1].end == null) {
            segments = segments.slice(0, -1);
        }
        const athlete = this.loadAthlete(ad.athleteId);
        return segments.map(x => this._formatLapish(x, ad, athlete, {
            segmentId: x.id,
            segment: env.cachedSegments.get(x.id),
        }));
    }

    _formatLapish(lapish, ad, athlete, extra) {
        const startIndex = lapish.power.roll._offt;
        const endIndex = Math.max(startIndex, lapish.power.roll._length - 1);
        return {
            stats: this._getCollectorStats(lapish, ad, athlete),
            startIndex,
            endIndex,
            start: lapish.power.roll._times[startIndex],
            end: lapish.power.roll._times[endIndex],
            sport: lapish.sport,
            courseId: lapish.courseId,
            ...extra,
        };
    }

    getAthleteStreams(id, {startTime}={}) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        let offt;
        if (startTime !== undefined) {
            const timeStream = ad.collectors.power.roll.times();
            offt = timeStream.findIndex(x => x >= startTime);
            if (offt === -1) {
                offt = Infinity;
            }
        }
        return this._getAthleteStreams(ad, offt);
    }

    _getAthleteStreams(ad, offt) {
        const cs = ad.collectors;
        const power = cs.power.roll.values(offt);
        const streams = {
            time: cs.power.roll.times(offt),
            power,
            speed: cs.speed.roll.values(offt),
            hr: cs.hr.roll.values(offt),
            cadence: cs.cadence.roll.values(offt),
            draft: cs.draft.roll.values(offt),
            active: power.map(x => !!+x || !(x instanceof sauce.data.Pad)),
        };
        for (const [k, arr] of Object.entries(ad.streams)) {
            streams[k] = arr.slice(offt);
        }
        return streams;
    }

    getSegment(id) {
        if (id == null) {
            throw new TypeError('id required');
        }
        return env.cachedSegments.get(id);
    }

    getSegments(courseId) {
        if (courseId == null) {
            throw new TypeError('courseId required');
        }
        return env.getCourseSegments(courseId);
    }

    getSegmentsForRoad(courseId, roadId, reverse=false) {
        if (courseId == null || roadId == null) {
            throw new TypeError('courseId and roadId required');
        }
        return env.getCourseSegments(courseId).filter(x => x.roadId === roadId && !!x.reverse === !!reverse);
    }

    async getSegmentResults(id, options={}) {
        let segments;
        if (id == null) {
            segments = await this.zwiftAPI.getLiveSegmentLeaders();
        } else {
            if (options.live) {
                segments = await this.zwiftAPI.getLiveSegmentLeaderboard(id, options);
            } else {
                segments = await this.zwiftAPI.getSegmentResults(id, options);
            }
        }
        if (segments) {
            return segments.map(x => ({
                ...x,
                ts: worldTimer.toLocalTime(x.worldTime),
                weight: x.weight / 1000,
                elapsed: x.elapsed / 1000,
                gender: x.male === false ? 'female' : 'male',
                _unsignedSegmentId: undefined,
                male: undefined,
            }));
        }
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
        Object.assign(lastLap, this._cloneDataCollectors(lastLap));
        ad.laps.push(this._createNewLapish(ad));
    }

    startSegment(ad, id) {
        const segment = this._createNewLapish(ad);
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
        const wt = worldTimer.now();
        for (const ad of this._athleteData.values()) {
            this._resetAthleteData(ad, wt);
        }
    }

    async exportFIT(id) {
        const athleteId = this._realAthleteId(id);
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
            software_version: Number([vmajor.slice(0, 2), vminor.slice(0, 2).padStart(2, '0')].join('')),
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
        const {laps, streams, wtOffset, mostRecentState} = this._athleteData.get(athleteId);
        const tsOffset = worldTimer.toServerTime(wtOffset);
        const sport = {
            'cycling': 'cycling',
            'running': 'running',
        }[mostRecentState?.sport || 'cycling'] || 'generic';
        fitParser.addMessage('event', {
            event: 'timer',
            event_type: 'start',
            event_group: 0,
            timestamp: tsOffset,
            data: 'manual',
        });
        let lapNumber = 0;
        let lastTS;
        let offt = 0;
        for (const {power, speed, cadence, hr} of laps) {
            if ([speed, cadence, hr].some(x => x.roll.size() !== power.roll.size())) {
                throw new Error("Assertion failure about roll sizes being equal");
            }
            for (let i = 0; i < power.roll.size(); i++, offt++) {
                lastTS = tsOffset + (power.roll.timeAt(i) * 1000);
                const record = {timestamp: lastTS};
                record.speed = speed.roll.valueAt(i) * 1000 / 3600;
                record.heart_rate = +hr.roll.valueAt(i);
                record.cadence = Math.round(cadence.roll.valueAt(i));
                record.power = Math.round(power.roll.valueAt(i));
                record.distance = streams.distance[offt];
                record.altitude = streams.altitude[offt];
                [record.position_lat, record.position_long] = streams.latlng[offt];
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
            sub_sport: 'virtual_activity',
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
        const powerMeter = p.powerSourceModel ? powerMeterSources.includes(p.powerSourceModel) : undefined;
        const minor = p.privacy && p.privacy.minor;
        const o = {
            firstName: p.firstName,
            lastName: p.lastName,
            ftp: p.ftp,
            type: p.playerType,
            countryCode: p.countryCode, // iso 3166
            powerSourceModel: p.powerSourceModel,
            avatar: !minor ? p.imageSrcLarge || p.imageSrc : undefined,
            weight: !minor && p.weight ? p.weight / 1000 : undefined,
            height: !minor && p.height ? p.height / 10 : undefined,
            gender: !minor && p.male === false ? 'female' : 'male',
            age: !minor && p.privacy && p.privacy.displayAge ? p.age : null,
            level: p.achievementLevel ? Math.floor(p.achievementLevel / 100) : undefined,
            powerMeter,
            ...p.competitionMetrics,
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
        if (d.sanitizedName) {
            const n = d.sanitizedName;
            d.initials = n
                .map(x => String.fromCodePoint(x.codePointAt(0)))
                .join('')
                .toUpperCase();
            d.fLast = n.length > 1 ? `${String.fromCodePoint(n[0].codePointAt(0))}.${n[1]}` : n[0];
        } else {
            d.fLast = d.initials = null;
        }
        if (d.wPrime === undefined && data.wPrime === undefined) {
            data.wPrime = wPrimeDefault; // Po-boy migration
        }
        for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
                d[k] = v;
            }
        }
        const ad = this._athleteData.get(id);
        if (ad) {
            this._updateAthleteDataFromDatabase(ad, d);
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
        if (!this.exclusions.has(zwift.getIDHash(id))) {
            const r = this.getAthleteStmt.get(id);
            if (r) {
                const data = JSON.parse(r.data);
                this._athletesCache.set(id, data);
                return data;
            } else {
                this._athletesCache.set(id, null);
            }
        }
    }

    async getAthlete(ident, {refresh, noWait, allowFetch}={}) {
        const id = this._realAthleteId(ident);
        if (allowFetch && !this.loadAthlete(id)) {
            refresh = true;
            noWait = false;
        }
        if (refresh && this.zwiftAPI.isAuthenticated()) {
            const updating = this.zwiftAPI.getProfile(id).then(p =>
                (p && this.updateAthlete(id, this._profileToAthlete(p))));
            if (!noWait) {
                await updating;
            }
        }
        return this._getAthlete(id);
    }

    _getAthlete(id) {
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

    getFollowerAthletes() {
        return Array.from(this._followerIds).map(id => ({id, athlete: this.loadAthlete(id)}));
    }

    getFollowingAthletes() {
        return Array.from(this._followingIds).map(id => ({id, athlete: this.loadAthlete(id)}));
    }

    getMarkedAthletes() {
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

    async _loadEvents(ids) {
        for (const x of ids) {
            try {
                const event = await this.zwiftAPI.getEvent(x);
                if (event) {
                    this._addEvent(event);
                }
            } catch(e) {
                /* no-pragma */
                // Club rides we don't have rights to show up in our list
                // I can't see a way to test for permissions before attempting
                // access so we just catch the error
                console.warn('Failed to load event:', x, e.status, e.message);
            }
        }
        await this.refreshEventSignups();
    }

    onIncoming(...args) {
        try {
            this._onIncoming(...args);
        } catch(e) {
            report.errorOnce(e);
        }
    }

    _onIncoming(packet) {
        const updatedEvents = [];
        const ignore = [
            'PayloadSegmentResult',
            'notableMoment',
            'PayloadLeftWorld2',
            '_fenceConfig',
            '_broadcastRideLeaderAction',
            '_handlePacePartnerInfo',
            '_flag',
            '_performAction',
        ];
        for (let i = 0; i < packet.worldUpdates.length; i++) {
            const x = packet.worldUpdates[i];
            if (x.payloadType) {
                if (x.payloadType === 'PayloadChatMessage') {
                    const ts = x.ts / 1000;
                    this.handleChatPayload(x.payload, ts);
                } else if (x.payloadType === 'PayloadRideOn') {
                    this.handleRideOnPayload(x.payload);
                } else if (x.payloadType === 'Event') {
                    // The event payload is more like a notification (it's incomplete)
                    // We also get multiples for each event, first with id = 0, then one
                    // for each subgroup.
                    const eventId = x.payload.id;
                    if (eventId && !updatedEvents.includes(eventId)) {
                        updatedEvents.push(eventId);
                    }
                } else if (x.payloadType === 'groupEventUserRegistered') {
                    const sg = this._recentEventSubgroups.get(x.payload.subgroupId);
                    if (sg) {
                        const event = this._recentEvents.get(sg.eventId);
                        if (this._followingIds.has(x.payload.athleteId)) {
                            sg.followeeEntrantCount++;
                            if (event) {
                                event.followeeEntrantCount++;
                            }
                        }
                        sg.totalEntrantCount++;
                        if (event) {
                            event.totalEntrantCount++;
                        }
                    }
                } else if (!ignore.includes(x.payloadType)) {
                    console.debug("Unhandled WorldUpdate:", x);
                }
            }
        }
        if (updatedEvents.length) {
            queueMicrotask(() => this._loadEvents(updatedEvents));
        }
        const hasStatesListener = !!this.listenerCount('states');
        for (let i = 0; i < packet.playerStates.length; i++) {
            const x = packet.playerStates[i];
            if (this.processState(x) === false) {
                continue;
            }
            if (hasStatesListener) {
                this._pendingEgressStates.push(x);
            }
        }
        if (packet.eventPositions) {
            const ep = packet.eventPositions;
            // There are several groups of fields on eventPositions, but I don't understand/see them.
            if (ep.players1.length + ep.players2.length + ep.players3.length + ep.players4.length) {
                console.warn('Unhandled event positions arrays 1, 2, 3 or 4', ep);
            }
            const positions = ep.players10;
            for (let i = 0; i < positions.length; i++) {
                const x = positions[i];
                const ad = this._athleteData.get(x.athleteId);
                // Must check eventSubgroup as these can lag an event finish and get stuck on.
                if (ad && ad.eventSubgroup) {
                    ad.eventPosition = x.position;
                    ad.eventParticipants = ep.activeAthleteCount;
                }
            }
            if (ep.position && this._athleteData.has(ep.watchingAthleteId)) {
                const ad = this._athleteData.get(ep.watchingAthleteId);
                ad.eventPosition = ep.position;
                ad.eventParticipants = ep.activeAthleteCount;
            }
        }
        this._schedStatesEmit();
    }

    _schedStatesEmit() {
        if (this._pendingEgressStates.length && !this._timeoutEgressStates) {
            const now = monotonic();
            const delay = this.emitStatesMinRefresh - (now - this._lastEgressStates);
            if (delay > 0) {
                this._timeoutEgressStates = setTimeout(() => {
                    this._timeoutEgressStates = null;
                    this._lastEgressStates = monotonic();
                    this.emit('states', this._pendingEgressStates.map(x => this._cleanState(x)));
                    this._pendingEgressStates.length = 0;
                }, delay);
            } else {
                this.emit('states', this._pendingEgressStates.map(x => this._cleanState(x)));
                this._pendingEgressStates.length = 0;
                this._lastEgressStates = now;
            }
        }
    }

    putState(state) {
        if (this.processState(state) === false) {
            console.warn("State skipped by processer");
            return;
        }
        if (this.listenerCount('states')) {
            this._pendingEgressStates.push(state);
        }
        this._schedStatesEmit();
    }

    handleRideOnPayload(payload) {
        this.emit('rideon', payload);
        console.debug("RideOn:", payload);
    }

    handleChatPayload(payload, ts) {
        if (this.exclusions.has(zwift.getIDHash(payload.from))) {
            return;
        }
        for (let i = 0; i < this._chatHistory.length && i < 10; i++) {
            const x = this._chatHistory[i];
            if (x.ts === ts && x.from === payload.from) {
                console.warn("Deduping chat message:", ts, payload.from, payload.message);
                return;
            } else if (x.from === payload.from && x.mesage === payload.message &&
                       payload.ts - x.ts < 5000) {
                console.warn("Deduping chat message (content based):", ts, payload.from, payload.message);
                debugger;
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
        const name = `${chat.firstName || ''} ${chat.lastName || ''}`;
        console.debug(`Chat from ${name} [id: ${chat.from}, event: ${chat.eventSubgroup}]:`, chat.message);
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
        return env.getRoadSig(state.courseId, state.roadId, state.reverse);
    }

    _getCollectorStats(cs, ad, athlete, {includeDeprecated}={}) {
        const end = cs.end || monotonic();
        const elapsedTime = (end - cs.start) / 1000;
        const np = cs.power.roll.np({force: true});
        let wBal, timeInPowerZones; // DEPRECATED
        if (includeDeprecated) {
            wBal = ad.privacy.hideWBal ? undefined : ad.wBal.get();
            timeInPowerZones = ad.privacy.hideFTP ? undefined : ad.timeInPowerZones.get();
        }
        const activeTime = cs.power.roll.active();
        const tss = (!ad.privacy.hideFTP && np && athlete && athlete.ftp) ?
            sauce.power.calcTSS(np, activeTime, athlete.ftp) :
            undefined;
        return {
            elapsedTime,
            activeTime,
            wBal, // DEPRECATED
            timeInPowerZones, // DEPRECATED
            power: cs.power.getStats(ad.wtOffset, {
                np,
                tss,
                kj: cs.power.roll.joules() / 1000,
                wBal, // DEPRECATED
                timeInZones: timeInPowerZones, // DEPRECATED
            }),
            speed: cs.speed.getStats(ad.wtOffset),
            hr: cs.hr.getStats(ad.wtOffset),
            cadence: cs.cadence.getStats(ad.wtOffset),
            draft: cs.draft.getStats(ad.wtOffset, {
                kj: cs.draft.roll.joules() / 1000,
            }),
        };
    }

    _makeDataCollectors() {
        const periods = [5, 15, 60, 300, 1200];
        const longPeriods = periods.filter(x => x >= 60);
        return {
            start: monotonic(),
            power: new DataCollector(sauce.power.RollingPower, periods, {inlineNP: true, round: true}),
            speed: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true}),
            hr: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true, round: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true, round: true}),
            draft: new DataCollector(sauce.power.RollingPower, longPeriods, {round: true}),
        };
    }

    _cloneDataCollectors(collectors, options={}) {
        const types = ['power', 'speed', 'hr', 'cadence', 'draft'];
        const bucket = {start: options.reset ? monotonic() : collectors.start};
        for (const x of types) {
            bucket[x] = collectors[x].clone(options);
        }
        return bucket;
    }

    _createNewLapish(ad) {
        const lapish = this._cloneDataCollectors(ad.collectors, {reset: true});
        lapish.courseId = ad.courseId;
        lapish.sport = ad.sport;
        return lapish;
    }

    maybeUpdateAthleteFromServer(athleteId) {
        if (this._profileFetchIds.has(athleteId)) {
            return;
        }
        this._profileFetchIds.add(athleteId);
        this._pendingProfileFetches.push(athleteId);
        if (!this._athleteProfileUpdaterActive) {
            this._athleteProfileUpdaterActive = true;
            // wait for next task so looped calls will fill the batch first...
            queueMicrotask(() => this.runAthleteProfileUpdater()
                .finally(() => this._athleteProfileUpdaterActive = false));
        }
    }

    async _updateAthleteProfilesFromServer(batch) {
        const updates = [];
        let allowRefetchAfter = 1000; // err
        try {
            for (const p of await this.zwiftAPI.getProfiles(batch, {silent: true})) {
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
                this._profileFetchBackoff = 1000;
            } catch(e) {
                if (e.name === 'FetchError') {
                    console.warn("Network problem while collecting profiles:", e.message);
                } else {
                    console.error("Error while collecting profiles:", e);
                }
                this._profileFetchBackoff *= 1.5;
            }
            await sauce.sleep(this._profileFetchBackoff);
        }
    }

    _updateAthleteDataFromDatabase(ad, athlete) {
        const cp = athlete.cp || athlete.ftp;
        const wPrime = athlete.wPrime || wPrimeDefault;
        if (ad.wBal.cp !== cp || ad.wBal.wPrime !== wPrime) {
            ad.wBal.configure(cp, wPrime);
        }
        const ftp = athlete.ftp;
        if (ad.timeInPowerZones.ftp !== ftp) {
            ad.timeInPowerZones.configure(ftp, ftp ? this.getPowerZones(ftp) : null);
        }
    }

    _createAthleteData(state) {
        const collectors = this._makeDataCollectors();
        const ad = {
            created: worldTimer.toLocalTime(state.worldTime),
            wtOffset: state.worldTime,
            athleteId: state.athleteId,
            courseId: state.courseId,
            sport: state.sport,
            privacy: {},
            mostRecentState: null,
            wBal: new WBalAccumulator(),
            timeInPowerZones: new ZonesAccumulator(),
            distanceOffset: 0,
            streams: {
                distance: [],
                altitude: [],
                latlng: [],
                wbal: [],
            },
            roadHistory: {
                sig: null,
                prevSig: null,
                timeline: [],
                prevTimeline: null,
            },
            collectors,
            laps: [],
            segments: [],
            activeSegments: new Map(),
            smoothGrade: expWeightedAvg(8),
        };
        ad.laps.push(this._createNewLapish(ad));
        const athlete = this.loadAthlete(state.athleteId);
        if (athlete) {
            this._updateAthleteDataFromDatabase(ad, athlete);
        }
        return ad;
    }

    _resetAthleteData(ad, wtOffset) {
        const collectors = this._makeDataCollectors();
        Object.assign(ad, {
            created: worldTimer.toLocalTime(wtOffset),
            wtOffset,
            collectors,
            laps: [this._createNewLapish(ad)],
        });
        // NOTE: Don't reset w'bal; it is a biometric
        ad.timeInPowerZones.reset();
        ad.activeSegments.clear();
        ad.segments.length = 0;
        for (const x of Object.values(ad.streams)) {
            x.length = 0;
        }
        const athlete = this.loadAthlete(ad.athleteId);
        if (athlete) {
            this._updateAthleteDataFromDatabase(ad, athlete);
        }
    }

    triggerEventStart(ad, state) {
        ad.eventStartPending = false;
        if (this._autoResetEvents) {
            console.debug("Event start triggering reset for:", ad.athleteId, ad.eventSubgroup?.id);
            this._resetAthleteData(ad, state.worldTime);
        } else if (this._autoLapEvents) {
            console.debug("Event start triggering lap for:", ad.athleteId, ad.eventSubgroup?.id);
            this.startAthleteLap(ad);
        }
    }

    triggerEventEnd(ad, state) {
        if (this._autoResetEvents || this._autoLapEvents) {
            console.debug("Event end triggering lap for:", ad.athleteId, ad.eventSubgroup?.id);
            this.startAthleteLap(ad);
        }
    }

    processState(state) {
        const worldMeta = env.worldMetas[state.courseId];
        if (worldMeta) {
            state.latlng = worldMeta.flippedHack ?
                [(state.x / (worldMeta.latDegDist * 100)) + worldMeta.latOffset,
                    (state.y / (worldMeta.lonDegDist * 100)) + worldMeta.lonOffset] :
                [-(state.y / (worldMeta.latDegDist * 100)) + worldMeta.latOffset,
                    (state.x / (worldMeta.lonDegDist * 100)) + worldMeta.lonOffset];
            let slopeScale;
            if (state.portal) {
                const road = env.getRoad(state.courseId, state.roadId);
                slopeScale = road?.physicsSlopeScaleOverride;
            } else {
                slopeScale = worldMeta.physicsSlopeScale;
            }
            state.altitude = (state.z + worldMeta.waterPlaneLevel) / 100 * slopeScale +
                worldMeta.altitudeOffsetHack;
        }
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId, this._createAthleteData(state));
        }
        const ad = this._athleteData.get(state.athleteId);
        const prevState = ad.mostRecentState;
        if (prevState) {
            const elapsed = state.worldTime - prevState.worldTime;
            if (elapsed < 0) {
                this._stateStaleCount++;
                return false;
            } else if (elapsed === 0) {
                this._stateDupCount++;
                return false;
            }
            if (prevState.sport !== state.sport || prevState.courseId !== state.courseId ||
                state.distance < prevState.distance) {
                ad.sport = state.sport;
                ad.courseId = state.courseId;
                ad.distanceOffset += prevState.distance;
                ad.autoLapMark = undefined;
                state.grade = 0;
                this.startAthleteLap(ad);
            } else {
                const elevationChange = state.altitude - prevState.altitude;
                const distanceChange = state.eventDistance ?
                    (state.eventDistance - prevState.eventDistance) :
                    (state.distance - prevState.distance);
                state.grade = ad.smoothGrade(distanceChange ?
                    (elevationChange / distanceChange) :
                    prevState.grade);
                // Leaving around because it's pretty darn useful for debugging...
                //state.mapurl = `https://maps.google.com/maps?` +
                //    `q=${state.latlng[0]},${state.latlng[1]}&z=17`;
            }
        } else {
            state.grade = 0;
        }
        const noSubgroup = null;
        const sg = state.eventSubgroupId &&
            this._recentEventSubgroups.get(state.eventSubgroupId) ||
            noSubgroup;
        if (sg && sg.courseId === state.courseId) {
            if (!ad.eventSubgroup || sg.id !== ad.eventSubgroup.id) {
                ad.eventSubgroup = sg;
                ad.privacy = {};
                ad.eventPosition = undefined;
                ad.eventParticipants = undefined;
                if (state.athleteId !== this.athleteId) {
                    ad.privacy.hideWBal = sg.allTags.includes('hidewbal');
                    ad.privacy.hideFTP = sg.allTags.includes('hideftp');
                }
                ad.disabled = sg.allTags.includes('hidethehud') || sg.allTags.includes('nooverlays');
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
            ad.eventPosition = undefined;
            ad.eventParticipants = undefined;
            this.triggerEventEnd(ad, state);
        }
        if (ad.disabled) {
            return;
        }
        const roadSig = this._roadSig(state);
        if (this._autoLap) {
            this._autoLapCheck(state, ad);
        }
        if (!roadDistances.has(roadSig)) {
            updateRoadDistance(state.courseId, state.roadId);
        }
        this._activeSegmentCheck(state, ad, roadSig);
        this._recordAthleteRoadHistory(state, ad, roadSig);
        const addCount = this._recordAthleteStats(state, ad);
        ad.mostRecentState = state;
        ad.updated = monotonic();
        this._stateProcessCount++;
        let emitData;
        let streamsData;
        if (this.watching === state.athleteId) {
            if (this.listenerCount('athlete/watching')) {
                this.emit('athlete/watching', emitData || (emitData = this._formatAthleteData(ad)));
            }
            if (addCount && this.listenerCount('streams/watching')) {
                this.emit('streams/watching', streamsData ||
                          (streamsData = this._getAthleteStreams(ad, -addCount)));
            }
        }
        if (this.athleteId === state.athleteId) {
            if (this.listenerCount('athlete/self')) {
                this.emit('athlete/self', emitData || (emitData = this._formatAthleteData(ad)));
            }
            if (addCount && this.listenerCount('streams/self')) {
                this.emit('streams/self', streamsData ||
                          (streamsData = this._getAthleteStreams(ad, -addCount)));
            }
        }
        if (this.listenerCount(`athlete/${state.athleteId}`)) {
            this.emit(`athlete/${state.athleteId}`, emitData || (emitData = this._formatAthleteData(ad)));
        }
        if (addCount && this.listenerCount(`streams/${state.athleteId}`)) {
            this.emit(`streams/${state.athleteId}`, streamsData ||
                      (streamsData = this._getAthleteStreams(ad, -addCount)));
        }
        this.maybeUpdateAthleteFromServer(state.athleteId);
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
        }
        ad.roadHistory.sig = roadSig;
        ad.roadHistory.timeline.push({
            wt: state.worldTime,
            roadCompletion: state.roadCompletion,
            distance: state.distance,
        });
    }

    _recordAthleteStats(state, ad) {
        // Never auto pause wBal as it is a biometric. We use true worldTime to
        // survive resets as well.
        const wbal = ad.wBal.accumulate(state.worldTime / 1000, state.power);
        if (!state.power && !state.speed) {
            // Emulate auto pause...
            const addCount = ad.collectors.power.flushBuffered();
            if (addCount) {
                ad.collectors.speed.flushBuffered();
                ad.collectors.hr.flushBuffered();
                ad.collectors.draft.flushBuffered();
                ad.collectors.cadence.flushBuffered();
                for (let i = 0; i < addCount; i++) {
                    ad.streams.distance.push(ad.distanceOffset + state.distance);
                    ad.streams.altitude.push(state.altitude);
                    ad.streams.latlng.push(state.latlng);
                    ad.streams.wbal.push(wbal);
                }
            }
            return addCount;
        }
        const time = (state.worldTime - ad.wtOffset) / 1000;
        ad.timeInPowerZones.accumulate(time, state.power);
        const addCount = ad.collectors.power.add(time, state.power);
        ad.collectors.speed.add(time, state.speed);
        ad.collectors.hr.add(time, state.heartrate);
        ad.collectors.draft.add(time, state.draft);
        ad.collectors.cadence.add(time, state.cadence);
        for (let i = 0; i < addCount; i++) {
            ad.streams.distance.push(ad.distanceOffset + state.distance);
            ad.streams.altitude.push(state.altitude);
            ad.streams.latlng.push(state.latlng);
            ad.streams.wbal.push(wbal);
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
        return addCount;
    }

    _activeSegmentCheck(state, ad, roadSig) {
        const segments = env.getRoadSegments(state.courseId, roadSig);
        if (!segments || !segments.length) {
            return;
        }
        const p = (state.roadTime - 5000) / 1e6;
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
        const segments = env.getRoadSegments(state.courseId, roadSig);
        if (!segments || !segments.length) {
            return [];
        }
        const p = (state.roadTime - 5000) / 1e6;
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

    resetAthletesDB() {
        deleteDatabase(this.athletesDB.name);
        this.athletesDB = null;
        this._athletesCache.clear();
        this.initAthletesDB();
    }

    initAthletesDB() {
        if (this.athletesDB) {
            throw new TypeError("Already initialized");
        }
        this.athletesDB = new SqliteDatabase(path.join(this._userDataPath, 'athletes.sqlite'), {
            tables: {
                athletes: {
                    id: 'INTEGER PRIMARY KEY',
                    data: 'TEXT',
                }
            }
        });
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
        this._gcInterval = setInterval(this.gcAthleteData.bind(this), 62768);
        if (this.gameMonitor) {
            this.gameMonitor.on('inPacket', this.onIncoming.bind(this));
            this.gameMonitor.on('watching-athlete', this.setWatching.bind(this));
            this.gameMonitor.on('game-athlete', id => {
                // Probably using --random-watch option
                console.warn('Game athlete changed to:', id);
                this.athleteId = id;
            });
            this.gameMonitor.start();
        }
        this._zwiftMetaRefresh = 10000;
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
        return Array.from(tags);
    }

    _addEvent(event) {
        const route = env.getRoute(event.routeId);
        if (route) {
            event.routeDistance = this._getRouteDistance(route, event.laps);
            event.routeClimbing = this._getRouteClimbing(route, event.laps);
        }
        event.tags = event._tags.split(';');
        event.allTags = this._parseEventTags(event);
        event.ts = +new Date(event.eventStart);
        event.courseId = env.getCourseId(event.mapId);
        if (!this._recentEvents.has(event.id)) {
            const start = new Date(event.ts).toLocaleString();
            console.debug(`Event added [${event.id}] - ${start}:`, event.name);
        }
        if (event.eventSubgroups) {
            for (const sg of event.eventSubgroups) {
                sg.eventId = event.id;
                sg.startOffset = +(new Date(sg.eventSubgroupStart)) - +(new Date(event.eventStart));
                sg.allTags = Array.from(new Set([...this._parseEventTags(sg), ...event.allTags]));
                sg.courseId = env.getCourseId(sg.mapId);
                const rt = env.getRoute(sg.routeId);
                if (rt) {
                    sg.routeDistance = this._getRouteDistance(rt, sg.laps);
                    sg.routeClimbing = this._getRouteClimbing(rt, sg.laps);
                }
                this._recentEventSubgroups.set(sg.id, sg);
            }
        }
        this._recentEvents.set(event.id, event);
        return event;
    }

    _addMeetup(meetup) {
        meetup.routeDistance = this.getRouteDistance(meetup.routeId, meetup.laps, 'meetup');
        meetup.routeClimbing = this.getRouteClimbing(meetup.routeId, meetup.laps, 'meetup');
        meetup.eventType = 'MEETUP';
        meetup.totalEntrantCount = meetup.acceptedTotalCount;
        meetup.followeeEntrantCount = meetup.acceptedFolloweeCount;
        meetup.allTags = this._parseEventTags(meetup);
        meetup.ts = +new Date(meetup.eventStart);
        meetup.courseId = env.getCourseId(meetup.mapId);
        // Meetups are basicaly a hybrid event/subgroup
        meetup.eventSubgroups = [{...meetup, id: meetup.eventSubgroupId, eventId: meetup.id}];
        this._recentEventSubgroups.set(meetup.eventSubgroupId, meetup);
        this._recentEvents.set(meetup.id, meetup);
    }

    _zwiftMetaSync() {
        if (!this._active || !this.zwiftAPI.isAuthenticated()) {
            console.warn("Skipping social network update because not logged into zwift");
            return;
        }
        this.__zwiftMetaSync().catch(e => {
            if (e.name !== 'FetchError') {
                report.errorThrottled(e);
            } else {
                console.warn('Zwift Meta Sync network problem:', e.message);
            }
        }).finally(() => {
            // The event feed APIs are horribly broken so we need to refresh more often
            // at startup to try and fill in the gaps.
            this._zwiftMetaId = setTimeout(() => this._zwiftMetaSync(), this._zwiftMetaRefresh);
            this._zwiftMetaRefresh = Math.min(10 * 60 * 1000, this._zwiftMetaRefresh * 1.25);
        });
    }

    async __zwiftMetaSync() {
        let addedEventsCount = 0;
        const zEvents = await this.zwiftAPI.getEventFeed();
        if (zEvents.length) {
            this._lastLoadOlderEventsTS = Math.min(this._lastLoadOlderEventsTS || Infinity,
                                                   zEvents.at(0).eventStart);
            this._lastLoadNewerEventsTS = Math.max(this._lastLoadNewerEventsTS || -Infinity,
                                                   zEvents.at(-1).eventStart);
        }
        for (const x of zEvents) {
            addedEventsCount += !this._recentEvents.has(x.id);
            this._addEvent(x);
        }
        const meetups = await this.zwiftAPI.getPrivateEventFeed();
        for (const x of meetups) {
            addedEventsCount += !this._recentEvents.has(x.id);
            this._addMeetup(x);
        }
        await this.refreshEventSignups();
        let backoff = 10;
        let absent = new Set(this._followingIds);
        await this.zwiftAPI.getFollowing(this.athleteId, {
            pageLimit: 0,
            silent: true,
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
                await sauce.sleep(Math.min(1000, backoff *= 1.1));
            }
        });
        for (const x of absent) {
            this._followingIds.delete(x);
        }
        backoff = 10;
        absent = new Set(this._followerIds);
        await this.zwiftAPI.getFollowers(this.athleteId, {
            pageLimit: 0,
            silent: true,
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
                await sauce.sleep(Math.min(1000, backoff *= 1.1));
            }
        });
        for (const x of absent) {
            this._followerIds.delete(x);
        }
        console.info(`Meta data sync: ${this._followingIds.size} following, ` +
            `${this._followerIds.size} followers, ${this._recentEvents.size} events ` +
            `(${addedEventsCount} new)`);
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

    async getPowerProfile() {
        return await this.zwiftAPI.getPowerProfile();
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
            const roadDist = roadDistances.get(a.sig) || 0;
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
                    const roadDist = roadDistances.get(b.prevSig) || 0;
                    const gapDistance = (d / 1e6 * roadDist) + (bTail.distance - bPrevTail.distance);
                    return {reversed: true, previous: true, gapDistance};
                }
            }
            if (d2 !== undefined) {
                // We can probably move this up to the first d2 block once we validate the above condition
                // is not relevant.  Probably need to check on something funky like crit city or japan.
                const aPrevTail = a.prevTimeline[a.prevTimeline.length - 1];
                const roadDist = roadDistances.get(a.prevSig) || 0;
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

    gcAthleteData() {
        const now = monotonic();
        const expiration = now - 1800 * 1000;
        for (const [k, {updated}] of this._athleteData.entries()) {
            if (updated < expiration) {
                this._athleteData.delete(k);
                this._athletesCache.delete(k);
            }
        }
    }

    async _statesProcessor() {
        const interval = 1000;
        // Align interval with realtime second boundary for aesthetics and to avoid potential
        // rounding issues in stats code or UX code.
        let target = (monotonic() / 1000 | 0) * 1000 + interval;
        let errBackoff = 1;
        let sli = 0;
        const slAvg = expWeightedAvg(100, 1000);
        let lastSl = monotonic();
        const start = monotonic();
        while (this._active) {
            let skipped = 0;
            const now = monotonic();
            while (now > (target += interval)) {
                skipped++;
            }
            if (skipped) {
                console.warn("States processor skipped:", skipped);
                sli += skipped;
            }
            if (sli % 1 === 0) {
                //console.log("sleep", target - now);
            }
            await highResSleepTill(target);
            let t = monotonic();
            sli++;
            slAvg(t - lastSl);
            if (sli % 10 === 0) {
                const elapsed = t - start;
                console.log(t, target, target - t, 'sleep ', 'totavg:', elapsed / sli, 'i:', sli, 'rollavg:', slAvg.get(),
                            'last:', t - lastSl);
            }
            lastSl = t;

            if (this.watching == null) {
                continue;
            }
            try {
                const nearby = this._mostRecentNearby = this._computeNearby();
                const groups = this._mostRecentGroups = this._computeGroups(nearby);
                this.emit('nearby', nearby);
                this.emit('groups', groups);
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

    getRouteDistance(routeId, laps=1, leadinType) {
        const route = env.getRoute(routeId);
        if (route) {
            return this._getRouteDistance(route, laps, leadinType);
        }
    }

    _getRouteDistance(route, laps=1, leadinType='event') {
        const leadin = {
            event: route.leadinDistanceInMeters,
            meetup: route.meetupLeadinDistanceInMeters,
            freeride: route.freeRideLeadinDistanceInMeters,
        }[leadinType];
        return (leadin || 0) +
            (route.distanceInMeters * (laps || 1)) -
            (route.distanceBetweenFirstLastLrCPsInMeters || 0);
    }

    getRouteClimbing(routeId, laps=1, leadinType) {
        const route = env.getRoute(routeId);
        if (route) {
            return this._getRouteClimbing(route, laps, leadinType);
        }
    }

    _getRouteClimbing(route, laps=1, leadinType='event') {
        const leadin = {
            event: route.leadinAscentInMeters,
            meetup: route.meetupLeadinAscentInMeters,
            freeride: route.freeRideLeadinAscentInMeters,
        }[leadinType];
        return (leadin || 0) +
            (route.ascentInMeters * (laps || 1)) -
            (route.ascentBetweenFirstLastLrCPsInMeters || 0);
    }

    _getEventOrRouteInfo(state) {
        const sg = state.eventSubgroupId && this._recentEventSubgroups.get(state.eventSubgroupId);
        if (sg) {
            const eventLeader = sg.invitedLeaders && sg.invitedLeaders.includes(state.athleteId);
            const eventSweeper = sg.invitedSweepers && sg.invitedSweepers.includes(state.athleteId);
            if (sg.durationInSeconds) {
                const eventEnd = +(new Date(sg.eventSubgroupStart || sg.eventStart)) +
                    (sg.durationInSeconds * 1000);
                return {
                    eventLeader,
                    eventSweeper,
                    remaining: (eventEnd - worldTimer.serverNow()) / 1000,
                    remainingMetric: 'time',
                    remainingType: 'event',
                };
            } else {
                const distance = sg.distanceInMeters || this.getRouteDistance(sg.routeId, sg.laps);
                return {
                    eventLeader,
                    eventSweeper,
                    remaining: distance - state.eventDistance,
                    remainingMetric: 'distance',
                    remainingType: 'event',
                };
            }
        } else if (state.routeId != null) {
            const route = env.getRoute(state.routeId);
            if (route) {
                const distance = this._getRouteDistance(route, 1, 'freeride');
                return {
                    remaining: distance - (state.progress * distance),
                    remainingMetric: 'distance',
                    remainingType: 'route',
                };
            }
        }
    }

    _formatAthleteData(ad) {
        let athlete = this.loadAthlete(ad.athleteId);
        if (athlete && ad.privacy.hideFTP) {
            athlete = {...athlete, ftp: null};
        }
        const state = ad.mostRecentState;
        const lapCount = ad.laps.length;
        return {
            created: ad.created,
            age: monotonic() - ad.updated,
            watching: ad.athleteId === this.watching ? true : undefined,
            self: ad.athleteId === this.athleteId ? true : undefined,
            courseId: ad.courseId,
            athleteId: state.athleteId,
            athlete,
            stats: this._getCollectorStats(ad.collectors, ad, athlete, {includeDeprecated: true}),
            lap: this._getCollectorStats(ad.laps[ad.laps.length - 1], ad, athlete),
            lastLap: lapCount > 1 ?
                this._getCollectorStats(ad.laps[ad.laps.length - 2], ad, athlete) : null,
            lapCount,
            state: this._cleanState(state),
            eventPosition: ad.eventPosition,
            eventParticipants: ad.eventParticipants,
            gameState: ad.gameState,
            gap: ad.gap,
            gapDistance: ad.gapDistance,
            isGapEst: ad.isGapEst ? true : undefined,
            wBal: ad.privacy.hideWBal ? undefined : ad.wBal.get(),
            timeInPowerZones: ad.privacy.hideFTP ? undefined : ad.timeInPowerZones.get(),
            ...this._getEventOrRouteInfo(state),
            ...ad.extra,
        };
    }

    _computeNearby() {
        const watching = this._athleteData.get(this.watching);
        if (!watching || !watching.mostRecentState) {
            for (const ad of this._athleteData.values()) {
                ad.gap = undefined;
                ad.gapDistance = undefined;
                ad.isGapEst = undefined;
            }
            return [];
        }
        watching.gap = 0;
        watching.gapDistance = 0;
        watching.isGapEst = undefined;
        // We need to use a speed value for estimates and just using one value is
        // dangerous, so we use a weighted function that's seeded (skewed) to the
        // the watching rider.
        const refSpeedForEstimates = expWeightedAvg(10); // maybe mv up and reuse? XXX
        const watchingSpeed = watching.mostRecentState.speed;
        if (watchingSpeed > 1) {
            refSpeedForEstimates(watchingSpeed);
        }
        // Only filter stopped riders if we are moving.
        const filterStopped = !!watchingSpeed;
        const ahead = [];
        const behind = [];
        for (const ad of this._athleteData.values()) {
            if (ad.athleteId !== this.watching) {
                const age = monotonic() - ad.updated;
                if ((filterStopped && !ad.mostRecentState.speed) || age > 10000) {
                    continue;
                }
                const rp = this.compareRoadPositions(ad, watching);
                if (rp === null) {
                    ad.gap = undefined;
                    ad.gapDistance = undefined;
                    ad.isGapEst = true;
                    continue;
                }
                ad.gap = this._realGap(rp, ad, watching);
                ad.gapDistance = rp.gapDistance;
                ad.isGapEst = ad.gap == null;
                if (rp.reversed) {
                    behind.push(ad);
                } else {
                    ahead.push(ad);
                }
            }
        }

        ahead.sort((a, b) => b.gapDistance - a.gapDistance);
        behind.sort((a, b) => a.gapDistance - b.gapDistance);

        for (let i = ahead.length - 1; i >= 0; i--) {
            const x = ahead[i];
            const adjacent = ahead[i + 1] || watching;
            const speedRef = refSpeedForEstimates(x.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(x, adjacent);
                if (incGap == null) {
                    const incGapDist = x.gapDistance - adjacent.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap - incGap;
            } else {
                x.gap = -x.gap;
            }
            x.gapDistance = -x.gapDistance;
        }
        for (let i = 0; i < behind.length; i++) {
            const x = behind[i];
            const adjacent = behind[i - 1] || watching;
            const speedRef = refSpeedForEstimates(x.mostRecentState.speed);
            if (x.gap == null) {
                let incGap = this.realGap(adjacent, x);
                if (incGap == null) {
                    const incGapDist = x.gapDistance - adjacent.gapDistance;
                    incGap = speedRef ? incGapDist / (speedRef * 1000 / 3600) : 0;
                }
                x.gap = adjacent.gap + incGap;
            }
        }

        const nearby = [];
        const maxGap = 15 * 60;
        for (let i = 0; i < ahead.length; i++) {
            if (ahead[i].gap > -maxGap) {
                nearby.push(this._formatAthleteData(ahead[i]));
            }
        }
        nearby.push(this._formatAthleteData(watching));
        for (let i = 0; i < behind.length; i++) {
            if (behind[i].gap < maxGap) {
                nearby.push(this._formatAthleteData(behind[i]));
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
            const grp = groups[i];
            grp.weight /= grp.weightCount;
            grp.power /= grp.athletes.length;
            grp.draft /= grp.athletes.length;
            grp.speed = sauce.data.median(grp.athletes.map(x => x.state.speed));
            grp.heartrate /= grp.heartrateCount;
            if (watchingIdx !== i) {
                const edge = watchingIdx < i ? grp.athletes[0] : grp.athletes[grp.athletes.length - 1];
                grp.isGapEst = edge.isGapEst;
                grp.gap = edge.gap;
            } else {
                grp.gap = 0;
                grp.isGapEst = false;
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
                    Object.values(x.streams).reduce((agg, xx) => agg + xx.length, 0))
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this._athletesCache.size,
        };
    }
}
