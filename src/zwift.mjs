/* global Buffer */

import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import events from 'node:events';
import crypto from 'node:crypto';
import {sleep} from '../shared/sauce/base.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {XXHash32} = require('xxhash-addon');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _case = protobuf.parse.defaults.keepCase;
protobuf.parse.defaults.keepCase = true;
export const protos = protobuf.loadSync([path.join(__dirname, 'zwift.proto')]).root;
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


export const worldTimeOffset = 1414016074335;  // ms since zwift started production.
export function worldTimeToDate(wt) {
    return new Date(worldTimeOffset + Number(wt));
}


export function dateToWorldTime(d) {
    return d - worldTimeOffset;
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
            //'Source': 'Game Client',
            'Source': 'zwift-companion', // Hack to make zwift-offline work
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
    const ProtoBuf = protos.get(options.protobuf);
    const data = Buffer.from(await r.arrayBuffer());
    if (options.debug) {
        console.debug(data.toString('hex'));
    }
    return ProtoBuf.decode(data);
}


function seedToBuffer(num) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(num);
    return buf;
}


export async function getHashSeeds(options) {
    const data = (await apiPB('/relay/worlds/hash-seeds', {
        protobuf: 'HashSeeds',
        ...options
    }));
    return Array.from(data.seeds).map(x => ({
        nonce: seedToBuffer(x.nonce),
        seed: seedToBuffer(x.seed),
    }));
}

 
export async function getProfile(id, options) {
    try {
        return await apiJSON(`/api/profiles/${id}`, options);
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
        protobuf: 'PlayerProfiles',
        ...options,
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
    relayId: 4,
    connId: 2,
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
        ivBuf.writeUInt16BE(this.connId || 0, 6);
        ivBuf.writeUInt32BE(this.seqno || 0, 8);
        return ivBuf;
    }

    toString() {
        return `IV deviceType:${this.deviceType} channelType:${this.channelType} connId:${this.connId} seqno:${this.seqno}`;
    }
}


export class GameClient extends events.EventEmitter {
    constructor({host}={}) {
        super();
        this.athleteId = undefined;
        this.host = host;
        this._tcpConnId = 0;
        this._udpConnId = 0;
        this._relayId = null;
        // These are real values, not test data...
        this.defaultHashSeed = {
            nonce: seedToBuffer(1234),
            seed: seedToBuffer(5678),
        };
    }

    decrypt(data, iv) {
        const flags = data.readUint8(0);
        let headerOfft = 1;
        if (flags & headerFlags.relayId) {
            const relayId = data.readUInt32BE(headerOfft);
            if (relayId !== this.relayId) {
                console.error("Unexpected relayId:", relayId, this.relayId);
                throw new Error("Bad Relay ID");
            }
            headerOfft += 4;
        }
        if (flags & headerFlags.connId) {
            iv.connId = data.readUInt16BE(headerOfft);
            headerOfft += 2;
        }
        if (flags & headerFlags.seqno) {
            iv.seqno = data.readUInt32BE(headerOfft);
            headerOfft += 4;
        }
        const ivBuf = iv.toBuffer();
        //console.debug("Decrypting:");
        //console.debug('  iv', iv.toString(), ivBuf.toString('hex'));
        const decipher = crypto.createDecipheriv('aes-128-gcm', this.aeskey, ivBuf, {authTagLength: 4});
        //console.debug("  header", data.subarray(0, headerOfft).toString('hex'));
        decipher.setAAD(data.subarray(0, headerOfft));
        decipher.setAuthTag(data.subarray(-4));
        const plain = Buffer.concat([decipher.update(data.subarray(headerOfft, -4)), decipher.final()]);
        //console.debug("  plaintext", plain.toString('hex'));
        iv.seqno++; // Implicit seqno increase (this protocol is quite fragile)
        return plain;
    }

