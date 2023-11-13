Error.stackTraceLimit = 25;

console.info('Starting...');

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const process = require('node:process');
const crypto = require('node:crypto');
const pkg = require('../package.json');
const {EventEmitter} = require('node:events');
const {app, dialog, nativeTheme} = require('electron');
const Sentry = require('@sentry/node');

const logFileName = 'sauce.log';


let settings = {};
if (fs.existsSync(joinAppPath('userData', 'loader_settings.json'))) {
    try {
        settings = JSON.parse(fs.readFileSync(joinAppPath('userData', 'loader_settings.json')));
    } catch(e) {
        console.error("Error loading 'loader_settings.json':", e);
    }
}
let buildEnv = {};
try {
    buildEnv = JSON.parse(fs.readFileSync('build.json'));
} catch(e) {
    console.error("Error loading 'build.json':", e);
}


function saveSettings(data) {
    fs.writeFileSync(joinAppPath('userData', 'loader_settings.json'), JSON.stringify(data));
}


function joinAppPath(subject, ...args) {
    return path.join(app.getPath(subject), ...args);
}


function fmtLogDate(d) {
    const h = d.getHours().toString();
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}


function rotateLogFiles(limit=5) {
    const logs = fs.readdirSync(joinAppPath('logs')).filter(x => x.startsWith(logFileName));
    logs.sort((a, b) => a < b ? 1 : -1);
    while (logs.length > limit) {
        // NOTE: this is only for if we change the limit to a lower number
        // in a subsequent release.
        const fName = logs.shift();
        console.warn("Delete old log file:", fName);
        fs.unlinkSync(joinAppPath('logs', fName));
    }
    let end = Math.min(logs.length, limit - 1);
    for (const fName of logs.slice(-(limit - 1))) {
        const newFName = `${logFileName}.${end--}`;
        if (newFName === fName) {
            continue;
        }
        fs.renameSync(joinAppPath('logs', fName), joinAppPath('logs', newFName));
    }
}


function getConsoleSymbol(name) {
    /*
     * The symbols of functions in the console module are somehow not in the
     * global registry.  So we need to use this hack to get the real symbols
     * for monkey patching.
     */
    const symString = Symbol.for(name).toString();
    return Object.getOwnPropertySymbols(console).filter(x =>
        x.toString() === symString)[0];
}


function monkeyPatchConsoleWithEmitter() {
    /*
     * This is highly Node specific but it maintains console logging,
     * devtools logging with correct file:lineno references, and allows
     * us to support file logging and logging windows.
     */
    let curLogLevel;
    const descriptors = Object.getOwnPropertyDescriptors(console);
    const levels = {
        debug: 'debug',
        info: 'info',
        log: 'info',
        count: 'info',
        dir: 'info',
        warn: 'warn',
        assert: 'warn',
        error: 'error',
        trace: 'error',
    };
    for (const [fn, level] of Object.entries(levels)) {
        Object.defineProperty(console, fn, {
            enumerable: descriptors[fn].enumerable,
            get: () => (curLogLevel = level, descriptors[fn].value),
            set: () => {
                throw new Error("Double console monkey patch detected!");
            },
        });
    }
    const kWriteToConsoleSymbol = getConsoleSymbol('kWriteToConsole');
    const kWriteToConsoleFunction = console[kWriteToConsoleSymbol];
    const emitter = new EventEmitter();
    let seqno = 1;
    console[kWriteToConsoleSymbol] = function(useStdErr, message) {
        try {
            return kWriteToConsoleFunction.call(this, useStdErr, message);
        } finally {
            const o = {};
            const saveTraceLimit = Error.stackTraceLimit;
            Error.stackTraceLimit = 3;
            Error.captureStackTrace(o);
            Error.stackTraceLimit = saveTraceLimit;
            const stack = o.stack;
            const fileMatch = stack.match(/([^/\\: (]+:[0-9]+):[0-9]+\)?$/);
            emitter.emit('message', {
                seqno: seqno++,
                date: new Date(),
                level: curLogLevel,
                message,
                file: fileMatch ? fileMatch[1] : null,
            });
        }
    };
    return emitter;
}


function initLogging() {
    const logsPath = path.join(app.getPath('documents'), 'Sauce', 'logs');
    app.setAppLogsPath(logsPath);
    let rotateErr;
    try {
        rotateLogFiles();
    } catch(e) {
        // Probably windows with anti virus. :/
        rotateErr = e;
    }
    process.env.TERM = 'dumb';  // Prevent color tty commands
    const logEmitter = monkeyPatchConsoleWithEmitter();
    const logFile = joinAppPath('logs', logFileName);
    const logQueue = [];
    const logFileStream = fs.createWriteStream(logFile);
    logEmitter.on('message', o => {
        logQueue.push(o);
        const time = fmtLogDate(o.date);
        const level = `[${o.level.toUpperCase()}]`;
        logFileStream.write(`${time} ${level} (${o.file}): ${o.message}\n`);
        if (logQueue.length > 2000) {
            logQueue.shift();
        }
    });
    console.dev = app.isPackaged ? () => undefined : console.debug;
    console.devDebug = app.isPackaged ? () => undefined : console.debug;
    console.devInfo = app.isPackaged ? () => undefined : console.info;
    console.devWarn = app.isPackaged ? () => undefined : console.warn;
    console.devError = app.isPackaged ? () => undefined : console.error;
    if (rotateErr) {
        console.error('Log rotate error:', rotateErr);
    }
    console.info("Sauce log file:", logFile);
    return {logEmitter, logQueue, logFile};
}


