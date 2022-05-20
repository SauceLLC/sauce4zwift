import os from 'node:os';
import net from 'node:net';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import * as storage from './storage.mjs';
import * as rpc from './rpc.mjs';
import * as sauce from '../shared/sauce/index.mjs';
import fetch from 'node-fetch';
import {getAppSetting} from './main.mjs';
import {createRequire} from 'node:module';
import {captureExceptionOnce} from '../shared/sentry-util.mjs';
const require = createRequire(import.meta.url);
const electron = require('electron');
const pkg = require('../package.json');

export let npcapMissing = false;

let cap;
let ZwiftPacketMonitor;
try {
    cap = require('cap');
    ZwiftPacketMonitor = require('@saucellc/zwift-packet-monitor');
} catch(e) {
    if (e.message.includes('cap.node')) {
        console.warn("npcap not installed");
        npcapMissing = true;
        ZwiftPacketMonitor = Object;
    } else {
        throw e;
    }
}


const powerUpEnum = {
    0: 'FEATHER',
    1: 'DRAFT',
    4: 'BURRITO',
    5: 'AERO',
    6: 'GHOST',
};


function randInt(ceil=Number.MAX_SAFE_INTEGER) {
    return Math.trunc(Math.random() * ceil);
}


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
    _db = null;
    await deleteDatabase('athletes');
}


const worldTimeOffset = 1414016074335;  // ms since zwift started production.
function worldTimeConv(wt) {
    // TBD I think timesync helps us adjust the offset but I can't interpret it yet.
    return new Date(Number(worldTimeOffset) + Number(wt));
}


