import * as Storage from './storage.mjs';
import * as RPC from './rpc.mjs';
import {updateAppMenuOnAllWindows} from './menu.mjs';
import {globalShortcut, dialog, Menu, MenuItem} from 'electron';

let hotkeys;
const storageKey = 'hotkeys';
const availableActions = new Map();
const isMac = process.platform === 'darwin';

export const supportedModifiers = [{
    id: 'CommandOrControl',
    label: isMac ? 'Command(⌘)' : 'Ctrl',
}, isMac ? {
    id: 'Control',
    label: 'Control',
} : {
    id: 'Super',
    label: 'Super',
}, {
    id: 'Alt',
    label: isMac ? 'Option(⌥)' : 'Alt',
}, {
    id: 'Shift',
    label: 'Shift',
    secondaryOnly: true,
}];

export const specialKeys = [
    {id: 'F1', match: /^F[1-9][0-9]?$/, help: 'F1...F12'},
    {id: 'Plus'},
    {id: 'Space'},
    {id: 'Tab'},
    {id: 'Capslock'},
    {id: 'Numlock'},
    {id: 'Scrolllock'},
    {id: 'Backspace'},
    {id: 'Delete'},
    {id: 'Insert'},
    {id: 'Enter'},
    {id: 'Up'},
    {id: 'Down'},
    {id: 'Left'},
    {id: 'Right'},
    {id: 'Home'},
    {id: 'End'},
    {id: 'PageUp'},
    {id: 'PageDown'},
    {id: 'Escape'},
    {id: 'VolumeUp'},
    {id: 'VolumeDown'},
    {id: 'VolumeMute'},
    {id: 'MediaNextTrack'},
    {id: 'MediaPreviousTrack'},
    {id: 'MediaStop'},
    {id: 'MediaPlayPause'},
    {id: 'PrintScreen'},
];


export function registerAction(action, options={}) {
    if (!action.id || !action.name || !action.callback) {
        throw new TypeError('Invalid hotkey action');
    }
    if (availableActions.has(action.id)) {
        throw new Error('Action already defined');
    }
    availableActions.set(action.id, action);
    if (hotkeys && !options.skipValidation) {
        validate();
    }
}


export function unregisterAction(id, options={}) {
    availableActions.delete(id);
    if (hotkeys && !options.skipValidation) {
        validate();
    }
}


function getHotkeyManifest() {
    return {
        actions: Array.from(availableActions.values()).map(x => ({
            id: x.id,
            name: x.name,
        })),
        supportedModifiers,
        specialKeys,
    };
}
RPC.register(getHotkeyManifest);


function validateHotkey(entry) {
    if (!entry) {
        throw new TypeError('Not an Object');
    }
    if (!entry.action) {
        throw new TypeError(`'action' key missing`);
    }
    if (!entry.keys) {
        throw new TypeError(`'keys' key missing`);
    }
    if (!availableActions.has(entry.action)) {
        throw new Error(`Invalid action: ${entry.action}`);
    }
    if (entry.keys.length < 2) {
        throw new Error('Key combination too short');
    }
    for (let i = 0; i < entry.keys.length - 1; i++) {
        const modifier = entry.keys[i];
        if (!supportedModifiers.filter(x => i || !x.secondaryOnly).some(x => x.id === modifier)) {
            console.error('Invalid hotkey modifier:', modifier, 'from:', entry.keys);
            throw new Error('Invalid Modifier');
        }
    }
    const opKey = entry.keys.at(-1);
    if (!specialKeys.some(x => x.match ? opKey.match(x.match) : x.id === opKey) && opKey.length > 1) {
        console.error('Invalid hotkey final key:', opKey);
        throw new Error('Invalid final key');
    }
}


export function validate() {
    if (!hotkeys) {
        return;
    }
    for (const x of hotkeys) {
        try {
            validateHotkey(x);
            x.invalid = false;
        } catch(e) {
            console.warn("Bad hotkey configuration:", e.message);
            x.invalid = true;
        }
    }
}


export function initialize() {
    if (hotkeys) {
        throw new Error("Already Initialized");
    }
    hotkeys = Storage.get(storageKey) || [];
    if (hotkeys.length) {
        validate();
        updateMapping();
    }
}


export function getHotkeys() {
    return hotkeys;
}
RPC.register(getHotkeys);


export function createHotkey(entry) {
    validateHotkey(entry);
    if (hotkeys.some(x => x.keys.join() === entry.keys.join())) {
        throw new Error('Key combination already in-use');
    }
    const id = crypto.randomUUID();
    entry = {...entry, id};
    hotkeys.push(entry);
    Storage.set(storageKey, hotkeys);
    updateMapping(this?.getOwnerBrowserWindow());
    return entry;
}
RPC.register(createHotkey);


export function removeHotkey(id) {
    const idx = hotkeys.findIndex(x => x.id === id);
    if (idx === -1) {
        console.warn("Hotkey not found:", id);
        return;
    }
    hotkeys.splice(idx, 1);
    Storage.set(storageKey, hotkeys);
    updateMapping(this?.getOwnerBrowserWindow());
}
RPC.register(removeHotkey);


function updateMapping(senderWindow) {
    globalShortcut.unregisterAll();
    let miHolder = Menu.getApplicationMenu().getMenuItemById('hotkeys');
    if (!miHolder) {
        const visible = isMac;  // required
        miHolder = new MenuItem({id: 'hotkeys', label: 'Hotkeys', visible, submenu: []});
        Menu.getApplicationMenu().append(miHolder);
    } else {
        miHolder.submenu.clear();
    }
    if (!hotkeys.length) {
        return;
    }
    for (const x of hotkeys) {
        if (x.invalid) {
            continue;
        }
        const action = availableActions.get(x.action);
        if (!action) {
            // Did we forget to call validateHotkey on a mutation?
            console.error("Missing action:", x.action);
            continue;
        }
        const accelerator = x.keys.join('+');
        const handler = async () => {
            console.debug("Hotkey pressed:", accelerator, '->', action.name);
            try {
                await action.callback();
            } catch(e) {
                console.error("Hotkey callback error:", e);
                throw e;
            }
        };
        if (x.global) {
            try {
                globalShortcut.register(accelerator, handler);
            } catch(e) {
                // some accelerator patterns are invalid will throw..
                dialog.showMessageBox(senderWindow, {
                    type: 'error',
                    title: 'Global Hotkey Error',
                    message: `Unable to register hotkey: ${accelerator}`,
                    detail: e.message
                });
            }
        } else {
            miHolder.submenu.append(new MenuItem({
                accelerator,
                click: handler,
                label: action.name
            }));
        }
    }
    if (isMac) {
        // Required to reflect updates..
        Menu.setApplicationMenu(Menu.getApplicationMenu());
    } else {
        // Linux and Windows clone the app menu only at startup, manually update them.
        updateAppMenuOnAllWindows();
    }
}
