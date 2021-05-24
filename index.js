const {app, BrowserWindow, ipcMain} = require('electron');
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

    processState(state) {
        state.heading = headingConv(state.heading);
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
            if (state.cadenceUHz != null) {
                stats.cadenceSum += state.cadenceUHz / 1000000 * 60 * duration;
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
            const byRelPos = [];
            const athlete = this.athletes.get(this.watching);
            const state = this.states.get(this.watching);
            if (state) {
                console.debug("Athletes:", this.athletes.size, "States:", this.states.size);
                console.debug("Watching:", state.id);
                const statePos = state.roadTime * ((state.flags1 & state.$type.getEnum('Flags1').REVERSE) ? -1 : 1);
                const now = Date.now();
                for (const [id, x] of this.states.entries()) {
                    if (now - x.date > 10000) {
                        console.warn("Stale entry:", x);
                        this.states.delete(id);
                        continue;
                    }
                    if (state.groupId && x.groupId !== state.groupId) {
                        continue;
                    }
                    const dist = distance(x, state);
                    const reverse = (x.flags1 & state.$type.getEnum('Flags1').REVERSE) ? -1 : 1;
                    byRelPos.push({dist, relPos: statePos - (x.roadTime * reverse), state: x});
                }
                byRelPos.sort((a, b) => b.relPos - a.relPos);
                const center = byRelPos.findIndex(x => x.state.id === this.watching);
                const nearby = [];
                for (let i = Math.max(0, center - 8); i < Math.min(byRelPos.length, center + 8); i++) {
                    const x = byRelPos[i];
                    const timeGap = x.dist / (state.speed / 1000 / 3600);
                    const athlete = this.athletes.get(x.state.id);
                    const name = athlete && `${athlete.firstName[0]}.${athlete.lastName}`;
                    console.debug('Nearby:', i - center, Math.round(x.dist), 'm', (x.state.speed / 1000000).toFixed(1), 'kph',
                        'timegap:', Math.round(timeGap), 'relPos:', x.relPos, 'flags...', x.state.flags1.toString(16),
                        x.state.flags2.toString(16), 'name:', name, headingConv(x.state.heading).toFixed(1));
                    nearby.push({
                        position: i - center, 
                        relDistance: x.dist,
                        speed: x.state.speed / 1000000,
                        timeGap,
                        name,
                        roadTime: x.roadTime,
                    });
                }
                this.emit('nearby', nearby);
            }
            await sleep(2000);
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
    const nearbyWin = makeFloatingWindow('nearby.html', {width: 240, height: 600, x: 980, y: 318});

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
