import process from 'node:process';
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import * as report from '../shared/report.mjs';
import * as storage from './storage.mjs';
import * as rpc from './rpc.mjs';
import {databases} from './db.mjs';
import * as webServer from './webserver.mjs';
import {StatsProcessor} from './stats.mjs';
import {createRequire} from 'node:module';
import * as zwift from './zwift.mjs';
import protobuf from 'protobufjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');


async function getLocalRoutedIP() {
    const conn = net.createConnection(80, 'www.zwift.com');
    return await new Promise((resolve, reject) => {
        conn.on('connect', () => {
            try {
                resolve(conn.address().address);
            } finally {
                conn.end();
            }
        });
        conn.on('error', reject);
    });
}


let _debuggingProtobufFields;
function debugMissingProtobufFields() {
    if (_debuggingProtobufFields) {
        return;
    }
    console.debug('Missing protobuf field detection enabled');
    _debuggingProtobufFields = true;
    const pb_Reader_skip = protobuf.Reader.prototype.skip;
    protobuf.Reader.prototype.skip = function(length) {
        const start = this.pos;
        const r = pb_Reader_skip.apply(this, arguments);
        const end = this.pos;
        console.error("Protobuf missing field:", this, start, end,
                      this.buf.subarray(start, end).toString('hex'));
        console.info(this.buf.subarray(0, this.len).toString('hex'));
        return r;
    };
}


export class SauceApp extends EventEmitter {
    _settings;
    _settingsKey = 'app-settings';
    _metricsPromise;
    _lastMetricsTS = 0;

    constructor({appPath, buildEnv={}}) {
        super();
        this.rpcEventEmitters = new Map();
        this.appPath = appPath;
        this.buildEnv = buildEnv;
        this.zwiftAPI = undefined;
        this.zwiftMonitorAPI = undefined;
        const _this = this;
        rpc.register(function() {
            _this.resetStorageState.call(_this, /*sender*/ this);
        }, {name: 'resetStorageState'});
        const rpcs = ['getSetting', 'setSetting', 'pollMetrics', 'getDebugInfo',
            'getGameConnectionStatus', 'getWebServerURL', 'getVersion', 'getZwiftLoginInfo'];
        for (const x of rpcs) {
            rpc.register(this[x].bind(this), {name: x});
        }
    }

    getWebServerURL() {
        return this.webServerURL;
    }

    getVersion() {
        return pkg.version;
    }

    getZwiftLoginInfo() {
        return {
            main: this.zwiftAPI ? {
                username: this.zwiftAPI.username,
                id: this.zwiftAPI.profile ? this.zwiftAPI.profile.id : null,
                authenticated: this.zwiftAPI.isAuthenticated(),
            } : null,
            monitor: this.zwiftMonitorAPI ? {
                username: this.zwiftMonitorAPI.username,
                id: this.zwiftMonitorAPI.profile ? this.zwiftMonitorAPI.profile.id : null,
                authenticated: this.zwiftMonitorAPI.isAuthenticated(),
            } : null,
        };
    }

    getSetting(key, def) {
        if (!this._settings) {
            this._settings = storage.get(this._settingsKey) || {};
        }
        if (!Object.prototype.hasOwnProperty.call(this._settings, key) && def !== undefined) {
            this._settings[key] = def;
            storage.set(this._settingsKey, this._settings);
        }
        return this._settings[key];
    }

    setSetting(key, value) {
        if (!this._settings) {
            this._settings = storage.get(this._settingsKey) || {};
        }
        this._settings[key] = value;
        storage.set(this._settingsKey, this._settings);
        this.emit('setting-change', {key, value});
    }

    _getMetrics(reentrant) {
        return new Promise(resolve => setTimeout(() => {
            if (reentrant !== true) {
                // Schedule one more in anticipation of pollers
                this._metricsPromise = this._getMetrics(true);
            } else {
                this._metricsPromise = null;
            }
            this._lastMetricsTS = Date.now();
            resolve(this.getAppMetrics());
        }, 2000 - (Date.now() - this._lastMetricsTS)));
    }

    getAppMetrics() {
        console.warn("UNIMPLEMENTED");
        return [];
    }

    async pollMetrics() {
        if (!this._metricsPromise) {
            this._metricsPromise = this._getMetrics();
        }
        return await this._metricsPromise;
    }

