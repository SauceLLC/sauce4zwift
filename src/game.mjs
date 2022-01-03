/* global */

import net from 'node:net';
import os from 'node:os';
import storage from './storage.mjs';
import sudo from 'sudo-prompt';
import cap from 'cap';
import ZwiftPacketMonitor from '@saucellc/zwift-packet-monitor';
import power from '../shared/sauce/power.mjs';

const athleteCacheLabel = 'athlete-cache';


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


async function getLocalRoutedIface() {
    const ip = await getLocalRoutedIP();
    for (const xDevice of cap.Cap.deviceList()) {
        for (const xAddr of xDevice.addresses) {
            if (xAddr.addr === ip) {
                return xDevice.name;
            }
        }
    }
}


let _acLastTS = 0;
let _acUpdates = 0;
async function getAthleteCache() {
    const data = await storage.load(athleteCacheLabel);
    _acLastTS = Date.now();
    return new Map(data);
}


async function maybeSaveAthleteCache(data) {
    if (Date.now() - _acLastTS < 30000 || _acUpdates < 100) {
        return;
    }
    _acLastTS = Date.now();
    await storage.save(athleteCacheLabel, Array.from(data));
    _acUpdates = 0;
}


async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}


const worldTimeOffset = 1414016074335;  // ms since zwift started production.
function worldTimeConv(wt) {
    // TBD I think timesync helps us adjust the offset but I can't interpret it yet.
    return new Date(Number(worldTimeOffset) + Number(wt));
}


function headingConv(microRads) {
    const halfCircle = 1000000 * Math.PI;
    return (((microRads + halfCircle) / (2 * halfCircle)) * 360) % 360;
}


function crowDistance(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 100;  // roughly meters
}


function estGap(a, b) {
    const dist = crowDistance(a, b);
    return dist / ((a.speed || b.speed || 1) * 1000 / 3600);
}


class Sauce4ZwiftMonitor extends ZwiftPacketMonitor {

    static async factory(...args) {
        const iface = await getLocalRoutedIface();
        console.info('Monitoring zwift data from:', iface);
        return new this(iface, ...args);
    }

    constructor(...args) {
        super(...args);
        this.setMaxListeners(50);
        this._stats = new Map();
        this._roadHistory = new Map();
        this._roadId;
        this.athleteId = null;
        this.watching = null;
        this.on('incoming', this.onIncoming);
        this.on('outgoing', this.onOutgoing);
    }

    maybeLearnAthleteId(packet) {
        if (this.athleteId === null && packet.athleteId != null) {
            this.athleteId = packet.athleteId;
            if (this.watching == null) {
                this.watching = this.athleteId;
            }
        }
    }

    updateAthlete(id, fName, lName, weight) {
        const d = this.athletes.get(id) || {};
        d.name = (fName || lName) ? [fName, lName].filter(x => x) : d.name;
        d.weight = weight != null ? weight : d.weight;
        this.athletes.set(id, d);
        _acUpdates++;
        maybeSaveAthleteCache(this.athletes);  // bg okay
    }

