/* global */

const net = require('net');
const os = require('os');
const state = require('./state');
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
    const data = await state.load('athlete-cache', '../.athlete-cache-seed.json.gz');
    _acLastTS = Date.now();
    return new Map(data);
}


async function maybeSaveAthleteCache(data) {
    if (Date.now() - _acLastTS < 30000 || _acUpdates < 100) {
        return;
    }
    _acLastTS = Date.now();
    await state.save('athlete-cache', Array.from(data));
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


function distance(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 100;  // roughly meters
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
                    this.athletes.set(x.payload.athleteId, x.payload.toJSON());
                    _acUpdates++;
                } else if (x.payload.$type.name === 'EventJoin') {
                    console.warn("Event Join:", x.payload);
                } else if (x.payload.$type.name === 'EventLeave') {
                    console.warn("Event Leave:", x.payload);
                } else if (x.payload.$type.name === 'ChatMessage') {
                    const chat = x.payload;
                    const watchingState = this.watching != null && this.states.get(this.watching);
                    if (!watchingState || watchingState.groupId === chat.eventSubgroup) {
                        const fromState = this.states.get(chat.from);
                        const distGap = (fromState && watchingState) ? distance(fromState, watchingState) : null;
                        this.emit('chat', {...chat, ts: x.ts, distGap});
                    } else {
                        console.warn("skip it", x.payload.message, x.payload.eventSubgroup, watchingState.groupId);
                    }
                } else if (x.payload.$type.name === 'RideOn') {
                    console.warn("RideOn:", x.payload);
                }
            }
        }
        for (const x of packet.playerStates) {
            this.processState(x);
        }
    }

    onOutgoing(packet) {
        this.maybeLearnAthleteId(packet);
        if (!packet.state) {
            return;
        }
        this.processState(packet.state);
        const roadSig = '' + packet.state.roadId + packet.state.reverse;
        const watching = packet.state.watchingAthleteId;
        if (watching != null && this.watching !== watching) {
            this.watching = watching;
            console.debug("Now watching:", watching);
            this.wakeup();
        } else if (this._roadSig !== roadSig) {
            this.wakeup();
        }
        this._roadSig = roadSig;
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

    processState(state) {
        // Move this to zwift-packet thing..
        state.heading = headingConv(state.heading);  // degrees
        state.speed = state.speed / 1000000;  // km/h
        state.cadence = state.cadenceUHz ? state.cadenceUHz / 1000000 * 60 : null;  // rpm
        delete state.cadenceUHz;
        Object.assign(state, this.processFlags1(state.flags1));
        Object.assign(state, this.processFlags2(state.flags2));
        this.states.set(state.athleteId, state);
        if (!this._stats.has(state.athleteId)) {
            this._stats.set(state.athleteId, {
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
        const stats = this._stats.get(state.athleteId);
        const duration = stats.worldTime ? state.worldTime.toNumber() - stats.worldTime : 0;
        stats.worldTime = state.worldTime.toNumber();
        if (duration && state.speed) {
            if (state.power != null) {
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
        if (this.watching === state.athleteId) {
            this.emit('watching', {state, stats});
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

    async nearbyProcessor() {
        while (this._active) {
            if (this.watching == null) {
                await sleep(100);
                continue;
            }
            const watching = this.states.get(this.watching);
            if (watching) {
                //console.debug("Athletes:", this.athletes.size, "States:", this.states.size);
                //console.debug("Watching:", watching.athleteId);
                const now = Date.now();
                const byRelLocation = [];
                for (const [k, x] of this.states.entries()) {
                    const age = now - worldTimeConv(x.worldTime);
                    if (age > 15 * 1000) {
                        if (age > 1800 * 1000) {
                            this.states.delete(k);
                        }
                        continue;
                    }
                    if ((watching.groupId && x.groupId !== watching.groupId) ||
                        watching.reverse !== x.reverse ||
                        watching.roadId !== x.roadId) {
                        continue;
                    }
                    byRelLocation.push({relRoadLocation: watching.roadLocation - x.roadLocation, ...x});
                }
                if (watching.reverse) {
                    byRelLocation.sort((a, b) => a.relRoadLocation - b.relRoadLocation);
                } else {
                    byRelLocation.sort((a, b) => b.relRoadLocation - a.relRoadLocation);
                }
                const center = byRelLocation.findIndex(x => x.athleteId === watching.athleteId);
                const nearby = [];
                for (let i = Math.max(0, center - 8); i < Math.min(byRelLocation.length, center + 8); i++) {
                    const x = byRelLocation[i];
                    const relDistance = distance(x, watching);
                    const timeGap = relDistance / ((watching.speed || x.speed || 1) * 1000 / 3600);  // XXX Pretty naive
                    const athlete = this.athletes.get(x.athleteId);
                    //const name = athlete && `${athlete.firstName[0]}.${athlete.lastName}`;
                    //console.debug('Nearby:', i - center, x.athleteId, 'flags...', x.flags1.toString(16), x.flags2.toString(16),
                    //    name, JSON.stringify(x));
                    nearby.push({
                        position: i - center,
                        relDistance,
                        timeGap,
                        athlete,
                        ...x
                    });
                }
                this.emit('nearby', nearby);

                const groups = [];
                let curGroup;
                for (const x of byRelLocation) {
                    if (!curGroup) {
                        curGroup = {athletes: [x]};
                    } else {
                        const last = curGroup.athletes[curGroup.athletes.length - 1];
                        const gap = distance(x, last);
                        if (gap > 25) {
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
                for (let i = 0; i < groups.length; i++) {
                    const x = groups[i];
                    x.power = x.athletes.reduce((agg, x) => agg + x.power, 0) / x.athletes.length;
                    x.draft = x.athletes.reduce((agg, x) => agg + x.draft, 0) / x.athletes.length;
                    if (i) {
                        const ahead = groups[i - 1];
                        x.distGap = distance(x.athletes[0], ahead.athletes[0]);
                        x.timeGap = x.distGap / ((x.athletes[0].speed || 1) * 1000 / 3600);  // XXX Pretty naive
                        x.totDistGap = ahead.totDistGap + x.distGap;
                        x.totTimeGap = ahead.totTimeGap + x.timeGap;
                    } else {
                        Object.assign(groups[0], {distGap: 0, timeGap: 0, totDistGap: 0, totTimeGap: 0});
                    }
                }
                this.emit('groups', groups);
            }
            await Promise.race([sleep(1000), this.wakeEvent]);
            await maybeSaveAthleteCache(this.athletes);
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
