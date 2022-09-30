import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import * as windows from './windows.mjs';
import {fileURLToPath} from 'node:url';
import {getApp} from './main.mjs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Menu, app, shell, nativeImage, Tray} = require('electron');
const pkg = require('../package.json');

const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let tray;

const template = [{
    label: 'Edit',
    submenu: [
        {role: 'undo'},
        {role: 'redo'},
        {type: 'separator'},
        {role: 'cut'},
        {role: 'copy'},
        {role: 'paste'},
    ]
}, {
    label: 'View',
    submenu: [
        {role: 'reload'},
        {type: 'separator'},
        {role: 'resetZoom'},
        {role: 'zoomIn', accelerator: 'CommandOrControl+='},
        {role: 'zoomOut'},
        {type: 'separator'},
        {role: 'toggleDevTools'},
        {
            // Universal F12 for me.
            role: 'toggleDevTools',
            accelerator: 'F12',
            visible: false,
            acceleratorWorksWhenHidden: true,
        }
    ],
}, {
    label: 'Window',
    submenu: [
        {role: 'minimize'},
        {role: 'zoom'},
        {role: 'close'},
    ]
}, {
    label: 'Help',
    submenu: [{
        label: 'Sauce Home Page',
        click: () => shell.openExternal('https://saucellc.io/')
    }]
}];

if (process.platform === 'darwin') {
    const name = app.getName();
    template.unshift({
        label: name,
        submenu: [
            {role: 'about'},
            {type: 'separator'},
            {role: 'hide'},
            {role: 'hideOthers'},
            {role: 'unhide'},
            {type: 'separator'},
            {role: 'quit'},
        ]
    });
}


export function setAppMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


export function installTrayIcon() {
    const iconFile = os.platform() === 'darwin' ? 'mac-trayicon.png' : 'win-trayicon.png';
    tray = new Tray(nativeImage.createFromPath(path.join(appPath, 'images', iconFile)));
    if (process.platform === 'win32') {
        tray.on('click', ev => void tray.popUpContextMenu());
    }
    tray.setToolTip(pkg.productName);
}


export function updateTrayMenu() {
    const pad = '  ';
    const wins = Object.values(windows.getWindows());
    const activeWins = wins.filter(x => x.private !== true && x.closed !== true);
    const closedWins = wins.filter(x => x.private !== true && x.closed === true);
    const menu = [{
        label: `${pkg.productName} v${pkg.version}`,
        click: windows.welcomeSplash
    }, {
        type: 'separator',
    }];
    if (activeWins.length) {
        menu.push(
            {type: 'separator'},
            {label: 'Active Windows', enabled: false},
            ...activeWins.map(x => ({
                label: pad + x.prettyName,
                tooltip: x.prettyDesc,
                click: () => windows.highlightWindow(x.id),
            }))
        );
    }
    if (closedWins.length) {
        menu.push(
            {type: 'separator'},
            {label: 'Closed Windows', enabled: false},
            ...closedWins.map(x => ({
                label: pad + x.prettyName,
                tooltip: x.prettyDesc,
                click: () => windows.openWindow(x.id),
            }))
        );
    }
    const sauceApp = getApp();
    if (sauceApp.webServerURL) {
        menu.push({
            type: 'separator',
        }, {
            label: `Web: ${sauceApp.webServerURL}`,
            click: () => shell.openExternal(sauceApp.webServerURL),
        });
    }
    menu.push({
        type: 'separator',
    }, {
        label: 'Settings',
        click: () => {
            const win = windows.makeCaptiveWindow({
                width: 500,
                height: 0.8,
                page: 'overview-settings.html',
                frame: false
            });
            // Bit of a hack to get the preload context setup so overview settings function
            const id = Object.values(windows.getWindows()).find(x => x.type === 'overview').id;
            windows.subWindows.set(win.webContents, {win, spec: {id, type: 'overview'}, activeSubs: new Set()});
        },
    }, {
        label: '',
        enabled: false,
    }, {
        label: 'Quit',
        role: 'quit',
    });
    tray.setContextMenu(Menu.buildFromTemplate(menu));
}