    onIncoming(packet, from) {
        this.maybeLearnAthleteId(packet);
        for (const x of packet.playerUpdates) {
            if (x.payload && x.payload.$type) {
                const p = x.payload;
                if (p.$type.name === 'PlayerEnteredWorld') {
                    this.updateAthlete(p.athleteId, p.firstName, p.lastName, p.weight / 1000);
                } else if (p.$type.name === 'EventJoin') {
                    console.debug("Event Join:", p);
                } else if (p.$type.name === 'EventLeave') {
                    console.debug("Event Leave:", p);
                } else if (p.$type.name === 'ChatMessage') {
                    this.emit('chat', {...p, ts: x.ts});
                    this.updateAthlete(p.from, p.firstName, p.lastName);
                } else if (x.payload.$type.name === 'RideOn') {
                    this.emit('rideon', {...p, ts: x.ts});
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

    onOutgoing(packet, from) {
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
            this.watching = watching;
            console.debug("Now watching:", watching);
        }
        if (state.athleteId === this.watching) {
            this._watchingRoadSig = this._roadSig(state);
        }
    }

    processFlags1(bits) {
        const b0_1 = bits & 0x3; // XXX possibly bit 1 = bot and bit 0 = no power-meter/run?
        bits >>>= 2;
        const reverse = !!(bits & 0x1);
        bits >>>= 1;
        const reversing = !!(bits & 0x1);
        bits >>>= 1;
        const b4_23 = bits & (1 << 20) - 1; // XXX no idea
        bits >>>= 20;
        const rideons = bits;
        return {
            b0_1,
            reversing,
            reverse,
            b4_23,
            rideons,
        };
    }

    processFlags2(bits) {
        const b0_3 = bits & 0xF;  // Some of these represent using a powerup.
        // b0_3: 15 = has powerup? 0b1111 0 = using/used powerup
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
        const rem2 = bits; // XXX no idea
        return {
            b0_3,
            turning,
            roadId,
            overlapping,
            rem2,
        };
    }

    _roadSig(state) {
        return [state.roadId, state.reverse].join();
    }

    processState(state, from) {
        state.ts = +worldTimeConv(state.worldTime);
        const prevState = this.states.get(state.athleteId);
        if (prevState && prevState.ts > state.ts) {
            console.warn("Dropping stale packet", state.ts - prevState.ts);
            return false;
        }
        // Move this to zwift-packet thing..
        Object.assign(state, this.processFlags1(state.flags1));
        Object.assign(state, this.processFlags2(state.flags2));
        state.kj = state.mwHours / 1000 / (1000 / 3600);
        state.heading = headingConv(state.heading);  // degrees
        state.speed = state.speed / 1000000;  // km/h
        state.cadence = state.cadenceUHz ? state.cadenceUHz / 1000000 * 60 : null;  // rpm
        delete state.cadenceUHz;
        const roadCompletion = state.roadLocation;
        state.roadCompletion = !state.reverse ? 1000000 - roadCompletion : roadCompletion;
        this.states.set(state.athleteId, state);
        const periods = [5, 30, 60, 300, 1200];
        if (!this._stats.has(state.athleteId)) {
            const rp = new power.RollingPower(null, {idealGap: 0.200, maxGap: 10});
            this._stats.set(state.athleteId, {
                _firstTS: state.ts,
                _rp: rp,
                _powerPeriods: new Map(periods.map(x => [x, {
                    roll: rp.clone({period: x}),
                    peak: {avg: 0, ts:0}
                }])),
                powerMax: 0,
                hrSum: 0,
                hrDur: 0,
                hrMax: 0,
                draftSum: 0,
                draftDur: 0,
                cadenceSum: 0,
                cadenceDur: 0,
            });
        }
        if (!this._roadHistory.has(state.athleteId)) {
            this._roadHistory.set(state.athleteId, {
                sig: this._roadSig(state),
                timeline: [],
                prevSig: null,
                prevTimeline: null,
            });
        }
        const roadLoc = this._roadHistory.get(state.athleteId);
        const curRoadSig = this._roadSig(state);
        if (curRoadSig !== roadLoc.sig) {
            roadLoc.prevSig = roadLoc.sig;
            roadLoc.prevTimeline = roadLoc.timeline;
            roadLoc.sig = curRoadSig;
            roadLoc.timeline = [];
        }
        const last = roadLoc.timeline.at(-1);
        if (last && state.roadCompletion < last.roadCompletion) {
            // This can happen when lapping a single road segment or if your avatar
            // Is stopped and sort of wiggling backwards. For safety we just nuke hist.
            roadLoc.timeline.length = 0;
        }
        roadLoc.timeline.push({ts: state.ts, roadCompletion: state.roadCompletion});
        const stats = this._stats.get(state.athleteId);
        const duration = stats._lastTS ? state.ts - stats._lastTS : 0;
        stats._lastTS = state.ts;
        if (duration && state.speed) {
            // Support runs. XXX
            if (state.power != null) {
                const rp = stats._rp;
                const time = (state.ts - stats._firstTS) / 1000;
                const prevTime = rp.timeAt(-1);
                if (prevTime && time < prevTime) {
                    debugger;
                    console.error("unexpected");
                }
                rp.add(time, state.power);
                for (const [p, {roll, peak}] of stats._powerPeriods.entries()) {
                    roll.resize();
                    if (roll.full()) {
                        const avg = Math.round(roll.avg());
                        if (avg >= peak.avg) {
                            if (avg > 2000) {
                                debugger;
                            }
                            peak.avg = avg;
                            peak.ts = Date.now();
                            stats[`peakPower${p}s`] = peak;
                        }
                    }
                }
                for (const x of periods) {
                    stats[`power${x}s`] = rp.slice(-x).avg();
                }
                stats.powerAvg = (rp.kj() * 1000) / rp.active();
                stats.powerNP = rp.np({force: true});
                if (state.power > stats.powerMax) {
                    stats.powerMax = state.power;
                }
            }
            if (state.heartrate) {
                stats.hrSum += state.heartrate * duration;
                stats.hrDur += duration;
                if (state.heartrate > stats.hrMax) {
                    stats.hrMax = state.heartrate;
                }
            }
            if (state.draft != null) {
                stats.draftSum += state.draft * duration;
                stats.draftDur += duration;
            }
            if (state.cadence != null) {
                stats.cadenceSum += state.cadence * duration;
                stats.cadenceDur += duration;
            }
        }
        state.stats = stats;
        if (this.watching === state.athleteId) { // XXX why is duration only sometimes 0, bug ?
            //console.warn('adsf', duration, state.power, from);
            this.emit('watching', this.cleanState(state));
        }
    }

    async start() {
        this._active = true;
        this.athletes = await getAthleteCache();
        this.states = new Map();
        super.start();
        this._nearbyJob = this.nearbyProcessor();
    }

    async stop() {
        this._active = false;
        super.stop();
        try {
            await this._nearbyJob;
        } finally {
            this._nearybyJob = null;
        }
    }

    realGap(a, b) {
        const aSig = this._roadSig(a);
        const bSig = this._roadSig(b);
        let leaderTimeline;
        let trailing;
        if (aSig === bSig) {
            if (a.roadCompletion > b.roadCompletion) {
                leaderTimeline = this._roadHistory.get(a.athleteId).timeline;
                trailing = b;
            } else if (a.roadCompletion < b.roadCompletion) {
                leaderTimeline = this._roadHistory.get(b.athleteId).timeline;
                trailing = a;
            }
        } else {
            const aHist = this._roadHistory.get(a.athleteId);
            if (aHist.prevSig === bSig) {
                leaderTimeline = aHist.prevTimeline;
                trailing = b;
            } else {
                const bHist = this._roadHistory.get(a.athleteId);
                if (bHist.prevSig === aSig) {
                    leaderTimeline = bHist.prevTimeline;
                    trailing = a;
                }
            }
        }
        if (!trailing == null || !leaderTimeline) {
            return null;
        }
        let prev;
        // TODO: Use binary search.
        for (const x of Array.from(leaderTimeline).reverse()) {  // newest to oldest...
            if (x.roadCompletion <= trailing.roadCompletion) {
                let offt = 0;
                if (prev) {
                    const dist = prev.roadCompletion - x.roadCompletion;
                    const time = prev.ts - x.ts;
                    offt = (trailing.roadCompletion - x.roadCompletion) / dist * time;
                }
                return Math.abs((trailing.ts - x.ts - offt) / 1000);
            }
            prev = x;
        }
        return null;
    }

    isFirstLeadingSecond(a, b) {
        const aSig = this._roadSig(a);
        const bSig = this._roadSig(b);
        if (aSig === bSig) {
            return a.roadCompletion > b.roadCompletion;
        } else {
            const aHist = this._roadHistory.get(a.athleteId);
            if (aHist.prevSig === bSig) {
                return true;
            } else {
                const bHist = this._roadHistory.get(a.athleteId);
                if (bHist.prevSig === aSig) {
                    return false;
                }
            }
        }
    }

    gcStates() {
        const now = Date.now();
        for (const [k, x] of this.states.entries()) {
            const age = now - x.ts;
            if (age > 30 * 1000) {
                this.states.delete(k);
            }
        }
    }

    async nearbyProcessor() {
        let errBackoff = 1000;
        const target = Date.now() % 1000;
        while (this._active) {
            if (this.watching == null) {
                await sleep(100);
                continue;
            }
            try {
                await this._nearbyProcessor();
                const offt = Date.now() % 1000;
                const schedSleep = 1000 - (offt - target);
                await sleep(schedSleep);
            } catch(e) {
                console.error("Unexpected processor error:", e);
                await sleep(errBackoff *= 2);
            }
        }
    }

    _cleanPrivate(o) {
        return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
    }

    cleanState(raw) {
        const clean = this._cleanPrivate(raw);
        if (clean.stats) {
            clean.stats = this._cleanPrivate(clean.stats);
        }
        return clean;
    }

    async _nearbyProcessor() {
        this.gcStates();
        const cleanState = this.cleanState.bind(this);
        const watching = this.states.get(this.watching);
        if (!watching) {
            return;
        }
        const nearby = [];
        for (const [k, x] of this.states.entries()) {
            if (!x.speed && k !== this.watching) {
                continue;
            }
            const leading = this.isFirstLeadingSecond(watching, x);
            if (leading == null) {
                if (k === this.watching) {
                    debugger;
                } else {
                    continue;
                }
            }
            const sign = leading ? 1 : -1;
            let gap = this.realGap(watching, x);
            let isGapEst = gap == null;
            if (isGapEst) {
                gap = estGap(watching, x);
            }
            nearby.push({
                gap: gap * sign,
                isGapEst,
                athlete: this.athletes.get(k),
                ...x
            });
        }
        nearby.sort((a, b) => a.gap - b.gap);
        this.emit('nearby', nearby.map(cleanState));

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
            x.power = x.athletes.reduce((agg, x) => agg + x.power, 0) / x.athletes.length;
            x.draft = x.athletes.reduce((agg, x) => agg + x.draft, 0) / x.athletes.length;
            x.speed = x.athletes.reduce((agg, x) => agg + x.speed, 0) / x.athletes.length; // XXX use median i think
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
        this.emit('groups', groups.map(g =>
            (g.athletes = g.athletes.map(cleanState), g)));
    }
}


async function getCapturePermission() {
    if (os.platform() === 'darwin') {
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
            'Network capture permission requried to continue',
            'Sauce extends Zwift by capturing the game data sent over the network ' +
            'For MacOS this requires read permission on the "/dev/bpf0" file.  ' +
            'On Windows it requires you to eat a pumpkin (I dunno).  Go fix up your computer now'
        );
        throw new Error("libpcap permission required");
    }
}


export default {
    Sauce4ZwiftMonitor,
    getCapturePermission,
};