function titleCase(s) {
    return s[0].toUpperCase() + s.substr(1).toLowerCase();
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


async function getLocalRoutedIP() {
    const sock = net.createConnection(80, 'www.zwift.com');
    return await new Promise((resolve, reject) => {
        sock.on('connect', () => {
            try {
                resolve(sock.address().address);
            } finally {
                sock.end();
            }
        });
        sock.on('error', reject);
    });
}


function getLocalRoutedIface(ip) {
    for (const xDevice of cap.Cap.deviceList()) {
        for (const xAddr of xDevice.addresses) {
            if (xAddr.addr === ip) {
                return xDevice.name;
            }
        }
    }
}


export class Sauce4ZwiftMonitor extends ZwiftPacketMonitor {

    static async factory({fakeData}={}) {
        const ip = await getLocalRoutedIP();
        const iface = getLocalRoutedIface(ip);
        return new this(iface, ip, fakeData);
    }

    constructor(iface, ip, fakeData) {
        super(iface);
        this.ip = ip;
        this._useFakeData = fakeData;
        this.setMaxListeners(50);
        this._athleteData = new Map();
        this._chatDeDup = [];
        this.athleteId = null;
        this.watching = null;
        this.athletesCache = new Map();
        this._stateProcessCount = 0;
        this._stateDupCount = 0;
        this._stateStaleCount = 0;
        this._profileFetchIds = new Set();
        this._pendingProfileFetches = new Map();
        this._profileFetchCount = 0;
        this.on('incoming', this.onIncoming);
        this.on('outgoing', this.onOutgoing);
        rpc.register(this.updateAthlete, {scope: this});
        rpc.register(this.startLap, {scope: this});
        rpc.register(this.resetStats, {scope: this});
        rpc.register(this.exportFIT, {scope: this});
    }

    maybeLearnAthleteId(packet) {
        if (this.athleteId === null && packet.athleteId != null) {
            this.athleteId = packet.athleteId;
            if (this.watching == null) {
                this.watching = this.athleteId;
            }
        }
    }

    startLap() {
        console.debug("User requested lap start");
        const now = performance.now();
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
        this.clearPendingProfileFetches();
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

    updateAthlete(id, fName, lName, extra={}) {
        const d = this.loadAthlete(id) || {};
        d.updated = Date.now();
        if (fName && fName.length === 1 && d.name && d.name[0] && d.name[0].length > 1 && d.name[0][0] === fName) {
            fName = d.name[0];  // Update is just the first initial but we know the full name already.
        }
        d.name = (fName || lName) ? [fName, lName].map(x =>
            (x && x.trim) ? x.trim() : null).filter(x => x) : d.name;
        d.fullname = d.name && d.name.join(' ');
        const leadingPunc = /^[.*_#\s]+/;
        const saniFirst = d.name && d.name[0].replace(leadingPunc, '');
        let saniLast;
        if (d.name && d.name[1]) {
            const [last, team] = splitNameAndTeam(d.name[1]);
            saniLast = last && last.replace(leadingPunc, '');
            d.team = team;
        }
        d.sanitizedName = (saniFirst || saniLast) ? [saniFirst, saniLast].filter(x => x) : null;
        d.sanitizedFullname = d.sanitizedName && d.sanitizedName.join(' ');
        d.initials = d.sanitizedName ? d.sanitizedName.map(x => x[0]).join('').toUpperCase() : null;
    console.debug(d.name, d.fullname, d.sanitizedName, d.sanitizedFullname, d.initials, d.team);
        Object.assign(d, extra);
        this.saveAthlete(id, d);
        return d;
    }

    loadAthlete(id) {
        const a = this.athletesCache.get(id);
        if (a !== undefined) {
            return a;
        }
        const r = this.getAthleteStmt.get(id);
        if (r) {
            const data = JSON.parse(r.data);
            this.athletesCache.set(id, data);
            return data;
        } else {
            this.athletesCache.set(id, null);
        }
    }

    saveAthlete(id, data) {
        this.athletesCache.set(id, data);
        this.athletesDB.prepare('INSERT OR REPLACE INTO athletes (id, data) VALUES(?, ?)')
            .run(id, JSON.stringify(data));
    }

    onIncoming(...args) {
        try {
            this._onIncoming(...args);
        } catch(e) {
            captureExceptionOnce(e);
        }
    }

    _onIncoming(packet, from) {
        this.maybeLearnAthleteId(packet);
        for (const x of packet.playerUpdates) {
            if (x.payload && x.payload.$type) {
                const ts = highPrecTimeConv(x.ts);
                const p = x.payload;
                if (p.$type.name === 'PlayerEnteredWorld') {
                    const extra = p.weight ? {weight: p.weight / 1000} : undefined;
                    this.updateAthlete(p.athleteId, p.firstName, p.lastName, extra);
                } else if (p.$type.name === 'EventJoin') {
                    console.debug("Event Join:", p);
                } else if (p.$type.name === 'EventLeave') {
                    console.debug("Event Leave:", p);
                } else if (p.$type.name === 'ChatMessage') {
                    let dedup;
                    for (const [t, from] of this._chatDeDup) {
                        if (t === ts && from === p.from) {
                            dedup = true;
                            break;
                        }
                    }
                    if (dedup) {
                        console.warn("Deduping chat message:", ts, p.from);
                        continue;
                    } else {
                        console.debug(ts, p.from, p);
                    }
                    this._chatDeDup.unshift([ts, p.from]);
                    this._chatDeDup.length = Math.min(10, this._chatDeDup.length);
                    this.emit('chat', {...p, ts});
                    this.updateAthlete(p.from, p.firstName, p.lastName, {avatar: p.avatar});
                } else if (x.payload.$type.name === 'RideOn') {
                    this.emit('rideon', {...p, ts});
                    this.updateAthlete(p.from, p.firstName, p.lastName);
                    console.debug("RideOn:", p);
                }
            }
        }
        for (const x of packet.playerStates) {
            if (this.processState(x, from) === false) {
                continue;
            }
            if (x.athleteId === this.watching) {
                this._watchingRoadSig = this._roadSig(x);
            }
        }
    }

    onOutgoing(...args) {
        try {
            this._onOutgoing(...args);
        } catch(e) {
            captureExceptionOnce(e);
        }
    }

    _onOutgoing(packet, from) {
        this.maybeLearnAthleteId(packet);
        const state = packet.state;
        if (!state) {
            return;
        }
        if (this.processState(state, from) === false) {
            return;
        }
        const watching = state.watchingAthleteId;
        if (watching != null && this.watching !== watching) {
            this.setWatching(watching);
        }
        if (state.athleteId === this.watching) {
            this._watchingRoadSig = this._roadSig(state);
        }
    }

    setWatching(athleteId) {
        console.debug("Now watching:", athleteId);
        this.watching = athleteId;
        this.clearPendingProfileFetches();
    }

    processFlags1(bits) {
        const powerMeter = !!(bits & 0x1);
        bits >>>= 1;
        const companionApp = !!(bits & 0x1);
        bits >>>= 1;
        const reverse = !!(bits & 0x1);
        bits >>>= 1;
        const reversing = !!(bits & 0x1);
        bits >>>= 1;
        const _b4_15 = bits & (1 << 12) - 1; // XXX no idea
        bits >>>= 12;
        const course = bits & 0xff;
        bits >>>= 8;
        const rideons = bits;
        return {
            powerMeter,
            companionApp,
            reversing,
            reverse,
            _b4_15,
            course,
            rideons,
        };
    }

    processFlags2(bits) {
        const powerUping = bits & 0xF;
        // b0_3: 15 = Not active, otherwise enum
        bits >>>= 4;
        const turning = {
            0: null,
            1: 'RIGHT',
            2: 'LEFT',
        }[bits & 0x3];
        bits >>>= 2;
        const overlapping = bits & 0x1;  // or near junction or recently on junction.  It's unclear.
        bits >>>= 1;
        const roadId = bits & 0xFFFF;
        bits >>>= 16;
        const _rem2 = bits; // XXX no idea
        return {
            activePowerUp: powerUping === 0xF ? false : powerUpEnum[powerUping],
            turning,
            roadId,
            overlapping,
            _rem2,
        };
    }

    _roadSig(state) {
        return [state.roadId, state.reverse].join();
    }

    _getCollectorStats(data, athlete) {
        const end = data.end || performance.now();
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

    maybeUpdateAthletesFromProfile(nearby) {
        for (const {athleteId, gap} of nearby) {
            if (this._profileFetchIds.has(athleteId)) {
                continue;
            }
            this._profileFetchIds.add(athleteId);
            this._pendingProfileFetches.set(athleteId, Math.abs(gap));
        }
        if (!this._athleteProfileUpdater && this._pendingProfileFetches.size) {
            this._athleteProfileUpdater = this.runAthleteProfileUpdater().finally(() =>
                this._athleteProfileUpdater = null);
        }
    }

    clearPendingProfileFetches() {
        for (const id of this._pendingProfileFetches.keys()) {
            this._profileFetchIds.delete(id);
        }
        this._pendingProfileFetches.clear();
    }

    async runAthleteProfileUpdater() {
        if (this._useFakeData) {
            this.zwiftToken = true;
        } else if (this.zwiftToken === undefined) {
            const zwiftLogin = getAppSetting('zwiftLogin');
            this.zwiftToken = zwiftLogin && storage.load('zwift-token');
        }
        while (this.zwiftToken && this._pendingProfileFetches.size) {
            let minGap = Infinity;
            let id;
            for (const [xId, xGap] of this._pendingProfileFetches.entries()) {
                if (xGap < minGap) {
                    minGap = xGap;
                    id = xId;
                }
            }
            this._pendingProfileFetches.delete(id);
            const state = this._athleteData.get(id).mostRecentState;
            if (!state || this._watchingRoadSig !== this._roadSig(state)) {
                this._profileFetchIds.delete(id);  // Allow immediate recheck
                continue;
            }
            // Allow lookup/cache-validation after 1 hour...
            setTimeout(() => this._profileFetchIds.delete(id), 3600 * 1000);
            const data = this.loadAthlete(id);
            if (!this._useFakeData && data && data.updated && (Date.now() - data.updated) < (86400 * 1000)) {
                continue;
            }
            if (this._useFakeData) {
                const words = this.constructor.toString().replaceAll(/[^a-zA-Z ]/g, ' ')
                    .split(' ').filter(x => x);
                const fName = words[randInt(words.length)];
                const lName = words[randInt(words.length)];
                this.updateAthlete(id, titleCase(fName), titleCase(lName), {
                    ftp: Math.round(100 + randInt(300)),
                    avatar: Math.random() > 0.25 ?
                        `https://gravatar.com/avatar/${Math.abs(id)}?s=400&d=robohash&r=x` :
                        undefined,
                    weight: Math.round(40 + randInt(70)),
                    gender: ['female', 'male'][randInt(2)],
                    age: Math.round(18 + randInt(60)),
                    level: Math.round(1 + randInt(40)),
                });
            } else {
                try {
                    const p = await this._fetchProfile(id, this.zwiftToken);
                    this.updateAthlete(id, p.firstName, p.lastName, {
                        ftp: p.ftp,
                        avatar: p.imageSrcLarge || p.imageSrc,
                        weight: p.weight / 1000,
                        height: p.height / 10,
                        gender: p.male === false ? 'female' : 'male',
                        age: p.age,
                        level: Math.floor(p.achievementLevel / 100),
                        createdOn: p.createdOn ? +(new Date(p.createdOn)) : undefined,
                    });
                } catch(e) {
                    console.error("Zwift API error:", e);
                    this.updateAthlete(id);  // Update TS
                }
            }
            this._profileFetchCount++;
            await sauce.sleep(500 + 1000 * Math.random());
        }
        this._pendingProfileFetches.clear();
    }

    async _fetchProfile(id, token) {
        const r = await fetch(`https://us-or-rly101.zwift.com/api/profiles/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Zwift-Api-Version': '2.5',
                'Authority': 'us-or-rly101.zwift.com',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9,und;q=0.8',
                'User-Agent': 'CNL/3.18.0 (Windows 10; Windows 10.0.19044) zwift/1.0.100641 curl/7.78.0-DEV',
            }
        });
        if (!r.ok) {
            storage.remove('zwift-token');
            this.zwiftToken = null;
            throw new Error(`[${r.status}]: ${await r.text()}`);
        }
        return await r.json();
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
        const start = performance.now();
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

    processState(state, from) {
        state.ts = +worldTimeConv(state._worldTime);
        if (!this._athleteData.has(state.athleteId)) {
            this._athleteData.set(state.athleteId, this._createAthleteData(state.athleteId, state.ts));
        }
        const ad = this._athleteData.get(state.athleteId);
        if (ad.mostRecentState && ad.mostRecentState.ts >= state.ts) {
            if (ad.mostRecentState.ts === state.ts) {
                this._stateDupCount++;
            } else {
                this._stateStaleCount++;
            }
            return false;
        }
        // TBD: Move most of this to zwift-packet-monitor...
        state.joinTime = +worldTimeConv(state._joinTime);
        Object.assign(state, this.processFlags1(state._flags1));
        Object.assign(state, this.processFlags2(state._flags2));
        state.kj = state._mwHours / 1000 / (1000 / 3600);
        state.heading = headingConv(state._heading);  // degrees
        state.speed = state._speed / 1000000;  // km/h
        state.cadence = state._cadenceUHz ? state._cadenceUHz / 1000000 * 60 : 0;  // rpm
        // XXX there are two distance values, one probably includes lateral movement?
        // But we just use the more precise one and clobber the other.
        state.distance = state._distance / 100;  // cm -> meters
        state.roadCompletion = !state.reverse ? 1000000 - state.roadLocation : state.roadLocation;
        ad.mostRecentState = state;
        const roadSig = this._roadSig(state);
        if (roadSig !== ad.roadHistory.sig) {
            ad.roadHistory.prevSig = ad.roadHistory.sig;
            ad.roadHistory.prevTimeline = ad.roadHistory.timeline;
            ad.roadHistory.sig = roadSig;
            ad.roadHistory.timeline = [];
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
        if (state.power == null || state.speed == null || state.heartrate == null ||
            state.cadence == null || state.draft == null) {
            console.error("Assertion failure");
            debugger;
        }
        ad.updated = performance.now();
        if (this.watching === state.athleteId) {
            const athlete = this.loadAthlete(state.athleteId);
            this.emit('watching', {
                athleteId: state.athleteId,
                athlete,
                stats: this._getCollectorStats(ad, athlete),
                laps: ad.laps.map(x => this._getCollectorStats(x, athlete)),
                state: this.cleanState(state),
            });
        }
        this._stateProcessCount++;
    }

    async start() {
        this._active = true;
        try {
            this.athletesDB = getDB();
        } catch(e) {
            captureExceptionOnce(e);
            await resetDB();
            this.athletesDB = getDB();
        }
        this.getAthleteStmt = this.athletesDB.prepare('SELECT data FROM athletes WHERE id = ?');
        if (!this._useFakeData) {
            super.start();
        } else {
            this._fakeDataGenerator();
        }
        this._nearbyJob = this.nearbyProcessor();
        this._gcInterval = setInterval(this.gcStates.bind(this), 32768);
    }

    async stop() {
        this._active = false;
        super.stop();
        clearInterval(this._gcInterval);
        this._gcInterval = null;
        try {
            await this._nearbyJob;
        } finally {
            this._nearybyJob = null;
        }
    }

    async _fakeDataGenerator() {
        const OutgoingPacket = ZwiftPacketMonitor.OutgoingPacket;
        const athleteCount = 10000;
        let watching = -Math.trunc(athleteCount / 2 + 1);
        let iters = 1;
        const hz = 5;
        while (this._active) {
            const start = performance.now();
            for (let i = 1; i < athleteCount + 1; i++) {
                const athleteId = -i;
                const ad = this._athleteData.get(athleteId);
                const priorState = ad && ad.mostRecentState;
                const roadId = priorState ? priorState.roadId : randInt(30);
                const packet = OutgoingPacket.fromObject({
                    athleteId,
                    worldTime: Date.now() - worldTimeOffset,
                    state: {
                        athleteId,
                        _worldTime: Date.now() - worldTimeOffset,
                        watchingAthleteId: watching,
                        power: Math.round(250 + 250 * Math.sin(i * 10 + Date.now() / 10000)),
                        heartrate: Math.round(150 + 50 * Math.cos(i * 10 + Date.now() / 10000)),
                        _speed: Math.round(30 + 25 * Math.sin(i * 10 + Date.now() / 15000)) * 1000000,
                        _cadenceUHz: Math.round(50 + 50 * Math.sin(i * 10 + Date.now() / 15000)) / 60 * 1000000,
                        draft: randInt(300),
                        roadLocation: priorState ?
                            (priorState.roadLocation + 100 + randInt(10)) % 1000000 :
                            i * 10,
                        _flags1: 1 << 2, // reverse
                        _flags2: +roadId << 7,
                    }
                });
                this.onOutgoing(packet);
            }
            if (iters++ % (hz * 60) === 0) {
                watching = -Math.trunc(Math.random() * athleteCount);
            }
            const delay = 200 - (performance.now() - start);
            if (iters % (hz * 5 * 1000) === 0) {
                console.debug('fake data delay', delay, iters, this._stateProcessCount);
            }
            await sauce.sleep(delay);
        }
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
            } else {
                if (b.roadHistory.prevSig === aSig) {
                    leaderTimeline = b.roadHistory.prevTimeline;
                    trailingState = a.mostRecentState;
                }
            }
        }
        if (!trailingState) {
            return null;
        }
        let prev;
        // TODO: Use binary search or at least use a normal for loop and walk backwards with out doing a reverse, and for of .geez guy
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
        const now = performance.now();
        const expiration = now - 300 * 1000;
        for (const [k, {updated}] of this._athleteData.entries()) {
            if (updated < expiration) {
                this._athleteData.delete(k);
            }
        }
    }

    async nearbyProcessor() {
        let errBackoff = 1000;
        const target = performance.now() % 1000;
        while (this._active) {
            if (this.watching == null) {
                await sauce.sleep(100);
                continue;
            }
            try {
                await this._nearbyProcessor();
                const offt = performance.now() % 1000;
                const schedSleep = 1000 - (offt - target);
                await sauce.sleep(schedSleep);
            } catch(e) {
                captureExceptionOnce(e);
                await sauce.sleep(errBackoff *= 2);
            }
        }
    }

    cleanState(raw) {
        return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
    }

    async _nearbyProcessor() {
        const watchingData = this._athleteData.get(this.watching);
        if (!watchingData) {
            return;
        }
        const nearby = [];
        for (const [aId, aData] of this._athleteData.entries()) {
            if ((!aData.mostRecentState.speed || performance.now() - aData.updated > 10000) && aId !== this.watching) {
                continue; // stopped or offline
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
                state: this.cleanState(aData.mostRecentState),
            });
        }
        nearby.sort((a, b) => a.gap - b.gap);
        this.emit('nearby', nearby);
        this.maybeUpdateAthletesFromProfile(nearby);

        const groups = [];
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
        this.emit('groups', groups);
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
                .map(x => x.power.roll.size() + x.speed.roll.size() + x.hr.roll.size() + x.hr.roll.size() + x.draft.roll.size())
                .reduce((agg, c) => agg + c, 0),
            athletesCacheSize: this.athletesCache.size,
        };
    }
}


export async function getCapturePermission() {
    if (os.platform() === 'darwin') {
        const sudo = await import('sudo-prompt');
        await new Promise((resolve, reject) => {
            sudo.exec(`chown ${os.userInfo().uid} /dev/bpf*`, {name: 'Sauce for Zwift'},
                (e, stdout, stderr) => {
                    if (stderr) {
                        console.warn(stderr);
                    }
                    if (e) {
                        reject(e);
                    } else {
                        resolve(stdout);
                    }
                });
        });
    } else {
        await electron.dialog.showErrorBox(
            'Network capture permission required to continue',
            'Sauce extends Zwift by capturing the game data sent over the network ' +
            'For MacOS this requires read permission on the "/dev/bpf0" file.'
        );
        throw new Error("libpcap permission required");
    }
}
