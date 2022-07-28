/* global Buffer */

import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _case = protobuf.parse.defaults.keepCase;
protobuf.parse.defaults.keepCase = true;
export const protos = protobuf.loadSync([
    path.join(__dirname, '..', 'node_modules', '@saucellc', 'zwift-packet-monitor', 'zwiftMessages.proto'),
    path.join(__dirname, 'zwift.proto')
]).root;
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
    if (options.pb) {
        options.body = options.pb.finish();
        headers['Content-Type'] = 'application/x-protobuf-lite; version=2.0';
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
            'User-Agent': 'CNL/3.22.2 (macOS 12 Monterey; Darwin Kernel 21.5.0) zwift/1.0.101324 curl/7.78.0-DEV',
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
    const data = Buffer.from(await r.arrayBuffer());
    if (options.debug) {
        console.debug(data.toString('hex'));
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


export async function _setFollowing(them, us) {
    return await apiJSON(`/api/profiles/${us}/following/${them}`, {
        method: 'POST',
        json: {
            followeeId: them,
            followerId: us,
        },
    });
}


export async function _setNotFollowing(them, us) {
    const resp = await api(`/api/profiles/${us}/following/${them}`, {method: 'DELETE'});
    if (!resp.ok) {
        throw new Error(resp.status);
    }
}


export async function _giveRideon(to, from, activity=0) {
    // activity 0 is an in-game rideon
    await apiJSON(`/api/profiles/${to}/activities/${activity}/rideon`, {
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


// Poor API naming here; this is how we get info about relay servers and establish
// encryption material.
export async function gameLogin(options={}) {
    const aeskey = crypto.randomBytes(16);

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const login = await apiPB('/api/users/login', {
        method: 'POST',

        host: 'jm', // XXX
        
        pb: protos.LoginRequest.encode({
            aeskey,
            properties: {
                entries: [{
                    key: 'OS Type',
                    value: 'macOS',
                }, {
                    key: 'OS',
                    value: 'OSX 10.X 64bit',
                }, {
                    key: 'COMPUTER',
                    value: 'MacBookPro18,2',
                }, {
                    key: 'Machine Id',
                    value: '2-986ffe15-41af-475a-8738-1bb16d2ca987',
                }],
            }
        }),
        protobuf: 'LoginResponse',
        ...options
    });
    return {login, aeskey};
}

const deviceTypes = {
    relay: 1,
    companion: 2,
};

const channelTypes = {
    udpClient: 1,
    udpServer: 2,
    tcpClient: 3,
    tcpServer: 4,
};

const headerFlags = {
    ri: 4,
    ci: 2,
    seqno: 1,
};


export class IV {
    constructor(props={}) {
        this.seqno = 0;
        Object.assign(this, props);
    }

    toBuffer() {
        const ivBuf = Buffer.alloc(2 + 2 + 2 + 2 + 4); // 12
        ivBuf.writeUInt16BE(deviceTypes[this.deviceType], 2);
        ivBuf.writeUInt16BE(channelTypes[this.channelType], 4);
        ivBuf.writeUInt16BE(this.ci || 0, 6);
        ivBuf.writeUInt32BE(this.seqno || 0, 8);
        return ivBuf;
    }
}


export function decryptPacket(data, key, iv) {
    const flags = data.readUint8(0);
    const envelope = {flags};
    let headerOfft = 1;
    if (flags & headerFlags.ri) {
        envelope.ri = data.readUInt32BE(headerOfft);
        headerOfft += 4;
    }
    if (flags & headerFlags.ci) {
        iv.ci = envelope.ci = data.readUInt16BE(headerOfft);
        headerOfft += 2;
    }
    if (flags & headerFlags.seqno) {
        iv.seqno = envelope.seqno = data.readUInt32BE(headerOfft);
        headerOfft += 4;
        iv.seqno++;
    }
    const ivBuf = iv.toBuffer();
    console.log('iv', ivBuf.toString('hex'));
    const decipher = crypto.createDecipheriv('aes-128-gcm', key, ivBuf);
    console.log("header", data.subarray(0, headerOfft).toString('hex'));
    decipher.setAAD(data.subarray(0, headerOfft));
    decipher.setAuthTag(data.subarray(-4));
    console.log(data.subarray(-4).toString('hex'));
    console.log('headerofft', headerOfft);
    const plain = Buffer.concat([decipher.update(data.subarray(headerOfft, -4)), decipher.final()]);
    console.log("plaintext", plain.toString('hex'));
    return plain;
}


export function encryptPacket(data, key, iv, ri, ci, seqno) {
    let flags = 0;
    let headerOfft = 1;
    const header = Buffer.alloc(1 + 4 + 2 + 4);
    if (ri !== undefined) {
        flags |= headerFlags.ri;
        header.writeUInt32BE(ri, headerOfft);
        headerOfft += 4;
    }
    if (ci !== undefined) {
        flags |= headerFlags.ci;
        header.writeUInt16BE(ci, headerOfft);
        headerOfft += 2;
    }
    if (seqno !== undefined) {
        flags |= headerFlags.seqno;
        header.writeUInt32BE(seqno, headerOfft);
        headerOfft += 4;
    }
    header.writeUInt8(flags, 0);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, iv.toBuffer());
    const headerCompact = header.subarray(0, headerOfft);
    cipher.setAAD(headerCompact);
    const cipherBufs = [cipher.update(data), cipher.final()];
    const mac = cipher.getAuthTag().subarray(0, 4);
    return Buffer.concat([headerCompact, ...cipherBufs, mac]);
}


export async function gameClient(options={}) {
    const {login, aeskey} = await gameLogin(options);
    const host = login.info.tcpConfig.nodes[0].ip;
    console.log(login);
    let pendingBuf;
    let pendingSize;
    const iv = new IV({deviceType: 'relay', channelType: 'tcpClient'});
    const client = net.createConnection({
        host,
        port: 3025,
        noDelay: true,
        timeout: 60000,
        onread: {
            buffer: Buffer.alloc(1 * 1024 * 1024),
            callback: (nread, buf) => {
                const data = buf.subarray(0, nread);
                for (let offt = 0; offt < data.byteLength;) {
                    let size;
                    if (pendingSize) {
                        size = pendingSize;
                    } else {
                        size = data.readUInt16BE(0);
                        offt += 2;
                    }
                    if (data.byteLength - offt + (pendingBuf ? pendingBuf.byteLength : 0) < size) {
                        debugger;
                        console.debug("short read");
                        const dataCopy = Buffer.from(data.subarray(offt));
                        if (!pendingBuf) {
                            pendingBuf = dataCopy;
                            pendingSize = size;
                        } else {
                            // Yet-another-short-read.
                            console.debug("another short read!");
                            pendingBuf = Buffer.concat([pendingBuf, dataCopy]);
                        }
                    } else {
                        let completeBuf;
                        if (pendingBuf) {
                            completeBuf = Buffer.concat([
                                pendingBuf,
                                data.subarray(offt, (offt += pendingBuf.byteLength - size))
                            ]);
                        } else {
                            completeBuf = data.subarray(offt, (offt += size));
                        }
                        iv.channelType = 'tcpServer';
                        console.log(completeBuf.toString('hex'));
                        const plainBuf = decryptPacket(completeBuf, aeskey, iv);
                        iv.seqno++;
                        console.log("plainbuf", plainBuf.toString('hex'));
                        const pb = protos.IncomingPacket.decode(plainBuf);
                        console.log(pb);
                        client.emit('packet', pb);
                    }
                }
                console.log('zwift game data', nread, buf.subarray(0, nread).toString('hex'));
            },
        },
    });
    await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
    });
    const hello = protos.ClientToServer.encode({
        athleteId: 1, // XXX
        worldTime: 0,
        seqno: 1,
        largWaTime: 0,
    });
    const plainBuf = hello.finish();
    const helloMagic = Buffer.from([0x10, 0x0]);
    const cipherBuf = encryptPacket(Buffer.concat([helloMagic, plainBuf]),
        aeskey, iv, /*ri*/ 1, /*ci*/ 0);
    const wireBuf = Buffer.alloc(cipherBuf.byteLength + 2);
    wireBuf.writeUInt16BE(cipherBuf.byteLength, 0);
    wireBuf.set(cipherBuf, 2);
    console.log('size+flags+cipher+mac', wireBuf.toString('hex'));
    console.log('plain', plainBuf.toString('hex'));
    await new Promise(resolve => client.write(wireBuf, resolve));
    return client;
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
    _nextRefresh = setTimeout(refreshToken, Math.min(0x7fffffff, delay));
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
        await this.sendCommands({command: protos.CompanionToGameCommandType.CHANGE_CAMERA_ANGLE});
    }

    async elbow() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.ELBOW_FLICK});
    }

    async wave() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.WAVE});
    }

    async say(what) {
        const cmd = {
            rideon: protos.CompanionToGameCommandType.RIDE_ON,
            bell: protos.CompanionToGameCommandType.BELL,
            hammertime: protos.CompanionToGameCommandType.HAMMER_TIME,
            toast: protos.CompanionToGameCommandType.TOAST,
            nice: protos.CompanionToGameCommandType.NICE,
            bringit: protos.CompanionToGameCommandType.BRING_IT,
        }[what] || 6;
        await this.sendCommands({
            command: cmd,
            subCommand: cmd,
        });
    }

    async ringBell() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.BELL});
    }

    async endRide() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.DONE_RIDING});
    }

    async takePicture() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.TAKE_SCREENSHOT});
    }

    async enableHUD(en=true) {
        await this._hud(en);
    }

    async disableHUD(en=false) {
        await this._hud(en);
    }

    async _hud(en=true) {
        await this.sendCommands({
            command: protos.CompanionToGameCommandType.CUSTOM_ACTION,
            subCommand: en ? 1080 : 1081,
        });
    }

    async toggleGraphs() {
        await this.sendCommands({
            command: protos.CompanionToGameCommandType.CUSTOM_ACTION,
            subCommand: 1060,
        });
    }

    async reverse() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.U_TURN});
    }

    async chatMessage(message, options={}) {
        await this.sendCommands({
            command: protos.CompanionToGameCommandType.SOCIAL_PLAYER_ACTION,
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
        await this.sendCommands({
            command: protos.CompanionToGameCommandType.FAN_VIEW,
            subject: id,
        });
    }

    async join(id) {
        await this.sendCommands({
            command: protos.CompanionToGameCommandType.JOIN_ANOTHER_PLAYER,
            subject: id,
        });
    }

    async teleportHome() {
        await this.sendCommands({command: protos.CompanionToGameCommandType.TELEPORT_TO_START});
    }

    async sendCommands(...commands) {
        for (const c of commands) {
            console.log(c.command);
        }
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

    async onConnection(socket) {
        console.info('Game connection established from:', socket.remoteAddress);
        this._socket = socket;
        this._state = 'connected';
        this._error = null;
        socket.on('data', this.onData.bind(this));
        socket.on('end', this.onSocketEnd.bind(this));
        socket.on('error', this.onSocketError.bind(this));
        this.emit('status', this.getStatus());
        await this.sendCommands({
        /*    command: protos.CompanionToGameCommandType.PHONE_TO_GAME_PACKET,
         *    ...
         *}, {
         */
            command: protos.CompanionToGameCommandType.PAIRING_AS,
            athleteId: 5052891,// this.athleteId, XXX
        });
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
        console.info(buf.toString('hex'));
        const pb = protos.GameToCompanion.decode(buf);
        console.info(pb);
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
