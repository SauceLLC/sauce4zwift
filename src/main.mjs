import path from 'node:path';
import {fileURLToPath} from 'node:url';
import storage from './storage.mjs';
import menu from './menu.mjs';
import game from './game.mjs';
import webServer from './webserver.mjs';

const {app, BrowserWindow, ipcMain, nativeImage, dialog} = electron;

const wd = path.dirname(fileURLToPath(import.meta.url));
const appIcon = nativeImage.createFromPath(path.join(wd, 'build/images/app-icon.icos'));
const windows = new Map();


async function getWindowState(page) {
    const id = page.split('.')[0];
    return await storage.load(`window-${id}`);
}


async function setWindowState(page, data) {
    const id = page.split('.')[0];
    await storage.save(`window-${id}`, data);
}


async function clearWindowState(page) {
    const id = page.split('.')[0];
    await storage.save(`window-${id}`, {});
}


async function makeFloatingWindow(page, options={}) {
    const state = (await getWindowState(page)) || {};
    const win = new BrowserWindow({
        icon: appIcon,
        transparent: true,
        hasShadow: false,
        frame: false,
        roundedCorners: false,  // macos only, we use page style instead.
        alwaysOnTop: true,
        resizable: true,
        maximizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            enableRemoteModule: false,
            preload: path.join(wd, '../pages/preload.js'),
        },
        ...options,
        ...state,
    });
    const hasPosition = state.x != null && state.y != null && state.width && state.height;
    if (!hasPosition && (options.relWidth != null || options.relHeight != null ||
        options.relX != null || options.relY != null || options.x < 0 || options.y < 0)) {
        const {width: sWidth, height: sHeight} = electron.screen.getPrimaryDisplay().size;
        const width = options.width == null ? Math.round(options.relWidth * sWidth) : options.width;
        const height = options.height == null ? Math.round(options.relHeight * sHeight) : options.height;
        const x = options.x == null ? Math.round(options.relX * sWidth) :
            options.x < 0 ? sWidth + options.x - width : options.x;
        const y = options.y == null ? Math.round(options.relY * sHeight) :
            options.y < 0 ? sHeight + options.y - height : options.y;
        win.setSize(width, height);
        win.setPosition(x, y, false);
    }
    // Allow iframes to work for any site..
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: Object.fromEntries(Object.entries(details.responseHeaders)
                .filter(header => !/x-frame-options/i.test(header[0])))
        });
    });
    windows.set(win.webContents, {win, state, options});
    win.webContents.on('new-window', (ev, url) => {
        // Popups...
        ev.preventDefault();
        const newWin = new BrowserWindow({
            resizable: true,
            maximizable: true,
            fullscreenable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                enableRemoteModule: false,
            }
        });
        newWin.loadURL(url);
    });
    let saveStateTimeout;
    function onPositionUpdate() {
        Object.assign(state, win.getBounds());
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => setWindowState(page, state), 200);
    }
    async function onHide(ev) {
        state.hidden = true;
        await setWindowState(page, state);
    }
    async function onShow(ev) {
        state.hidden = false;
        await setWindowState(page, state);
    }
    function onWindowMessage(name, callback) {
        ipcMain.on(name, (ev, ...args) => {
            if (ev.sender === win.webContents) {
                callback(ev, ...args);
            }
        });
    }
    if (options.show !== false) {
        if (state.hidden) {
            win.minimize();
        } else {
            win.show();
        }
    }
    onWindowMessage('close', () => win.minimize());
    win.on('moved', onPositionUpdate);
    win.on('resized', onPositionUpdate);
    win.on('minimize', onHide);
    win.on('closed', onHide);
    win.on('restore', onShow);
    win.loadFile(path.join('pages', page));
    return win;
}


async function createWindows(monitor) {
    //await clearWindowState('overview.html'); // XXX TESTING
    //await clearWindowState('watching.html'); // XXX TESTING
    //await clearWindowState('groups.html'); // XXX TESTING
    //await clearWindowState('chat.html'); // XXX TESTING
    await Promise.all([
        makeFloatingWindow('watching.html',
            {width: 260, height: 260, x: 8, y: 64}),
        makeFloatingWindow('groups.html',
            {width: 235, height: 650, x: -280, y: -10}),
        makeFloatingWindow('chat.html',
            {width: 280, height: 580, x: 320, y: 230}),
        makeFloatingWindow('overview.html',
            {relWidth: 0.6, height: 40, relX: 0.2, y: 0, hideable: false}),
        makeFloatingWindow('nearby.html',
            {width: 800, height: 400, x: 20, y: 20}),
    ]);
}

if (app.dock) {
    app.dock.setIcon(appIcon);
}

app.on('window-all-closed', () => {
    app.exit(0);
});


async function main() {
    await app.whenReady();

    menu.setAppMenu();
    const monitor = await game.Sauce4ZwiftMonitor.factory();
    try {
        await monitor.start();
    } catch(e) {
        try {
            if (e.message.match(/permission denied/i)) {
                await game.getCapturePermission();
                await monitor.start();  // Try once more
            } else {
                debugger; // Find the error windows throws when pcap is needed.
                throw e;
            }
        } catch(e) {
            await dialog.showErrorBox('Startup Error', '' + e);
            app.exit(0);
            return;
        }
    }
    await webServer.start(monitor);
    ipcMain.on('subscribe', (ev, {event, domEvent}) => {
        const win = windows.get(ev.sender).win;
        const cb = data => win.webContents.send('browser-message', {domEvent, data});
        const enableEvents = ['responsive', 'show'];
        const disableEvents = ['unresponsive', 'hide', 'close'];
        function enable() {
            console.debug("Enable subscription:", event, domEvent);
            monitor.on(event, cb);
        }
        function disable() {
            console.debug("Disable subscription:", event, domEvent);
            monitor.off(event, cb);
        }
        function shutdown() {
            console.debug("Shutdown subscription:", event, domEvent);
            monitor.off(event, cb);
            for (const x of enableEvents) {
                win.off(x, enable);
            }
            for (const x of disableEvents) {
                win.off(x, disable);
            }
        }
        if (win.isVisible()) {
            enable();
        }
        win.webContents.once('destroyed', shutdown);
        win.webContents.once('did-start-loading', shutdown);
        for (const x of enableEvents) {
            win.on(x, enable);
        }
        for (const x of disableEvents) {
            win.on(x, disable);
        }
    });
    ipcMain.on('hideAllWindows', ev => {
        for (const {win, state, options} of windows.values()) {
            if (options.hideable !== false && !state.hidden) {
                win.hide();
            }
        }
    });
    ipcMain.on('showAllWindows', ev => {
        for (const {win, state, options} of windows.values()) {
            if (options.hideable !== false && !state.hidden) {
                win.show();
            }
        }
    });
    ipcMain.on('quit', ev => app.exit(0));

    await createWindows(monitor);
    app.on('activate', async () => {
        // Clicking on the app icon..
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindows(monitor);
        }
    });
}

main();
