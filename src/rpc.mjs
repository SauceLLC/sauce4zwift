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
        return successReply(await _invoke.call(this, name, ...args));
    } catch(e) {
        return errorReply(e);
    }
}


async function _invoke(name, ...args) {
    if (!handlers.has(name)) {
        throw new Error('Invalid handler name: ' + name);
    } else {
        const {fn, scope} = handlers.get(name);
        return await fn.call(scope || this, ...args);
    }
}


export function register(fn, options={}) {
    const name = options.name || fn.name;
    if (!name) {
        throw new TypeError("Function name could not be inferred, use options.name");
    }
    handlers.set(options.name || fn.name, {fn, scope: options.scope});
}


app.whenReady().then(() => {
    ipcMain.handle('__rpc__', async (ev, name, ...args) => JSON.stringify(await invoke.call(ev.sender, name, ...args)));
});
