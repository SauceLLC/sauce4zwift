import process from 'node:process';
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import * as report from '../shared/report.mjs';
import * as storage from './storage.mjs';
import * as rpc from './rpc.mjs';
import {databases} from './db.mjs';
import * as webServer from './webserver.mjs';
import {StatsProcessor} from './stats.mjs';
import {createRequire} from 'node:module';
import * as zwift from './zwift.mjs';
import * as mods from './mods.mjs';
import {parseArgs} from './argparse.mjs';
import protobuf from 'protobufjs';
import fetch from 'node-fetch';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const isDEV = true;
const rpcSources = {};

let zwiftAPI;
let zwiftMonitorAPI;
let sauceApp;

export let started;
export let quiting;


export class Exiting extends Error {}


export function getApp() {
    return sauceApp;
}


function userDataPath(...args) {
    return path.join(os.homedir(), '.sauce4zwift', ...args);
}


function quit(retcode) {
    quiting = true;
    process.exit(retcode);
}
rpc.register(quit);


function restart() {
    console.warn("CLI restart not supported: exiting...");
    quit();
}
rpc.register(restart);


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


rpc.register(() => isDEV, {name: 'isDEV'});
rpc.register(() => pkg.version, {name: 'getVersion'});
rpc.register(url => {
    const opener = {
        darwin: 'open',
        win32: 'explorer.exe',
        linux: 'xdg-open'
    }[process.platform];
    childProcess.execSync(`${opener} ${url}`, {windowsHide: true});
}, {name: 'openExternalLink'});
rpc.register(() => sauceApp && sauceApp.webServerURL, {name: 'getWebServerURL'});
rpc.register(() => {
    return {
        main: {
            username: zwiftAPI.username,
            id: zwiftAPI.profile ? zwiftAPI.profile.id : null,
            authenticated: zwiftAPI.isAuthenticated(),
        },
        monitor: {
            username: zwiftMonitorAPI.username,
            id: zwiftMonitorAPI.profile ? zwiftMonitorAPI.profile.id : null,
            authenticated: zwiftMonitorAPI.isAuthenticated(),
        },
    };
}, {name: 'getZwiftLoginInfo'});


function registerRPCMethods(instance, ...methodNames) {
    for (const name of methodNames) {
        if (!instance[name]) {
            throw new TypeError('Invalid method name: ' + name);
        }
        rpc.register(instance[name].bind(instance), {name});
    }
}


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


class SauceApp extends EventEmitter {
    _settings;
    _settingsKey = 'app-settings';
    _metricsPromise;
    _lastMetricsTS = 0;

    constructor() {
        super();
        const _this = this;
        rpc.register(function() {
            _this._resetStorageState.call(_this, /*sender*/ this);
        }, {name: 'resetStorageState'});
        registerRPCMethods(this, 'getSetting', 'setSetting', 'pollMetrics', 'getDebugInfo',
                           'getGameConnectionStatus');
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
            resolve({}); // XXX TBD
        }, 2000 - (Date.now() - this._lastMetricsTS)));
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
                version: pkg.version,
                uptime: process.uptime(),
                mem: process.memoryUsage(),
                cpu: process.cpuUsage(),
                cwd: process.cwd(),
            },
            gpu: {},
            sys: {
                arch: process.arch,
                platform: os.platform(),
                release: os.release(),
                version: os.version(),
                productVersion: process.getSystemVersion(),
                mem: process.getSystemMemoryInfo(),
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
        };
    }

    startGameConnectionServer(ip) {
        const gcs = new zwift.GameConnectionServer({ip, zwiftAPI});
        registerRPCMethods(gcs, 'watch', 'join', 'teleportHome', 'say', 'wave', 'elbow',
                           'takePicture', 'powerup', 'changeCamera', 'enableHUD', 'disableHUD', 'chatMessage',
                           'reverse', 'toggleGraphs', 'sendCommands', 'turnLeft', 'turnRight', 'goStraight');
        gcs.start().catch(report.error);
        return gcs;
    }

    _resetStorageState(sender) {
        console.warn('Reseting state and quiting...');
        storage.reset();
        quit();
    }

    getGameConnectionStatus() {
        return this.gameConnection && this.gameConnection.getStatus();
    }

    async start(args) {
        if (isDEV || args.debugGameFields) {
            debugMissingProtobufFields();
        }
        const gameMonitor = this.gameMonitor = new zwift.GameMonitor({
            zwiftMonitorAPI,
            gameAthleteId: args.athleteId || zwiftAPI.profile.id,
            randomWatch: args.randomWatch,
            exclusions: args.exclusions,
        });
        gameMonitor.on('multiple-logins', () => {
            console.error('Multiple Logins Detected');
            console.error(
                'Your Monitor Zwift Login is being used by more than 1 application. ' +
                'This is usually an indicator that your Monitor Login is not the correct one.');
        });
        let ip;
        let gameConnection;
        if (this.getSetting('gameConnectionEnabled') && !args.disableGameConnection) {
            ip = ip || await getLocalRoutedIP();
            gameConnection = this.startGameConnectionServer(ip);
            // This isn't required but reduces latency..
            gameConnection.on('watch-command', id => gameMonitor.setWatching(id));
            this.gameConnection = gameConnection; // debug
        }
        rpcSources.gameConnection = gameConnection || new EventEmitter();
        this.statsProc = new StatsProcessor({
            app: this,
            userDataPath: userDataPath(),
            zwiftAPI,
            gameMonitor,
            gameConnection,
            args
        });
        this.statsProc.start();
        rpcSources.stats = this.statsProc;
        rpcSources.app = this;
        ip = ip || await getLocalRoutedIP();
        this.webServerEnabled = true;
        this.webServerPort = this.getSetting('webServerPort', 1080);
        this.webServerURL = `http://${ip}:${this.webServerPort}`;
        // Will stall when there is a port conflict..
        webServer.start({
            ip,
            port: this.webServerPort,
            rpcSources,
            statsProc: this.statsProc,
        }).catch(report.error);
    }
}


