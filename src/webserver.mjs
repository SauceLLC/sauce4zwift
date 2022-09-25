import express from 'express';
import * as rpc from './rpc.mjs';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';

const MAX_BUFFERED_PER_SOCKET = 8 * 1024 * 1024;
const WD = path.dirname(fileURLToPath(import.meta.url));
let app;
let server;
let starting;
let stopping;
let running;


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


export async function restart() {
    if (starting) {
        await stop();
    }
    start();
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


export async function start(options={}) {
    if (starting || starting || running) {
        throw new Error("Invalid state");
    }
    starting = true;
    try {
        await _start(options);
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


async function _start({ip, port, rpcSources, statsProc}) {
    app = express();
    app.set('json spaces', 2);
    app.use(express.json());
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
    router.use('/pages/deps/flags', express.static(`${WD}/../pages/deps/flags`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    router.use('/pages/', express.static(`${WD}/../pages`, {
        cacheControl: true,
        setHeaders: res => {
            res.setHeader('Cache-Control', cacheDisabled);
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
    }));
    router.use('/shared/', express.static(`${WD}/../shared`, {
        cacheControl: true,
        setHeaders: res => res.setHeader('Cache-Control', cacheDisabled)
    }));
    const serialCache = new WeakMap();
    router.ws('/api/ws/events', (ws, req) => {
        const client = req.client.remoteAddress;
        console.info("WebSocket connected:", client);
        const subs = new Map();
        ws.on('message', wrapWebSocketMessage(ws, (type, {method, arg}) => {
            if (type !== 'request') {
                throw new TypeError('Invalid type');
            }
            if (method === 'subscribe') {
                const {event, subId, source='stats'} = arg;
                if (!event) {
                    throw new TypeError('"event" arg required');
                }
                const emitter = rpcSources[source];
                if (!emitter) {
                    throw new TypeError('Invalid emitter source: ' + source);
                }
                const cb = data => {
                    if (ws && ws.bufferedAmount > MAX_BUFFERED_PER_SOCKET) {
                        console.warn("Terminating unresponsive WebSocket connection:", client);
                        ws.close();
                        ws = null;
                    } else if (ws) {
                        let json = serialCache.get(data);
                        if (!json) {
                            json = JSON.stringify(data);
                            serialCache.set(data, json);
                        }
                        // Saves heaps of CPU when we have many clients on same event
                        ws.send(`{
                            "success": true,
                            "type": "event",
                            "uid": ${JSON.stringify(subId)},
                            "data": ${json}
                        }`);
                    }
                };
                subs.set(subId, {event, cb, emitter});
                emitter.on(event, cb);
                return;
            } else if (method === 'unsubscribe') {
                const subId = arg;
                if (!subId) {
                    throw new TypeError('"subId" arg required');
                }
                const {event, cb, emitter} = subs.get(subId);
                subs.delete(subId);
                emitter.off(event, cb);
                return;
            } else {
                throw new TypeError('Invalid "method"');
            }
        }));
        ws.on('close', () => {
            for (const {event, cb, emitter} of subs.values()) {
                emitter.off(event, cb);
            }
            subs.clear();
            console.debug("WebSocket closed:", client);
        });
    });
    const api = express.Router();
    api.use(express.json());
    api.use((req, res, next) => {
        res.on('finish', () => {
            const client = req.client.remoteAddress;
            console.debug(`Web API request: (${client}) [${req.method}] ${req.originalUrl} -> ${res.statusCode}`);
        });
        next();
    });
    api.get('/', (req, res) => {
        res.send([{
            'athletes': '[GET] Information for all active athletes',
            'athletes/<id>': '[GET] Information for specific athlete',
            'athletes/self': '[GET] Information for the logged in athlete',
            'athletes/watching': '[GET] Information for athlete being watched',
            'nearby': '[GET] Information for all nearby athletes',
            'groups': '[GET] Information for all nearby groups',
            'rpc/<name>': '[POST] Make an RPC call into the backend. ' +
                'Content body should be JSON Array of arguments',
        }]);
    });
    api.get('/rpc', (req, res) => {
        res.send(Array.from(rpc.handlers.keys()).map(name => `${name}: [POST]`));
    });
    const sp = statsProc;
    function getAthleteHandler(res, id) {
        const data = sp.getAthleteData(id);
        if (!data) {
            res.status(404);
        }
        res.json(data);
    }
    api.post('/rpc/:name', async (req, res) => {
        const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...req.body);
        if (!replyEnvelope.success) {
            res.status(400);
        }
        res.send(replyEnvelope);
    });
    api.get('/athletes/self', (req, res) => getAthleteHandler(res, sp.athleteId));
    api.get('/athletes/watching', (req, res) => getAthleteHandler(res, sp.watching));
    api.get('/athletes/:id', (req, res) => getAthleteHandler(res, Number(req.params.id)));
    api.get('/athletes', (req, res) => res.send(sp.getAthletesData()));
    api.get('/nearby', (req, res) => res.send(sp.getNearbyData()));
    api.get('/groups', (req, res) => res.send(sp.getGroupsData()));
    api.use((e, req, res, next) => {
        res.status(500);
        res.json({
            error: "internal error",
            message: e.message,
        });
    });
    api.all('*', (req, res) => res.status(404).json(null));
    router.use('/api', api);
    router.all('*', (req, res) => res.status(404).send('Invalid URL'));
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
                server.listen(port);
            });
            console.info(`Web server started at: http://${ip}:${port}/`);
            console.debug(`  Web API at: http://${ip}:${port}/api`);
            console.debug(`  WebSocket API at: http://${ip}:${port}/api/ws/events`);
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
    console.error(`Web server failed to startup at: http://${ip}:${port}/`);
    return true;
}
