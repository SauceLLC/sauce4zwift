/* global Buffer */

import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _case = protobuf.parse.defaults.keepCase;
protobuf.parse.defaults.keepCase = true;
const protos = protobuf.loadSync(path.join(__dirname, 'zwift.proto')).root;
protobuf.parse.defaults.keepCase = _case;

let xRequestId = 1;
let authToken;


function zwiftCompatDate(date) {
    return date && (date.toISOString().slice(0, -5) + 'Z');
}


export function isAuthenticated() {
    return !!authToken;
}


export async function api(urn, options={}, headers={}) {
    headers = headers || {};
    if (!options.noAuth) {
        if (!authToken || !authToken.access_token) {
            throw new TypeError('Auth token not set');
        }
        headers['Authorization'] = `Bearer ${authToken.access_token}`;
    }
    if (options.json) {
        options.body = JSON.stringify(options.json);
        headers['Content-Type'] = 'application/json';
    }
    if (options.accept) {
        headers['Accept'] = {
            json: 'application/json',
            protobuf: 'application/x-protobuf-lite',
        }[options.accept];
    }
    const host = options.host || `us-or-rly101.zwift.com`;
    const r = await fetch(`https://${host}/${urn.replace(/^\//, '')}`, {
        headers: {
            'Platform': 'OSX',
            'Source': 'Game Client',
            'User-Agent': 'CNL/3.20.4 (macOS 12 Monterey; Darwin Kernel 21.4.0) zwift/1.0.101024 curl/7.78.0-DEV',
            'X-Machine-Id': '2-986ffe25-41af-475a-8738-1bb16d3ca987',
            'X-Request-Id': xRequestId++,
            ...headers,
        },
        ...options,
    });
    if (!r.ok && (!options.ok || !options.ok.includes(r.status))) {
        const msg = await r.text();
        console.error('Zwift API Error:', r.status, msg);
        throw new Error('Zwift HTTP Error: ' + r.status);
    }
    return r;
}


export async function apiJSON(urn, options, headers) {
    const r = await api(urn, {accept: 'json', ...options}, headers);
    return await r.json();
}


export async function apiPB(urn, options, headers) {
    const r = await api(urn, {accept: 'protobuf', ...options}, headers);
    const monitorProtos = require('@saucellc/zwift-packet-monitor').pbRoot;
    const ProtoBuf = protos.get(options.protobuf) || monitorProtos.get(options.protobuf);
    return ProtoBuf.decode(new Uint8Array(await r.arrayBuffer()));
}


export async function getProfile(id) {
    return await apiJSON(`/api/profiles/${id}`);
}


export async function getProfiles(ids) {
    const q = new URLSearchParams(ids.map(id => ['id', id]));
    const unordered = (await apiPB(`/api/profiles?${q}`, {protobuf: 'PlayerProfiles'})).profiles;
    const m = new Map(unordered.map(x => [Number(x.id), x]));
    return ids.map(id => m.get(id));
}


export async function getLiveSegmentLeaders() {
    const data = await apiPB(`/live-segment-results-service/leaders`,
        {protobuf: 'SegmentResults'});
    return data.results.filter(x => x._unsignedSegmentId.toNumber()).map(x => ({
        ...x,
        segmentId: x._unsignedSegmentId.toSigned().toString()
    }));
}


export async function getLiveSegmentLeaderboard(segmentId) {
    return (await apiPB(`/live-segment-results-service/leaderboard/${segmentId}`,
        {protobuf: 'SegmentResults'})).results;
}


export async function getSegmentResults(segmentId, options={}) {
    // query args: segment_id, player_id, only-best, from, to
    const q = new URLSearchParams({
        world_id: 1,
        segment_id: segmentId,
    });
    if (options.athleteId) {
        q.set('player_id', options.athleteId);
    }
    if (options.from) {
        q.set('from', zwiftCompatDate(options.from));
    }
    if (options.to) {
        q.set('to', zwiftCompatDate(options.to));
    }
    if (options.best) {
        q.set('only-best', 'true');
    }
    console.log('' + q);
    return (await apiPB(`/api/segment-results?${q}`, {protobuf: 'SegmentResults'})).results;
}


export async function searchProfiles(query, options={}) {
    const limit = options.limit || 100;
    const results = [];
    let start = 0;
    let pages = 0;
    const pageLimit = options.pageLimit ? options.pageLimit : 10;
    while (true) {
        const q = new URLSearchParams({start, limit});
        const page = await (await api(`/api/search/profiles?${q}`, {
            method: 'POST',
            json: {query},
        })).json();
        for (const x of page) {
            results.push(x);
        }
        if (page.length < limit || ++pages >= pageLimit) {
            break;
        }
        start = results.length;
    }
    return results;
}


