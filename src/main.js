/* global __dirname */

const path = require('path');
const storage = require('./storage');
const menu = require('./menu');
const game = require('./game');
const {app, BrowserWindow, ipcMain, nativeImage, dialog} = require('electron');

const appIcon = nativeImage.createFromPath(path.join(__dirname, 'build/images/app-icon.icos'));
const windows = new Map();


if (Array.prototype.at) {
    console.warn("Node supports Array.at now, remove this.");
} else {
    Array.prototype.at = function(i) {
        return i < 0 ? this[this.length + i] : this[i];
    };
}


async function getWindowState(page) {
    const id = page.split('.')[0];
    return await storage.load(`window-${id}`);
}


async function setWindowState(page, data) {
    const id = page.split('.')[0];
    await storage.save(`window-${id}`, data);
}


async function makeFloatingWindow(page, options={}) {
    const savedState = (await getWindowState(page)) || {};
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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, '../pages/preload.js'),
        },
        ...options,
        ...savedState,
    });
    windows.set(win.webContents, win);
    let saveStateTimeout;
    function onPositionUpdate() {
        Object.assign(savedState, win.getBounds());
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => setWindowState(page, savedState), 400);
    }
    async function onHide(ev) {
        savedState.hidden = true;
        await setWindowState(page, savedState);
    }
    async function onShow(ev) {
        savedState.hidden = false;
        await setWindowState(page, savedState);
    }
    function onWindowMessage(name, callback) {
        ipcMain.on(name, (ev, ...args) => {
            if (ev.sender === win.webContents) {
                callback(ev, ...args);
            }
        });
    }
    onWindowMessage('close', () => win.hide());
    win.on('moved', onPositionUpdate);
    win.on('resized', onPositionUpdate);
    win.on('minimize', onHide);
    win.on('closed', onHide);
    win.on('restore', onShow);
    if (savedState.hidden) {
        win.minimize();  // TODO: make restoration UX so we can just skip load.
    }
    win.loadFile(path.join('pages', page));
    return win;
}


async function createWindows(monitor) {
    await Promise.all([
        makeFloatingWindow('watching.html', {width: 260, height: 260, x: 8, y: 54}),
        makeFloatingWindow('groups.html', {width: 235, height: 650, x: 960, y: 418}),
        makeFloatingWindow('chat.html', {width: 280, height: 580, x: 280, y: 230}),
    ]);
}

if (app.dock) {
    app.dock.setIcon(appIcon);
}

app.on('window-all-closed', () => {
    app.quit();
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
            app.quit();
            return;
        }
    }
    ipcMain.on('subscribe', (ev, {event, domEvent}) => {
        const win = windows.get(ev.sender);
        const cb = data => win.webContents.send('browser-message', {domEvent, data});
        const enableEvents = ['responsive', 'show', 'restore'];
        const disableEvents = ['unresponsive', 'hide', 'minimize', 'close'];
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
        enable('init');
        win.webContents.once('destroyed', shutdown);
        win.webContents.once('did-start-loading', shutdown);
        for (const x of enableEvents) {
            win.on(x, enable);
        }
        for (const x of disableEvents) {
            win.on(x, disable);
        }
    });
    await createWindows(monitor);
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindows(monitor);
        }
    });
}

main();