    encodeHeader(iv, options={}) {
        let flags = 0;
        let headerOfft = 1;
        const header = Buffer.alloc(1 + 4 + 2 + 4);
        // Work on a cleaner way of managing the caching capabilities of this header.
        // We are only required to send relayId and connId when values change.
        if (options.hello) {
            flags |= headerFlags.relayId;
            header.writeUInt32BE(this.relayId, headerOfft);
            headerOfft += 4;
        }
        if (options.hello && iv.connId !== undefined) {
            flags |= headerFlags.connId;
            header.writeUInt16BE(iv.connId, headerOfft);
            headerOfft += 2;
        }
        if ((options.hello && iv.seqno) || options.forceSeq) {
            flags |= headerFlags.seqno;
            header.writeUInt32BE(iv.seqno || 0, headerOfft);
            headerOfft += 4;
        }
        header.writeUInt8(flags, 0);
        return header.subarray(0, headerOfft);
    }

    encrypt(aad, data, iv) {
        const cipher = crypto.createCipheriv('aes-128-gcm', this.aeskey, iv.toBuffer(),
            {authTagLength: 4});
        cipher.setAAD(aad);
        return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    }

    async login(options) {
        if (!this.athleteId) {
            const profile = await getProfile('me', {host: this.host});
            this.athleteId = profile.id;
        }
        this.aeskey = crypto.randomBytes(16);
        const login = await apiPB('/api/users/login', {
            method: 'POST',
            host: this.host,
            pb: protos.LoginRequest.encode({
                aeskey: this.aeskey,
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
                        value: '2-d9d8235c-f1b5-4415-b90e-eaef1bd3098c',
                    }],
                }
            }),
            protobuf: 'LoginResponse',
            ...options,
        });
        this.serverHashSeeds = await getHashSeeds({host: this.host, debug: true});
        this.relayId = login.relaySessionId;
        this.servers = login.info.tcpConfig.nodes;
    }

    async connect(options) {
        await this.login(options);
        await sleep(1000); // No joke this is required.
        await this.establishConnection(options);
        await this.sayHello(options);
    }

    async disconnect(options) {
        clearInterval(this.sendLoop);
        if (this.tcpConn) {
            this.tcpConn.end();
            this.tcpConn = null;
        }
        if (this.udpSock) {
            this.udpSock.close();
            this.udpSock = null;
        }
    }

    async establishConnection(options={}) {
        this._connectingTime = Date.now();
        if (this.tcpConn) {
            this.tcpConn.removeAllListeners();
            this.tcpConn.end();
        }
        this._tcpSendIV = new IV({deviceType: 'relay', channelType: 'tcpClient', connId: this._tcpConnId});
        this._tcpRecvIV = new IV({deviceType: 'relay', channelType: 'tcpServer', connId: this._tcpConnId});
        this._tcpConnId++;
        this._tcpPacketSeqno = 0;
        let servers = this.servers.filter(x => x.realm === 0 && x.courseId === 0);
        if (options.courseId) {
            const dedicatedServers = this.servers.filter(x => x.realm === 1 && x.courseId === options.courseId);
            if (dedicatedServers.length) {
                servers = dedicatedServers;
            }
        }
        let ip;
        if (!options.ip) {
            ip = servers[0].ip;
        }
        console.info("Establishing TCP connection to:", ip);
        this.tcpConn = net.createConnection({
            host: ip,
            port: 3025,
            noDelay: true,
            keepAlive: true,
            keepAliveInitialDelay: 15000,
            timeout: 60000,
            onread: {
                buffer: Buffer.alloc(65536),
                callback: this.onTCPData.bind(this),
            }
        });
        await new Promise((resolve, reject) => {
            this.tcpConn.once('connect', resolve);
            this.tcpConn.once('error', reject);
        });
        this.tcpConn.on('close', this.onConnectionClose.bind(this));
    }

    async establishUDPSocket(ip) {
        if (this.udpSock) {
            this.udpSock.removeAllListeners();
            this.udpSock.close();
        }
        this._udpSendIV = new IV({deviceType: 'relay', channelType: 'udpClient', connId: this._udpConnId});
        this._udpRecvIV = new IV({deviceType: 'relay', channelType: 'udpServer', connId: this._udpConnId});
        this._udpConnId++;
        this._udpPacketSeqno = 0;
        console.info("Establishing UDP connection to:", ip);
        this.udpSock = dgram.createSocket('udp4');
        this.udpSock.on('message', this.onUDPData.bind(this));
        await new Promise((resolve, reject) =>
            this.udpSock.connect(3024, ip, e => void (e ? reject(e) : resolve())));
    }

    async onConnectionClose() {
        console.warn("Connection to Zwift Game servers closed");
        this.disconnect();
        return;
        await sleep(Math.max(0, 15000 - (Date.now() - this._connectingTime)));
        await this.establishConnection();
    }

    async sayHello(options={}) {
        const udpConnected = new Promise((resolve, reject) => {
            this.once('inPacket', packet => (async () => {
                let pool = packet.servers2.pools.find(x => x.realm === 0 && x.courseId === 0);
                if (options.courseId) {
                    const dedicatedPool = packet.servers2.pools.find(x =>
                        x.realm === 1 && x.courseId === options.courseId);
                    if (dedicatedPool.length) {
                        pool= dedicatedPool;
                    }
                }
                const ip = pool.addresses.at(-1).ip;
                await this.establishUDPSocket(ip);
                resolve();
            })().catch(reject));
        });
        await this.sendTCP({
            athleteId: this.athleteId,
            _worldTime: 0,
            largWaTime: 0,
        }, {hello: true});
        await udpConnected;
        for (let i = 0; i < 4; i++) { // XXX
            await this.sendUDP({
                athleteId: this.athleteId,
                realm: 1,
                _worldTime: 0,
            }, {hello: true});
        }
        await this.establishUDPSocket('54.213.160.217'); // XXX
        await this.sendUDP({
            athleteId: this.athleteId,
            realm: 1,
            _worldTime: 0,
        }, {hello: true});
        await this.sendPlayerState();
        this.sendLoop = setInterval(async () => {
            await this.sendPlayerState();
        }, 1000);
    }

    async sendPlayerState(props={}, state={}, sendOptions={}) {
        const wt = dateToWorldTime(new Date());
        await this.sendUDP({
            athleteId: 0,
            realm: 1,
            _worldTime: wt,
            ...props,
            state: {
                athleteId: 0,
                _worldTime: wt,
                //distance: 0,
                //roadLocation: 680000,
                //laps: 0,
                //_speed: 0,
                //roadPosition: 10463403,
                //_cadenceUHz: 0,
                //draft: 0,
                //heartrate: 0,
                //power: 0,
                //_heading: 5235197,
                //lean: 970405,
                //climbing: 0,
                //time: 0,
                //_flags1: 393237,
                //_flags2: 33560079,
                //_progress: 0,
                justWatching: true,
                //_mwHours: 0,
                //x: 63127.33984375,
                //altitude: 11080.501953125,
                //y: -90862.140625,
                //watchingAthleteId: this.athleteId,
                watchingAthleteId: 62463,
                //groupId: 0,
                //sport: 0,
                //_distanceWithLateral: 3.11,
                //world: 6,
                //_f36: 0,
                //_f37: 2,
                //canSteer: false,
                ...this.playerState, // XXX
                ...state,
            }
        }, {forceSeq: true, dfPrefix: true, ...sendOptions});
    }

    async sendUDP(props, options={}) {
        const seqno = this._udpPacketSeqno++;
        const pb = protos.ClientToServer.encode({seqno, ...props});
        const prefixBuf = options.dfPrefix ? Buffer.from([0xdf]) : Buffer.alloc(0);
        const dataBuf = pb.finish();
        const headerBuf = this.encodeHeader(this._udpSendIV, options);
        const hashSeed = options.hello ? this.defaultHashSeed : this.serverHashSeeds[0];
        const hash = new XXHash32(hashSeed.seed);
        hash.update(dataBuf);
        hash.update(hashSeed.nonce); // XXX Not sure how server knows which once we're using.
        const hashBuf = hash.digest();
        // XXX I don't know why, but non hello-ish packets must be prefixed with 0xdf
        const plainBuf = Buffer.concat([prefixBuf, dataBuf, hashBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf, this._udpSendIV);
        const wireBuf = Buffer.concat([headerBuf, cipherBuf]);
        //console.debug("Sending UDP packet");
        //console.debug("  iv", this._udpSendIV.toString(), this._udpSendIV.toBuffer().toString('hex'));
        //console.debug('  header', headerBuf.toString('hex'));
        //console.debug('  [prefix]+data', prefixBuf.toString('hex'), dataBuf.toString('hex'));
        //console.debug('  hash', hashBuf.toString('hex'));
        this._udpSendIV.seqno++;
        await new Promise((resolve, reject) =>
            this.udpSock.send(wireBuf, e => void (e ? reject(e) : resolve())));
        this.emit('outPacket', protos.ClientToServer.decode(dataBuf)); // XXX find alt use of protobufs
    }

    async sendTCP(props, options={}) {
        const seqno = this._tcpPacketSeqno++;
        const pb = protos.ClientToServer.encode({seqno, ...props});
        const dataBuf = pb.finish();
        const headerBuf = this.encodeHeader(this._tcpSendIV, options);
        const magic = Buffer.from([0x01, options.hello ? 0 : 1]);
        const hashSeed = options.hello ? this.defaultHashSeed : this.serverHashSeeds[0];
        const hash = new XXHash32(hashSeed.seed);
        hash.update(magic);
        hash.update(dataBuf);
        hash.update(hashSeed.nonce); // XXX Not sure how server knows which once we're using.
        const hashBuf = hash.digest();
        const plainBuf = Buffer.concat([magic, dataBuf, hashBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf, this._tcpSendIV);
        const sizeBuf = Buffer.alloc(2);
        sizeBuf.writeUInt16BE(headerBuf.byteLength + cipherBuf.byteLength);
        const wireBuf = Buffer.concat([sizeBuf, headerBuf, cipherBuf]);
        console.debug("Sending TCP packet");
        console.debug("  iv", this._tcpSendIV.toString(), this._tcpSendIV.toBuffer().toString('hex'));
        console.debug('  header', headerBuf.toString('hex'));
        console.debug('  magic', magic.toString('hex'));
        console.debug('  data', dataBuf.toString('hex'));
        console.debug('  hash', hashBuf.toString('hex'));
        this._tcpSendIV.seqno++;
        await new Promise(resolve => this.tcpConn.write(wireBuf, resolve));
        this.emit('outPacket', protos.ClientToServer.decode(dataBuf)); // XXX find alt use of protobufs
    }

    onUDPData(buf, rinfo) {
        try {
            this._onUDPData(buf, rinfo);
        } catch(e) {
            console.error(e);
            debugger;
        }
    }

    _onUDPData(buf, rinfo) {
        const plainBuf = this.decrypt(buf, this._udpRecvIV);
        queueMicrotask(() => this.processPacket(plainBuf));
    }

    onTCPData(nread, buf) {
        try {
            this._onTCPData(nread, buf);
        } catch(e) {
            console.error(e);
            debugger;
        }
    }

    _onTCPData(nread, buf) {
        const data = buf.subarray(0, nread);
        for (let offt = 0; offt < data.byteLength;) {
            let size;
            if (this.pendingSize) {
                size = this.pendingSize;
            } else {
                size = data.readUInt16BE(offt);
                offt += 2;
            }
            if (data.byteLength - offt + (this.pendingBuf ? this.pendingBuf.byteLength : 0) < size) {
                const dataCopy = Buffer.from(data.subarray(offt));
                offt += dataCopy.byteLength;
                if (!this.pendingBuf) {
                    this.pendingBuf = dataCopy;
                    this.pendingSize = size;
                } else {
                    // Yet-another-short-read.
                    this.pendingBuf = Buffer.concat([this.pendingBuf, dataCopy]);
                }
            } else {
                let completeBuf;
                if (this.pendingBuf) {
                    completeBuf = Buffer.concat([
                        this.pendingBuf,
                        data.subarray(offt, (offt += size - this.pendingBuf.byteLength))
                    ]);
                    this.pendingBuf = null;
                    this.pendingSize = null;
                    if (completeBuf.byteLength !== size) {
                        throw new Error("Assertion error about complete packet size");
                    }
                } else {
                    completeBuf = data.subarray(offt, (offt += size));
                }
                try {
                    const plainBuf = this.decrypt(completeBuf, this._tcpRecvIV);
                    queueMicrotask(() => this.processPacket(plainBuf));
                } catch(e) {
                    console.error('Decryption error:', e);
                }
            }
        }
    }

    processPacket(buf) {
        const pb = protos.ServerToClient.decode(buf);
        this.emit('inPacket', pb);
    }
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
        const size = Buffer.alloc(4);
        size.writeUInt32BE(pb.byteLength);
        this._socket.write(size);
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
