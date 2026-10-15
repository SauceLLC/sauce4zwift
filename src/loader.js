Error.stackTraceLimit = 15;

const OS = require('node:os');
const Path = require('node:path');
const FS = require('./fs-safe.js');
const Process = require('node:process');
const Package = require('../package.json');
const Logging = require('./logging.js');
const {app, dialog, nativeTheme, protocol} = require('electron');

let Sentry;
let settings = {};
let buildEnv = {};

try {
    buildEnv = JSON.parse(FS.readFileSync(Path.join(__dirname, '..', 'build.json')));
} catch(e) {
    console.error("Error loading 'build.json':", e);
}


function initSettings() {
    if (FS.existsSync(joinAppPath('userData', 'loader_settings.json'))) {
        try {
            settings = JSON.parse(FS.readFileSync(joinAppPath('userData', 'loader_settings.json')));
        } catch(e) {
            console.error("Error loading 'loader_settings.json':", e);
        }
    }
    settings.errorReporting ??= true;
}


function saveSettings(data) {
    FS.writeFileSync(joinAppPath('userData', 'loader_settings.json'), JSON.stringify(data));
}


function joinAppPath(subject, ...args) {
    return Path.join(app.getPath(subject), ...args);
}


async function ensureSingleInstance() {
    if (app.requestSingleInstanceLock({type: 'probe'})) {
        return;
    }
    if (Process.argv.length > 1 && Process.argv.at(-1).startsWith('sauce4zwift://')) {
        // Emulate mac style open-url eventing for url handling..
        const url = Process.argv.at(-1);
        console.info("Sending open-url data to primary Sauce instance:", url);
        app.requestSingleInstanceLock({type: 'open-url', url});
        app.quit();
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
        app.quit();
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
    app.exit(1);
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
    if (!settings.errorReporting || !buildEnv.sentry_dsn ||
        (!app.isPackaged && !Process.env.FORCE_ENABLE_SENTRY)) {
        return;
    }
    const [Sentry, Report] = await Promise.all([
        import('../deps/src/sentry.mjs'),
        import('../shared/report.mjs')
    ]);
    Report.setSentry(Sentry);
    let id = settings.sentryId;
    if (!id) {
        const crypto = require('node:crypto');
        id = Array.from(crypto.randomBytes(16)).map(x => String.fromCharCode(97 + (x % 26))).join('');
        settings.sentryId = id;
        saveSettings(settings);
    }
    Report.setSentryCommonConfig({
        dsn: buildEnv.sentry_dsn,
        release: `sauce4zwift@${Package.version}`,
        initialScope: {
            user: {id},
            tags: {
                git_commit: buildEnv.git_commit,
            }
        },
    });
    const skipIntegrations = new Set(['OnUncaughtException', 'Console']);
    Sentry.initWithoutDefaultIntegrations({
        ...Report.getSentryCommonConfig(),
        sampleRate: 0.5,
        maxBreadcrumbs: 200,
        normalizeDepth: 10,
        sendClientEvents: false,
        integrations: Sentry.getDefaultIntegrationsWithoutPerformance()
            .filter(x => !skipIntegrations.has(x.name)),
        beforeSend: Report.beforeSentrySend,
    });
    Process.on('uncaughtException', Report.errorThrottled);
    app.on('before-quit', () => {
        // Avoid side effects during quit..
        try {
            Sentry.flush();
        } catch(e) {
            console.error('Sentry flush problem:', e);
        }
    });
    logEmitter.on('message', ({message, level}) => {
        Sentry.addBreadcrumb({
            category: 'log',
            level: level === 'warn' ? 'warning' : level,
            message,
        });
    });
    return Sentry;
}


function earlyElectronInit() {
    // Routines that has to (or should) happen before the app "ready" state..
    initSettings();
    const logsPath = Path.join(app.getPath('documents'), 'Sauce', 'logs');
    app.setAppLogsPath(logsPath);
    const logMeta = Logging.initFileLogging(logsPath, app.isPackaged);
    nativeTheme.themeSource = 'dark';
    // Use non-electron naming for windows updater.
    // https://github.com/electron-userland/electron-builder/issues/2700
    app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows
    if (settings.gpuEnabled === undefined) {
        settings.gpuEnabled = settings.forceEnableGPU == null ?
            OS.platform() !== 'win32' : settings.forceEnableGPU;
        delete settings.forceEnableGPU;
    }
    if (!settings.gpuEnabled) {
        console.debug("Disable GPU Compositing");
        app.commandLine.appendSwitch('disable-gpu-compositing');
    }
    app.commandLine.appendSwitch('force-gpu-mem-available-mb', '1024');
    // Fix audio playback (retain stream priv)..
    protocol.registerSchemesAsPrivileged([{
        scheme: 'file',
        privileges: {stream: true}
    }]);
    return {logMeta};
}


async function startNormal() {
    const {logMeta} = earlyElectronInit();
    Sentry = await initSentry(logMeta.logEmitter);
    await app.whenReady();
    if (await ensureSingleInstance() === false) {
        return;
    }
    if (OS.platform() === 'darwin' && await checkMacOSInstall()) {
        return;
    }
    const main = await import('./main.mjs');
    try {
        await main.main({
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
    const fqMod = Path.join(__dirname, 'headless.mjs');
    const args = [fqMod].concat(Process.argv.slice(app?.isPackaged ? 1 : 2));
    // We have to proxy the --inspect arg so the parent process doesn't steal the inspect server
    for (const x of ['--inspect', '--inspect-brk', '--inspect-wait']) {
        if (args.indexOf(x) !== -1) {
            console.error(`\nCAUTION: ${x} used with headless mode.  Use ${x}-child instead\n`);
        }
        const inspectArg = args.indexOf(`${x}-child`);
        if (inspectArg !== -1) {
            args.splice(inspectArg, 1);
            args.unshift(x);  // must be first
        }
    }
    const {status} = require('node:child_process').spawnSync(Process.execPath, args, {
        windowsHide: false,
        stdio: 'inherit',
        env: {...Process.env, ELECTRON_RUN_AS_NODE: 1}
    });
    Process.exit(status);
}


if (Process.argv.includes('--headless')) {
    try {
        startHeadless();
    } catch(e) {
        console.error('Runtime error:', e.stack);
        Process.exit(1);
    }
} else {
    startNormal().catch(async e => {
        console.error('Runtime error:', e.stack);
        dialog.showErrorBox('Runtime error', e.stack);
        if (Sentry) {
            Sentry.captureException(e);
            await Sentry.flush();
        }
        app.exit(1);
    });
}
