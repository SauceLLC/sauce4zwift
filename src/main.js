/* global __dirname */

const path = require('path');
const state = require('./state');
const menu = require('./menu');
const game = require('./game');
const {app, BrowserWindow, nativeImage, dialog} = require('electron');

const appIcon = nativeImage.createFromPath(path.join(__dirname, 'build/images/app-icon.icos'));


async function getWindowState(page) {
    const id = page.split('.')[0];
    return await state.load(`window-${id}`);
}


async function setWindowState(page, data) {
    const id = page.split('.')[0];
    await state.save(`window-${id}`, data);
}


async function makeFloatingWindow(page, options={}) {
    const savedState = (await getWindowState(page)) || {};
    const win = new BrowserWindow({
        icon: appIcon,
        transparent: true,
        hasShadow: false,
        titleBarStyle: 'customButtonsOnHover',
        alwaysOnTop: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'pages', 'preload.js'),
        },
        ...options,
        ...savedState,
    });
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
    const watchingWin = await makeFloatingWindow('watching.html', {width: 250, height: 238, x: 14, y: 60});
    const nearbyWin = await makeFloatingWindow('nearby.html', {width: 500, height: 400, x: 780, y: 418});
    const groupsWin = await makeFloatingWindow('groups.html', {width: 500, height: 400, x: 270, y: 418});
    const chatWin = await makeFloatingWindow('chat.html', {width: 280, height: 580, x: 280, y: 230});

    function winMonProxy(event, win) {
        const cb = data => win.webContents.send('proxy', {event, source: 'sauce4zwift', data});
        monitor.on(event, cb);
        win.on('close', () => monitor.off(event, cb));
    }

    winMonProxy('watching', watchingWin);
    winMonProxy('nearby', nearbyWin);
    winMonProxy('groups', groupsWin);
    winMonProxy('chat', chatWin);
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
        if (e.message.match(/permission denied/i)) {
            await game.getCapturePermission();
            await monitor.start();  // Try once more
        } else {
            await dialog.showErrorBox('Error trying monitor game traffic', '' + e);
            throw e;
        }
        await game.getCapturePermission();
        await monitor.start();  // Try once more
    }
    await createWindows(monitor);
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindows(monitor);
        }
    });
}

main();
