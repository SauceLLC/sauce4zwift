import Express from 'express';
import * as RPC from './rpc.mjs';
import * as Mods from './mods.mjs';
import * as Mime from './mime.mjs';
import {WebSocketServer} from "ws";
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
import FS from './fs-safe.js';
import HTTP from 'node:http';
import HTTPS from 'node:https';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

// There are performance and mem fragmentation issues with zlib
// Use it only sparingly for web sockets.
const minWebSocketCompression = 64 * 1024;
const maxWebSocketBufferSize = 8 * 1024 * 1024;
const WD = Path.dirname(fileURLToPath(import.meta.url));
const servers = [];
const windowManifests = require('./window-manifests.json');
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
            }), {compress: false});
        } catch(e) {
            console.warn("WebSocket request error:", e);
            ws.send(JSON.stringify({
                type: 'response',
                success: false,
                uid,
                error: e.message,
            }), {compress: false});
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


const _jsonBufWeakCache = new WeakMap();
function jsonBufferCache(data) {
    // Use with caution.  The data arg must be deep frozen
    let jsonBuf = _jsonBufWeakCache.get(data);
    if (!jsonBuf) {
        if (data === undefined) {
            console.warn("Converting undefined to null: prevent this at the emitter source");
            data = null;
        }
        jsonBuf = Buffer.from(JSON.stringify(data));
        if (data != null && typeof data === 'object') {
            _jsonBufWeakCache.set(data, jsonBuf);
        }
    }
    return jsonBuf;
}


function handleEventsWebSocket(ws, req, rpcEventEmitters) {
    const subs = new Map();
    const client = req.client.remoteAddress;
    const loopback = client === req.client.localAddress;
    console.info("WebSocket connected:", client);
    ws.on('message', wrapWebSocketMessage(ws, (type, {method, arg}) => {
        if (type !== 'request') {
            throw new TypeError('Invalid type');
        }
        if (method === 'subscribe') {
            const {event, subId, source='stats', options} = arg;
            if (!event) {
                throw new TypeError('"event" arg required');
            }
            if (!rpcEventEmitters.has(source)) {
                throw new TypeError('Invalid emitter source: ' + source);
            }
            const jsonWrapTemplate = JSON.stringify({
                success: true,
                type: 'event',
                uid: subId,
                data: "::SPLIT::"
            }).split(/"::SPLIT::"/);
            const fastRespStart = Buffer.from(jsonWrapTemplate[0]);
            const fastRespEnd = Buffer.from(jsonWrapTemplate[1]);
            const callback = data => {
                if (ws && ws.bufferedAmount > maxWebSocketBufferSize) {
                    console.warn("Terminating unresponsive WebSocket connection:", client);
                    ws.close();
                    ws = null;
                } else if (ws) {
                    // Saves heaps of CPU when we have many clients on same event
                    const jsonBuf = jsonBufferCache(data);
                    const compress = !loopback && jsonBuf.length > minWebSocketCompression;
                    ws.send(fastRespStart, {binary: false, compress, fin: false});
                    ws.send(jsonBuf, {binary: false, compress, fin: false});
                    ws.send(fastRespEnd, {binary: false, compress, fin: true});
                }
            };
            subs.set(subId, {event, callback, source, options});
            rpcEventEmitters.subscribe(source, event, callback, options);
            console.info(`WebSocket events: (${client}) [subscribe] ${source} ${event} subId:${subId}`);
            return;
        } else if (method === 'unsubscribe') {
            const {subId} = arg;
            if (!subId) {
                throw new TypeError('"subId" arg required');
            }
            const {event, callback, source, options} = subs.get(subId);
            subs.delete(subId);
            rpcEventEmitters.unsubscribe(source, event, callback, options);
            console.info(`WebSocket events: (${client}) [unsubscribe] ${source} ${event} subId:${subId}`);
            return;
        } else {
            throw new TypeError('Invalid "method"');
        }
    }));
    ws.on('close', () => {
        for (const x of subs.values()) {
            rpcEventEmitters.unsubscribe(x.source, x.event, x.callback, x.options);
        }
        subs.clear();
        console.info("WebSocket closed:", client);
    });
    // IMPORTANT: Prevent main thread error handler from kicking in..
    ws.on('error', e => console.warn('Ignore WebSocket Error:', e));
}


async function _start({ip, port, rpcEventEmitters, statsProc}) {
    app = Express();
    app.use((req, res, next) => {
        req.start = performance.now();
        next();
    });
    servers.push(HTTP.createServer(app));
    let key, cert;
    try {
        key = FS.readFileSync(Path.join(WD, '../https/key.pem'));
        cert = FS.readFileSync(Path.join(WD, '../https/cert.pem'));
    } catch(e) {/*no-pragma*/}
    if (key && cert) {
        servers.push(HTTPS.createServer({key, cert}, app));
    } else {
        console.warn("No certs found for TLS server");
    }
    const cacheEnabled = 'private, max-age=3600';
    const cacheLong = 'private, max-age=8640000';
    const router = Express.Router();
    router.use('/', Express.static(`${WD}/../pages`, {index: 'index.html'}));
    router.use('/pages/images', Express.static(`${WD}/../pages/images`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    router.use('/pages/deps/flags', Express.static(`${WD}/../pages/deps/flags`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheLong)
    }));
    router.use('/pages/fonts/', Express.static(`${WD}/../pages/fonts`, {
        setHeaders: res => res.setHeader('Cache-Control', cacheLong)
    }));
    router.use('/pages/', Express.static(`${WD}/../pages`, {
        setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
    }));
    router.use('/shared/', Express.static(`${WD}/../shared`, {
        setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
    }));

    const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: {
            zlibDeflateOptions: {
                memLevel: 9,
                level: 1, // Fastest with compression
            },
        }
    });
    for (const s of servers) {
        s.on('upgrade', (req, socket, head) => {
            if (req.url !== '/api/ws/events') {
                return;
            }
            wss.handleUpgrade(req, socket, head, ws => handleEventsWebSocket(ws, req, rpcEventEmitters));
        });
    }

    const sp = statsProc;
    const ensureAthleteId = ident =>
        ident === 'self' ?
            sp.athleteId :
            ident === 'watching' ?
                sp.watchingId :
                Number(ident);
    function parseAthleteDataV2Query({resource, stats}) {
        const resources = resource ? (Array.isArray(resource) ? resource : [resource]) : undefined;
        stats = !!(stats && (isNaN(stats) ? stats.toLowerCase() === 'true' : Number(stats)));
        return {resources, stats};
    }
    function getAthleteStatsHandler(res, id) {
        console.warn("DEPRECATED: use /api/athletes/v1/ instead");
        return getAthleteDataHandler(res, id);
    }
    function getAthleteDataHandler(res, id) {
        id = ensureAthleteId(id);
        const data = sp.getAthleteData(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteDataV2Handler(res, id, q) {
        const {resources, stats} = parseAthleteDataV2Query(q);
        id = ensureAthleteId(id);
        const data = sp.getAthleteData(id, {version: 2, resources, stats});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getNearbyHandler(res) {
        res.json(sp._mostRecentNearby.map(x => sp._formatAthleteData(x)));
    }
    function getNearbyV2Handler(res, q) {
        const {resources, stats} = parseAthleteDataV2Query(q);
        res.json(sp._mostRecentNearby.map(x => sp._formatAthleteDataV2(x, {resources, stats})));
    }
    function getGroupsHandler(res, q) {
        res.json(sp._mostRecentGroups.map(x => ({
            ...x,
            _athleteDatas: undefined,
            _nearbyIndexes: undefined,
            athletes: x._nearbyIndexes.map(i => sp._formatAthleteData(sp._mostRecentNearby[i])),
        })));
    }
    function getGroupsV2Handler(res, q) {
        const {resources, stats} = parseAthleteDataV2Query(q);
        res.json(sp._mostRecentGroups.map(x => ({
            ...x,
            _athleteDatas: undefined,
            _nearbyIndexes: undefined,
            athletes: x._nearbyIndexes.map(i =>
                sp._formatAthleteDataV2(sp._mostRecentNearby[i], {resources, stats})),
        })));
    }
    function getAthleteLapsHandler(res, id) {
        id = ensureAthleteId(id);
        const data = sp.getAthleteLaps(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteSegmentsHandler(res, id) {
        id = ensureAthleteId(id);
        const data = sp.getAthleteSegments(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteEventsHandler(res, id) {
        id = ensureAthleteId(id);
        const data = sp.getAthleteEvents(id, {active: true});
        data ? res.json(data) : res.status(404).json(null);
    }
    function getAthleteStreamsHandler(res, id) {
        id = ensureAthleteId(id);
        const data = sp.getAthleteStreams(id);
        data ? res.json(data) : res.status(404).json(null);
    }
    const apiDirectory = JSON.stringify([{
        'athlete/v1/<id>|self|watching': '[GET] Current data for an athlete in the game',
        'athlete/v2/<id>|self|watching[?resource=RES1][&resource=...RESN][&stats=true]':
            '[GET] Current data for an athlete in the game.\n' +
            '   ?resource: stats|state|athlete|lap|lastLap|laps|segments|events|timeInPowerZones\n' +
            '   ?stats: Include extended statistics for applicable resources',
        'athlete/laps/v1/<id>|self|watching': '[GET] Lap data for an athlete',
        'athlete/segments/v1/<id>|self|watching': '[GET] Segments data for an athlete',
        'athlete/events/v1/<id>|self|watching': '[GET] Events data for an athlete',
        'athlete/streams/v1/<id>|self|watching': '[GET] Stream data (power, cadence, etc..) for an athlete',
        'nearby/v1': '[GET] Information for all nearby athletes',
        'nearby/v2[?resource=RES1][&resource=...RESN][&stats=true]':
            '[GET] Information for all nearby athletes\n' +
            '   ?resource: stats|state|athlete|lap|lastLap|laps|segments|events|timeInPowerZones\n' +
            '   ?stats: Include extended statistics for applicable resources',
        'groups/v1': '[GET] Information for all nearby groups',
        'groups/v2[?resource=RES1][&resource=...RESN][&stats=true]':
            '[GET] Information for all nearby groups\n' +
            '   ?resource: stats|state|athlete|lap|lastLap|laps|segments|events|timeInPowerZones\n' +
            '   ?stats: Include extended statistics for applicable resources',
        'rpc/v1': '[GET] List available RPC resources',
        'rpc/v1/<name>': '[POST] Make an RPC to the backend.\n' +
            '    Content body should be JSON array of arguments',
        'rpc/v1/<name>[/<arg1>][.../<argN>]': '[GET] Simple RPC to the backend.\n' +
            '    CAUTION: Types are inferred based on value.  Values of null, undefined, true, false,\n' +
            '    NaN, Infinity and -Infinity are converted to their native JavaScript counterpart.\n' +
            '    Number-like values are converted to the native number type.  For advanced call patterns\n' +
            '    use the POST method or the v2 endpoint.',
        'rpc/v2/<name>[/<base64url_arg1>][.../<base64url_argN>]': '[GET] Make an RPC to the backend.\n' +
            '    URL components following the name should be Base64[URL] encoded JSON representing each\n' +
            '    RPC argument.',
        'mods/v1': '[GET] List available mods (i.e. plugins)',
    }], null, 4);
    const api = Express.Router();
    api.use(Express.json({limit: 32 * 1024 * 1024}));
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
    api.get('/athlete/v2/:id', (req, res) => getAthleteDataV2Handler(res, req.params.id, req.query));
    api.get('/athlete/laps/v1/:id', (req, res) => getAthleteLapsHandler(res, req.params.id));
    api.get('/athlete/segments/v1/:id', (req, res) => getAthleteSegmentsHandler(res, req.params.id));
    api.get('/athlete/events/v1/:id', (req, res) => getAthleteEventsHandler(res, req.params.id));
    api.get('/athlete/streams/v1/:id', (req, res) => getAthleteStreamsHandler(res, req.params.id));
    api.get('/nearby/v1', (req, res) => getNearbyHandler(res));
    api.get('/nearby/v2', (req, res) => getNearbyV2Handler(res, req.query));
    api.get('/groups/v1', (req, res) => getGroupsHandler(res));
    api.get('/groups/v2', (req, res) => getGroupsV2Handler(res, req.query));
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
            const replyEnvelope = await RPC.invoke.call(null, req.params.name, ...args);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(RPC.errorReply(e));
        }
    });
    api.post('/rpc/v1/:name', async (req, res) => {
        try {
            const ct = req.headers['content-type'];
            if (!ct || ct.split(';')[0] !== 'application/json') {
                res.status(400);
                res.send(RPC.errorReply(new TypeError('Expected content-type header of application/json')));
                return;
            }
            const replyEnvelope = await RPC.invoke.call(null, req.params.name, ...req.body);
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(RPC.errorReply(e));
        }
    });
    api.get('/rpc/v1', (req, res) =>
        res.send(JSON.stringify(Array.from(RPC.handlers.keys()).map(name =>
            `${name}: [POST,GET]`), null, 4)));
    api.get('/rpc/v2/:name*', async (req, res) => {
        try {
            const encodedArgs = req.params[0].split('/').slice(1);
            const jsonArgs = encodedArgs.map(x => x ? Buffer.from(x, 'base64url').toString() : undefined);
            const args = jsonArgs.map(x => x ? JSON.parse(x) : undefined);
            const replyEnvelope = await RPC.invoke.call(null, req.params.name, ...args);
            req.logURL = `/rpc/v2/${req.params.name}/${jsonArgs.join('/')}`;
            if (!replyEnvelope.success) {
                res.status(400);
            }
            res.send(replyEnvelope);
        } catch(e) {
            res.status(500);
            res.send(RPC.errorReply(e));
        }
    });
    api.get('/rpc/v2', (req, res) =>
        res.send(JSON.stringify(Array.from(RPC.handlers.keys()).map(name =>
            `${name}: [GET]`), null, 4)));

    api.get('/mods/v1', (req, res) => res.send(JSON.stringify(Mods.getAvailableMods())));
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
    for (const {id} of Mods.getEnabledMods()) {
        const mod = Mods.getMod(id);
        if (!mod.manifest.web_root) {
            continue;
        }
        const modRouter = Express.Router();
        try {
            const urn = Path.posix.join('/', mod.id, mod.manifest.web_root);
            if (!mod.packed) {
                const fullPath = Path.join(mod.modPath, mod.manifest.web_root);
                console.warn('Adding unpacked Mod web root:', '/mods' + urn, '->', fullPath);
                modRouter.use(urn, Express.static(fullPath, {
                    setHeaders: res => res.setHeader('Access-Control-Allow-Origin', '*')
                }));
            } else {
                const fullPath = Path.posix.join(mod.zipRootDir, mod.manifest.web_root);
                console.warn('Adding Mod web root:', '/mods' + urn, '->', fullPath);
                modRouter.use(urn, async (req, res) => {
                    let data;
                    try {
                        data = await mod.zip.entryData(Path.posix.join(fullPath, req.path));
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
                    const ct = Mime.mimeTypesByExt.get(Path.posix.parse(req.path).ext.substr(1));
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
    const webWindows = windowManifests.filter(x => !x.private && !x.widgetOnly);
    for (const x of Mods.getWindowManifests()) {
        if (x.widgetOnly || x.private) {
            continue;
        }
        const mod = Mods.getMod(x.modId);
        if (!mod.manifest.web_root) {
            continue;
        }
        const validRoot = Path.posix.join('/mods', mod.id, mod.manifest.web_root, '/');
        if (!x.file.startsWith(validRoot)) {
            console.warn("Skipping possibly misconfigured Mod web window:", x.file, {validRoot});
            continue;
        }
        webWindows.push(x);
    }
    RPC.register(function getWebWindowManifests() {
        return webWindows;
    });

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
