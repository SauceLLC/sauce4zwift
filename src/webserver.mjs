import express from 'express';
import * as rpc from './rpc.mjs';
import * as mods from './mods.mjs';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const MAX_BUFFERED_PER_SOCKET = 8 * 1024 * 1024;
const WD = path.dirname(fileURLToPath(import.meta.url));
const servers = [];
let app;
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
    if (running) {
        await stop();
    }
    start();
}


export async function stop() {
    if (stopping) {
        throw new Error("Invalid state");
    }
    stopping = true;
    for (const s of servers) {
        await closeServer(s);
    }
    servers.length = 0;
    app = null;
    stopping = false;
    running = false;
}


async function closeServer(s) {
    await new Promise((resolve, reject) => s.close(e => e ? reject(e) : resolve()));
}


export async function start(options={}) {
    if (starting || running) {
        throw new Error("Invalid state");
    }
    starting = true;
    try {
        await _start(options);
    } catch(e) {
        await stop();
        throw e;
    } finally {
        starting = false;
    }
    running = true;
}


const _jsonWeakMap = new WeakMap();
function jsonCache(data) {
    // Use with caution.  The data arg must be deep frozen
    let json = _jsonWeakMap.get(data);
    if (!json) {
        json = JSON.stringify(data);
        if (typeof data === 'object') {
            _jsonWeakMap.set(data, json);
        }
    }
    return json;
}


