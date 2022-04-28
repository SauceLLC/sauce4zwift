import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app, ipcMain} = require('electron');

export const handlers = new Map();


function errorReply(e) {
    console.warn("RPC error:", e);
    return {
        success: false,
        error: {
            name: e.name,
            message: e.message,
            stack: e.stack,
        }
    };
}


function successReply(value) {
    return {
        success: true,
        value
    };
}


export async function invoke(name, ...args) {
    try {
        return successReply(await _invoke(name, ...args));
    } catch(e) {
        return errorReply(e);
    }
}


async function _invoke(name, ...args) {
    if (!handlers.has(name)) {
        throw new Error('Invalid handler name: ' + name);
    } else {
        const fn = handlers.get(name);
        return await fn(...args);
    }
}


export function register(name, fn) {
    handlers.set(name, fn);
}


app.whenReady().then(() => {
    ipcMain.handle('__rpc__', (ev, name, ...args) => invoke(name, ...args));
});