export async function giveRideon(to, from) {
    await (await api(`/api/profiles/${to}/activities/0/rideon`, {
        method: 'POST',
        json: {profileId: from},
        accept: 'json',
    })).json();
}


export async function getNotifications() {
    return await (await api(`/api/notifications`, {accept: 'json'})).json();
}


export async function getEventFeed() {  // from=epoch, limit=25, sport=CYCLING
    return await (await api(`/api/event-feed`, {accept: 'json'})).json();
}


export async function authenticate(username, password) {
    const r = await api('/auth/realms/zwift/protocol/openid-connect/token', {
        host: 'secure.zwift.com',
        noAuth: true,
        method: 'POST',
        ok: [200, 401],
        accept: 'json',
        body: new URLSearchParams({
            client_id: 'Zwift Game Client',
            grant_type: 'password',
            password,
            username,
        })
    });
    const resp = await r.json();
    if (r.status === 401) {
        throw new Error(resp.error_description || 'Login failed');
    }
    authToken = resp;
    console.debug("Zwift auth token acquired");
    schedRefresh(authToken.expires_in * 1000 / 2);
}


export async function refreshToken() {
    if (!authToken) {
        console.warn("No auth token to refresh");
        return false;
    }
    const r = await api('/auth/realms/zwift/protocol/openid-connect/token', {
        host: 'secure.zwift.com',
        noAuth: true,
        method: 'POST',
        accept: 'json',
        body: new URLSearchParams({
            client_id: 'Zwift Game Client',
            grant_type: 'refresh_token',
            refresh_token: authToken.refresh_token,
        })
    });
    const resp = await r.json();
    authToken = resp;
    console.debug("Zwift auth token refreshed");
    schedRefresh(authToken.expires_in * 1000 / 2);
}


let _nextRefresh;
function cancelRefresh() {
    clearTimeout(_nextRefresh);
}


function schedRefresh(delay) {
    cancelRefresh();
    console.debug(`Refresh Zwift token in: ${Math.round(delay / 1000)} seconds`);
    _nextRefresh = setTimeout(refreshToken, delay);
}


export class GameConnectionServer extends net.Server {
    constructor(ip) {
        super();
        this.ip = ip;
        this._socket = null;
        this._msgSize = null;
        this._msgOfft = 0;
        this._msgBuf = null;
        this.on('connection', this.onConnection.bind(this));
        this.on('error', this.onError.bind(this));
        this.listenDone = new Promise(resolve => this.listen({address: ip, port: 0}, resolve));
    }

    async register() {
        await this.listenDone;
        const {port} = this.address();
        console.info("Registering game connnection server:", this.ip, port);
        await api('/relay/profiles/me/phone', {
            method: 'PUT',
            json: {
                phoneAddress: this.ip,
                port,
                protocol: 'TCP',
            }
        });
    }

    async send(o) {
        const pb = protos.CompanionToGame.encode(o).finish();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(pb.byteLength);
        this._socket.write(header);
        await new Promise(resolve => {
            this._socket.write(pb, resolve);
        });
    }

    onConnection(socket) {
        console.info('Game connection established from:', socket);
        this._socket = socket;
        socket.on('data', this.onData.bind(this));
        socket.on('end', this.onSocketEnd.bind(this));
        socket.on('error', this.onSocketError.bind(this));
    }

    onError(e) {
        console.error('Game connection server error:', e);
    }

    onData(buf) {
        if (!this._msgBuf) {
            this._msgSize = buf.readUint32BE(0);
            this._msgOfft = 0;
            this._msgBuf = Buffer.alloc(this._msgSize);
            buf = buf.slice(4);
        }
        const end = this._msgSize - this._msgOfft;
        buf.copy(this._msgBuf, this._msgOfft, 0, end);
        this._msgOfft += Math.min(end, buf.byteLength);
        if (this._msgOfft === this._msgSize) {
            this.onMessage();
            if (end < buf.byteLength) {
                this.onData(buf.slice(end));
            }
        }
    }

    onMessage() {
        const buf = this._msgBuf;
        this._msgBuf = null;
        const pb = protos.GameToCompanion.decode(buf);
        console.debug("Game message:", pb.toJSON());
        this.emit('message', pb);
    }

    onSocketEnd() {
        console.info("Game connection ended");
        this._socket = null;
    }

    onSocketError(e) {
        console.error("Game connection network error:", e);
    }
}
