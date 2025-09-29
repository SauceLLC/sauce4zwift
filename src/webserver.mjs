/* global Buffer */
import express from 'express';
import * as rpc from './rpc.mjs';
import * as mods from './mods.mjs';
import * as mime from './mime.mjs';
import expressWebSocketPatch from 'express-ws';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from './fs-safe.js';
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
        if (s._handle) {
            await closeServer(s);
        }
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
        if (data === undefined) {
            console.warn("Converting undefined to null: prevent this at the emitter source");
            data = null;
        }
        json = JSON.stringify(data);
        if (data != null && typeof data === 'object') {
            _jsonWeakMap.set(data, json);
        }
    }
    return json;
}


async function _start({ip, port, rpcEventEmitters, statsProc}) {
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
    const cacheEnabled = 'private, max-age=3600';
    const cacheLong = 'private, max-age=8640000';
    const router = express.Router();
    router.use('/', express.static(`${WD}/../pages`, {index: 'index.html'}));
    router.use('/pages/images', express.static(`${WD}/../pages/images`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    router.use('/pages/deps/flags', express.static(`${WD}/../pages/deps/flags`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheLong)
    }));
    router.use('/pages/fonts/', express.static(`${WD}/../pages/fonts`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheLong)
    }));
    router.use('/pages/', express.static(`${WD}/../pages`, {
        setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
    }));
    router.use('/shared/', express.static(`${WD}/../shared`, {
        setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
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
                const emitter = rpcEventEmitters.get(source);
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
    function getAthleteStatsHandler(res, id) {
        console.warn("DEPRECATED: use /api/athletes/v1/ instead");
        return getAthleteDataHandler(res, id);
    }
    function getAthleteDataHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteData(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteLapsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteLaps(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteSegmentsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteSegments(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteEventsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteEvents(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteStreamsHandler(res, id) {
        id = id === 'self' ? sp.athleteId : id === 'watching' ? sp.watching : Number(id);
        const data = sp.getAthleteStreams(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    const apiDirectory = JSON.stringify([{
        'athlete/v1/<id>|self|watching': '[GET] Current data for an athlete in the game',
        'athlete/laps/v1/<id>|self|watching': '[GET] Lap data for an athlete',
        'athlete/segments/v1/<id>|self|watching': '[GET] Segments data for an athlete',
        'athlete/events/v1/<id>|self|watching': '[GET] Events data for an athlete',
        'athlete/streams/v1/<id>|self|watching': '[GET] Stream data (power, cadence, etc..) for an athlete',
        'nearby/v1': '[GET] Information for all nearby athletes',
        'groups/v1': '[GET] Information for all nearby groups',
        'rpc/v1': '[GET] List available RPC resources',
        'rpc/v1/<name>': '[POST] Make an RPC to the backend. ' +
            'Content body should be JSON array of arguments',
        'rpc/v1/<name>[/<arg1>][.../<argN>]': '[GET] Simple RPC to the backend. ' +
            'CAUTION: Types are inferred based on value.  Values of null, undefined, true, false, NaN, ' +
            'Infinity and -Infinity are converted to their native JavaScript counterpart.  Number-like ' +
            'values are converted to the native number type.  For advanced call patterns use the POST ' +
            'method or the v2 endpoint.',
        'rpc/v2/<name>[/<base64url_arg1>][.../<base64url_argN>]': '[GET] Make an RPC to the backend. ' +
            'URL components following the name should be Base64[URL] encoded JSON representing each ' +
            'RPC argument.',
        'mods/v1': '[GET] List available mods (i.e. plugins)',
    }], null, 4);
    const api = express.Router();
    api.use(express.json({limit: 32 * 1024 * 1024}));
    api.use((req, res, next) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.on('finish', () => {
            const client = req.client.remoteAddress;
            const elapsed = (performance.now() - req.start).toFixed(1);
            const sizeKB = (res._contentLength / 1024).toFixed(1);
            const msg = `HTTP API request: (${client}) [${req.method}] ${req.logURL || req.originalUrl} -> ` +
                `${res.statusCode}, ${elapsed} ms, ${sizeKB} KB`;
            if (res.statusCode >= 400) {
                console.error(msg);
            } else {
                console.debug(msg);
            }
        });
        next();
    });
    api.get('/', (req, res) => res.send(apiDirectory));
    api.get('/athlete/stats/v1/:id', (req, res) => getAthleteStatsHandler(res, req.params.id)); // DEPRECATED
    api.get('/athlete/v1/:id', (req, res) => getAthleteDataHandler(res, req.params.id));
    api.get('/athlete/laps/v1/:id', (req, res) => getAthleteLapsHandler(res, req.params.id));
    api.get('/athlete/segments/v1/:id', (req, res) => getAthleteSegmentsHandler(res, req.params.id));
    api.get('/athlete/events/v1/:id', (req, res) => getAthleteEventsHandler(res, req.params.id));
    api.get('/athlete/streams/v1/:id', (req, res) => getAthleteStreamsHandler(res, req.params.id));
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
            const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...args);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(rpc.errorReply(e));
        }
    });
    api.post('/rpc/v1/:name', async (req, res) => {
        try {
            const ct = req.headers['content-type'];
            if (!ct || ct.split(';')[0] !== 'application/json') {
                res.status(400);
                res.send(rpc.errorReply(new TypeError('Expected content-type header of application/json')));
                return;
            }
            const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...req.body);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(rpc.errorReply(e));
        }
    });
    api.get('/rpc/v1', (req, res) =>
        res.send(JSON.stringify(Array.from(rpc.handlers.keys()).map(name =>
            `${name}: [POST,GET]`), null, 4)));
    api.get('/rpc/v2/:name*', async (req, res) => {
        try {
            const encodedArgs = req.params[0].split('/').slice(1);
            const jsonArgs = encodedArgs.map(x => x ? Buffer.from(x, 'base64url').toString() : undefined);
            const args = jsonArgs.map(x => x ? JSON.parse(x) : undefined);
            const replyEnvelope = await rpc.invoke.call(null, req.params.name, ...args);
            req.logURL = `/rpc/v2/${req.params.name}/${jsonArgs.join('/')}`;
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(rpc.errorReply(e));
        }
    });
    api.get('/rpc/v2', (req, res) =>
        res.send(JSON.stringify(Array.from(rpc.handlers.keys()).map(name =>
            `${name}: [GET]`), null, 4)));

    api.get('/mods/v1', (req, res) => res.send(JSON.stringify(mods.getAvailableMods())));
    api.options('*', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.status(204);
        res.send();
    });
    api.use((e, req, res, next) => {
        res.status(500);
        res.json({
            error: "internal error",
            message: e.message,
        });
    });
    api.all('*', (req, res) => res.status(404).send(apiDirectory));
    router.use('/api', api);
    for (const {id} of mods.getEnabledMods()) {
        const mod = mods.getMod(id);
        if (!mod.manifest.web_root) {
            continue;
        }
        const modRouter = express.Router();
        try {
            const urn = path.posix.join('/', mod.id, mod.manifest.web_root);
            if (!mod.packed) {
                const fullPath = path.join(mod.modPath, mod.manifest.web_root);
                console.warn('Adding unpacked Mod web root:', '/mods' + urn, '->', fullPath);
                modRouter.use(urn, express.static(fullPath, {
                    setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
                }));
            } else {
                const fullPath = path.posix.join(mod.zipRootDir, mod.manifest.web_root);
                console.warn('Adding Mod web root:', '/mods' + urn, '->', fullPath);
                modRouter.use(urn, async (req, res) => {
                    let data;
                    try {
                        data = await mod.zip.entryData(path.posix.join(fullPath, req.path));
                    } catch(e) {
                        if (!e.message.match(/(not found|not file)/)) {
                            res.status(500);
                            res.send("Internal Mod zip entry error");
                            console.error("Mod file error:", e);
                        } else {
                            res.status(404);
                            res.send("Not found");
                        }
                        return;
                    }
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    const ct = mime.mimeTypesByExt.get(path.posix.parse(req.path).ext.substr(1));
                    if (ct) {
                        res.setHeader('Content-Type', ct);
                    }
                    res.end(data);
                });
            }
            router.use('/mods', modRouter);
        } catch(e) {
            console.error('Failed to add mod web root:', mod, e);
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
                    server.listen(serverPort, '0.0.0.0');
                });
                const s = (server.key && server.cert) ? 's' : '';
                console.info(`Web server started at: http${s}://${ip}:${serverPort}/`);
                console.debug(`  HTTP API at: http${s}://${ip}:${serverPort}/api`);
                console.debug(`  WebSocket API at: ws${s}://${ip}:${serverPort}/api/ws/events`);
                continue startup;
            } catch(e) {
                if (e.code === 'EADDRINUSE') {
                    console.warn(`Web server port (${serverPort}) not available, will retry...`);
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
