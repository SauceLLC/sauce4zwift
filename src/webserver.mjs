import express from 'express';
import storage from './storage.mjs';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';

const WD = path.dirname(fileURLToPath(import.meta.url));
let app;
let server;
let starting;
let stopping;
let running;
let monitor;


async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}


function wrapWebSocketMessage(ws, callback) {
    return async function(msg) {
        let type, data, uid = -1;
        try {
            ({type, data, uid} = JSON.parse(msg));
            ws.send(JSON.stringify({
                type: 'response',
                success: true,
                uid,
                data: await callback(type, data),
            }));
        } catch(e) {
            console.warn("WebSocket request error:", e);
            ws.send(JSON.stringify({
                type: 'response',
                success: false,
                uid,
                error: e.message,
            }));
        }
    };
}


export async function getConfig() {
    return (await storage.load('webserver-config.v2')) || {
        enabled: true,
        port: 1080,
    };
}


export async function setConfig(config) {
    await storage.save('webserver-config.v2', config);
}


export async function restart(monitor) {
    if (starting) {
        await stop();
    }
    start();
}


export function setMonitor(m) {
    monitor = m;
}


export async function stop() {
    if (stopping || starting) {
        throw new Error("Invalid state");
    }
    stopping = true;
    const s = server;
    server = null;
    app = null;
    try {
        if (s) {
            await closeServer(s);
        }
    } finally {
        stopping = false;
    }
    running = false;
}


async function closeServer(s) {
    await new Promise((resolve, reject) => s.close(e => e ? reject(e) : resolve()));
}


export async function start() {
    if (starting || starting || running) {
        throw new Error("Invalid state");
    }
    starting = true;
    try {
        await _start();
    } catch(e) {
        const s = server;
        server = null;
        app = null;
        if (s) {
            running = await closeServer(s);
        }
        throw e;
    } finally {
        starting = false;
    }
}


async function _start() {
    const config = await getConfig();
    if (!config.enabled) {
        console.debug("Web server disabled");
        return false;
    }
    app = express();
    server = http.createServer(app);
    const webSocketServer = expressWebSocketPatch(app, server).getWss();
    // workaround https://github.com/websockets/ws/issues/2023
    webSocketServer.on('error', () => void 0);
    const cacheDisabled = 'no-cache, no-store, must-revalidate';
    const cacheEnabled = 'public, max-age=3600, s-maxage=900';
    const router = express.Router();
    router.use('/', express.static(`${WD}/../pages`, {index: 'index.html'}));
    router.use('/pages/images', express.static(`${WD}/../pages/images`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    router.use('/pages/', express.static(`${WD}/../pages`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.use('/shared/', express.static(`${WD}/../shared`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    router.ws('/api/ws', (ws, req) => {
        const subs = new Map();
        ws.on('message', wrapWebSocketMessage(ws, (type, {method, arg}) => {
            if (type !== 'request') {
                throw new TypeError('Invalid type');
            }
            if (method === 'subscribe') {
                const {event, subId} = arg;
                if (!event) {
                    throw new TypeError('"event" arg required');
                }
                const cb = data => {
                    ws.send(JSON.stringify({
                        success: true,
                        type: 'event',
                        data,
                        uid: subId,
                    }));
                };
                subs.set(subId, {event, cb});
                monitor.on(event, cb);
                return;
            } else if (method === 'unsubscribe') {
                const subId = arg;
                if (!subId) {
                    throw new TypeError('"subId" arg required');
                }
                const {event, cb} = subs.get(subId);
                subs.delete(subId);
                monitor.off(event, cb);
                return;
            } else {
                throw new TypeError('Invalid "method"');
            }
        }));
        ws.on('close', () => {
            for (const {event, cb} of subs.values()) {
                monitor.off(event, cb);
            }
            subs.clear();
        });
    });
    router.all('*', (req, res) => res.status(404).send(`File Not Found: "${req.path}"\n`));
    app.use(router);
    let retries = 0;
    while (retries < 20) {
        let res, rej;
        try {
            await new Promise((_res, _rej) => {
                res = _res;
                rej = _rej;
                server.on('listening', res);
                server.on('error', rej);
                server.listen(config.port);
            });
            console.info(`\nWeb server started at: http://${monitor.ip}:${config.port}/\n`);
            return;
        } catch(e) {
            if (e.code === 'EADDRINUSE') {
                console.warn('Web server port not available, will retry...');
                server.close();
                await sleep(1000 * ++retries);
            } else {
                throw e;
            }
        } finally {
            server.off('listening', res);
            server.off('error', rej);
        }
    }
    console.error(`Web server failed to startup at: http://${monitor.ip}:${config.port}/`);
    return true;
}
