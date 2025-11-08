import * as storageMod from './storage.mjs';
import * as rpc from './rpc.mjs';
import {globalShortcut} from 'electron';

let hotkeys;
const storageKey = 'hotkeys';
const availableActions = new Map();

export const supportedModifiers = [{
    id: 'CommandOrControl',
    label: 'Ctrl/Command(⌘)',
}, {
    id: 'Super',
    label: 'Super/Command(⌘)',
}, {
    id: 'Alt',
    label: 'Alt/Option(⌥)',
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


export function registerAction(action) {
    if (!action.id || !action.name || !action.callback) {
        throw new TypeError('Invalid hotkey action');
    }
    if (availableActions.has(action.id)) {
        throw new Error('Action already defined');
    }
    availableActions.set(action.id, action);
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
rpc.register(getHotkeyManifest);


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


export function initHotkeys() {
    if (hotkeys) {
        throw new Error("Already activated");
    }
    hotkeys = storageMod.get(storageKey) || [];
    for (const x of hotkeys) {
        try {
            validateHotkey(x);
        } catch(e) {
            console.warn("Bad hotkey configuration:", e.message);
            x.invalid = true;
        }
    }
    updateMapping();
}


export function getHotkeys() {
    if (!hotkeys) {
        initHotkeys();
    }
    return hotkeys;
}
rpc.register(getHotkeys);


export function createHotkey(entry) {
    validateHotkey(entry);
    if (!hotkeys) {
        initHotkeys();
    }
    if (hotkeys.some(x => x.keys.join() === entry.keys.join())) {
        throw new Error('Key combination already in-use');
    }
    const id = crypto.randomUUID();
    entry = {...entry, id};
    hotkeys.push(entry);
    storageMod.set(storageKey, hotkeys);
    updateMapping();
    return entry;
}
rpc.register(createHotkey);


export function removeHotkey(id) {
    if (!hotkeys) {
        initHotkeys();
    }
    const idx = hotkeys.findIndex(x => x.id === id);
    if (idx === -1) {
        console.warn("Hotkey not found:", id);
        return;
    }
    hotkeys.splice(idx, 1);
    storageMod.set(storageKey, hotkeys);
    updateMapping();
}
rpc.register(removeHotkey);


function updateMapping() {
    globalShortcut.unregisterAll();
    for (const x of hotkeys) {
        if (x.invalid || !x.global) {
            continue;
        }
        const accel = x.keys.join('+');
        const action = availableActions.get(x.action);
        globalShortcut.register(accel, async () => {
            console.debug("Hotkey pressed:", accel, '->', action.name);
            try {
                await action.callback();
            } catch(e) {
                console.error("Hotkey callback error:", e);
                throw e;
            }
        });
    }
}
