import Process from 'node:process';
import OS from 'node:os';
import Path from 'node:path';
import ChildProcess from 'node:child_process';
import Events from 'node:events';
import FS from './fs-safe.js';
import * as Storage from './storage.mjs';
import * as RPC from './rpc.mjs';
import * as Zwift from './zwift.mjs';
import * as Mods from './mods.mjs';
import * as ArgParse from './argparse.mjs';
import * as App from './app.mjs';
import * as Logging from './logging.js';

Error.stackTraceLimit = 25;
Events.defaultMaxListeners = 100;

const isDEV = true;


function quit(retcode) {
    Process.exit(retcode);
}
RPC.register(quit);


function restart() {
    console.warn("CLI restart not supported: exiting...");
    quit();
}
RPC.register(restart);


RPC.register(() => isDEV, {name: 'isDEV'});
RPC.register(url => {
    const opener = {
        darwin: 'open',
        win32: 'explorer.exe',
        linux: 'xdg-open'
    }[Process.platform];
    ChildProcess.execSync(`${opener} ${url}`, {windowsHide: true});
}, {name: 'openExternalLink'});
RPC.register(key => undefined, {name: 'getLoaderSetting'});
RPC.register(() => {}, {name: 'getLoaderSettings'});

// Stub out window related RPC handlers..
RPC.register(() => [], {name: 'getWidgetWindowSpecs'});
RPC.register(() => [], {name: 'getWidgetWindowManifests'});
RPC.register(() => [], {name: 'getProfiles'});


class NodeSauceApp extends App.SauceApp {
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
        const usage = Process.resourceUsage();
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
            pid: Process.pid,
            type: 'Node',
            cpu: {
                percentCPUUsage,
            },
            memory: {
                workingSetSize: Process.memoryUsage().rss / 1024
            }
        }];
    }
}


async function main() {
    const {logEmitter, logQueue} = Logging.initTTYLogging(isDEV);
    const appPath = Path.join(OS.homedir(), '.sauce4zwift');
    FS.mkdirSync(appPath, {recursive: true});
    Storage.initialize(appPath);
    const s = Date.now();
    const args = ArgParse.parseArgs([
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
    RPC.register(() => null, {name: 'getSentryAnonId'});
    RPC.register(() => null, {name: 'getSentryDSN'});
    const exclusions = await App.getExclusions(appPath);
    const zwiftAPI = new Zwift.ZwiftAPI({exclusions});
    const zwiftMonitorAPI = new Zwift.ZwiftAPI({exclusions});
    await Promise.all([
        zwiftAPI.authenticate(args.mainUsername, args.mainPassword),
        zwiftMonitorAPI.authenticate(args.monitorUsername, args.monitorPassword),
    ]);
    await Mods.initialize(Path.join(OS.homedir(), 'Documents', 'SauceMods'), Path.join(appPath, 'mods'));
    const sauceApp = new NodeSauceApp({appPath});
    sauceApp.rpcEventEmitters.set('logs', logEmitter);
    sauceApp.rpcEventEmitters.set('mods', Mods.eventEmitter);
    sauceApp.rpcEventEmitters.set('windows', new Events.EventEmitter());
    RPC.register(() => logQueue, {name: 'getLogs'});
    RPC.register(() => logQueue.length = 0, {name: 'clearLogs'});
    RPC.register(() => () => console.warn("File logging disabled for headless mode"),
                 {name: 'showLogInFolder'});
    await sauceApp.start({...args, exclusions, zwiftAPI, zwiftMonitorAPI});
    console.debug(`Startup took ${Date.now() - s}ms`);
}
main();
