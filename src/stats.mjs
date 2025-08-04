/* global setImmediate, Buffer */
import events from 'node:events';
import path from 'node:path';
import {worldTimer} from './zwift.mjs';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as rpc from './rpc.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import * as report from '../shared/report.mjs';
import * as zwift from './zwift.mjs';
import * as env from './env.mjs';
import {expWeightedAvg} from '../shared/sauce/data.mjs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const wPrimeDefault = 20000;
let groupIdCounter = 1;


rpc.register(env.getWorldMetas);
rpc.register(env.getCourseId);
rpc.register(env.getRoad);
rpc.register(env.getCourseRoads);
rpc.register(env.getRoute);
rpc.register(env.getCourseRoutes);
rpc.register(env.getSegment);
rpc.register(env.getCourseSegments);

rpc.register(courseId => {
    console.warn("DEPRECATED: use `getCourseRoads`");
    return env.getCourseRoads(courseId);
}, {name: 'getRoads'});

rpc.register(ids => {
    if (typeof ids === 'number') {
        console.warn("DEPRECATED: use `getCourseRoutes`");
        return env.getCourseRoutes(ids);
    }
    return env.getRoutes(ids);
}, {name: 'getRoutes'});

rpc.register(ids => {
    if (typeof ids === 'number') {
        console.warn("DEPRECATED: use `getCourseSegments`");
        return env.getCourseSegments(ids);
    }
    return env.getSegments(ids);
}, {name: 'getSegments'});

rpc.register((courseId, roadId, reverse=false) => {
    if (courseId == null || roadId == null) {
        throw new TypeError('courseId and roadId required');
    }
    return env.getCourseSegments(courseId).filter(x => x.roadId === roadId && !!x.reverse === !!reverse);
}, {name: 'getSegmentsForRoad'});


function monotonic() {
    return performance.timeOrigin + performance.now();
}


function nextMacrotask() {
    return new Promise(setImmediate);
}


