Error.stackTraceLimit = 25;

const os = require('node:os');
const path = require('node:path');
const fs = require('./fs-safe.js');
const process = require('node:process');
const pkg = require('../package.json');
const logging = require('./logging.js');
const {app, dialog, nativeTheme, protocol} = require('electron');

let settings = {};
let buildEnv = {};

try {
    buildEnv = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build.json')));
} catch(e) {
    console.error("Error loading 'build.json':", e);
}


function initSettings() {
    if (fs.existsSync(joinAppPath('userData', 'loader_settings.json'))) {
        try {
            settings = JSON.parse(fs.readFileSync(joinAppPath('userData', 'loader_settings.json')));
        } catch(e) {
            console.error("Error loading 'loader_settings.json':", e);
        }
    }
}


function saveSettings(data) {
    fs.writeFileSync(joinAppPath('userData', 'loader_settings.json'), JSON.stringify(data));
}


function joinAppPath(subject, ...args) {
    return path.join(app.getPath(subject), ...args);
}


async function ensureSingleInstance() {
    if (app.requestSingleInstanceLock({type: 'probe'})) {
        return;
    }
    if (process.argv.length > 1 && process.argv.at(-1).startsWith('sauce4zwift://')) {
        // Emulate mac style open-url eventing for url handling..
        const url = process.argv.at(-1);
        console.info("Sending open-url data to primary Sauce instance:", url);
        app.requestSingleInstanceLock({type: 'open-url', url});
        app.quit(0);
        return false;
    }
    const {response} = await dialog.showMessageBox({
        type: 'question',
        message: 'Another Sauce process detected.\n\nThere can only be one, you must choose...',
        buttons: ['Oops, quit here', 'Replace the other process'],
        noLink: true,
    });
    if (response === 0) {
        console.debug("User quitting due to existing instance");
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
        return;
    }
    const Sentry = require('@sentry/node');
    const report = await import('../shared/report.mjs');
    report.setSentry(Sentry);
    const skipIntegrations = new Set(['OnUncaughtException', 'Console']);
    Sentry.init({
        dsn: buildEnv.sentry_dsn,
        // Sentry changes the uncaught exc behavior to exit the process.  I think it may
        // be fixed in newer versions though.
        integrations: data => data.filter(x => !skipIntegrations.has(x.name)),
        beforeSend: report.beforeSentrySend,
        sampleRate: 0.1,
    });
    process.on('uncaughtException', report.errorThrottled);
    Sentry.setTag('version', pkg.version);
    Sentry.setTag('git_commit', buildEnv.git_commit);
    // Leave some state for our beforeSendFilter that can customize reported events. (see report.mjs)
    Sentry._sauceSpecialState = {
        startClock: Date.now(),
        startTimer: performance.now(),
    };
    let id = settings.sentryId;
    if (!id) {
        const crypto = require('node:crypto');
        id = Array.from(crypto.randomBytes(16)).map(x => String.fromCharCode(97 + (x % 26))).join('');
        settings.sentryId = id;
        saveSettings(settings);
    }
    Sentry.setUser({id});
    Sentry.setContext('os', {
        machine: os.machine(),
        platform: os.platform(),
        release: os.release(),
    });
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


async function startNormal() {
    initSettings();
    const logsPath = path.join(app.getPath('documents'), 'Sauce', 'logs');
    app.setAppLogsPath(logsPath);
    const logMeta = logging.initFileLogging(logsPath, app.isPackaged);
    nativeTheme.themeSource = 'dark';
    // Use non-electron naming for windows updater.
    // https://github.com/electron-userland/electron-builder/issues/2700
    app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows

    // If we are forced to update to 114+ we'll have to switch our scrollbars to this...
    // EDIT 2024-02  Maybe not, but it could look nicer in places where we will now require
    // a visible scrollbar on windows and linux.  Last I looked it was kind of buggy though
    // so we have to retest everything before using.
    // EDIT 2024-03  We have reworked to support normal scrollbars but this still might look
    // better.
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
    // Not working yet, but maybe with upcoming chromium (when we can upgrade). XXX
    //app.commandLine.appendSwitch('throttle-main-thread-to-60hz'); // XXX
    // Fix audio playback of all things...
    // By calling protocol.handle on file: we reset it's privs.
    protocol.registerSchemesAsPrivileged([{
        scheme: 'file',
        privileges: {stream: true}
    }]);
    const sentryAnonId = await initSentry(logMeta.logEmitter);
    await app.whenReady();
    if (await ensureSingleInstance() === false) {
        return;
    }
    if (os.platform() === 'darwin' && await checkMacOSInstall()) {
        return;
    }
    const main = await import('./main.mjs');
    try {
        await main.main({
            sentryAnonId,
            ...logMeta,
            loaderSettings: settings,
            saveLoaderSettings: saveSettings,
            buildEnv
        });
    } catch(e) {
        if (!(e instanceof main.Exiting)) {
            throw e;
        }
    }
}


function startHeadless() {
    // NOTE: Node doesn't expose posix-like exec() or fork() calls, so read the docs before
    // inferring anything related to child_process handling.
    const fqMod = path.join(__dirname, 'headless.mjs');
    const args = [fqMod].concat(process.argv.slice(app?.isPackaged ? 1 : 2));
    if (args.indexOf('--inspect') !== -1) {
        console.error("--inspect arg should not be used for headless mode.  Use --inspect-child intead");
    }
    // We have to proxy the --inspect arg so the parent process doesn't steal the inspect server
    const inspectArg = args.indexOf('--inspect-child');
    if (inspectArg !== -1) {
        args.splice(inspectArg, 1);
        args.unshift('--inspect'); // must be first
    }
    const {status} = require('node:child_process').spawnSync(process.execPath, args, {
        windowsHide: false,
        stdio: 'inherit',
        env: {...process.env, ELECTRON_RUN_AS_NODE: 1}
    });
    process.exit(status);
}


if (process.argv.includes('--headless')) {
    try {
        startHeadless();
    } catch(e) {
        console.error('Runtime error:', e.stack);
        process.exit(1);
    }
} else {
    startNormal().catch(async e => {
        console.error('Runtime error:', e.stack);
        await dialog.showErrorBox('Runtime error', e.stack);
        app.exit(1);
    });
}