    getDebugInfo() {
        return {
            app: {
                version: this.getVersion(),
                uptime: process.uptime(),
                mem: process.memoryUsage(),
                cpu: process.cpuUsage(),
                cwd: process.cwd(),
            },
            sys: {
                arch: process.arch,
                platform: os.platform(),
                release: os.release(),
                version: os.version(),
                productVersion: (process.getSystemVersion ? process.getSystemVersion() : os.release())
                    . split(/-/, 1)[0],
                mem: {
                    total: os.totalmem() / 1024,
                    free: os.freemem() / 1024,
                },
                uptime: os.uptime(),
                cpus: os.cpus(),
            },
            stats: this.statsProc.getDebugInfo(),
            databases: [].concat(...Array.from(databases.entries()).map(([dbName, db]) => {
                const stats = db.prepare('SELECT * FROM sqlite_schema WHERE type = ? AND name NOT LIKE ?')
                    .all('table', 'sqlite_%');
                return stats.map(t => ({
                    dbName,
                    tableName: t.name,
                    rows: db.prepare(`SELECT COUNT(*) as rows FROM ${t.name}`).get().rows,
                }));
            })),
            zwift: this.gameMonitor?.getDebugInfo(),
        };
    }

    startGameConnectionServer(ip) {
        const gcs = new zwift.GameConnectionServer({ip, zwiftAPI: this.zwiftAPI});
        const rpcs = ['watch', 'join', 'teleportHome', 'say', 'wave', 'elbow',
            'takePicture', 'powerup', 'changeCamera', 'enableHUD', 'disableHUD', 'chatMessage',
            'reverse', 'toggleGraphs', 'sendCommands', 'turnLeft', 'turnRight', 'goStraight'];
        for (const x of rpcs) {
            rpc.register(gcs[x].bind(gcs), {name: x});
        }
        gcs.start().catch(report.error);
        return gcs;
    }

    resetStorageState(sender) {
        storage.reset();
    }

    getGameConnectionStatus() {
        return this.gameConnection && this.gameConnection.getStatus();
    }

    async start(options) {
        if (options.debugGameFields) {
            debugMissingProtobufFields();
        }
        if (options.zwiftMonitorAPI) {
            this.zwiftMonitorAPI = options.zwiftMonitorAPI;
        }
        if (options.zwiftAPI) {
            this.zwiftAPI = options.zwiftAPI;
        }
        this.gameMonitor = !options.disableMonitor ? new zwift.GameMonitor({
            zwiftMonitorAPI: this.zwiftMonitorAPI,
            gameAthleteId: options.athleteId || this.zwiftAPI.profile.id,
            randomWatch: options.randomWatch,
            exclusions: options.exclusions,
        }) : undefined;
        let ip;
        let gameConnection;
        if (this.getSetting('gameConnectionEnabled') && !options.disableGameConnection) {
            ip = ip || await getLocalRoutedIP();
            gameConnection = this.startGameConnectionServer(ip);
            // This isn't required but reduces latency..
            gameConnection.on('watch-command', id => this.gameMonitor?.setWatching(id));
            this.gameConnection = gameConnection; // debug
        }
        this.rpcEventEmitters.set('gameConnection', gameConnection || new EventEmitter());
        this.statsProc = new StatsProcessor({
            app: this,
            userDataPath: this.appPath,
            zwiftAPI: this.zwiftAPI,
            gameMonitor: this.gameMonitor,
            gameConnection,
            ...options,
        });
        this.statsProc.start();
        this.rpcEventEmitters.set('stats', this.statsProc);
        this.rpcEventEmitters.set('app', this);
        if (this.getSetting('webServerEnabled', true)) {
            ip = ip || await getLocalRoutedIP();
            this.webServerEnabled = true;
            this.webServerPort = this.getSetting('webServerPort', 1080);
            this.webServerURL = `http://${ip}:${this.webServerPort}`;
            // Will stall when there is a port conflict..
            webServer.start({
                ip,
                port: this.webServerPort,
                rpcEventEmitters: this.rpcEventEmitters,
                statsProc: this.statsProc,
            }).catch(report.error);
        }
    }
}


async function updateExclusions(fname) {
    let data;
    try {
        const r = await fetch('https://www.sauce.llc/products/sauce4zwift/exclusions.json');
        data = await r.json();
    } catch(e) {
        report.error(e);
    }
    if (!data) {
        console.warn("No exclusions list found");
        return;
    }
    await fs.promises.writeFile(fname, JSON.stringify(data));
    return data;
}


export async function getExclusions(appPath) {
    // use the local cache copy if possible and update in the bg.
    const fname = path.join(appPath, 'exclusions_cached.json');
    let data;
    try {
        data = JSON.parse(fs.readFileSync(fname));
    } catch(e) {/*no-pragma*/}
    const updating = updateExclusions(fname);
    if (!data) {
        console.info("Waiting for network fetch of exclusions...");
        data = await updating;
    }
    return data && new Set(data.map(x => x.idhash));
}