async function _start({ip, port, rpcSources, statsProc}) {
    app = express();
    app.use((req, res, next) => {
        req.start = performance.now();
        next();
    });
    servers.push(http.createServer(app));
    let key, cert;
    try {
        key = fs.readFileSync(path.join(WD, '../https/key.pem'));
        cert = fs.readFileSync(path.join(WD, '../https/cert.pem'));
    } catch(e) {/*no-pragma*/}
    if (key && cert) {
        servers.push(https.createServer({key, cert}, app));
    } else {
        console.warn("No certs found for TLS server");
    }
    for (const s of servers) {
        const webSocketServer = expressWebSocketPatch(app, s).getWss();
        // workaround https://github.com/websockets/ws/issues/2023
        webSocketServer.on('error', () => void 0);
    }
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
        setHeaders: res => {
            res.setHeader('Cache-Control', cacheDisabled);
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
    }));
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
                        // Saves heaps of CPU when we have many clients on same event
                        ws.send(`{
                            "success": true,
                            "type": "event",
                            "uid": ${JSON.stringify(subId)},
                            "data": ${jsonCache(data)}
                        }`);
                    }
                };
                subs.set(subId, {event, cb, emitter, source});
                emitter.on(event, cb);
                console.info(`WebSocket events: (${client}) [subscribe] ${source} ${event} subId:${subId}`);
                return;
            } else if (method === 'unsubscribe') {
                const {subId} = arg;
                if (!subId) {
                    throw new TypeError('"subId" arg required');
                }
                const {event, cb, emitter, source} = subs.get(subId);
                subs.delete(subId);
                emitter.off(event, cb);
                console.info(`WebSocket events: (${client}) [unsubscribe] ${source} ${event} subId:${subId}`);
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
            console.info("WebSocket closed:", client);
        });
    });
    const sp = statsProc;
    function getStatsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteStats(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    function getLapsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteLaps(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    function getSegmentsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteSegments(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    function getStreamsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteStreams(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    const apiDirectory = JSON.stringify([{
        'athlete/stats/v1/<id>|self|watching': '[GET] Current stats for an athlete in the game',
        'athlete/laps/v1/<id>|self|watching': '[GET] Lap data for an athlete',
        'athlete/segments/v1/<id>|self|watching': '[GET] Segments data for an athlete',
        'athlete/streams/v1/<id>|self|watching': '[GET] Stream data (power, cadence, etc..) for an athlete',
        'nearby/v1': '[GET] Information for all nearby athletes',
        'groups/v1': '[GET] Information for all nearby groups',
        'rpc/v1': '[GET] List available RPC resources',
        'rpc/v1/<name>': '[POST] Make an RPC call into the backend. ' +
            'Content body should be JSON Array of arguments',
        'rpc/v1/<name>/[<arg1>, <arg2>, ...<argN>]': '[GET] Simple mode RPC call into the backend. ' +
            'CAUTION: Types are inferred based on value.  Values of null, undefined, true, false, NaN, ' +
            'Infinity and -Infinity are converted to their native JavaScript counterpart.  Number-like ' +
            'values are converted to the native number type.  For advanced call patterns use the POST method.',
        'mods/v1': '[GET] List available mods (i.e. plugins)',
    }], null, 4);
    const api = express.Router();
    api.use(express.json());
    api.use((req, res, next) => {
        res.setHeader('Content-Type', 'application/json');
        res.on('finish', () => {
            const client = req.client.remoteAddress;
            const elapsed = (performance.now() - req.start).toFixed(1);
            const msg = `HTTP API request: (${client}) [${req.method}] ${req.originalUrl} -> ${res.statusCode}, ${elapsed}ms`;
            if (res.statusCode >= 400) {
                console.error(msg);
            } else {
                console.debug(msg);
            }
        });
        next();
    });
    api.get('/', (req, res) => res.send(apiDirectory));
    api.get('/athlete/stats/v1/:id', (req, res) => getStatsHandler(res, req.params.id));
    api.get('/athlete/laps/v1/:id', (req, res) => getLapsHandler(res, req.params.id));
    api.get('/athlete/segments/v1/:id', (req, res) => getSegmentsHandler(res, req.params.id));
    api.get('/athlete/streams/v1/:id', (req, res) => getStreamsHandler(res, req.params.id));
    api.get('/nearby/v1', (req, res) =>
        res.send(sp._mostRecentNearby ? jsonCache(sp._mostRecentNearby) : '[]'));
    api.get('/groups/v1', (req, res) =>
        res.send(sp._mostRecentGroups ? jsonCache(sp._mostRecentGroups) : '[]'));
    api.get('/rpc/v1/:name*', async (req, res) => {
        const natives = {
            'null': null,
            'undefined': undefined,
            'true': true,
            'false': false,
            'NaN': NaN,
            'Infinity': Infinity,
            '-Infinity': -Infinity,
        };
        try {
            const args = req.params[0].split('/').slice(1).map(x => {
                if (Object.prototype.hasOwnProperty.call(natives, x)) {
                    return natives[x];
                } else {
                    const n = Number(x);
                    if (!Number.isNaN(n) && n.toString() === x) {
                        return n;
                    } else {
                        return x;
                    }
                }
            });
            console.log(req.params, args);
            const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...args);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.json({
                error: "internal error",
                message: e.message,
            });
        }
    });
    api.post('/rpc/v1/:name', async (req, res) => {
        try {
            const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...req.body);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.json({
                error: "internal error",
                message: e.message,
            });
        }
    });
    api.get('/rpc/v1', (req, res) =>
        res.send(JSON.stringify(Array.from(rpc.handlers.keys()).map(name => `${name}: [POST,GET]`), null, 4)));
    api.get('/mods/v1', (req, res) => res.send(JSON.stringify(mods.available, null, 4)));
    api.use((e, req, res, next) => {
        res.status(500);
        res.json({
            error: "internal error",
            message: e.message,
        });
    });
    api.all('*', (req, res) => res.status(404).send(apiDirectory));
    router.use('/api', api);
    if (mods.available) {
        for (const mod of mods.available) {
            if (!mod.enabled || !mod.manifest.web_root) {
                continue;
            }
            const modRouter = express.Router();
            try {
                const urn = path.posix.join('/', mod.id, mod.manifest.web_root);
                const fullPath = path.join(mod.modPath, mod.manifest.web_root);
                console.warn('Adding Mod web root:', '/mods' + urn, '->', fullPath);
                modRouter.use(urn, express.static(fullPath, {
                    cacheControl: true,
                    setHeaders: res => {
                        res.setHeader('Cache-Control', cacheDisabled);
                        res.setHeader('Access-Control-Allow-Origin', '*');
                    }
                }));
                router.use('/mods', modRouter);
            } catch(e) {
                console.error('Failed to add mod web root:', mod, e);
            }
        }
    }
    router.all('*', (req, res) => res.status(404).send('Invalid URL'));
    app.use(router);
    let retries = 0;
    startup:
    for (const [i, server] of servers.entries()) {
        const serverPort = port + i;
        while (retries < 20) {
            let res, rej;
            try {
                await new Promise((_res, _rej) => {
                    res = _res;
                    rej = _rej;
                    server.on('listening', res);
                    server.on('error', rej);
                    server.listen(serverPort);
                });
                const s = (server.key && server.cert) ? 's' : '';
                console.info(`Web server started at: http${s}://${ip}:${serverPort}/`);
                console.debug(`  HTTP API at: http${s}://${ip}:${serverPort}/api`);
                console.debug(`  WebSocket API at: ws${s}://${ip}:${serverPort}/api/ws/events`);
                continue startup;
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
        console.error(`Web server failed to startup at: http://${ip}:${serverPort}/`);
    }
}
