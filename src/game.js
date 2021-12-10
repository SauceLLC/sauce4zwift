/* global */

const net = require('net');
const os = require('os');
const storage = require('./storage');
const sudo = require('sudo-prompt');
const cap = require('cap');
const {dialog} = require('electron');
const ZwiftPacketMonitor = require('@saucellc/zwift-packet-monitor');


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
    const data = await storage.load('athlete-cache', '../.athlete-cache-seed.json.gz');
    _acLastTS = Date.now();
    return new Map(data);
}


async function maybeSaveAthleteCache(data) {
    if (Date.now() - _acLastTS < 30000 || _acUpdates < 100) {
        return;
    }
    _acLastTS = Date.now();
    await storage.save('athlete-cache', Array.from(data));
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
        this._stats = new Map();
        this._roadHistory = new Map();
        this._roadId;
        this.athleteId = null;
        this.watching = null;
        this.on('incoming', this.onIncoming);
        this.on('outgoing', this.onOutgoing);
        this.wakeup();  // set up wakeEvent
    }

    wakeup() {
        if (this._wakeResolve) {
            this._wakeResolve();
        }
        this.wakeEvent = new Promise(resolve => this._wakeResolve = resolve);
    }

    maybeLearnAthleteId(packet) {
        if (this.athleteId === null && packet.athleteId != null) {
            this.athleteId = packet.athleteId;
            if (this.watching == null) {
                this.watching = this.athleteId;
            }
        }
    }

    onIncoming(packet) {
        this.maybeLearnAthleteId(packet);
        for (const x of packet.playerUpdates) {
            if (x.payload && x.payload.$type) {
                if (x.payload.$type.name === 'PlayerEnteredWorld') {
                    this.athletes.set(x.payload.athleteId, {
                        name: [x.payload.firstName, x.payload.lastName].filter(x => x),
                        weight: x.payload.weight / 1000,
                    });
                    _acUpdates++;
                } else if (x.payload.$type.name === 'EventJoin') {
                    console.warn("Event Join:", x.payload);
                } else if (x.payload.$type.name === 'EventLeave') {
                    console.warn("Event Leave:", x.payload);
                } else if (x.payload.$type.name === 'ChatMessage') {
                    const chat = x.payload;
                    this.emit('chat', {...x.payload, ts: x.ts});
                } else if (x.payload.$type.name === 'RideOn') {
                    console.warn("RideOn:", x.payload);
                }
            }
        }
        for (const x of packet.playerStates) {
            this.processState(x);
            if (x.athleteId === this.watching) {
                this._watchingRoadSig = this._roadSig(x);
            }
        }
    }

    onOutgoing(packet) {
        this.maybeLearnAthleteId(packet);
        const state = packet.state;
        if (!state) {
            return;
        }
        this.processState(state);
        const watching = state.watchingAthleteId;
        let shouldWakeup;
        if (watching != null && this.watching !== watching) {
            this.watching = watching;
            console.debug("Now watching:", watching);
            shouldWakeup = true;
        }
        if (state.athleteId === this.watching) {
            this._watchingRoadSig = this._roadSig(state);
            shouldWakeup = true;
        }
        if (shouldWakeup) {
            this.wakeup();
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

    processState(state) {
        // Move this to zwift-packet thing..
        Object.assign(state, this.processFlags1(state.flags1));
        Object.assign(state, this.processFlags2(state.flags2));
        state.ts = +worldTimeConv(state.worldTime);
        state.heading = headingConv(state.heading);  // degrees
        state.speed = state.speed / 1000000;  // km/h
        state.cadence = state.cadenceUHz ? state.cadenceUHz / 1000000 * 60 : null;  // rpm
        delete state.cadenceUHz;
        const roadCompletion = state.roadLocation;
        state.roadCompletion = !state.reverse ? 1000000 - roadCompletion : roadCompletion;
        this.states.set(state.athleteId, state);
        if (!this._stats.has(state.athleteId)) {
            this._stats.set(state.athleteId, {
                power30s: 0,
                powerSum: 0,
                powerDur: 0,
                powerMax: 0,
                hrSum: 0,
                hrDur: 0,
                hrMax: 0,
                draftSum: 0,
                draftDur: 0,
                cadenceSum: 0,
                cadenceDur: 0,
                worldTime: 0,
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
        const last = roadLoc.timeline[roadLoc.timeline.length - 1];
        if (last && state.roadCompletion < last.roadCompletion) {
			// This can happen when lapping a single road segment or if your avatar
			// Is stopped and sort of wiggling backwards. For safety we just nuke hist.
			roadLoc.timeline.length = 0;
        }
		roadLoc.timeline.push({ts: state.ts, roadCompletion: state.roadCompletion});
        const stats = this._stats.get(state.athleteId);
        const duration = stats.worldTime ? state.worldTime.toNumber() - stats.worldTime : 0;
        stats.worldTime = state.worldTime.toNumber();
        if (duration && state.speed) {
            if (state.power != null) {
                stats.power30s = (stats.power30s * 29 + state.power) / 30,
                stats.powerSum += state.power * duration;
                stats.powerDur += duration;
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
        if (this.watching === state.athleteId) {
            this.emit('watching', state);
        }
    }

    async start() {
        this._active = true;
        const s = Date.now();
        debugger;
        this.athletes = await getAthleteCache();
        for (const [k, v] of this.athletes.entries()) {
            this.athletes.set(k, {name: [v.firstName, v.lastName].filter(x=>x), weight: v.weight / 1000});
        }
        await storage.save('athlete-cache2', Array.from(this.athletes));
        console.info('storage load', Date.now() - s);
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
				debugger;
                leaderTimeline = aHist.prevTimeline;
                trailing = b;
            } else {
                const bHist = this._roadHistory.get(a.athleteId);
                if (bHist.prevSig === aSig) {
					debugger;
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
                } else {
					console.error("Unexpected order configuration");
                }
                return Math.abs((trailing.ts - x.ts - offt) / 1000);
            }
            prev = x;
        }
        return null;
    }

    async nearbyProcessor() {
        while (this._active) {
            if (this.watching == null) {
                await sleep(100);
                continue;
            }
            const watching = this.states.get(this.watching);
            if (watching) {
                const now = Date.now();
                const byRelCompletion = [];
                for (const [k, x] of this.states.entries()) {
                    const age = now - x.ts;
                    if (age > 15 * 1000 || !x.speed) {
                        if (age > 1800 * 1000) {
                            this.states.delete(k);
                        }
                        continue;
                    }
                    if (this._watchingRoadSig !== this._roadSig(x)) {
                        continue;
                    }
                    byRelCompletion.push({relRoadCompletion: watching.roadCompletion - x.roadCompletion, ...x});
                }
                byRelCompletion.sort((a, b) => a.relRoadCompletion - b.relRoadCompletion);
                const center = byRelCompletion.findIndex(x => x.athleteId === watching.athleteId);
                const nearby = [];
                for (let i = 0; i < byRelCompletion.length; i++) {
                    const x = byRelCompletion[i];
                    nearby.push({
                        position: i - center,
                        estGap: estGap(watching, x),
                        realGap: this.realGap(watching, x),
                        ...x
                    });
                    //const [xxx] = nearby.slice(-1);
                    //console.debug('Nearby:', center - i, Math.round(xxx.estGap), xxx.realGap && Math.round(xxx.realGap));
                }
                //console.debug('');
                this.emit('nearby', nearby);

                const groups = [];
                let curGroup;
                for (const x of byRelCompletion) {
                    if (!curGroup) {
                        curGroup = {athletes: [x]};
                    } else {
                        const last = curGroup.athletes[curGroup.athletes.length - 1];
                        const gap = this.realGap(last, x) || estGap(last, x)
                        if (gap > 2) {
                            groups.push(curGroup);
                            curGroup = {athletes: []};
                        } else if (gap < 0) {
							debugger;
						}
                        curGroup.athletes.push(x);
                    }
                    curGroup.watching = curGroup.watching || x.athleteId === this.watching;
                }
                if (curGroup && curGroup.athletes.length) {
                    groups.push(curGroup);
                }
                for (let i = 0; i < groups.length; i++) {
                    const x = groups[i];
                    x.power = x.athletes.reduce((agg, x) => agg + x.power, 0) / x.athletes.length;
                    x.draft = x.athletes.reduce((agg, x) => agg + x.draft, 0) / x.athletes.length;
                    x.speed = x.athletes.reduce((agg, x) => agg + x.speed, 0) / x.athletes.length; // XXX use median i think
                    if (i) {
                        const ahead = groups[i - 1];
						const nextAthlete = ahead.athletes[ahead.athletes.length - 1];
                        x.estGap = estGap(nextAthlete, x.athletes[0]);
                        x.realGap = this.realGap(nextAthlete, x.athletes[0]);
                        x.totGap = ahead.totGap + (x.realGap != null ? x.realGap : x.estGap);
                    } else {
                        Object.assign(groups[0], {totGap: 0});
                    }
                }
                this.emit('groups', groups);
            }
            await Promise.race([sleep(1000), this.wakeEvent]);
            maybeSaveAthleteCache(this.athletes);  // bg okay
        }
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
        await dialog.showErrorBox(
            'Network capture permission requried to continue',
            'Sauce extends Zwift by capturing the game data sent over the network ' +
            'For MacOS this requires read permission on the "/dev/bpf0" file.  ' +
            'On Windows it requires you to eat a pumpkin (I dunno).  Go fix up your computer now'
        );
        throw new Error("libpcap permission required");
    }
}


module.exports = {
    Sauce4ZwiftMonitor,
    getCapturePermission,
};
