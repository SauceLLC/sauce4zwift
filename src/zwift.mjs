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

let authToken;


const pbProfilePrivacyFlags = {
    approvalRequired: 0x1,
    minor: 0x2,
    displayWeight: 0x4,
    privateMessaging: 0x8,
    defaultFitnessDataPrivacy: 0x10,
    suppressFollowerNotification: 0x20,
};
const pbProfilePrivacyFlagsInverted = {
    displayAge: 0x40,
};


// XXX lifted from zwift-packet-monitor.  I need to refactor it so it's less of a pita to work with or integrate it.
const worldTimeOffset = 1414016074335;  // ms since zwift started production.
function worldTimeToDate(wt) {
    return new Date(worldTimeOffset + Number(wt));
}


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
    if (options.apiVersion) {
        headers['Zwift-Api-Version'] = options.apiVersion;
    }
    const host = options.host || `us-or-rly101.zwift.com`;
    const q = options.query ? '?' + options.query : '';
    const r = await fetch(`https://${host}/${urn.replace(/^\//, '')}${q}`, {
        headers: {
            'Platform': 'OSX',
            'Source': 'Game Client',
            'User-Agent': 'CNL/3.20.4 (macOS 12 Monterey; Darwin Kernel 21.4.0) zwift/1.0.101024 curl/7.78.0-DEV',
            ...headers,
        },
        ...options,
    });
    if (!r.ok && (!options.ok || !options.ok.includes(r.status))) {
        const msg = await r.text();
        const e = new Error(`Zwift HTTP Error: [${r.status}]: ${msg}`);
        e.status = r.status;
        throw e;
    }
    return r;
}


