import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import * as windows from './windows.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Menu, shell, nativeImage, Tray, BaseWindow} = require('electron');
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
        click: () => shell.openExternal('https://www.sauce.llc')
    }]
}];

if (process.platform === 'darwin') {
    template.unshift({role: 'appMenu'});
}


export function setAppMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


export function updateAppMenuOnAllWindows() {
    const menu = Menu.getApplicationMenu();
    for (const x of BaseWindow.getAllWindows()) {
        x.setMenu(menu);
    }
}


export function installTrayIcon() {
    const iconFile = os.platform() === 'darwin' ? 'mac-trayicon.png' : 'win-trayicon.png';
    tray = new Tray(nativeImage.createFromPath(path.join(appPath, 'images', iconFile)));
    if (process.platform === 'win32') {
        tray.on('click', ev => void tray.popUpContextMenu());
    }
    tray.setToolTip(pkg.productName);
}


let _webServerURL;
export function setWebServerURL(url) {
    _webServerURL = url;
}


export function updateTrayMenu() {
    const pad = '  ';
    const wins = windows.getWidgetWindowSpecs();
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
                click: () => windows.highlightWidgetWindow(x.id),
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
                click: () => windows.openWidgetWindow(x.id),
            }))
        );
    }
    if (_webServerURL) {
        menu.push({
            type: 'separator',
        }, {
            label: `Web: ${_webServerURL}`,
            click: () => shell.openExternal(_webServerURL),
        });
    }
    menu.push({
        label: 'Debug Logs',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'logs', id: 'debug-logs-tray-menu'})
    }, {
        label: 'Stats for Nerds',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'stats-for-nerds', id: 'stats-tray-menu'})
    }, {
        type: 'separator',
    }, {
        label: 'Analysis',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'analysis', id: 'analysis-tray-menu'})
    }, {
        label: 'Athletes',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'athletes', id: 'athletes-tray-menu'})
    }, {
        label: 'Events',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'events', id: 'events-tray-menu'})
    }, {
        label: 'Your Profile',
        click: () => windows.makeOrFocusEphemeralWindow({type: 'profile', id: 'profile-tray-menu'})
    });
    menu.push({
        type: 'separator',
    }, {
        label: 'Settings',
        click: () => windows.openSettingsWindow(),
    }, {
        type: 'separator',
    }, {
        label: 'Quit',
        role: 'quit',
    });
    tray.setContextMenu(Menu.buildFromTemplate(menu));
}
