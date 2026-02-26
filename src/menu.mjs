import Process from 'node:process';
import OS from 'node:os';
import Path from 'node:path';
import * as Windows from './windows.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Menu, shell, nativeImage, Tray, BaseWindow} = require('electron');
const Package = require('../package.json');

const appPath = Path.join(Path.dirname(fileURLToPath(import.meta.url)), '..');

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

if (Process.platform === 'darwin') {
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
    const iconFile = OS.platform() === 'darwin' ? 'mac-trayicon.png' : 'win-trayicon.png';
    tray = new Tray(nativeImage.createFromPath(Path.join(appPath, 'images', iconFile)));
    if (Process.platform === 'win32') {
        tray.on('click', ev => void tray.popUpContextMenu());
    }
    tray.setToolTip(Package.productName);
}


let _webServerURL;
export function setWebServerURL(url) {
    _webServerURL = url;
}


export function updateTrayMenu() {
    const pad = '  ';
    const wins = Windows.getWidgetWindowSpecs();
    const activeWins = wins.filter(x => x.private !== true && x.closed !== true);
    const closedWins = wins.filter(x => x.private !== true && x.closed === true);
    const menu = [{
        label: `${Package.productName} v${Package.version}`,
        click: Windows.welcomeSplash
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
                click: () => Windows.highlightWidgetWindow(x.id),
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
                click: () => Windows.openWidgetWindow(x.id),
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
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'logs', id: 'debug-logs-tray-menu'})
    }, {
        label: 'Stats for Nerds',
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'stats-for-nerds', id: 'stats-tray-menu'})
    }, {
        type: 'separator',
    }, {
        label: 'Analysis',
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'analysis', id: 'analysis-tray-menu'})
    }, {
        label: 'Athletes',
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'athletes', id: 'athletes-tray-menu'})
    }, {
        label: 'Events',
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'events', id: 'events-tray-menu'})
    }, {
        label: 'Your Profile',
        click: () => Windows.makeOrFocusEphemeralWindow({type: 'profile', id: 'profile-tray-menu'})
    });
    menu.push({
        type: 'separator',
    }, {
        label: 'Settings',
        click: () => Windows.openSettingsWindow(),
    }, {
        type: 'separator',
    }, {
        label: 'Quit',
        role: 'quit',
    });
    tray.setContextMenu(Menu.buildFromTemplate(menu));
}