async function updateExclusions() {
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
    await fs.promises.writeFile(userDataPath('exclusions_cached.json'), JSON.stringify(data));
    return data;
}


async function getExclusions() {
    // use the local cache copy if possible and update in the bg.
    let data;
    try {
        data = JSON.parse(fs.readFileSync(userDataPath('exclusions_cached.json')));
    } catch(e) {/*no-pragma*/}
    const updating = updateExclusions();
    if (!data) {
        console.info("Waiting for network fetch of exclusions...");
        data = await updating;
    }
    return data && new Set(data.map(x => x.idhash));
}


async function main() {
    fs.mkdirSync(userDataPath(), {recursive: true});
    storage.initialize(userDataPath());
    const s = Date.now();
    const args = parseArgs([
        {arg: 'main-username', label: 'USERNAME', required: true, env: 'MAIN_USERNAME',
         help: 'The main Zwift username (email)'},
        {arg: 'main-password', label: 'PASSWORD', required: true, env: 'MAIN_PASSWORD',
         help: 'The main Zwift password'},
        {arg: 'monitor-username', label: 'USERNAME', required: true, env: 'MON_USERNAME',
         help: 'The monitor Zwift username (email)'},
        {arg: 'monitor-password', label: 'PASSWORD', required: true, env: 'MON_PASSWORD',
         help: 'The monitor Zwift password'},
        {arg: 'athlete-id', type: 'num', label: 'ATHLETE_ID',
         help: 'Override the athlete ID for the main Zwift account'},
        {arg: 'random-watch', type: 'num', optional: true, label: 'COURSE_ID',
         help: 'Watch random athlete; optionally specify a Course ID to choose the athlete from'},
        {arg: 'disable-game-connection', type: 'switch',
         help: 'Disable the companion protocol service'},
        {arg: 'debug-game-fields', type: 'switch',
         help: 'Include otherwise hidden fields from game data'},
    ]);
    if (!args || args.help) {
        quit();
        return;
    }
    rpc.register(() => null, {name: 'getSentryAnonId'});
    rpc.register(() => null, {name: 'getSentryDSN'});
    sauceApp = new SauceApp();
    const exclusions = await getExclusions();
    zwiftAPI = new zwift.ZwiftAPI({exclusions});
    zwiftMonitorAPI = new zwift.ZwiftAPI({exclusions});
    await Promise.all([
        zwiftAPI.authenticate(args.mainUsername, args.mainPassword),
        zwiftMonitorAPI.authenticate(args.monitorUsername, args.monitorPassword),
    ]);
    mods.init(path.join(os.homedir(), 'Documents', 'SauceMods'));
    await sauceApp.start({...args, exclusions});
    console.debug(`Startup took ${Date.now() - s}ms`);
    started = true;
}
main();