let _hrSleepLatency = 1;
const _hrSleepLatencyRoll = expWeightedAvg(10, _hrSleepLatency);
async function highResSleepTill(deadline, options={}) {
    // NOTE: V8 can and does wake up early.
    // NOTE: GC pauses can and will cause delays.
    let t = monotonic();
    const macroDelay = Math.trunc((deadline - t) - _hrSleepLatency);
    if (macroDelay > 1) {
        await new Promise(r => setTimeout(r, macroDelay));
        const t2 = monotonic();
        const stoLatency = (t2 - t) - macroDelay;
        t = t2;
        if (stoLatency > 0) {
            _hrSleepLatency = Math.sqrt(_hrSleepLatencyRoll((stoLatency + 1) ** 2));
        }
    }
    while (t < deadline) {
        await nextMacrotask();
        t = monotonic();
    }
    return t;
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
        for (const [period, {roll, peak}] of this.periodized) {
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
        const added = this.roll.resize();
        if (added) {
            const value = this.roll.valueAt(-1);
            if (value > this._maxValue) {
                this._maxValue = value;
            }
            this._resizePeriodized();
        }
        return added;
    }

    _resizePeriodized() {
        for (const x of this.periodized.values()) {
            const added = x.roll.resize();
            if (added && x.roll.full()) {
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
        for (const [p, {roll, peak}] of this.periodized) {
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


class Event {
    constructor() {
        this.clear();
    }

    set() {
        this._resolve();
    }

    clear() {
        this._promise = new Promise(r => this._resolve = r);
    }

    wait() {
        return this._promise;
    }
}


class ActivityReplay extends events.EventEmitter {
    static async fromFITFile(data) {
        const fit = await import('jsfit');
        const parser = fit.FitParser.decode(data);
        const athlete = {};
        const activity = {};
        const streams = {};
        const laps = [];
        for (const {type, name, fields} of parser.messages) {
            if (type !== 'data') {
                continue;
            }
            if (name === 'record') {
                if (fields.altitude != null) {
                    streams.altitude = streams.altitude || [];
                    streams.altitude.push(fields.altitude);
                }
                if (fields.cadence != null) {
                    streams.cadence = streams.cadence || [];
                    streams.cadence.push(fields.cadence);
                }
                if (fields.distance != null) {
                    streams.distance = streams.distance || [];
                    streams.distance.push(fields.distance);
                }
                if (fields.heart_rate != null) {
                    streams.hr = streams.hr || [];
                    streams.hr.push(fields.heart_rate);
                }
                if (fields.position_lat != null) {
                    streams.latlng = streams.latlng || [];
                    streams.latlng.push([fields.position_lat, fields.position_long]);
                }
                if (fields.speed != null) {
                    streams.speed = streams.speed || [];
                    streams.speed.push(fields.speed);
                }
                if (fields.timestamp != null) {
                    streams.time = streams.time || [];
                    streams.time.push(+fields.timestamp / 1000);
                }
                if (fields.power != null) {
                    streams.power = streams.power || [];
                    streams.power.push(fields.power);
                }
            } else if (name === 'lap') {
                console.log('lap', fields);
            } else if (name === 'file_id') {
                if (fields.type && fields.type !== 'activity') {
                    throw new TypeError("Expected 'activity' file type");
                }
                activity.created = fields.time_created;
                console.info(`Activity [${fields.product_name}]: ${activity.created.toLocaleString()}`);
            } else if (name === 'user_profile') {
                Object.assign(athlete, {
                    name: fields.friendly_name,
                    gender: fields.gender,
                    weight: fields.weight,
                    height: fields.height,
                    age: fields.age,
                });
                console.info(`Athlete: ${athlete.name}, ${athlete.weight.toFixed(1)}kg`);
            } else if (name === 'sport') {
                if (fields.sport) {
                    activity.sport = {
                        cycling: 'cycling',
                        running: 'running',
                    }[fields.sport];
                }
            } else if (name === 'session') {
                if (fields.sport) {
                    activity.sport = {
                        cycling: 'cycling',
                        running: 'running',
                    }[fields.sport];
                }
            } else if (name === 'zones_target') {
                if (fields.functional_threshold_power) {
                    athlete.ftp = fields.functional_threshold_power;
                }
                if (fields.threshold_heart_rate) {
                    athlete.hrt = fields.threshold_heart_rate;
                }
            }
        }
        return new this({athlete, activity, streams, laps});
    }

    constructor({athlete, activity, streams, laps}) {
        super();
        this.athlete = athlete;
        this.activity = activity;
        this.streams = streams;
        this.laps = laps;
        this.playing = false;
        this.position = 0;
        this._stopEvent = new Event();
        this.startTime = streams ? streams.time[0] : undefined;
    }

    getTimestamp(i) {
        i = i === undefined ?
            Math.max(0, Math.min(this.streams.time.length - 1, this.position)) :
            i;
        const t = this.streams.time[i];
        return t !== undefined ? t - this.startTime : undefined;
    }

    play() {
        if (this.playing) {
            return;
        }
        this.playing = true;
        this.emitTimeSync();
        this._stopEvent.clear();
        this._playPromise = this._playLoop();
    }

    async stop() {
        if (!this.playing) {
            return;
        }
        this.playing = false;
        this._stopEvent.set();
        await this._playPromise;
        this.emitTimeSync();
    }

    emitTimeSync() {
        this.emit('timesync', {
            ts: this.getTimestamp(),
            playing: this.playing,
            position: this.position,
        });
    }

    emitRecord() {
        const i = this.position;
        this.emit('record', {
            time: this.streams.time[i],
            power: this.streams.power && this.streams.power[i],
            cadence: this.streams.cadence && this.streams.cadence[i],
            latlng: this.streams.latlng && this.streams.latlng[i],
            distance: this.streams.distance && this.streams.distance[i],
            speed: this.streams.speed && this.streams.speed[i],
            heartrate: this.streams.hr && this.streams.hr[i],
            altitude: this.streams.altitude && this.streams.altitude[i],
        });
    }

    async _playLoop() {
        while (this.playing) {
            if (this.position >= this.streams.time.length) {
                this.playing = false;
                this.emitTimeSync();
                return;
            }
            this.emitRecord();
            this.emitTimeSync();
            this.position++;
            const nextTime = this.streams.time[this.position];
            if (nextTime !== undefined) {
                const next = (nextTime - this.streams.time[this.position - 1]) * 1000 + monotonic();
                await Promise.race([
                    highResSleepTill(next),
                    this._stopEvent.wait(),
                ]);
            }
        }
    }

    rewind(steps) {
        this.position -= steps;
        if (this.position < 0) {
            this.position = 0;
        }
        this.emitTimeSync();
    }

    forward(steps) {
        this.position += steps;
        if (this.position >= this.streams.time.length) {
            this.playing = false;
            this.position = this.streams.time.length;
        }
        this.emitTimeSync();
    }

    fastForward(steps) {
        for (let i = 0; i < steps && this.position < this.streams.time.length; i++) {
            this.emitRecord();
            this.position++;
            if (this.position >= this.streams.time.length) {
                this.playing = false;
                this.position = this.streams.time.length;
                break;
            }
        }
        this.emitTimeSync();
    }
}


export class StatsProcessor extends events.EventEmitter {
    constructor(options={}) {
        super();
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
        this._profileFetchDeferrals = new Map();
        this._pendingProfileFetches = new Set();
        this._profileFetchCount = 0;
        this._profileFetchReset = this._profileFetchBackoff = 1000;
        this._chatHistory = [];
        this._recentEvents = new Map();
        this._recentEventsPending = new Map();
        this._recentEventSubgroups = new Map();
        this._recentEventSubgroupsPending = new Map();
        this._mostRecentNearby = [];
        this._mostRecentGroups = [];
        this._groupMetas = new Map();
        this._markedIds = new Set();
        this._followingIds = new Set();
        this._followerIds = new Set();
        this._pendingEgressStates = new Map();
        this._lastEgressStates = 0;
        this._timeoutEgressStates = null;
        const app = options.app;
        this._googleMapTileKey = app.buildEnv?.google_map_tile_key;
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
        this._gmapTileCache = new Map();
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
        rpc.register(this.getSegmentResults, {scope: this});
        rpc.register(this.putState, {scope: this});
        rpc.register(this.fileReplayLoad, {scope: this});
        rpc.register(this.fileReplayPlay, {scope: this});
        rpc.register(this.fileReplayStop, {scope: this});
        rpc.register(this.fileReplayRewind, {scope: this});
        rpc.register(this.fileReplayForward, {scope: this});
        rpc.register(this.fileReplayStatus, {scope: this});
        rpc.register(this.getIRLMapTile, {scope: this});
        rpc.register(this.getWorkouts, {scope: this});
        rpc.register(this.getWorkout, {scope: this});
        rpc.register(this.getWorkoutCollection, {scope: this});
        rpc.register(this.getWorkoutCollections, {scope: this});
        rpc.register(this.getWorkoutSchedule, {scope: this});
        rpc.register(this.getQueue, {scope: this}); // XXX ambiguous name
        this._athleteSubs = new Map();
        if (options.gameConnection) {
            const gc = options.gameConnection;
            gc.on('status', ({connected}) => this.onGameConnectionStatusChange(connected));
            gc.on('powerup-activate', this.onPowerupActivate.bind(this));
            gc.on('powerup-set', this.onPowerupSet.bind(this));
            gc.on('custom-action-button', this.onCustomActionButton.bind(this));
        }
        if (options.debugGameFields) {
            this._formatState = this._formatStateDebug;
        }
    }

    async fileReplayLoad(info) {
        let data;
        if (info.type === 'base64') {
            data = Buffer.from(info.payload, 'base64');
        } else {
            throw new TypeError('Invalid payload type');
        }
        if (this._activityReplay) {
            await this._activityReplay.stop();
        }
        const athleteId = -1;
        this._athleteData.delete(athleteId);
        this._activityReplay = await ActivityReplay.fromFITFile(data);
        const a = this._activityReplay.athlete;
        const names = (a.name || 'noname').split(/(\s+)/);
        this.updateAthlete(athleteId, {
            ...a,
            name: undefined,
            type: 'FILE_REPLAY',
            firstName: names[0],
            lastName: names.slice(2).join(''),
        });
        this._activityReplay.on('record', record => {
            const now = monotonic();
            const fakeState = this.emulatePlayerStateFromRecord(record, {
                athleteId,
                sport: this._activityReplay.activity.sport
            });
            if (!this._athleteData.has(athleteId)) {
                this._athleteData.set(athleteId, this._createAthleteData(fakeState, now));
            }
            const ad = this._athleteData.get(athleteId);
            if (this._preprocessState(fakeState, ad, now) !== false) {
                this._recordAthleteStats(fakeState, ad, now);
                if (this.listenerCount('states')) {
                    this._pendingEgressStates.set(fakeState.athleteId, fakeState);
                    this._schedStatesEmit();
                }
            }
        });
        this._activityReplay.on('timesync', (...args) => this.emit('file-replay-timesync', ...args));
        this.setWatching(athleteId);
    }

    emulatePlayerStateFromRecord(record, extra) {
        let x = 0, y = 0, z = 0;
        if (record.latlng) {
            [x, y] = env.webMercatorProjection(record.latlng);
        }
        if (record.altitude != null) {
            z = record.altitude;
        }
        return {
            courseId: env.realWorldCourseId,
            worldTime: worldTimer.fromLocalTime(record.time * 1000),
            power: record.power,
            cadence: record.cadence,
            distance: record.distance,
            speed: record.speed,
            heartrate: record.heartrate,
            latlng: record.latlng,
            x, y, z,
            ...extra,
        };
    }

    fileReplayPlay() {
        console.info("Starting playback of activity file...");
        return this._activityReplay.play();
    }

    fileReplayStop() {
        console.info("Stoping playback of activity file.");
        return this._activityReplay.stop();
    }

    fileReplayRewind(steps=10) {
        console.info(`Rewinding ${steps} steps in activity replay...`);
        return this._activityReplay.rewind(steps);
    }

    fileReplayForward(steps=10) {
        console.info(`Fast forwarding ${steps} steps in activity replay...`);
        return this._activityReplay.fastForward(steps);
    }

    fileReplayStatus() {
        const r = this._activityReplay;
        if (!r) {
            return {
                state: 'inactive',
            };
        }
        return {
            state: r.playing ? 'playing' : 'stopped',
            startTime: r.startTime,
            athlete: r.athlete,
            activity:  r.activity,
            position: r.position,
            ts: r.getTimestamp(),
        };
    }

    async _initGmapSession(key) {
        // https://developers.google.com/maps/documentation/tile/session_tokens
        const resp = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                mapType: 'roadmap', // roadmap, satellite, terrain, streetview
                language: 'en-US',
                region: 'US',
                //imageFormat: 'png', // png, jpeg
                //scale: 'scaleFactor1x', // 1x, 2x, 4x
                //highDpi: false, // set to true with scaleFactor2x or 4x only
            }),
        });
        if (!resp.ok) {
            console.error("Failed to create google map API session:", resp.status, await resp.text());
            throw new Error("Map Session Error");
        }
        return await resp.json();
    }

    async getIRLMapTile(x, y, z) {
        const sig = [x,y,z].join();
        if (this._gmapTileCache.has(sig)) {
            return await this._gmapTileCache.get(sig);
        }
        const key = this._googleMapTileKey;
        if (!key) {
            throw new Error("google map tile key required");
        }
        if (!this._gmapSessionPromise) {
            this._gmapSessionPromise = this._initGmapSession(key);
        }
        const session = await this._gmapSessionPromise;
        const q = new URLSearchParams({session: session.session, key});
        // https://developers.google.com/maps/documentation/tile/roadmap
        console.log(x, y, z);
        const resp = await fetch(`https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?${q}`);
        if (!resp.ok) {
            const msg = await resp.text();
            const e = new Error(`Map Tile Error [${resp.status}]: ` + msg);
            this._gmapTileCache.set(sig, Promise.reject(e));
            throw e;
        }
        const entry = {
            contentType: resp.headers.get('content-type'),
            encoding: 'base64',
            data: Buffer.from(await resp.arrayBuffer()).toString('base64'),
        };
        this._gmapTileCache.set(sig, entry);
        return entry;
    }

    async getWorkoutCollections() {
        return await this.zwiftAPI.getWorkoutCollection(null, {all: true});
    }

    async getWorkoutCollection(collectionID) {
        return await this.zwiftAPI.getWorkoutCollection(collectionID);
    }

    async getWorkouts() {
        return await this.zwiftAPI.getWorkout(null, {all: true});
    }

    async getWorkout(workoutId) {
        // XXX replace with XML parser...
        const workoutText = await this.zwiftAPI.getWorkout(workoutId);
        const workoutData = workoutText.substring(workoutText.indexOf('<workout_file>') + 14,
                                                  workoutText.indexOf('<workout>'));
        const workout = {};
        const tagPattern = /<(\w+)(?:\s[^>]*)?>([^]*?)<\/\1>/g;
        const tagSinglePattern = /<(\w+)\s+name="([^"]+)"\s*\/>/g;
        let match;
        while ((match = tagPattern.exec(workoutData)) !== null) {
            const tagName = match[1];
            const tagContent = match[2].trim();
            if (tagName === "tags") {
                const tags = [];
                let tagMatch;
                while ((tagMatch = tagSinglePattern.exec(tagContent)) !== null) {
                    tags.push(tagMatch[2]);
                }
                workout[tagName] = tags;
            } else {
                workout[tagName] = tagContent;
            }
        }
        workout.workout = [];
        const workoutDetails = workoutText.substring(workoutText.indexOf('<workout>') + 9,
                                                     workoutText.indexOf('</workout>'));
        const lines = workoutDetails.split("\n");
        let totalDuration = 0;
        for (let line of lines) {
            line = line.trim();
            if (line === "" || line.indexOf("!-") > -1) {  // ignore blank lines and comments
                continue;
            }
            const objLine = {};
            if (line.indexOf("</") > -1) {  // ignore closing tags
                continue;
            } else {
                const lineType = line.substring(1, line.indexOf(" "));
                objLine.type = lineType.toLowerCase();
                const regex = /(\w+)="([^"]*)"/g;
                let match;
                while ((match = regex.exec(line))) {
                    objLine[match[1]] = match[2];
                }
            }
            // XXX intervalst or intervals?
            if (objLine.type === "intervalst") {
                objLine.Duration = (parseInt(objLine.OffDuration) + parseInt(objLine.OnDuration)) *
                    parseInt(objLine.Repeat);
            }
            if (objLine.type === "textevent" || objLine.type === "textnotification" ) {
                if (!workout.workout[workout.workout.length - 1].textEvents) {
                    workout.workout[workout.workout.length - 1].textEvents = [objLine];
                } else {
                    workout.workout[workout.workout.length - 1].textEvents.push(objLine);
                }
            } else {
                workout.workout.push(objLine);
                const parsedDuration = parseInt(objLine.Duration);
                if (!isNaN(parsedDuration)) {
                    totalDuration += parsedDuration;
                }
            }
        }
        workout.totalDuration = totalDuration;
        return workout;
    }

    async getWorkoutSchedule() {
        // List of scheduled workouts from 3rd party partners (intervals.icu, trainingpeaks, etc.)
        return await this.zwiftAPI.getWorkoutSchedule();
    }

    // XXX ambiguous name
    async getQueue() {
        return await this.zwiftAPI.getQueue();
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

    getCachedEvents() {
        return Array.from(this._recentEvents.values().filter(x => x)).sort((a, b) => a.ts - b.ts);
    }

    async getEvent(id, {meetup}={}) {
        if (!this._recentEvents.has(id)) {
            this._recentEvents.set(id, null);
            let p;
            if (meetup) {
                p = this.zwiftAPI.getPrivateEvent(id).then(x => x && this._addMeetup(x));
            } else {
                p = this.zwiftAPI.getEvent(id).then(x => x && this._addEvent(x));
            }
            this._recentEventsPending.set(id, p);
            p.then(() => this._recentEventsPending.delete(id));
            p.catch(() => {
                setTimeout(() => {
                    if (this._recentEvents.get(id) === null) {
                        this._recentEvents.delete(id);
                        this._recentEventsPending.delete(id);
                    }
                }, 30000);  // allow retry later
            });
            return await p;
        }
        return this._recentEvents.get(id) || await this._recentEventsPending.get(id);
    }

    async getEventSubgroup(id) {
        if (!this._recentEventSubgroups.has(id)) {
            this._recentEventSubgroups.set(id, null);
            const r = this._getEventSubgroupStmt.get(id);
            const eventId = r && r.eventId;
            if (eventId != null) {
                const meetup = r.eventType === 'MEETUP';
                const p = this.getEvent(eventId, {meetup}).then(() => this._recentEventSubgroups.get(id));
                this._recentEventSubgroupsPending.set(id, p);
                p.then(() => this._recentEventSubgroupsPending.delete(id));
                p.catch(() => {
                    setTimeout(() => {
                        if (this._recentEventSubgroups.get(id) === null) {
                            this._recentEventSubgroups.delete(id);
                            this._recentEventSubgroupsPending.delete(id);
                        }
                    }, 30000);  // allow retry later
                });
                return await p;
            }
        }
        return this._recentEventSubgroups.get(id) || await this._recentEventSubgroupsPending.get(id);
    }

    _rememberEventSubgroup(sg, event) {
        if (sg.id == null || sg.eventId == null || !event) {
            console.error("Unexpected null event or subgroup", sg);
            return;
        }
        this._eventSubgroupsDB
            .prepare('INSERT OR REPLACE INTO subgroups (id, eventId, eventType) VALUES(?, ?, ?)')
            .run(sg.id, sg.eventId, event.eventType);
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
        const results = await this.zwiftAPI.getEventSubgroupResults(id);
        const updates = new Map();
        const missingProfiles = new Set(results.map(x => x.profileId).filter(id => !this._getAthlete(id)));
        if (missingProfiles.size) {
            for (const p of await this.zwiftAPI.getProfiles(missingProfiles)) {
                if (p) {
                    updates.set(p.id, this._updateAthlete(p.id, this._profileToAthlete(p)));
                }
            }
        }
        // Unranked events or single result events will contain scoreHistory that represents
        // non current values (probably floor values).  Look for scoreChangeType
        // that are only found when scoreHistory represents actual values.
        const validScoreChangeTypes = new Set(['INCREASED', 'DECREASED', 'AT_FLOOR']);
        const zrsIsTrustWorthy = results.length > 1 &&
            results.some(x => validScoreChangeTypes.has(x.scoreHistory?.scoreChangeType));
        for (const x of results) {
            if (zrsIsTrustWorthy) {
                const endTime = new Date(x.activityData.endDate).getTime();
                if (x.scoreHistory.previousScore) {
                    updates.set(x.profileId, this._updateAthlete(x.profileId, {
                        racingScore: x.scoreHistory.previousScore,
                        racingScoreTS: endTime - x.activityData.durationInMilliseconds,
                    }));
                }
                if (x.scoreHistory.newScore) {
                    updates.set(x.profileId, this._updateAthlete(x.profileId, {
                        racingScore: x.scoreHistory.newScore,
                        racingScoreTS: endTime,
                    }));
                }
            }
            x.athlete = this._getAthlete(x.profileId) || {};
        }
        if (updates.size) {
            this.saveAthletes(Array.from(updates));
        }
        return results;
    }

    async addEventSubgroupSignup(subgroupId) {
        const accepted = await this.zwiftAPI.addEventSubgroupSignup(subgroupId);
        if (!accepted) {
            console.warn("Failed to signup for subgroup:", subgroupId);
            return false;
        }
        const sg = await this.getEventSubgroup(subgroupId);
        sg.signedUp = true;
        return true;
    }

    async deleteEventSignup(eventId) {
        await this.zwiftAPI.deleteEventSignup(eventId);
        const event = await this.getEvent(eventId);
        if (event && event.eventSubgroups) {
            for (const x of event.eventSubgroups) {
                x.signedUp = false;
            }
        }
    }

    async refreshEventSignups() {
        const upcoming = await this.zwiftAPI.getUpcomingEvents();
        for (const x of upcoming.filter(x => x.profileId === this.zwiftAPI.profile.id)) {
            const sg = this._recentEventSubgroups.get(x.eventSubgroupId);
            if (sg && !sg.signedUp) {
                console.info(`Joined event subgroup[${sg.id}]:`, sg.name);
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
            if (athlete) {
                x.muted = athlete.muted;  // may have changed mid-history
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
        const athletes = ids ?
            ids.map(x => this._athleteData.get(this._realAthleteId(x))) :
            Array.from(this._athleteData.values());
        const now = monotonic();
        return athletes.map(x => x ? this._formatAthleteData(x, now) : null);
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

    getAthleteLaps(id, {startTime, endTime, active}={}) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        let laps = ad.laps;
        if (startTime !== undefined) {
            laps = laps.filter(x => x.power.roll._times[x.power.roll._offt] >= startTime);
        }
        if (endTime !== undefined) {
            laps = laps.filter(x =>
                x.power.roll._times[Math.max(x.power.roll._offt, x.power.roll._length - 1)] > endTime);
        }
        if (!active && laps.length && laps[laps.length - 1].end == null) {
            laps = laps.slice(0, -1);
        }
        const athlete = this.loadAthlete(ad.athleteId);
        const now = monotonic();
        return laps.map(x => this._formatLapish(x, ad, athlete, now));
    }

    getAthleteSegments(id, {startTime, endTime, active}={}) {
        const ad = this._athleteData.get(this._realAthleteId(id));
        if (!ad) {
            return null;
        }
        let segments = ad.segments;
        if (startTime !== undefined) {
            segments = segments.filter(x => x.power.roll._times[x.power.roll._offt] >= startTime);
        }
        if (endTime !== undefined) {
            segments = segments.filter(x =>
                x.power.roll._times[Math.max(x.power.roll._offt, x.power.roll._length - 1)] > endTime);
        }
        if (!active) {
            segments = segments.filter(x => !ad.activeSegments.has(x.id));
        }
        const athlete = this.loadAthlete(ad.athleteId);
        const now = monotonic();
        return segments.map(x => this._formatLapish(x, ad, athlete, now, {
            segmentId: x.id,
            segment: env.getSegment(x.id),
        }));
    }

    _formatLapish(lapish, ad, athlete, now, extra) {
        const startIndex = lapish.power.roll._offt;
        const endIndex = Math.max(startIndex, lapish.power.roll._length - 1);
        return {
            stats: this._getBucketStats(lapish, ad, athlete, {now}),
            active: lapish.end == null,
            startIndex,
            endIndex,
            start: lapish.power.roll._times[startIndex],
            end: lapish.power.roll._times[endIndex],
            sport: lapish.sport,
            courseId: lapish.courseId,
            eventSubgroupId: lapish.eventSubgroupId,
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
            const timeStream = ad.bucket.power.roll.times();
            offt = timeStream.findIndex(x => x >= startTime);
            if (offt === -1) {
                offt = Infinity;
            }
        }
        return this._getAthleteStreams(ad, offt);
    }

    _getAthleteStreams(ad, offt) {
        const power = ad.bucket.power.roll.values(offt);
        const streams = {
            time: ad.bucket.power.roll.times(offt),
            power,
            speed: ad.bucket.speed.roll.values(offt),
            hr: ad.bucket.hr.roll.values(offt),
            cadence: ad.bucket.cadence.roll.values(offt),
            draft: ad.bucket.draft.roll.values(offt),
            active: power.map(x => !!+x || !(x instanceof sauce.data.Pad)),
        };
        for (const [k, arr] of Object.entries(ad.streams)) {
            streams[k] = arr.slice(offt);
        }
        return streams;
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
        return segments || [];
    }

    getNearbyData() {
        return this._mostRecentNearby;
    }

    getGroupsData() {
        return this._mostRecentGroups;
    }

    startLap() {
        console.debug("Starting new lap...");
        const now = monotonic();
        for (const x of this._athleteData.values()) {
            this.startAthleteLap(x, now);
        }
    }

    startAthleteLap(ad, now=monotonic()) {
        const lastLap = ad.laps[ad.laps.length - 1];
        lastLap.end = now;
        const lap = this._createNewLapish(ad, now);
        ad.laps.push(lap);
        return lap;
    }

    startSegment(ad, id, start=monotonic()) {
        const segment = this._createNewLapish(ad, start);
        segment.id = id;
        // Indirectly lookup sgId via cur-lap to avoid after_party_duration window..
        segment.eventSubgroupId = ad.laps[ad.laps.length - 1].eventSubgroupId;
        ad.segments.push(segment);
        ad.activeSegments.set(id, segment);
        return segment;
    }

    stopSegment(ad, id, end=monotonic()) {
        const segment = ad.activeSegments.get(id);
        segment.end = end;
        ad.activeSegments.delete(id);
    }

    resetStats() {
        console.debug("Reseting stats...");
        const wt = worldTimer.now();
        const now = monotonic();
        for (const ad of this._athleteData.values()) {
            this._resetAthleteData(ad, wt, now);
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
            powerSourceModel: p.powerSourceModel,
            powerMeter: p.powerSourceModel ? powerMeterSources.includes(p.powerSourceModel) : undefined,
            maxHeartRate: p.maxHeartRate,
        };
        if (p.competitionMetrics) {
            o.racingScore = p.competitionMetrics.racingScore;
            o.racingCategory = minor || p.male !== false ?
                p.competitionMetrics.category :
                p.competitionMetrics.categoryWomen;
        }
        if (p.socialFacts) {
            o.follower = p.socialFacts.followeeStatusOfLoggedInPlayer === 'IS_FOLLOWING';
            o.following = p.socialFacts.followerStatusOfLoggedInPlayer === 'IS_FOLLOWING';
            o.followRequest = p.socialFacts.followerStatusOfLoggedInPlayer === 'REQUESTS_TO_FOLLOW';
            o.favorite = !!p.socialFacts.isFavoriteOfLoggedInPlayer;
        }
        return o;
    }

    updateAthlete(id, data) {
        const fullData = this._updateAthlete(id, data);
        this.saveAthletes([[id, fullData]]);
        return fullData;
    }

    _updateAthlete(id, updates) {
        let athlete = this.loadAthlete(id);
        if (!athlete) {
            // Make sure we are working on the shared/cached object...
            athlete = {};
            this._athletesCache.set(id, athlete);
        }
        athlete.id = id;
        athlete.updated = Date.now();
        athlete.name = (updates.firstName || updates.lastName) ?
            [updates.firstName, updates.lastName]
                .map(x => (x && x.trim) ? x.trim() : null)
                .filter(x => x) :
            athlete.name;
        athlete.fullname = athlete.name && athlete.name.join(' ');
        let saniFirst;
        let saniLast;
        if (athlete.name && athlete.name.length) {
            const edgeJunk = /^[.*_#\-\s]+|[.*_#\-\s]+$/g;
            saniFirst = athlete.name[0].replace(edgeJunk, '');
            const idx = athlete.name.length - 1;
            const [name, team] = splitNameAndTeam(athlete.name[idx]);
            if (idx > 0) {
                saniLast = name && name.replace(edgeJunk, '');
            } else {
                // User only set a last name, sometimes because this looks better in game.
                saniFirst = name;
            }
            athlete.team = team;
        }
        athlete.sanitizedName = (saniFirst || saniLast) ? [saniFirst, saniLast].filter(x => x) : null;
        athlete.sanitizedFullname = athlete.sanitizedName && athlete.sanitizedName.join(' ');
        if (athlete.sanitizedName) {
            const n = athlete.sanitizedName;
            athlete.initials = n
                .map(x => String.fromCodePoint(x.codePointAt(0)))
                .join('')
                .toUpperCase();
            athlete.fLast = n.length > 1 ? `${String.fromCodePoint(n[0].codePointAt(0))}.${n[1]}` : n[0];
        } else {
            athlete.fLast = athlete.initials = null;
        }
        if (athlete.wPrime === undefined && updates.wPrime === undefined) {
            updates = {...updates, wPrime: wPrimeDefault}; // Po-boy migration
        }
        if (updates.racingScore != null) {
            // Fill in history of racing scores and update cur value when most
            // recent value is updated.
            if (!athlete.racingScoreIncompleteHistory) {
                athlete.racingScoreIncompleteHistory = [];
            }
            const entry = {
                score: updates.racingScore,
                ts: updates.racingScoreTS || athlete.updated,
            };
            const hist = athlete.racingScoreIncompleteHistory;
            const replaceIdx = hist.findIndex(x => x.ts === entry.ts);
            if (replaceIdx !== -1) {
                hist.splice(replaceIdx, 1);
            }
            hist.push(entry);
            hist.sort((a, b) => a.ts - b.ts);
            const idx = hist.indexOf(entry);
            const before = hist[idx - 1];
            const after = hist[idx + 1];
            if (before && before.score === entry.score) {
                // Dedup ourselves, we didn't learn anything new..
                hist.splice(idx, 1);
            } else if (after && after.score === entry.score) {
                // We learned the score was older than previously known..
                hist.splice(idx + 1, 1);
            }
            if (hist.indexOf(entry) !== hist.length - 1) {
                // Don't clobber more up to date value..
                updates = {
                    ...updates,
                    racingScore: undefined,
                    racingScoreTS: undefined,
                    racingCategory: undefined,
                };
            } else {
                updates = {...updates, racingScoreTS: undefined};
            }
        }
        if (updates.racingScore && updates.racingCategory == null && athlete.racingCategory == null) {
            // Fallback to setting estimated racing category..
            // https://support.zwift.com/en_us/racing-score-faq-BkG9_Rqrh
            const offt = [690, 520, 350, 180, 1].findIndex(x => updates.racingScore >= x);
            if (offt !== -1) {
                updates = {...updates, racingCategory: String.fromCharCode(65 + offt)};
            }
        }
        for (const [k, v] of Object.entries(updates)) {
            if (v !== undefined) {
                athlete[k] = v;
            }
        }
        const ad = this._athleteData.get(id);
        if (ad) {
            this._updateAthleteDataFromDatabase(ad, athlete);
        }
        if (updates.marked !== undefined) {
            if (updates.marked) {
                this._markedIds.add(id);
            } else {
                this._markedIds.delete(id);
            }
        }
        return athlete;
    }

    loadAthlete(id) {
        const a = this._athletesCache.get(id);
        if (a !== undefined) {
            return a;
        }
        if (!this.exclusions.has(zwift.getIDHash(id))) {
            const r = this._getAthleteStmt.get(id);
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
        const stmt = this._athletesDB.prepare(
            `SELECT athletes.id ` +
            `FROM athletes, json_each(athletes.data, '$.marked') ` +
            `WHERE json_each.value`);
        this._markedIds.clear();
        for (const x of stmt.iterate()) {
            this._markedIds.add(x.id);
        }
    }


    saveAthletes(records) {
        const stmt = this._athletesDB.prepare('INSERT OR REPLACE INTO athletes (id, data) VALUES(?, ?)');
        this._athletesDB.transaction(() => {
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
    }

    onIncoming(...args) {
        try {
            this._onIncoming(...args);
        } catch(e) {
            report.errorOnce(e);
        }
    }

    _onIncoming(packet) {
        const now = monotonic();
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
                    this.getEventSubgroup(x.payload.subgroupId).then(sg => {
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
                    });
                } else if (!ignore.includes(x.payloadType)) {
                    console.debug("Unhandled WorldUpdate:", x);
                }
            }
        }
        if (updatedEvents.length) {
            queueMicrotask(() => this._loadEvents(updatedEvents));
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
        const hasStatesListeners = !!this.listenerCount('states');
        for (let i = 0; i < packet.playerStates.length; i++) {
            const x = packet.playerStates[i];
            if (this.processState(x, now) === false) {
                continue;
            }
            if (hasStatesListeners) {
                this._pendingEgressStates.set(x.athleteId, x);
            }
        }
        if (hasStatesListeners) {
            this._schedStatesEmit();
        }
    }

    _schedStatesEmit() {
        if (this._pendingEgressStates.size && !this._timeoutEgressStates) {
            const delay = this.emitStatesMinRefresh - (monotonic() - this._lastEgressStates);
            this._timeoutEgressStates = setTimeout(() => this._flushPendingEgressStates(), delay);
        }
    }

    _flushPendingEgressStates() {
        const states = Array.from(this._pendingEgressStates.values()).map(x => this._formatState(x));
        this._pendingEgressStates.clear();
        this._lastEgressStates = monotonic();
        this._timeoutEgressStates = null;
        this.emit('states', states);
    }

    putState(state) {
        if (this.processState(state) === false) {
            console.warn("State skipped by processer");
            return;
        }
        this._pendingEgressStates.set(state.athleteId, state);
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
        this.emit('watching-athlete-change', athleteId);
    }

    _roadSig(state) {
        return env.getRoadSig(state.courseId, state.roadId, state.reverse);
    }

    _getBucketStats(bucket, ad, athlete, {now, includeDeprecated}={}) {
        const end = bucket.end ?? now ?? monotonic();
        const elapsedTime = (end - bucket.start) / 1000;
        const np = bucket.power.roll.np({force: true});
        let wBal, timeInPowerZones; // DEPRECATED
        if (includeDeprecated) {
            wBal = ad.privacy.hideWBal ? undefined : ad.wBal.get();
            timeInPowerZones = ad.privacy.hideFTP ? undefined : ad.timeInPowerZones.get();
        }
        const activeTime = bucket.power.roll.active();
        const tss = (!ad.privacy.hideFTP && np && athlete && athlete.ftp) ?
            sauce.power.calcTSS(np, activeTime, athlete.ftp) :
            undefined;
        return {
            elapsedTime,
            activeTime,
            coffeeTime: Math.round(bucket.coffeeTime / 1000),
            workTime: Math.round(bucket.workTime / 1000),
            followTime: Math.round(bucket.followTime / 1000),
            soloTime: Math.round(bucket.soloTime / 1000),
            workKj: bucket.workKj,
            followKj: bucket.followKj,
            soloKj: bucket.soloKj,
            wBal, // DEPRECATED
            timeInPowerZones, // DEPRECATED
            power: bucket.power.getStats(ad.wtOffset, {
                np,
                tss,
                kj: bucket.power.roll.joules() / 1000,
                wBal, // DEPRECATED
                timeInZones: timeInPowerZones, // DEPRECATED
            }),
            speed: bucket.speed.getStats(ad.wtOffset),
            hr: bucket.hr.getStats(ad.wtOffset),
            cadence: bucket.cadence.getStats(ad.wtOffset),
            draft: bucket.draft.getStats(ad.wtOffset, {
                kj: bucket.draft.roll.joules() / 1000,
            }),
        };
    }

    _makeDataBucket(start) {
        const periods = [5, 15, 60, 300, 1200];
        const longPeriods = periods.filter(x => x >= 60);
        return {
            start,
            coffeeTime: 0,
            workTime: 0,
            followTime: 0,
            soloTime: 0,
            workKj: 0,
            followKj: 0,
            soloKj: 0,
            power: new DataCollector(sauce.power.RollingPower, periods, {inlineNP: true, round: true}),
            speed: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true}),
            hr: new DataCollector(sauce.data.RollingAverage, longPeriods, {ignoreZeros: true, round: true}),
            cadence: new DataCollector(sauce.data.RollingAverage, [], {ignoreZeros: true, round: true}),
            draft: new DataCollector(sauce.power.RollingPower, longPeriods, {round: true}),
        };
    }

    _createNewLapish(ad, start=monotonic()) {
        const cloneOpts = {reset: true};
        return {
            start,
            coffeeTime: 0,
            workTime: 0,
            followTime: 0,
            soloTime: 0,
            workKj: 0,
            followKj: 0,
            soloKj: 0,
            courseId: ad.courseId,
            sport: ad.sport,
            power: ad.bucket.power.clone(cloneOpts),
            speed: ad.bucket.speed.clone(cloneOpts),
            hr: ad.bucket.hr.clone(cloneOpts),
            cadence: ad.bucket.cadence.clone(cloneOpts),
            draft: ad.bucket.draft.clone(cloneOpts),
        };
    }

    _maybeUpdateAthleteFromServer(athleteId, now) {
        if (this._pendingProfileFetches.has(athleteId) ||
            (this._profileFetchDeferrals.get(athleteId) ?? 0) > now) {
            return;
        }
        this._pendingProfileFetches.add(athleteId);
        if (!this._athleteProfileUpdaterActive) {
            this._athleteProfileUpdaterActive = true;
            // wait for next task so looped calls will fill the batch first...
            queueMicrotask(() => this.runAthleteProfileUpdater()
                .finally(() => this._athleteProfileUpdaterActive = false));
        }
    }

    async _updateAthleteProfilesFromServer(batch) {
        const updates = [];
        const now = monotonic();
        const goodDefer = now + 300 * 1000;
        const badDefer = now + 1000;
        try {
            const profiles = await this.zwiftAPI.getProfiles(batch, {silent: true});
            for (const [i, p] of profiles.entries()) {
                if (p) {
                    this._profileFetchDeferrals.set(batch[i], goodDefer);
                    updates.push([p.id, this._updateAthlete(p.id, this._profileToAthlete(p))]);
                } else {
                    this._profileFetchDeferrals.set(batch[i], badDefer);
                    console.warn("Profile not found:", batch[i]);
                }
            }
        } catch(e) {
            for (const x of batch) {
                if (!updates.find(([id]) => id === x)) {
                    this._profileFetchDeferrals.set(x, badDefer);
                }
            }
            throw e;
        } finally {
            if (updates.length) {
                this.saveAthletes(updates);
            }
        }
    }

    async runAthleteProfileUpdater() {
        while (this._pendingProfileFetches.size) {
            const batch = Array.from(this._pendingProfileFetches);
            this._pendingProfileFetches.clear();
            this._profileFetchCount += batch.length;
            try {
                await this._updateAthleteProfilesFromServer(batch);
                this._profileFetchBackoff = this._profileFetchReset;
            } catch(e) {
                if (e.message === 'fetch failed' || e.name === 'TimeoutError') {
                    console.warn("Network problem while collecting profiles:", e.cause?.message || e);
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

    _createAthleteData(state, now) {
        const bucket = this._makeDataBucket(now);
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
                aRoad: null,
                bRoad: null,
                cRoad: null,
                a: [],
                b: null,
                c: null,
            },
            events: new Map(),
            bucket,
            laps: [],
            segments: [],
            activeSegments: new Map(),
            smoothGrade: expWeightedAvg(8),
        };
        ad.laps.push(this._createNewLapish(ad, now));
        const athlete = this.loadAthlete(state.athleteId);
        if (athlete) {
            this._updateAthleteDataFromDatabase(ad, athlete);
        }
        return ad;
    }

    _resetAthleteData(ad, wtOffset, now) {
        Object.assign(ad, {
            created: worldTimer.toLocalTime(wtOffset),
            wtOffset,
            bucket: this._makeDataBucket(now),
        });
        ad.laps = [this._createNewLapish(ad, now)];
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

    triggerEventStart(ad, state, now=monotonic()) {
        ad.eventStartPending = false;
        const sgId = ad.eventSubgroup?.id;
        if (sgId) {
            const sg = this._recentEventSubgroups.get(sgId);
            if (sg && sg.eventId != null) {
                ad.events.set(sg.eventId, sgId);
            }
        }
        if (this._autoResetEvents) {
            console.debug("Event start triggering reset for:", ad.athleteId, ad.eventSubgroup?.id);
            this._resetAthleteData(ad, state.worldTime, now);
        } else if (this._autoLapEvents) {
            console.debug("Event start triggering lap for:", ad.athleteId, ad.eventSubgroup?.id);
            this.startAthleteLap(ad, now);
        }
        ad.laps[ad.laps.length - 1].eventSubgroupId = sgId;
    }

    triggerEventEnd(ad, state, now=monotonic()) {
        if (this._autoResetEvents || this._autoLapEvents) {
            console.debug("Event end triggering lap for:", ad.athleteId, ad.eventSubgroup?.id);
            this.startAthleteLap(ad, now);
        }
    }

    processState(state, now=monotonic()) {
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId, this._createAthleteData(state, now));
        }
        const worldMeta = env.worldMetas[state.courseId];
        const elOffset = worldMeta.eleOffset || 0;
        if (worldMeta) {
            state.latlng = worldMeta.flippedHack ?
                [(state.x / (worldMeta.latDegDist * 100)) + worldMeta.latOffset,
                    (state.y / (worldMeta.lonDegDist * 100)) + worldMeta.lonOffset] :
                [-(state.y / (worldMeta.latDegDist * 100)) + worldMeta.latOffset,
                    (state.x / (worldMeta.lonDegDist * 100)) + worldMeta.lonOffset];
            let slopeScale = worldMeta.physicsSlopeScale;
            if (state.portal) {
                const road = env.getRoad(state.courseId, state.roadId);
                slopeScale = road?.physicsSlopeScaleOverride || 1;
                // Portals are an anomaly.  The original road data has a large z offset that seems to
                // be completely arbitrary but then playerState.z comes in as basically 0 offset.  So
                // in env.mjs we normalize the z values so they match the player state z (roughly).
                state.altitude = state.z / 100 * slopeScale;
            } else {
                state.altitude = (state.z - worldMeta.seaLevel + elOffset) / 100 * slopeScale;
            }
        }
        const ad = this._athleteData.get(state.athleteId);
        if (this._preprocessState(state, ad, now) === false) {
            return false;
        }
        if (state.eventSubgroupId) {
            const sg = this._recentEventSubgroups.get(state.eventSubgroupId);
            if (sg === undefined) {
                // Queue up load of this event info and defer state change till.
                this.getEventSubgroup(state.eventSubgroupId);  // bg okay
            } else if (sg !== null && sg.courseId === state.courseId) { // state.eventSubgroupId races
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
                        this.triggerEventStart(ad, state, now);
                    } else {
                        ad.eventStartPending = true;
                    }
                } else if (ad.eventStartPending) {
                    if (state.time) {
                        this.triggerEventStart(ad, state, now);
                    }
                } else if (sg.allTagsObject.after_party_duration &&
                           ad.laps[ad.laps.length - 1].eventSubgroupId === sg.id &&
                           (sg.endDistance ?
                               state.eventDistance > sg.endDistance :
                               sg.endTS && worldTimer.serverNow() > sg.endTS)) {
                    this.triggerEventEnd(ad, state, now);
                }
            }
        } else if (ad.eventSubgroup) {
            ad.eventSubgroup = null;
            ad.privacy = {};
            ad.disabled = false;
            ad.eventStartPending = false;
            ad.eventPosition = undefined;
            ad.eventParticipants = undefined;
            this.triggerEventEnd(ad, state, now);
        }
        if (ad.disabled) {
            return false;
        }
        const roadSig = this._roadSig(state);
        if (this._autoLap) {
            this._autoLapCheck(state, ad, now);
        }
        this._activeSegmentCheck(state, ad, roadSig, now);
        this._recordAthleteRoadHistory(state, ad, roadSig);
        this._recordAthleteStats(state, ad, now);
        this._maybeUpdateAthleteFromServer(state.athleteId, now);
    }

    _autoLapCheck(state, ad, now) {
        const mark = this._autoLapMetric === 'distance' ? state.distance : state.time;
        if (ad.autoLapMark === undefined) {
            ad.autoLapMark = mark;
        } else if (mark - ad.autoLapMark >= this._autoLapInterval) {
            console.debug("Auto lap triggered for:", ad.athleteId);
            ad.autoLapMark = mark;
            this.startAthleteLap(ad, now);
        }
    }

    _recordAthleteRoadHistory(state, ad, roadSig) {
        const prevState = ad.mostRecentState;
        const hist = ad.roadHistory;
        // XXX
        /*if (!hist._xxxName) {
            const athlete = this.loadAthlete(ad.athleteId);
            if (athlete) {
                hist._xxxName = athlete.fLast;
            }
        }*/
        const rpct = state.roadCompletion / 1e6;
        if (prevState) {
            if (prevState.courseId === state.courseId) {
                let shiftTimelines;
                if (roadSig !== hist.aRoad.sig) {
                    shiftTimelines = true;
                } else {
                    // Some same-road conditions still justify timeline shifting...
                    const last = hist.a[hist.a.length - 1];
                    const delta = rpct - last.rpct;
                    if (delta < 0) { // direction change
                        if (delta < -0.01) {
                            shiftTimelines = true;
                        } else {
                            // Stopped and wiggling backwards.
                            // For simplicity and safety just nuke current timeline.
                            hist.a.length = 0;
                        }
                    }
                }
                if (shiftTimelines) {
                    hist.cRoad = hist.bRoad;
                    hist.c = hist.b;
                    hist.bRoad = hist.aRoad;
                    hist.b = hist.a;
                    hist.a = [];
                }
            } else {
                // reset all history...
                hist.bRoad = hist.cRoad = hist.b = hist.c = null;
                hist.a = [];
            }
        }
        if (roadSig !== hist.aRoad?.sig) {
            hist.aRoad = {...env.fromRoadSig(roadSig), sig: roadSig};
        }
        hist.a.push({rpct, wt: state.worldTime});
    }

    _preprocessState(state, ad, now) {
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
                this.startAthleteLap(ad, now);
            } else {
                const elevationChange = state.altitude - prevState.altitude;
                const distanceChange = state.eventDistance ?
                    (state.eventDistance - prevState.eventDistance) :
                    (state.distance - prevState.distance);
                state.grade = ad.smoothGrade(distanceChange ?
                    (elevationChange / distanceChange) :
                    prevState.grade);
                if (state.portal && (typeof state.portalElevationScale) === 'number' &&
                    state.portalElevationScale !== 100) {
                    state.grade *= state.portalElevationScale / 100;
                }
                // Leaving around because it's pretty darn useful for debugging...
                //state.mapurl = `https://maps.google.com/maps?` +
                //    `q=${state.latlng[0]},${state.latlng[1]}&z=17`;
            }
        } else {
            state.grade = 0;
        }
    }

    _recordAthleteStats(state, ad, now) {
        // Never auto pause wBal as it is a biometric. We use true worldTime to
        // survive resets as well.
        const wbal = ad.wBal.accumulate(state.worldTime / 1000, state.power);
        const curLap = ad.laps[ad.laps.length - 1];
        let addCount;
        if (!state.power && !state.speed) {
            // Emulate auto pause...
            addCount = ad.bucket.power.flushBuffered();
            if (addCount) {
                ad.bucket.speed.flushBuffered();
                ad.bucket.hr.flushBuffered();
                ad.bucket.draft.flushBuffered();
                ad.bucket.cadence.flushBuffered();
            }
        } else {
            const time = (state.worldTime - ad.wtOffset) / 1000;
            ad.timeInPowerZones.accumulate(time, state.power);
            addCount = ad.bucket.power.add(time, state.power);
            ad.bucket.speed.add(time, state.speed);
            ad.bucket.hr.add(time, state.heartrate);
            ad.bucket.draft.add(time, state.draft);
            ad.bucket.cadence.add(time, state.cadence);
        }
        if (ad.mostRecentState) {
            const elapsedTime = state.worldTime - ad.mostRecentState.worldTime;
            if (elapsedTime < 10000) { // Ignore erroneously large gaps
                if (state.coffeeStop) {
                    ad.bucket.coffeeTime += elapsedTime;
                    curLap.coffeeTime += elapsedTime;
                    for (const s of ad.activeSegments.values()) {
                        s.coffeeTime += elapsedTime;
                    }
                } else if (state.speed) {
                    const kj = state.power * elapsedTime / 1e6;
                    if (ad.group) {
                        if (state.draft) {
                            ad.bucket.followTime += elapsedTime;
                            ad.bucket.followKj += kj;
                            curLap.followTime += elapsedTime;
                            curLap.followKj += kj;
                            for (const s of ad.activeSegments.values()) {
                                s.followTime += elapsedTime;
                                s.followKj += kj;
                            }
                        } else {
                            ad.bucket.workTime += elapsedTime;
                            ad.bucket.workKj += kj;
                            curLap.workTime += elapsedTime;
                            curLap.workKj += kj;
                            for (const s of ad.activeSegments.values()) {
                                s.workTime += elapsedTime;
                                s.workKj += kj;
                            }
                        }
                    } else {
                        ad.bucket.soloTime += elapsedTime;
                        ad.bucket.soloKj += kj;
                        curLap.soloTime += elapsedTime;
                        curLap.soloKj += kj;
                        for (const s of ad.activeSegments.values()) {
                            s.soloTime += elapsedTime;
                            s.soloKj += kj;
                        }
                    }
                }
            }
        }
        if (addCount) {
            for (let i = 0; i < addCount; i++) {
                ad.streams.distance.push(ad.distanceOffset + state.distance);
                ad.streams.altitude.push(state.altitude);
                ad.streams.latlng.push(state.latlng);
                ad.streams.wbal.push(wbal);
            }
            curLap.power.resize();
            curLap.speed.resize();
            curLap.hr.resize();
            curLap.draft.resize();
            curLap.cadence.resize();
            for (const s of ad.activeSegments.values()) {
                s.power.resize();
                s.speed.resize();
                s.hr.resize();
                s.draft.resize();
                s.cadence.resize();
            }
        }
        ad.mostRecentState = state;
        ad.updated = worldTimer.toLocalTime(state.worldTime);
        ad.internalUpdated = now;
        this._stateProcessCount++;
        let emitData;
        let streamsData;
        if (this.watching === state.athleteId) {
            if (this.listenerCount('athlete/watching')) {
                this.emit('athlete/watching', emitData || (emitData = this._formatAthleteData(ad, now)));
            }
            if (addCount && this.listenerCount('streams/watching')) {
                this.emit('streams/watching',
                          streamsData || (streamsData = this._getAthleteStreams(ad, -addCount)));
            }
        }
        if (this.athleteId === state.athleteId) {
            if (this.listenerCount('athlete/self')) {
                this.emit('athlete/self', emitData || (emitData = this._formatAthleteData(ad, now)));
            }
            if (addCount && this.listenerCount('streams/self')) {
                this.emit('streams/self',
                          streamsData || (streamsData = this._getAthleteStreams(ad, -addCount)));
            }
        }
        if (this.listenerCount(`athlete/${state.athleteId}`)) {
            this.emit(`athlete/${state.athleteId}`,
                      emitData || (emitData = this._formatAthleteData(ad, now)));
        }
        if (addCount && this.listenerCount(`streams/${state.athleteId}`)) {
            this.emit(`streams/${state.athleteId}`, streamsData ||
                      (streamsData = this._getAthleteStreams(ad, -addCount)));
        }
    }

    _activeSegmentCheck(state, ad, roadSig, now) {
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
                    this.stopSegment(ad, x.id, now);
                }
            } else if (progress != null && progress < 0.05) {
                this.startSegment(ad, x.id, now);
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
        deleteDatabase(this._athletesDB.name);
        this._athletesDB = null;
        this._athletesCache.clear();
        this.initAthletesDB();
    }

    initAthletesDB() {
        if (this._athletesDB) {
            throw new TypeError("Already initialized");
        }
        this._athletesDB = new SqliteDatabase(path.join(this._userDataPath, 'athletes.sqlite'), {
            tables: {
                athletes: {
                    id: 'INTEGER PRIMARY KEY',
                    data: 'TEXT',
                }
            }
        });
        this._getAthleteStmt = this._athletesDB.prepare('SELECT data FROM athletes WHERE id = ?');
        queueMicrotask(() => this._loadMarkedAthletes());
    }

    initEventSubgroupsDB() {
        if (this.eventSubgroupsDB) {
            throw new TypeError("Already initialized");
        }
        this._eventSubgroupsDB = new SqliteDatabase(path.join(this._userDataPath, 'event_subgroups.sqlite'), {
            tables: {
                subgroups: {
                    id: 'INTEGER PRIMARY KEY',
                    eventId: 'INTEGER',
                    eventType: 'TEXT',
                }
            }
        });
        this._getEventSubgroupStmt = this._eventSubgroupsDB
            .prepare('SELECT eventId,eventType FROM subgroups WHERE id = ?');
    }

    start() {
        this._active = true;
        try {
            this.initAthletesDB();
            this.initEventSubgroupsDB();
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
                if (id != null) {
                    console.warn('Game athlete changed to:', id);
                    this.athleteId = id;
                }
            });
            this.gameMonitor.start();
            this._zwiftMetaRefresh = 10000;
            this._zwiftMetaId = setTimeout(() => this._zwiftMetaSync(), 0);
        }
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
        const raw = eventOrSubgroup.tags ? Array.from(eventOrSubgroup.tags) : [];
        const desc = eventOrSubgroup.description;
        if (desc) {
            for (const x of desc.matchAll(/\B#([a-z]+[a-z0-9]*)\b/gi)) {
                raw.push(x[1]);
            }
        }
        const tags = {};
        for (const x of raw) {
            const kvIdx = x.indexOf('=');
            if (kvIdx !== -1) {
                let value = x.substr(kvIdx + 1);
                const num = +value;
                if (!isNaN(num) && num.toString() === value) {
                    value = num;
                }
                tags[x.substr(0, kvIdx).toLowerCase()] = value;
            } else {
                tags[x.toLowerCase()] = undefined;
            }
        }
        return tags;
    }

    _flattenEventTags(tagsObject) {
        return Object.entries(tagsObject).map(([k, v]) => v !== undefined ? `${k}=${v}` : k);
    }

    _parsePowerupPercents(powerupPercents) {
        const o = {};
        const pp = powerupPercents.slice(1, -1).split(',').map(Number);
        for (let i = 0; i < pp.length; i += 2) {
            const pu = zwift.powerUpsEnum[pp[i]];
            if (!pu) {
                console.warn("Unknown PowerUp:", pp[i]);
                o[pp[i]] = pp[i + 1] / 100;
            } else {
                o[pu] = pp[i + 1] / 100;
            }
        }
        return o;
    }

    _addEvent(event) {
        const route = env.getRoute(event.routeId);
        if (route) {
            event.routeDistance = this._getRouteDistance(route, event.laps);
            event.routeClimbing = this._getRouteClimbing(route, event.laps);
        }
        event.tags = event._tags ? event._tags.split(';') : [];
        event.allTagsObject = this._parseEventTags(event);
        event.allTags = this._flattenEventTags(event.allTagsObject);
        if (event.allTagsObject.powerup_percent) {
            event.powerUps = this._parsePowerupPercents(event.allTagsObject.powerup_percent);
        }
        event.ts = +new Date(event.eventStart);
        event.courseId = env.getCourseId(event.mapId);
        event.prettyType = {
            EFONDO: 'Fondo',
            RACE: 'Race',
            GROUP_RIDE: 'Group',
            GROUP_WORKOUT: 'Workout',
            TIME_TRIAL: 'Time Trial',
            TEAM_TIME_TRIAL: 'Team Time Trial',
        }[event.eventType] || event.eventType;
        event.prettyTypeShort = {
            TIME_TRIAL: 'TT',
            TEAM_TIME_TRIAL: 'TTT',
        }[event.eventType] || event.prettyType;
        if (!this._recentEvents.get(event.id)) {
            const start = new Date(event.ts).toLocaleString();
            console.debug(`Event added [${event.id}] - ${start}:`, event.name);
        }
        if (event.eventSubgroups) {
            for (const sg of event.eventSubgroups) {
                sg.eventId = event.id;
                sg.ts = +new Date(sg.eventSubgroupStart);
                sg.startOffset = sg.ts - event.ts;
                sg.allTagsObject = {...event.allTagsObject, ...this._parseEventTags(sg)};
                sg.allTags = this._flattenEventTags(sg.allTagsObject);
                if (sg.allTagsObject.powerup_percent) {
                    sg.powerUps = this._parsePowerupPercents(sg.allTagsObject.powerup_percent);
                }
                sg.courseId = env.getCourseId(sg.mapId);
                const rt = env.getRoute(sg.routeId);
                if (rt) {
                    sg.routeDistance = this._getRouteDistance(rt, sg.laps);
                    sg.routeClimbing = this._getRouteClimbing(rt, sg.laps);
                }
                if (sg.durationInSeconds) {
                    sg.endTS = sg.ts + sg.durationInSeconds * 1000;
                } else {
                    sg.endDistance = sg.distanceInMeters || sg.routeDistance;
                }
                this._recentEventSubgroups.set(sg.id, sg);
                this._rememberEventSubgroup(sg, event);
            }
        }
        this._recentEvents.set(event.id, event);
        return event;
    }

    _addMeetup(meetup) {
        meetup.routeDistance = this.getRouteDistance(meetup.routeId, meetup.laps, 'meetup');
        meetup.routeClimbing = this.getRouteClimbing(meetup.routeId, meetup.laps, 'meetup');
        meetup.eventType = 'MEETUP';
        meetup.prettyType = meetup.prettyTypeShort = 'Meetup';
        meetup.totalEntrantCount = meetup.acceptedTotalCount;
        meetup.followeeEntrantCount = meetup.acceptedFolloweeCount;
        meetup.allTagsObject = this._parseEventTags(meetup);
        meetup.allTags = this._flattenEventTags(meetup.allTagsObject);
        meetup.ts = +new Date(meetup.eventStart);
        if (meetup.mapId) {
            // XXX might be dead...
            meetup.courseId = env.getCourseId(meetup.mapId);
            console.warn("I'm not dead yet!", meetup);
        } else if (meetup.routeId) {
            const rt = env.getRoute(meetup.routeId);
            meetup.courseId = rt.courseId;
            meetup.mapId = rt.worldId;
        } else {
            console.warn("Meetup has no decernable course/world", meetup);
        }
        // Meetups are basically a hybrid event/subgroup
        const sg = {
            ...meetup,
            id: meetup.eventSubgroupId,
            eventSubgroupStart: meetup.eventStart,
            eventId: meetup.id,
            signedUp: meetup.inviteStatus !== 'REJECTED',
        };
        if (sg.durationInSeconds) {
            sg.endTS = meetup.ts + meetup.durationInSeconds * 1000;
        } else {
            sg.endDistance = meetup.distanceInMeters || meetup.routeDistance;
        }
        meetup.eventSubgroups = [sg];
        this._recentEventSubgroups.set(meetup.eventSubgroupId, sg);
        this._recentEvents.set(meetup.id, meetup);
        this._rememberEventSubgroup(sg, meetup);
    }

    _zwiftMetaSync() {
        if (!this._active || !this.zwiftAPI.isAuthenticated()) {
            console.warn("Skipping social network update because not logged into zwift");
            return;
        }
        this.__zwiftMetaSync().catch(e => {
            if (e.message === 'fetch failed' || e.name === 'TimeoutError') {
                console.warn('Zwift Meta Sync network problem:', e.cause?.message || e);
            } else {
                report.errorThrottled(e);
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
            addedEventsCount += !this._recentEvents.get(x.id);
            this._addEvent(x);
        }
        const meetups = await this.zwiftAPI.getPrivateEventFeed();
        for (const x of meetups) {
            addedEventsCount += !this._recentEvents.get(x.id);
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
            return this._formatState(state);
        }
    }

    compareRoadPositions(p1, p2) {
        // NOTE: This code uses a few micro optimizations given that it's heavily used..
        //
        // Stage 1: Find a path between p1 and p2.
        //  * If p1 is not leading, indicate the positions are reversed.
        //     * Looping conditions will indicate reversed positions when the path is shorter.
        //       I.e. If you are lapping riders in a circuit race, the gaps will flip to
        //       negative as you close in on the lapped riders.
        //  * If p1 and p2 do not have a connected history, ignore them.
        const boundaryErrorTerm = 0.01;  // amount of slop permitted around road edges
        let reversed = false;
        let tiers;
        let p1CurPct = p1.a[p1.a.length - 1].rpct;
        let p2CurPct = p2.a[p2.a.length - 1].rpct;
        if (p1.aRoad.sig === p2.aRoad.sig) {
            tiers = 1;
            const d = p1CurPct - p2CurPct;
            // Check for simple lapping.  Theoretically we could check for c tier lapping too but in test
            // the only match I found was a false positive with sparse data where two athletes were lapping
            // the same loop road multiple times.
            if (d > 0.5) {
                if (p1.aRoad.sig === p2.bRoad?.sig &&
                    p2.b[p2.b.length - 1].rpct >= p1CurPct - boundaryErrorTerm) {
                    tiers = 2;
                    reversed = true;
                }
            } else if (d < 0) {
                reversed = true;
                if (d < -0.5) {
                    if (p2.aRoad.sig === p1.bRoad?.sig &&
                        p1.b[p1.b.length - 1].rpct >= p2CurPct - boundaryErrorTerm) {
                        tiers = 2;
                        reversed = false;
                    }
                }
            }
        } else if (p2.aRoad.sig === p1.bRoad?.sig &&
                   p1.b[p1.b.length - 1].rpct >= p2CurPct - boundaryErrorTerm) {
            tiers = 2;
        } else if (p1.aRoad.sig === p2.bRoad?.sig &&
                   p2.b[p2.b.length - 1].rpct >= p1CurPct - boundaryErrorTerm) {
            tiers = 2;
            reversed = true;
        } else if (p2.aRoad.sig === p1.cRoad?.sig &&
                   p1.c[p1.c.length - 1].rpct >= p2CurPct - boundaryErrorTerm) {
            tiers = 3;
        } else if (p1.aRoad.sig === p2.cRoad?.sig &&
                   p2.c[p2.c.length - 1].rpct >= p1CurPct - boundaryErrorTerm) {
            tiers = 3;
            reversed = true;
        } else {
            return;
        }

        if (reversed) {
            [p1, p2] = [p2, p1];
            [p1CurPct, p2CurPct] = [p2CurPct, p1CurPct];
        }

        // Stage 2: Compute actual road slices between the positions...
        //  * Because road history timelines are incomplete we may see connected road history but not have
        //    sufficient data for a real time gap.  We'll still return the road segments for time estimates.
        let sharedTimeline;
        let distance;
        if (tiers === 1) {
            distance = this._getRoadDistance(p1.aRoad, p2CurPct, p1CurPct);
            sharedTimeline = p1.a;
        } else {
            distance = this._getRoadDistance(p1.aRoad, p1.a[0].rpct, p1CurPct);
            const p1BLastPct = p1.b[p1.b.length - 1].rpct;
            if (tiers === 2) {
                distance += this._getRoadDistance(p1.bRoad, p2CurPct, p1BLastPct);
                sharedTimeline = p1.b;
            } else {
                const p1CLastPct = p1.c[p1.c.length - 1].rpct;
                distance += this._getRoadDistance(p1.bRoad, p1.b[0].rpct, p1BLastPct);
                distance += this._getRoadDistance(p1.cRoad, p2CurPct, p1CLastPct);
                sharedTimeline = p1.c;
            }
        }

        // Stage 3: Find the check point where p1 was at p2's current position.
        //  * This is the actual time when p1 was there.
        //  * If we satisfy the requirements below we have a "Real" gap.
        let worldTime;
        if (sharedTimeline.length > 1) {
            const index = this._findNearestTimelineCheckpoint(sharedTimeline, p2CurPct);
            const nearestPct = sharedTimeline[index].rpct;
            const d = p2CurPct - nearestPct;
            let left, right;
            if (d > 0) {
                if (index !== sharedTimeline.length - 1) {
                    left = index;
                    right = index + 1;
                }
            } else if (d < 0) {
                if (index > 0) {
                    left = index - 1;
                    right = index;
                }
            } else {
                worldTime = sharedTimeline[index].wt;  // exact match (unlikely)
            }
            if (left !== right) {
                // Lerp the difference between edges...
                const t = (p2CurPct - sharedTimeline[left].rpct) /
                          (sharedTimeline[right].rpct - sharedTimeline[left].rpct);
                worldTime = Math.round(sharedTimeline[left].wt * (1 - t) + sharedTimeline[right].wt * t);
            }
        }
        return {
            worldTime,
            distance,
            reversed,
        };
    }

    _getRoadDistance({courseId, roadId, reversed}, start, end) {
        if (start == null || end == null || isNaN(start) || isNaN(end)) {
            throw new Error("NOPE");
        }
        if (end < start) {
            return 0;
        }
        const roadPath = env.getRoadCurvePath(courseId, roadId, reversed);
        if (!roadPath) {
            return 0;
        }
        return roadPath.subpathAtRoadPercents(start, end).distance(0.05) / 100;
    }

    _findNearestTimelineCheckpoint(timeline, value) {
        let left = 0;
        let right = timeline.length - 1;
        let i;
        const low = timeline[0].rpct;
        const high = timeline[right].rpct;
        if (value > low && value < high) {
            while (right >= left) {
                i = left + ((right - left) * 0.5 | 0);
                const test = timeline[i].rpct;
                if (test > value) {
                    right = i - 1;
                } else if (test < value) {
                    left = i + 1;
                } else {
                    return i;
                }
            }
        } else if (value <= low) {
            right = 0;
        } else if (value >= high) {
            left = right;
        }
        const lDist = Math.abs(timeline[left].rpct - value);
        const rDist = Math.abs(timeline[right].rpct - value);
        return rDist <= lDist ? right : left;
    }

    gcAthleteData() {
        const now = monotonic();
        const expiration = now - 3600 * 1000;
        for (const [id, {internalUpdated}] of this._athleteData) {
            if (internalUpdated < expiration) {
                this._athleteData.delete(id);
                this._athletesCache.delete(id);
                this._profileFetchDeferrals.delete(id);
            }
        }
        for (const x of this._groupMetas.values()) {
            if (now - x.accessed > 90 * 1000) {
                this._groupMetas.delete(x.id);
            }
        }
    }

    async _statesProcessor() {
        const interval = 1000;
        // Align interval with realtime second boundary for aesthetics and to avoid potential
        // rounding issues in stats code or UX code.
        let target = (monotonic() / 1000 | 0) * 1000 + interval;
        let errBackoff = 1;
        while (this._active) {
            let skipped = 0;
            let now = monotonic();
            while (now > (target += interval)) {
                skipped++;
            }
            if (skipped) {
                console.warn("States processor skipped:", skipped);
            }
            await highResSleepTill(target);
            if (this.watching == null) {
                continue;
            }
            now = monotonic();
            try {
                const nearby = this._computeNearby();
                const groups = this._computeGroups(nearby);
                this._mostRecentNearby = nearby.map(x => this._formatAthleteData(x, now));
                this._mostRecentGroups = groups.map(x => ({
                    ...x,
                    _athleteDatas: undefined,
                    _nearbyIndexes: undefined,
                    athletes: x._nearbyIndexes.map(i => this._mostRecentNearby[i]),
                }));
                this.emit('nearby', this._mostRecentNearby);
                this.emit('groups', this._mostRecentGroups);
            } catch(e) {
                report.errorThrottled(e);
                target += errBackoff++ * interval;
            }
        }
    }

    _formatState(raw, wt) {
        const o = {};
        const keys = Object.keys(raw);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k[0] !== '_') {
                o[k] = raw[k];
            }
        }
        o.ts = worldTimer.toLocalTime(raw.worldTime);
        return o;
    }

    _formatStateDebug(raw) {
        // Use same method as non-debug method so benchmarking is the same..
        const o = {};
        const keys = Object.keys(raw);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k[0] !== ' ') {
                o[k] = raw[k];
            }
        }
        o.ts = worldTimer.toLocalTime(raw.worldTime);
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
            if (sg.endTS) {
                return {
                    eventLeader,
                    eventSweeper,
                    remaining: (sg.endTS - worldTimer.serverNow()) / 1000,
                    remainingMetric: 'time',
                    remainingType: 'event',
                };
            } else {
                return {
                    eventLeader,
                    eventSweeper,
                    remaining: sg.endDistance - state.eventDistance,
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

    _formatAthleteData(ad, now=monotonic()) {
        let athlete = this.loadAthlete(ad.athleteId);
        if (athlete && ad.privacy.hideFTP) {
            athlete = {...athlete, ftp: null};
        }
        const state = ad.mostRecentState;
        const lapCount = ad.laps.length;
        return {
            created: ad.created,
            updated: ad.updated,
            age: now - ad.internalUpdated,
            watching: ad.athleteId === this.watching ? true : undefined,
            self: ad.athleteId === this.athleteId ? true : undefined,
            courseId: ad.courseId,
            athleteId: ad.athleteId,
            athlete,
            stats: this._getBucketStats(ad.bucket, ad, athlete, {now, includeDeprecated: true}),
            lap: this._getBucketStats(ad.laps[ad.laps.length - 1], ad, athlete, {now}),
            lastLap: lapCount > 1 ?
                this._getBucketStats(ad.laps[ad.laps.length - 2], ad, athlete) :
                null,
            lapCount,
            state: state && this._formatState(state),
            events: ad.events.size ?
                Array.from(ad.events).map(x => ({id: x[0], subgroupId: x[1]})) :
                [],
            eventPosition: ad.eventPosition,
            eventParticipants: ad.eventParticipants,
            gameState: ad.gameState,
            gap: ad.gap,
            gapDistance: ad.gapDistance,
            isGapEst: ad.isGapEst ? true : undefined,
            wBal: ad.privacy.hideWBal ? undefined : ad.wBal.get(),
            timeInPowerZones: ad.privacy.hideFTP ? undefined : ad.timeInPowerZones.get(),
            ...(state && this._getEventOrRouteInfo(state)),
            ...ad.extra,
        };
    }

    _computeNearby() {
        const watching = this._athleteData.get(this.watching);
        if (!watching || !watching.mostRecentState || watching.disabled) {
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
        const watchingWorldTime = watching.mostRecentState.worldTime;
        // Only filter stopped riders if we are moving.
        const filterStopped = !!watching.mostRecentState.speed;
        const ahead = [];
        const behind = [];
        const now = monotonic();
        for (const ad of this._athleteData.values()) {
            //if (ad !== watching && !this._markedIds.has(ad.athleteId)) continue;
            if (ad.athleteId === this.watching || ad.disabled || !ad.mostRecentState ||
                now - ad.internalUpdated > 15000 || (filterStopped && !ad.mostRecentState.speed)) {
                continue;
            }
            const rp = this.compareRoadPositions(watching.roadHistory, ad.roadHistory);
            if (rp == null) {
                ad.gap = undefined;
                ad.gapDistance = undefined;
                ad.isGapEst = true;
                continue;
            }
            if (rp.worldTime != null)  {
                ad.gap = (watchingWorldTime - rp.worldTime) / 1000;
                if (rp.reversed && ad.gap > 0) { //need to check sign of ad.gap for stopped athletes
                    ad.gap = -ad.gap;
                }
                ad.isGapEst = false;
            } else {
                ad.gap = undefined;
                ad.isGapEst = true;
            }
            if (rp.reversed) {
                ad.gapDistance = -rp.distance;
                ahead.push(ad);
            } else {
                ad.gapDistance = rp.distance;
                behind.push(ad);
            }
        }

        ahead.sort((a, b) => a.gapDistance - b.gapDistance);
        behind.sort((a, b) => a.gapDistance - b.gapDistance);

        // Now fill in gap estimates by seeing if we can incrementally account for the gaps
        // between each rider.  Failing this, just fallback to speed and distance...
        let refSpeedForEstimates = expWeightedAvg(10, Math.max(10, watching.mostRecentState.speed));
        for (let i = ahead.length - 1; i >= 0; i--) {
            const x = ahead[i];
            if (x.mostRecentState.speed > 2) {
                refSpeedForEstimates(x.mostRecentState.speed);
            }
            if (x.gap == null) {
                const adjacent = ahead[i + 1] || watching;
                const incRP = this.compareRoadPositions(x.roadHistory, adjacent.roadHistory);
                if (!incRP || incRP.worldTime == null || incRP.reversed) {
                    // `reversed` indicates that the adjacent athlete branched before the test subject,
                    // making it irrelevant as a time based checkpoint to the watching athlete.
                    const incGapDist = adjacent.gapDistance - x.gapDistance;
                    const velocity = refSpeedForEstimates.get() / 3.6;
                    const incGap = incGapDist / velocity;
                    x.gap = adjacent.gap - incGap;
                } else {
                    x.gap = adjacent.gap - (x.mostRecentState.worldTime - incRP.worldTime) / 1000;
                }
            }
        }
        refSpeedForEstimates = expWeightedAvg(10, Math.max(10, watching.mostRecentState.speed));
        for (let i = 0; i < behind.length; i++) {
            const x = behind[i];
            if (x.mostRecentState.speed > 2) {
                refSpeedForEstimates(x.mostRecentState.speed);
            }
            if (x.gap == null) {
                const adjacent = behind[i - 1] || watching;
                const incRP = this.compareRoadPositions(adjacent.roadHistory, x.roadHistory);
                if (!incRP || incRP.worldTime == null || incRP.reversed) {
                    // `reversed` indicates that the adjacent athlete branched before the test subject making
                    // it irrelevant as a time based checkpoint to the watching athlete.
                    const incGapDist = x.gapDistance - adjacent.gapDistance;
                    const velocity = refSpeedForEstimates.get() / 3.6;
                    const incGap = incGapDist / velocity;
                    x.gap = adjacent.gap + incGap;
                } else {
                    x.gap = adjacent.gap + (x.mostRecentState.worldTime - incRP.worldTime) / 1000;
                }
            }
        }

        const nearby = [];
        const maxGap = 15 * 60;
        for (let i = 0; i < ahead.length; i++) {
            if (ahead[i].gap > -maxGap) {
                nearby.push(ahead[i]);
            }
        }
        nearby.push(watching);
        for (let i = 0; i < behind.length; i++) {
            if (behind[i].gap < maxGap) {
                nearby.push(behind[i]);
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
        // Clump all riders into their respective groups...
        let watchingIdx;
        let curGroup;
        let prevGap;
        for (let i = 0; i < nearby.length; i++) {
            const ad = nearby[i];
            const athlete = this._athletesCache.get(ad.athleteId);
            if (!curGroup || (!ad.mostRecentState.draft && ad.gap - prevGap > 1)) {
                if (curGroup) {
                    curGroup.innerGap = ad.gap - prevGap;
                    const head = curGroup._athleteDatas[0];
                    const tail = curGroup._athleteDatas[curGroup._athleteDatas.length - 1];
                    curGroup.lengthTime = tail.gap - head.gap;
                    curGroup.lengthDistance = tail.gapDistance - head.gapDistance;
                    groups.push(curGroup);
                }
                curGroup = {
                    _athleteDatas: [],
                    _nearbyIndexes: [],
                    weight: 0,
                    weightCount: 0,
                    power: 0,
                    draft: 0,
                    heartrate: 0,
                    heartrateCount: 0,
                };
            }
            curGroup._athleteDatas.push(ad);
            curGroup._nearbyIndexes.push(i);
            curGroup.weight += athlete?.weight || 0;
            curGroup.weightCount += athlete?.weight ? 1 : 0;
            curGroup.power += ad.mostRecentState.power || 0;
            curGroup.draft += ad.mostRecentState.draft || 0;
            curGroup.heartrate += ad.mostRecentState.heartrate || 0;
            curGroup.heartrateCount += ad.mostRecentState.heartrate ? 1 : 0;
            if (ad.athleteId === this.watching) {
                curGroup.watching = true;
                watchingIdx = groups.length;
            }
            prevGap = ad.gap;
        }
        const head = curGroup._athleteDatas[curGroup._athleteDatas.length - 1];
        const tail = curGroup._athleteDatas[curGroup._athleteDatas.length - 1];
        curGroup.lengthTime = head.gap - tail.gap;
        curGroup.lengthDistance = head.gapDistance - tail.gapDistance;
        groups.push(curGroup);

        // With completed groups and athletes compute aggregate stats...
        const newGroupMetas = [];
        const usedGroupIds = new Set();
        for (let i = 0; i < groups.length; i++) {
            const grp = groups[i];
            grp.weight /= grp.weightCount;
            grp.power /= grp._athleteDatas.length;
            grp.draft /= grp._athleteDatas.length;
            grp.speed = sauce.data.median(grp._athleteDatas.map(x => x.mostRecentState.speed));
            grp.heartrate /= grp.heartrateCount;
            if (watchingIdx !== i) {
                const edge = watchingIdx < i ?
                    grp._athleteDatas[0] :
                    grp._athleteDatas[grp._athleteDatas.length - 1];
                grp.isGapEst = edge.isGapEst;
                grp.gap = edge.gap;
            } else {
                grp.gap = 0;
                grp.isGapEst = false;
            }
            // For groups with > 1 athlete, try to match with prior group for group stats...
            // This is Greedy Jaccard Similarity algo (fast but imperfect)...
            if (grp._athleteDatas.length > 1) {
                const identitySet = new Set();
                for (let j = 0; j < grp._athleteDatas.length; j++) {
                    const ad = grp._athleteDatas[j];
                    identitySet.add(ad.athleteId);
                    ad.group = grp;
                }
                let bestScore = 0;
                let bestGroupMeta;
                for (const xMeta of this._groupMetas.values()) {
                    if (usedGroupIds.has(xMeta.id)) {
                        continue;
                    }
                    const jaccardScore = identitySet.intersection(xMeta.identitySet).size /
                        identitySet.union(xMeta.identitySet).size;
                    if (jaccardScore > bestScore) {
                        bestScore = jaccardScore;
                        bestGroupMeta = xMeta;
                    }
                }
                if (bestScore > 0.5) {
                    //console.info("Matching group", bestScore, identitySet);
                    grp.id = bestGroupMeta.id;
                    const leftAthletes = bestGroupMeta.identitySet.difference(identitySet);
                    //const existingAthletes = identitySet.union(bestGroupMeta.identitySet);
                    const newAthletes = identitySet.difference(bestGroupMeta.identitySet);
                    for (const x of newAthletes) {
                        this._athleteData.get(x).groupId = grp.id;
                        console.debug(grp.id, "Athlete joined the group!", this.loadAthlete(x)?.fullname);
                    }
                    for (const x of leftAthletes) {
                        console.debug(grp.id, "Athlete LEFT the group!", this.loadAthlete(x)?.fullname);
                    }
                    bestGroupMeta.identitySet = identitySet;
                    bestGroupMeta.accessed = monotonic();
                    usedGroupIds.add(bestGroupMeta.id);
                } else if (grp.id == null) {
                    grp.id = groupIdCounter++;
                    for (const x of identitySet) {
                        console.debug(grp.id, "Athlete formed a new group!", this.loadAthlete(x)?.fullname);
                    }
                    grp.created = Date.now();
                    newGroupMetas.push({id: grp.id, accessed: monotonic(), identitySet});
                }
            } else {
                grp.id = null;
                grp._athleteDatas[0].group = null;
            }
        }
        for (const x of newGroupMetas) {
            this._groupMetas.set(x.id, x);
        }
        return groups;
    }

    getDebugInfo() {
        return {
            pendingZwiftProfileFetches: this._pendingProfileFetches.size,
            zwiftProfileFetchCount: this._profileFetchCount,
            stateProcessCount: this._stateProcessCount,
            stateDupCount: this._stateDupCount,
            stateStaleCount: this._stateStaleCount,
            activeAthletesSize: this._athleteData.size,
            activeAthleteDataPoints: Array.from(this._athleteData.values())
                .map(x =>
                    x.bucket.power.roll.size() +
                    x.bucket.speed.roll.size() +
                    x.bucket.hr.roll.size() +
                    x.bucket.draft.roll.size() +
                    x.bucket.cadence.roll.size() +
                    Object.values(x.streams).reduce((agg, xx) => agg + xx.length, 0))
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this._athletesCache.size,
        };
    }
}