async function ensureSingleInstance() {
    if (app.requestSingleInstanceLock({type: 'probe'})) {
        return;
    }
    const {response} = await dialog.showMessageBox({
        type: 'question',
        message: 'Another Sauce process detected.\n\nThere can only be one, you must choose...',
        buttons: ['Oops, quit here', 'Replace the other process'],
        noLink: true,
    });
    if (response === 0) {
        console.debug("User quiting due to existing instance");
        app.quit(0);
        return false;
    }
    let hasLock = app.requestSingleInstanceLock({type: 'quit'});
    for (let i = 0; i < 10; i++) {
        if (hasLock) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        hasLock = app.requestSingleInstanceLock({type: 'quit'});
    }
    await dialog.showErrorBox(
        'Existing Sauce process hung',
        'Consider using Activity Monitor (mac) or Task Manager (windows) to find ' +
        'and stop any existing Sauce processes');
    app.quit(1);
    return false;
}


async function checkMacOSInstall() {
    if (!app.isPackaged ||
        app.isInApplicationsFolder() ||
        settings.isIgnoringImproperInstall) {
        return;
    }
    const {response, checkboxChecked} = await dialog.showMessageBox({
        type: 'question',
        message: 'Sauce for Zwift needs to be located in the /Applications folder.\n\n' +
            'Would your like to move it there now?',
        buttons: ['No, I\'m a rebel', 'Yes, thank you'],
        checkboxLabel: 'Don\'t ask again',
        checkboxChecked: false,
        defaultId: 1,
    });
    if (response === 0) {
        console.warn("User opted out of moving app to the Applications folder");
        if (checkboxChecked) {
            settings.isIgnoringImproperInstall = true;
            saveSettings(settings);
        }
    } else {
        try {
            console.warn("Moving Sauce to /Applications...");
            if (!app.moveToApplicationsFolder()) {
                console.error("Sauce was NOT moved into the applications folder");
            } else {
                console.error("Sauce WAS moved into the applications folder");
                return true;
            }
        } catch(e) {
            console.error('Move failed', e);
            await dialog.showErrorBox('Move to Applications folder failed', '' + e);
        }
    }
}


async function initSentry(logEmitter) {
    if (!app.isPackaged || !buildEnv.sentry_dsn) {
        console.info("Sentry disabled: non production build");
        return;
    }
    const report = await import('../shared/report.mjs');
    report.setSentry(Sentry);
    const skipIntegrations = new Set(['OnUncaughtException', 'Console']);
    Sentry.init({
        dsn: buildEnv.sentry_dsn,
        // Sentry changes the uncaught exc behavior to exit the process.  I think it may
        // be fixed in newer versions though.
        integrations: data => data.filter(x => !skipIntegrations.has(x.name)),
        beforeSend: report.beforeSentrySend,
    });
    process.on('uncaughtException', report.errorThrottled);
    Sentry.setTag('version', pkg.version);
    Sentry.setTag('git_commit', buildEnv.git_commit);
    let id = settings.sentryId;
    if (!id) {
        id = Array.from(crypto.randomBytes(16)).map(x => String.fromCharCode(97 + (x % 26))).join('');
        settings.sentryId = id;
        saveSettings(settings);
    }
    Sentry.setUser({id});
    app.on('before-quit', () => Sentry.flush());
    logEmitter.on('message', ({message, level}) => {
        Sentry.addBreadcrumb({
            category: 'log',
            level: level === 'warn' ? 'warning' : level,
            message,
        });
    });
    return id;
}


(async () => {
    const logMeta = initLogging();
    nativeTheme.themeSource = 'dark';
    // If we are foreced to update to 114+ we'll have to switch our scrollbars to this...
    //app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');
    if (settings.gpuEnabled === undefined) {
        settings.gpuEnabled = settings.forceEnableGPU == null ?
            os.platform() !== 'win32' : settings.forceEnableGPU;
        delete settings.forceEnableGPU;
    }
    if (!settings.gpuEnabled) {
        console.debug("Disable GPU Compositing");
        app.commandLine.appendSwitch('disable-gpu-compositing');
    }
    app.commandLine.appendSwitch('force-gpu-mem-available-mb', '1024');
    // Use non-electron naming for windows updater.
    // https://github.com/electron-userland/electron-builder/issues/2700
    app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows
    console.error('XXX Able to register protocol handler:', app.setAsDefaultProtocolClient('sauce4zwift'));
    const sentryAnonId = await initSentry(logMeta.logEmitter);
    await app.whenReady();
    if (await ensureSingleInstance() === false) {
        return;
    }
    if (os.platform() === 'darwin' && await checkMacOSInstall()) {
        return;
    }
    const main = await import('./main.mjs');
    await main.main({
        sentryAnonId,
        ...logMeta,
        loaderSettings: settings,
        saveLoaderSettings: saveSettings,
        buildEnv
    });
})().catch(async e => {
    console.error('Startup Error:', e.stack);
    await dialog.showErrorBox('Sauce Startup Error', e.stack);
    app.exit(1);
});