export async function apiPaged(urn, options={}, headers) {
    const results = [];
    let start = 0;
    let pages = 0;
    const pageLimit = options.pageLimit ? options.pageLimit : 10;
    const query = options.query || new URLSearchParams();
    const limit = options.limit || 100;
    query.set('limit', limit);
    while (true) {
        query.set('start', start);
        const page = await apiJSON(urn, {query, ...options}, headers);
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


export async function apiJSON(urn, options, headers) {
    const r = await api(urn, {accept: 'json', ...options}, headers);
    return await r.json();
}


export async function apiPB(urn, options, headers) {
    const r = await api(urn, {accept: 'protobuf', ...options}, headers);
    const monitorProtos = require('@saucellc/zwift-packet-monitor').pbRoot;
    const ProtoBuf = protos.get(options.protobuf) || monitorProtos.get(options.protobuf);
    const data = new Uint8Array(await r.arrayBuffer());
    if (options.debug) {
        const hex = [];
        for (const x of data) {
            hex.push(x.toString(16).padStart(2, '0'));
        }
        // compatible with https://protobuf-decoder.netlify.app/
        console.debug(hex.join(' '));
    }
    return ProtoBuf.decode(data);
}


export async function getProfile(id) {
    try {
        return await apiJSON(`/api/profiles/${id}`);
    } catch(e) {
        if (e.status === 404) {
            return;
        }
        throw e;
    }
}


export async function getProfiles(ids, options) {
    const unordered = (await apiPB('/api/profiles', {
        query: new URLSearchParams(ids.map(id => ['id', id])),
        protobuf: 'PlayerProfiles', ...options
    })).profiles;
    // Reorder and make results similar to getProfile
    const m = new Map(unordered.map(x => [x.id.toNumber(), x.toJSON()]));
    return ids.map(_id => {
        const id = +_id;
        const x = m.get(id);
        if (!x) {
            console.debug('Missing profile:', id);
            return;
        }
        x.id = id;
        x.privacy = {
            defaultActivityPrivacy: x.default_activity_privacy,
        };
        for (const [k, flag] of Object.entries(pbProfilePrivacyFlags)) {
            x.privacy[k] = !!(+x.privacy_bits & flag);
        }
        for (const [k, flag] of Object.entries(pbProfilePrivacyFlagsInverted)) {
            x.privacy[k] = !(+x.privacy_bits & flag);
        }
        return x;
    });
}


function convSegmentResult(x) {
    const ret = {
        ...x.toJSON(),
        ts: worldTimeToDate(x._worldTime),
        finishTime: x.finishTime && new Date(x.finishTime),
        segmentId: x._unsignedSegmentId.toSigned().toString()
    };
    delete ret._worldTime;
    delete ret._unsignedSegmentId;
    return ret;
}


export async function getLiveSegmentLeaders() {
    const data = await apiPB(`/live-segment-results-service/leaders`,
        {protobuf: 'SegmentResults'});
    return data.results.filter(x => +x.id).map(convSegmentResult);
}


export async function getLiveSegmentLeaderboard(segmentId) {
    const data = await apiPB(`/live-segment-results-service/leaderboard/${segmentId}`,
        {protobuf: 'SegmentResults'});
    return data.results.map(convSegmentResult);
}


export async function getSegmentResults(segmentId, options={}) {
    const query = new URLSearchParams({
        world_id: 1,
        segment_id: segmentId,
    });
    if (options.athleteId) {
        query.set('player_id', options.athleteId);
    }
    if (options.from) {
        query.set('from', zwiftCompatDate(options.from));
    }
    if (options.to) {
        query.set('to', zwiftCompatDate(options.to));
    }
    if (options.best) {
        query.set('only-best', 'true');
    }
    return (await apiPB('/api/segment-results', {query, protobuf: 'SegmentResults'})).results;
}


export async function getGameInfo() {
    return await apiJSON(`/api/game_info`, {apiVersion: '2.6'});
}


export async function searchProfiles(searchText, options={}) {
    return await apiPaged('/api/search/profiles', {
        method: 'POST',
        json: {query: searchText},
    });
}


export async function getFollowees(athleteId, options={}) {
    return await apiPaged(`/api/profiles/${athleteId}/followees`);
}


export async function getFollowers(athleteId, options={}) {
    return await apiPaged(`/api/profiles/${athleteId}/followers`);
}


export async function _setFollowing(to, from) {
    return await apiJSON(`/api/profiles/${from}/following/${to}`, {
        method: 'POST',
        json: {
            followeeId: to,
            followerId: from,
        },
    });
}


export async function _giveRideon(to, from) {
    await apiJSON(`/api/profiles/${to}/activities/0/rideon`, {
        method: 'POST',
        json: {profileId: from},
    });
}


export async function getNotifications() {
    return await (await api(`/api/notifications`, {accept: 'json'})).json();
}


export async function getEventFeed(options={}) {
    // Be forewarned, this API is not stable.  It returns dups and skips entries on page boundries.
    const urn = '/api/event-feed';
    const results = [];
    const from = +options.from || (Date.now() - (3600 * 1000));
    const to = +options.to || (Date.now() + (3600 * 1000));
    let pages = 0;
    const pageLimit = options.pageLimit ? options.pageLimit : 5;
    const ids = new Set();
    const limit = options.limit || 50;
    const query = new URLSearchParams({from, limit});
    let done;
    while (!done) {
        const page = await apiJSON(urn, {query});
        for (const x of page.data) {
            if (new Date(x.event.eventStart) >= to) {
                done = true;
                break;
            } else if (!ids.has(x.event.id)) {
                results.push(x.event);
                ids.add(x.event.id);
            }
        }
        if (page.data.length < limit || ++pages >= pageLimit) {
            break;
        }
        query.set('cursor', page.cursor);
    }
    return results;
}


export async function getPrivateEventFeed(options={}) {
    // This endpoint is also unreliable and the from/to don't seem to do much.
    // Sometimes it returns all meetups, and sometimes just recent ones if any.
    const start_date = +options.from || (Date.now() - (3600 * 1000));
    const end_date = +options.to || (Date.now() + (3600 * 1000));
    const query = new URLSearchParams({start_date, end_date});
    return await apiJSON('/api/private_event/feed', {query});
}


export async function getEvent(id) {
    return await apiJSON(`/api/events/${id}`);
}


export async function getPrivateEvent(id) {
    return await apiJSON(`/api/private_event/${id}`);
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
    constructor(gameMonitor) {
        super();
        this.ip = gameMonitor.ip;
        this._socket = null;
        this._msgSize = null;
        this._msgOfft = 0;
        this._msgBuf = null;
        this._seqno = 1;
        this._cmdSeqno = 1;
        this.athleteId = 0; // Set by gameToCompan messages
        this.on('connection', this.onConnection.bind(this));
        this.on('error', this.onError.bind(this));
        this.watching = gameMonitor.watching;
        gameMonitor.on('watching-athlete-change', id => this.watching = id);
        this.listenDone = new Promise(resolve => this.listen({address: this.ip, port: 0}, resolve));
        this._state = 'init';
    }

    async start() {
        try {
            await this._start();
        } catch(e) {
            this._state = 'error';
            this._error = e;
            throw e;
        }
    }

    async _start() {
        await this.listenDone;
        this._state = 'ready';
        const {port} = this.address();
        console.info("Registering game connnection server:", this.ip, port);
        this.port = port;
        await api('/relay/profiles/me/phone', {
            method: 'PUT',
            json: {
                phoneAddress: this.ip,
                port,
                protocol: 'TCP',
            }
        });
        this._state = 'waiting';
    }

    async changeCamera() {
        await this.sendCommands({
            command: 1,
            subCommand: 1,
        });
    }

    async elbow() {
        await this.sendCommands({
            command: 4,
            subCommand: 4,
        });
    }

    async wave() {
        await this.sendCommands({
            command: 5,
            subCommand: 5,
        });
    }

    async say(what) {
        const cmd = {
            rideon: 6,
            bell: 7,
            hammertime: 8,
            toast: 9,
            nice: 10,
            bringit: 11,
        }[what] || 6;
        await this.sendCommands({
            command: cmd,
            subCommand: cmd,
        });
    }

    async ringBell() {
        await this.sendCommands({
            command: 7,
            subCommand: 7,
        });
    }

    async endRide() {
        await this.sendCommands({
            command: 14,
            subCommand: 14,
        });
    }

    async takePicture() {
        await this.sendCommands({
            command: 17,
            subCommand: 17,
        });
    }

    async enableHUD(en=true) {
        await this._hud(en);
    }

    async disableHUD(en=false) {
        await this._hud(en);
    }

    async _hud(en=true) {
        await this.sendCommands({
            command: 22,
            subCommand: en ? 1080 : 1081,
        });
    }

    async toggleGraphs() {
        await this.sendCommands({
            command: 22,
            subCommand: 1060,
        });
    }

    async reverse() {
        await this.sendCommands({
            command: 23,
            subCommand: 23,
        });
    }

    async chatMessage(message, options={}) {
        console.warn("XXX Just use the REST api please");
        await this.sendCommands({
            command: 25,
            socialAction: {
                athleteId: this.athleteId,
                toAthleteId: options.to || 0,
                spa_type: 1,
                firstName: 'Justin',
                lastName: 'Mayfield',
                message,
                avatar: 'https://static-cdn.zwift.com/prod/profile/a70f79fb-486675',
                countryCode: 840,
            }
        });
    }

    async watch(id) {
        this.watching = id;
        await this.sendCommands({
            command: 24,
            subject: id,
        });
    }

    async join(id) {
        await this.sendCommands({
            command: 2,
            subject: id,
        });
    }

    async teleportHome() {
        await this.sendCommands({command: 3});
    }

    async sendCommands(...commands) {
        return await this._send({
            commands: commands.map(x => ({
                seqno: this._cmdSeqno++,
                ...x
            }))
        });
    }

    async _send(o) {
        const seqno = this._seqno++;
        const payload = {
            athleteId: this.athleteId,
            seqno,
            ...o,
        };
        console.debug('sneding', JSON.stringify(payload, null, 2));
        const pb = protos.CompanionToGame.encode(payload).finish();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(pb.byteLength);
        this._socket.write(header);
        await new Promise(resolve => {
            this._socket.write(pb, resolve);
        });
        return seqno;
    }

    onConnection(socket) {
        console.info('Game connection established from:', socket.remoteAddress);
        this._socket = socket;
        this._state = 'connected';
        this._error = null;
        socket.on('data', this.onData.bind(this));
        socket.on('end', this.onSocketEnd.bind(this));
        socket.on('error', this.onSocketError.bind(this));
        this.emit('status', this.getStatus());
    }

    getStatus() {
        const connected = !!this._socket;
        return {
            connected,
            port: this.port,
            state: this._state,
            error: this._state === 'error' ? this._error.message : undefined,
        };
    }

    onError(e) {
        console.error('Game connection server error:', e);
        this._socket = null;
        this._state = 'error';
        this._error = e;
        this.emit('status', this.getStatus());
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
        if (!this.athleteId) {
            this.athleteId = pb.athleteId.toNumber();
        }
        this.emit('message', pb);
    }

    onSocketEnd() {
        console.info("Game connection ended");
        this._socket = null;
        this._state = 'disconnected';
        this.emit('status', this.getStatus());
    }

    onSocketError(e) {
        console.error("Game connection network error:", e);
        this._socket = null;
        this._state = 'error';
        this._error = e;
        this.emit('status', this.getStatus());
    }
}
