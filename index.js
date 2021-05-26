/* global __dirname */

const {app, BrowserWindow} = require('electron');
const ZwiftPacketMonitor = require('@saucellc/zwift-packet-monitor');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const athleteCache = path.resolve(os.homedir(), '.zwiftAthleteCache.json');


async function getAthleteCache() {
    let f;
    try {
        f = await fs.open(athleteCache);
    } catch(e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
        return new Map();
    }
    const data = new Map(JSON.parse(await f.readFile()));
    await f.close();
    return data;
}


async function setAthleteCache(data) {
    const tmp = athleteCache + '.tmp';
    const f = await fs.open(tmp, 'w');
    await f.writeFile(JSON.stringify(Array.from(data)));
    await f.close();
    await fs.rename(tmp, athleteCache);
}


async function getPrimaryInterface() {
    // XXX macos only.
    const {stdout, stderr} = await exec('route get 0/0');
    if (!stdout) {
        throw new Error(stderr || 'route get failuere');
    }
    return stdout.match(/\sinterface: (.+?)$/m)[1];
}


async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}


function headingConv(microRads) {
    if (microRads < Math.PI * -1000000 || microRads > Math.PI * 3000000) {
        debugger;
    }
    const halfCircle = 1000000 * Math.PI;
    return (((microRads + halfCircle) / (2 * halfCircle)) * 360) % 360;
}


function distance(a, b) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / 100;  // roughly meters
}


class Sauce4ZwiftMonitor extends ZwiftPacketMonitor {
    constructor(...args) {
        super(...args);
        this._stats = new Map();
        this.on('incoming', this.onIncoming);
        this.on('outgoing', this.onOutgoing);
    }

    onIncoming(packet) {
        for (const x of packet.playerUpdates) {
            if (x.payload && x.payload.$type) {
                if (x.payload.$type.name === 'PlayerEnteredWorld') {
                    this.athletes.set(x.payload.athleteId, x.payload.toJSON());
                } else if (x.payload.$type.name === 'EventJoin') {
                    console.warn("Event Join:", x.payload);
                } else if (x.payload.$type.name === 'EventLeave') {
                    console.warn("Event Leave:", x.payload);
                } else if (x.payload.$type.name === 'ChatMessage') {
                    console.warn("Chat:", x.payload.firstName, x.payload.lastName, ':', x.payload.message);
                } else if (x.payload.$type.name === 'RideOn') {
                    console.warn("RideOn:", x.payload);
                }
            }
        }
        if (!this.watching) {
            // Fallback for when we are just watching or not hooked up with power.
            this.watching = packet.athleteId;
        }
        for (const x of packet.playerStates) {
            this.processState(x);
        }
    }

    onOutgoing(packet) {
        if (!packet.state) {
            return;
        }
        this.watching = packet.state.watchingAthleteId;
        this.processState(packet.state);
    }

    processFlags1(bits) {
        const b0_1 = bits & 0x3; // XXX no idea
        bits >>= 2;
        const reverse = !!(bits & 0x1);
        bits >>= 1;
        const reversing = !!(bits & 0x1);
        bits >>= 1;
        const b24_31 = bits >> 20;
        bits &= (1 << 20) - 1;
        const b4_23 = bits; // XXX no idea
        // saw a time like transition from bits above 24.
        return {
            b0_1,
            reversing,
            reverse,
            b4_23,
            b24_31,
        };
    }

