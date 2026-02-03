import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import events from 'node:events';
import fs from './fs-safe.js';
import * as storage from './storage.mjs';
import * as rpc from './rpc.mjs';
import * as zwift from './zwift.mjs';
import * as mods from './mods.mjs';
import {parseArgs} from './argparse.mjs';
import * as app from './app.mjs';
import * as logging from './logging.js';

Error.stackTraceLimit = 25;
events.defaultMaxListeners = 100;

const isDEV = true;


function quit(retcode) {
    process.exit(retcode);
}
rpc.register(quit);


function restart() {
    console.warn("CLI restart not supported: exiting...");
    quit();
}
rpc.register(restart);


rpc.register(() => isDEV, {name: 'isDEV'});
rpc.register(url => {
    const opener = {
        darwin: 'open',
        win32: 'explorer.exe',
        linux: 'xdg-open'
    }[process.platform];
    childProcess.execSync(`${opener} ${url}`, {windowsHide: true});
}, {name: 'openExternalLink'});

// Stub out window related RPC handlers..
rpc.register(() => [], {name: 'getWidgetWindowSpecs'});
rpc.register(() => [], {name: 'getWidgetWindowManifests'});
rpc.register(() => [], {name: 'getProfiles'});


class NodeSauceApp extends app.SauceApp {
    resetStorageState(sender) {
        console.warn('Reseting state and quitting...');
        super.resetStorageState();
        quit();
    }

    async start(args) {
        await super.start(args);
        this.gameMonitor.on('multiple-logins', () => {
            console.error('Multiple Logins Detected');
            console.error(
                'Your Monitor Zwift Login is being used by more than 1 application. ' +
                'This is usually an indicator that your Monitor Login is not the correct one.');
        });
    }

    getAppMetrics() {
        const usage = process.resourceUsage();
        let percentCPUUsage;
        const ts = Date.now();
        if (this._lastUsage) {
            const elapsed = ts - this._lastUsageTS;
            percentCPUUsage = ((usage.userCPUTime + usage.systemCPUTime) -
                               (this._lastUsage.userCPUTime + this._lastUsage.systemCPUTime)) /
                              elapsed / 1000;
        }
        this._lastUsageTS = ts;
        this._lastUsage = usage;
        return [{
            pid: process.pid,
            type: 'Node',
            cpu: {
                percentCPUUsage,
            },
            memory: {
                workingSetSize: process.memoryUsage().rss / 1024
            }
        }];
    }
}


async function main() {
    const {logEmitter, logQueue} = logging.initTTYLogging(isDEV);
    const appPath = path.join(os.homedir(), '.sauce4zwift');
    fs.mkdirSync(appPath, {recursive: true});
    storage.initialize(appPath);
    const s = Date.now();
    const args = parseArgs([
        // Do not remove headless arg.  It's informational here but handled by loader.mjs
        {arg: 'headless', type: 'switch',
         help: 'Run in headless mode.  NOTE: All settings for headless mode are separate from normal mode.'},
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
        {arg: 'debug-game-fields', type: 'switch', default: isDEV,
         help: 'Include otherwise hidden fields from game data'},
    ]);
    if (!args || args.help) {
        quit(!args ? 1 : 0);
        return;
    }
    rpc.register(() => null, {name: 'getSentryAnonId'});
    rpc.register(() => null, {name: 'getSentryDSN'});
    const exclusions = await app.getExclusions(appPath);
    const zwiftAPI = new zwift.ZwiftAPI({exclusions});
    const zwiftMonitorAPI = new zwift.ZwiftAPI({exclusions});
    await Promise.all([
        zwiftAPI.authenticate(args.mainUsername, args.mainPassword),
        zwiftMonitorAPI.authenticate(args.monitorUsername, args.monitorPassword),
    ]);
    await mods.initialize(path.join(os.homedir(), 'Documents', 'SauceMods'), path.join(appPath, 'mods'));
    const sauceApp = new NodeSauceApp({appPath});
    sauceApp.rpcEventEmitters.set('logs', logEmitter);
    sauceApp.rpcEventEmitters.set('mods', mods.eventEmitter);
    sauceApp.rpcEventEmitters.set('windows', new events.EventEmitter());
    rpc.register(() => logQueue, {name: 'getLogs'});
    rpc.register(() => logQueue.length = 0, {name: 'clearLogs'});
    rpc.register(() => () => console.warn("File logging disabled for headless mode"),
                 {name: 'showLogInFolder'});
    await sauceApp.start({...args, exclusions, zwiftAPI, zwiftMonitorAPI});
    console.debug(`Startup took ${Date.now() - s}ms`);
}
main();
