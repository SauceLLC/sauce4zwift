import Process from 'node:process';
import OS from 'node:os';
import Net from 'node:net';
import FS from 'node:fs';
import Path from 'node:path';
import {EventEmitter} from 'node:events';
import * as Report from '../shared/report.mjs';
import * as Storage from './storage.mjs';
import * as RPC from './rpc.mjs';
import * as DB from './db.mjs';
import * as webServer from './webserver.mjs';
import {StatsProcessor} from './stats.mjs';
import {createRequire} from 'node:module';
import * as Zwift from './zwift.mjs';
import Protobuf from 'protobufjs';
import * as Env from './env.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');


async function getLocalRoutedIP() {
    const conn = Net.createConnection(80, 'www.zwift.com');
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
    const pb_Reader_skip = Protobuf.Reader.prototype.skip;
    Protobuf.Reader.prototype.skip = function(length) {
        const start = this.pos;
        const r = pb_Reader_skip.apply(this, arguments);
        const end = this.pos;
        console.error("Protobuf missing field:", this, start, end,
                      this.buf.subarray(start, end).toString('hex'));
        console.info(this.buf.subarray(0, this.len).toString('hex'));
        return r;
    };
}


function entropy(str) {
    const indexes = new Map();
    const counts = [];
    for (let i = 0; i < str.length; i++) {
        const k = str[i];
        let idx = indexes.get(k);
        if (idx === undefined) {
            idx = counts.length;
            counts[idx] = 1;
            indexes.set(k, idx);
        } else {
            counts[idx]++;
        }
    }
    let entropy = 0;
    const mf = 1 / str.length;
    for (let i = 0; i < counts.length; i++) {
        const p = counts[i] * mf;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}


export class SauceApp extends EventEmitter {
    _settings;
    _settingsKey = 'app-settings';
    _metricsPromise;
    _lastMetricsTS = 0;

    constructor({appPath, buildEnv={}}) {
        super();
        this.rpcEventEmitters = new RPC.RPCEventEmitters();
        this.appPath = appPath;
        this.buildEnv = buildEnv;
        this.zwiftAPI = undefined;
        this.zwiftMonitorAPI = undefined;
        const _this = this;
        RPC.register(function() {
            _this.resetStorageState.call(_this, /*sender*/ this);
        }, {name: 'resetStorageState'});
        const rpcs = ['getSetting', 'setSetting', 'pollMetrics', 'getDebugInfo',
            'getGameConnectionStatus', 'getWebServerURL', 'getVersion', 'getZwiftLoginInfo'];
        for (const x of rpcs) {
            RPC.register(this[x].bind(this), {name: x});
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
            this._settings = Storage.get(this._settingsKey) || {};
        }
        if (!Object.prototype.hasOwnProperty.call(this._settings, key) && def !== undefined) {
            this._settings[key] = def;
            Storage.set(this._settingsKey, this._settings);
        }
        return this._settings[key];
    }

    setSetting(key, value) {
        if (!this._settings) {
            this._settings = Storage.get(this._settingsKey) || {};
        }
        this._settings[key] = value;
        Storage.set(this._settingsKey, this._settings);
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
                uptime: Process.uptime(),
                mem: Process.memoryUsage(),
                cpu: Process.cpuUsage(),
                cwd: Process.cwd(),
            },
            sys: {
                arch: Process.arch,
                platform: OS.platform(),
                release: OS.release(),
                version: OS.version(),
                productVersion: (Process.getSystemVersion ? Process.getSystemVersion() : OS.release())
                    . split(/-/, 1)[0],
                mem: {
                    total: OS.totalmem() / 1024,
                    free: OS.freemem() / 1024,
                },
                uptime: OS.uptime(),
                cpus: OS.cpus(),
            },
            stats: this.statsProc.getDebugInfo(),
            databases: [].concat(...Array.from(DB.databases.entries()).map(([dbName, db]) => {
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
        const gcs = new Zwift.GameConnectionServer({ip, zwiftAPI: this.zwiftAPI});
        const rpcs = ['watch', 'join', 'teleportHome', 'say', 'wave', 'elbow',
            'takePicture', 'powerup', 'changeCamera', 'enableHUD', 'disableHUD', 'chatMessage',
            'reverse', 'toggleGraphs', 'sendCommands', 'turnLeft', 'turnRight', 'goStraight'];
        for (const x of rpcs) {
            RPC.register(gcs[x].bind(gcs), {name: x});
        }
        gcs.start().catch(Report.error);
        return gcs;
    }

    resetStorageState(sender) {
        Storage.reset();
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
        this.gameMonitor = !options.disableMonitor ? new Zwift.GameMonitor({
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
        const statsRPCMethods = [
            'getPowerZones', 'updateAthlete', 'startLap', 'resetStats', 'exportFIT', 'getAthlete',
            'getAthletes', 'getFollowingAthletes', 'getFollowerAthletes', 'getMarkedAthletes',
            'searchAthletes', 'getCachedEvent', 'getCachedEvents', 'getEvent', 'getEventSubgroup',
            'getEventSubgroupEntrants', 'getEventSubgroupResults', 'addEventSubgroupSignup',
            'deleteEventSignup', 'loadOlderEvents', 'loadNewerEvents', 'resetAthletesDB',
            'getChatHistory', 'setFollowing', 'setNotFollowing', 'giveRideon', 'getPowerProfile',
            'getPlayerState', 'getNearbyData', 'getGroupsData', 'getAthleteData', 'getAthletesData',
            'updateAthleteData', 'getAthleteLaps', 'getAthleteSegments', 'getAthleteEvents',
            'getAthleteStreams', 'getSegmentResults', 'putState', 'fileReplayLoad', 'fileReplayPlay',
            'fileReplayStop', 'fileReplayRewind', 'fileReplayForward', 'fileReplayStatus',
            'getIRLMapTile', 'getWorkouts', 'getWorkout', 'getWorkoutCollection',
            'getWorkoutCollections', 'getWorkoutSchedule', 'getZwiftConnectionInfo', 'reconnectZwift',
            'toggleMarkedAthlete', 'removeFollower',
            'getAthleteStats' /* DEPRECATED */, 'updateAthleteStats' /* DEPRECATED */,
            'getQueue' /* XXX ambiguous name */
        ];
        for (const x of statsRPCMethods) {
            const method = this.statsProc[x];
            if (!method || typeof method !== 'function') {
                console.error('Missing StatsProcessor method:', x);
                throw new Error("Internal Error");
            }
            RPC.register(method, {scope: this.statsProc});
        }
        const envRPCMethods = [
            'getWorldMetas', 'getCourseId', 'getRoad', 'getCourseRoads', 'getRoute', 'getCourseRoutes',
            'getSegment', 'getCourseSegments'
        ];
        for (const x of envRPCMethods) {
            const fn = Env[x];
            if (!fn || typeof fn !== 'function') {
                console.error('Missing env module function:', x);
                throw new Error("Internal Error");
            }
            RPC.register(fn);
        }
        RPC.register(courseId => {
            console.warn("DEPRECATED: use `getCourseRoads`");
            return Env.getCourseRoads(courseId);
        }, {name: 'getRoads'});
        RPC.register(ids => {
            if (typeof ids === 'number') {
                console.warn("DEPRECATED: use `getCourseRoutes`");
                return Env.getCourseRoutes(ids);
            }
            return Env.getRoutes(ids);
        }, {name: 'getRoutes'});
        RPC.register(ids => {
            if (typeof ids === 'number') {
                console.warn("DEPRECATED: use `getCourseSegments`");
                return Env.getCourseSegments(ids);
            }
            return Env.getSegments(ids);
        }, {name: 'getSegments'});
        RPC.register((courseId, roadId, reverse=false) => {
            if (courseId == null || roadId == null) {
                throw new TypeError('courseId and roadId required');
            }
            return Env.getCourseSegments(courseId).filter(x => x.roadId === roadId &&
                                                               !!x.reverse === !!reverse);
        }, {name: 'getSegmentsForRoad'});
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
            }).catch(Report.error);
        }
    }
}


export async function getExclusions(appPath) {
    let data;
    try {
        const r = await fetch('https://www.sauce.llc/products/sauce4zwift/exclusions.json');
        data = await r.json();
    } catch(e) {
        Report.error(e);
    }
    const cacheFileName = Path.join(appPath, 'exclusions_cached.json');
    if (!data || !data.length) {
        console.warn("Using cached exclusions");
        data = JSON.parse(FS.readFileSync(cacheFileName));
    } else {
        await FS.promises.writeFile(cacheFileName, JSON.stringify(data));
    }
    if (!data || !data.length || !data.every(x => entropy(x.idhash) > 3)) {
        throw new Error("tampering detected");
    }
    return new Set(data.map(x => x.idhash));
}