    processFlags2(bits) {
        const b0_3 = bits & 0xF;  // Some of these represent using a powerup.
        // b0_3: 15 = has powerup? 0b1111 0 = using/used powerup
        bits >>= 4;
        const turning = {
            0: null,
            1: 'RIGHT',
            2: 'LEFT',
        }[bits & 0x3];
        if (turning === undefined) {
            console.error("Unexpected turning value:", bits & 0x3);
        }
        bits >>= 2;
        const overlapping = bits & 0x1;
        bits >>= 1;
        const roadId = bits & 0xFFFF;  // XXX good chance this actually owns the next 8 bits.
        bits >>= 16;
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
        this.states.set(state.id, state);
        if (!this._stats.has(state.id)) {
            this._stats.set(state.id, {
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
        const stats = this._stats.get(state.id);
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
        if (this.watching === state.id) {
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
            if (!this.watching) {
                await sleep(100);
                continue;
            }
            const watching = this.states.get(this.watching);
            if (watching) {
                console.debug("Athletes:", this.athletes.size, "States:", this.states.size);
                console.debug("Watching:", watching.id);
                const now = Date.now();
                const byRelLocation = [];
                for (const [id, x] of this.states.entries()) {
                    if (now - x.date > 10000) {
                        console.warn("Stale entry:", x);
                        this.states.delete(id);
                        continue;
                    }
                    if ((watching.groupId && x.groupId !== watching.groupId) ||
                        watching.reverse !== x.reverse ||
                        watching.roadId !== x.roadId) {
                        continue;
                    }
                    byRelLocation.push({
                        relDistance: distance(x, watching),
                        relRoadLocation: watching.roadLocation - x.roadLocation,
                        ...x,
                    });
                }
                if (watching.reverse) {
                    byRelLocation.sort((a, b) => a.relRoadLocation - b.relRoadLocation);
                } else {
                    byRelLocation.sort((a, b) => b.relRoadLocation - a.relRoadLocation);
                }
                const center = byRelLocation.findIndex(x => x.id === watching.id);
                const nearby = [];
                for (let i = Math.max(0, center - 8); i < Math.min(byRelLocation.length, center + 8); i++) {
                    const x = byRelLocation[i];
                    const timeGap = x.relDistance / ((watching.speed || x.speed || 1) * 1000 / 3600);  // XXX Pretty naive
                    const athlete = this.athletes.get(x.id);
                    const name = athlete && `${athlete.firstName[0]}.${athlete.lastName}`;
                    console.debug('Nearby:', i - center, x.id, 'flags...', x.flags1.toString(16), x.flags2.toString(16),
                        name, JSON.stringify(x));
                    nearby.push({
                        position: i - center, 
                        timeGap,
                        athlete,
                        ...x
                    });
                }
                this.emit('nearby', nearby);
            }
            await sleep(5000);
            await setAthleteCache(this.athletes);
        }
    }
}

let windowOfft = 0;
function makeFloatingWindow(page, options={}) {
    windowOfft += 100;
    const win = new BrowserWindow({
        width: 400,
        height: 300,
        transparent: true,
        //frame: false,
        titleBarStyle: 'customButtonsOnHover',  // best so far  dragging is possible but difficult with top bar and wrong cursor
        x: windowOfft,
        y: windowOfft,
        alwaysOnTop: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'pages', 'preload.js'),
        },
        ...options,
    });
    win.loadFile(path.join('pages', page));
    return win;
}


function createWindow(monitor) {
    const watchingWin = makeFloatingWindow('watching.html', {width: 250, height: 238, x: 14, y: 60});
    //const nearbyWin = makeFloatingWindow('nearby.html', {width: 240, height: 600, x: 980, y: 318});
    const nearbyWin = makeFloatingWindow('nearby.html', {width: 500, height: 400, x: 780, y: 418});

    //app.dock.hide();
    //win.setAlwaysOnTop(true, "floating", 1);
    //win.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
    //win.setFullScreenable(false);
    //win.maximize();
    
    function winMonProxy(event, win) {
        const cb = data => win.webContents.send('proxy', {event, source: 'sauce4zwift', data});
        monitor.on(event, cb);
        win.on('close', () => monitor.off(event, cb));
    }

    winMonProxy('nearby', nearbyWin);
    winMonProxy('watching', watchingWin);
}


app.on('window-all-closed', () => {
    app.quit();
});


async function main() {
    // interface is cap interface name (can be device name or IP address)
    const iface = await getPrimaryInterface();
    console.info('Monitoring zwift data from:', iface);
    const monitor = new Sauce4ZwiftMonitor(iface);
    await monitor.start();
    await app.whenReady();
    createWindow(monitor);
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(monitor);
        }
    });
}

main();
