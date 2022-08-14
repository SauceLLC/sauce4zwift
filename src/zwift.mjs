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

const powerUpEnum = {
    0: 'FEATHER',
    1: 'DRAFT',
    4: 'BURRITO',
    5: 'AERO',
    6: 'GHOST',
};


export function decodePlayerStateFlags1(bits) {
    const powerMeter = !!(bits & 0x1);
    bits >>>= 1;
    const companionApp = !!(bits & 0x1);
    bits >>>= 1;
    const reverse = !!(bits & 0x1);
    bits >>>= 1;
    const reversing = !!(bits & 0x1);
    bits >>>= 1;
    const _b4_15 = bits & 0xfff;
    bits >>>= 12;
    const auxCourseId = bits & 0xff;
    bits >>>= 8;
    const rideons = bits;
    return {
        powerMeter,
        companionApp,
        reversing,
        reverse,
        _b4_15,
        auxCourseId,
        rideons,
    };
}


export function encodePlayerStateFlags1(props) {
    let bits = 0;
    bits |= props.rideons & 0xff;
    bits <<= 8;
    bits |= props.auxCourseId & 0xff;
    bits <<= 12;
    bits |= props._b4_15 & 0xfff;
    bits <<= 1;
    bits |= props.reversing;
    bits <<= 1;
    bits |= props.reverse;
    bits <<= 1;
    bits |= props.companionApp;
    bits <<= 1;
    bits |= props.powerMeter;
    return bits;
}


export function decodePlayerStateFlags2(bits) {
    const powerUping = bits & 0xf; // 15 = Not active, otherwise enum
    bits >>>= 4;
    const turning = {
        0: null,
        1: 'RIGHT',
        2: 'LEFT',
    }[bits & 0x3];
    bits >>>= 2;
    const overlapping = bits & 0x1;  // or near junction or recently on junction.  It's unclear.
    bits >>>= 1;
    const roadId = bits & 0xffff;
    bits >>>= 16;
    const _rem2 = bits; // XXX no idea
    return {
        activePowerUp: powerUping === 0xf ? null : powerUpEnum[powerUping],
        turning,
        overlapping,
        roadId,
        _rem2,
    };
}


export function encodePlayerStateFlags2(props) {
    let bits = 0;
    bits |= props._rem2 & 0x1ff;
    bits <<= 16;
    bits |= props.roadId & 0xffff;
    bits <<= 1;
    bits |= props.overlapping;
    bits <<= 2;
    bits |= {
        RIGHT: 1,
        LEFT: 2,
    }[props.turning] || 0;
    bits <<= 4;
    let powerUping = 0xf; // hidden, but possibly by server, so maybe do include it?
    if (props.activePowerUp) {
        [powerUping] = Object.entries(powerUpEnum).find(([v, k]) => k === props.activePowerUp);
    }
    bits |= powerUping & 0xf;
    return bits;
}


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


function seedToBuffer(num) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(num);
    return buf;
}


export class ZwiftAPI {
    async authenticate(username, password, options={}) {
        if (options.host) {
            this.host = options.host;
        }
        const r = await this.fetch('/auth/realms/zwift/protocol/openid-connect/token', {
            host: this.host || 'secure.zwift.com',
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
        this._authToken = resp;
        console.debug("Zwift auth token acquired");
        this._schedRefresh(this._authToken.expires_in * 1000 / 2);
        this.profile = await this.getProfile('me');
    }

    async _refreshToken() {
        if (!this._authToken) {
            console.warn("No auth token to refresh");
            return false;
        }
        const r = await this.fetch('/auth/realms/zwift/protocol/openid-connect/token', {
            host: this.host || 'secure.zwift.com',
            noAuth: true,
            method: 'POST',
            accept: 'json',
            body: new URLSearchParams({
                client_id: 'Zwift Game Client',
                grant_type: 'refresh_token',
                refresh_token: this._authToken.refresh_token,
            })
        });
        const resp = await r.json();
        this._authToken = resp;
        console.debug("Zwift auth token refreshed");
        this._schedRefresh(this._authToken.expires_in * 1000 / 2);
    }

    _schedRefresh(delay) {
        clearTimeout(this._nextRefresh);
        console.debug(`Refresh Zwift token in: ${Math.round(delay / 1000)} seconds`);
        this._nextRefresh = setTimeout(this._refreshToken.bind(this), Math.min(0x7fffffff, delay));
    }

    isAuthenticated() {
        return !!(this._authToken && this._authToken.access_token);
    }

    async fetch(urn, options={}, headers={}) {
        headers = headers || {};
        if (!options.noAuth) {
            if (!this.isAuthenticated()) {
                throw new TypeError('Auth token not set');
            }
            headers['Authorization'] = `Bearer ${this._authToken.access_token}`;
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
        const host = options.host || this.host || `us-or-rly101.zwift.com`;
        const q = options.query ? '?' + options.query : '';
        const r = await fetch(`https://${host}/${urn.replace(/^\//, '')}${q}`, {
            headers: {
                'Platform': 'OSX',
                'Source': 'Game Client',
                //'Source': 'zwift-companion', // Hack to make zwift-offline work
                'User-Agent': 'CNL/3.23.5 (macOS 12 Monterey; Darwin Kernel 21.5.0) zwift/1.0.101433 curl/7.78.0-DEV',
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

    async fetchPaged(urn, options={}, headers) {
        const results = [];
        let start = 0;
        let pages = 0;
        const pageLimit = options.pageLimit ? options.pageLimit : 10;
        const query = options.query || new URLSearchParams();
        const limit = options.limit || 100;
        query.set('limit', limit);
        while (true) {
            query.set('start', start);
            const page = await this.fetchJSON(urn, {query, ...options}, headers);
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

    async fetchJSON(urn, options, headers) {
        const r = await this.fetch(urn, {accept: 'json', ...options}, headers);
        return await r.json();
    }

    async fetchPB(urn, options, headers) {
        const r = await this.fetch(urn, {accept: 'protobuf', ...options}, headers);
        const ProtoBuf = protos.get(options.protobuf);
        const data = Buffer.from(await r.arrayBuffer());
        if (options.debug) {
            console.debug('PB API DEBUG', urn, data.toString('hex'));
        }
        return ProtoBuf.decode(data);
    }

    async getHashSeeds(options) {
        const data = (await this.fetchPB('/relay/worlds/hash-seeds', {
            protobuf: 'HashSeeds',
            ...options
        }));
        return Array.from(data.seeds).map(x => ({
            nonce: seedToBuffer(x.nonce),
            seed: seedToBuffer(x.seed),
        }));
    }

    async getProfile(id, options) {
        try {
            return await this.fetchJSON(`/api/profiles/${id}`, options);
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
    }

    async getProfiles(ids, options) {
        const unordered = (await this.fetchPB('/api/profiles', {
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

    convSegmentResult(x) {
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

    async getLiveSegmentLeaders() {
        const data = await this.fetchPB(`/live-segment-results-service/leaders`,
            {protobuf: 'SegmentResults'});
        return data.results.filter(x => +x.id).map(this.convSegmentResult);
    }

    async getLiveSegmentLeaderboard(segmentId) {
        const data = await this.fetchPB(`/live-segment-results-service/leaderboard/${segmentId}`,
            {protobuf: 'SegmentResults'});
        return data.results.map(this.convSegmentResult);
    }

    async getSegmentResults(segmentId, options={}) {
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
        return (await this.fetchPB('/api/segment-results', {query, protobuf: 'SegmentResults'})).results;
    }

    async getGameInfo() {
        return await this.fetchJSON(`/api/game_info`, {apiVersion: '2.6'});
    }

    async searchProfiles(searchText, options={}) {
        return await this.fetchPaged('/api/search/profiles', {
            method: 'POST',
            json: {query: searchText},
        });
    }

    async getFollowees(athleteId, options={}) {
        return await this.fetchPaged(`/api/profiles/${athleteId}/followees`);
    }

    async getFollowers(athleteId, options={}) {
        return await this.fetchPaged(`/api/profiles/${athleteId}/followers`);
    }

    async _setFollowing(them, us) {
        return await this.fetchJSON(`/api/profiles/${us}/following/${them}`, {
            method: 'POST',
            json: {
                followeeId: them,
                followerId: us,
            },
        });
    }

    async _setNotFollowing(them, us) {
        const resp = await this.fetch(`/api/profiles/${us}/following/${them}`, {method: 'DELETE'});
        if (!resp.ok) {
            throw new Error(resp.status);
        }
    }

    async _giveRideon(to, from, activity=0) {
        // activity 0 is an in-game rideon
        await this.fetchJSON(`/api/profiles/${to}/activities/${activity}/rideon`, {
            method: 'POST',
            json: {profileId: from},
        });
    }

    async getNotifications() {
        return await (await this.fetch(`/api/notifications`, {accept: 'json'})).json();
    }

    async getEventFeed(options={}) {
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
            const page = await this.fetchJSON(urn, {query});
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

    async getPrivateEventFeed(options={}) {
        // This endpoint is also unreliable and the from/to don't seem to do much.
        // Sometimes it returns all meetups, and sometimes just recent ones if any.
        const start_date = +options.from || (Date.now() - (3600 * 1000));
        const end_date = +options.to || (Date.now() + (3600 * 1000));
        const query = new URLSearchParams({start_date, end_date});
        return await this.fetchJSON('/api/private_event/feed', {query});
    }

    async getEvent(id) {
        return await this.fetchJSON(`/api/events/${id}`);
    }

    async getPrivateEvent(id) {
        return await this.fetchJSON(`/api/private_event/${id}`);
    }
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


export class RelayIV {
    constructor(props={}) {
        this.seqno = 0;
        this.deviceType = 'relay';
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
        return `RelayIV deviceType:${this.deviceType} channelType:${this.channelType} connId:${this.connId} seqno:${this.seqno}`;
    }
}


// These are real values, not test data...
const defaultHashSeed = {
    nonce: seedToBuffer(1234),
    seed: seedToBuffer(5678),
};


class NetChannel extends events.EventEmitter {
    static getConnInc() {
        return this._connInc++; // Defined by subclasses so tcp and udp each have their own counter
    }

    constructor(options={}) {
        super();
        this.ip = options.ip;
        this.proto = options.proto;
        this.connId = this.constructor.getConnInc();
        this.relayId = options.relayId;
        this.hashSeeds = options.hashSeeds;
        this.aesKey = options.aesKey;
        this._sendSeqno = 0;
        this.sendIV = new RelayIV({channelType: `${options.proto}Client`, connId: this.connId});
        this.recvIV = new RelayIV({channelType: `${options.proto}Server`, connId: this.connId});
    }

    toString() {
        return `<NetChannel [${this.proto}] connId: ${this.connId}, relayId: ${this.relayId}>`;
    }

    decrypt(data) {
        const iv = this.recvIV;
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
        const decipher = crypto.createDecipheriv('aes-128-gcm', this.aesKey, ivBuf, {authTagLength: 4});
        decipher.setAAD(data.subarray(0, headerOfft));
        decipher.setAuthTag(data.subarray(-4));
        const plain = Buffer.concat([decipher.update(data.subarray(headerOfft, -4)), decipher.final()]);
        iv.seqno++;
        return plain;
    }

    encrypt(aad, data) {
        const cipher = crypto.createCipheriv('aes-128-gcm', this.aesKey, this.sendIV.toBuffer(),
            {authTagLength: 4});
        cipher.setAAD(aad);
        const dataBuf = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
        this.sendIV.seqno++;
        return dataBuf;
    }

    encodeHeader(options={}) {
        const iv = this.sendIV;
        let flags = 0;
        let headerOfft = 1;
        const header = Buffer.alloc(1 + 4 + 2 + 4);
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

    establish() {
        this.active = true;
    }

    shutdown(options) {
        if (this.active) {
            this.active = false;
            this.emit('shutdown', this);
        }
    }

    makeDataPBAndBuffer(props) {
        const seqno = this._sendSeqno++;
        const pb = protos.ClientToServer.fromObject({seqno, ...props});
        return [pb, protos.ClientToServer.encode(pb).finish()];
    }

    makeHashBuf(dataBuf, options={}) {
        const hashSeed = options.hello ? defaultHashSeed : this.hashSeeds[0];
        const hash = new XXHash32(hashSeed.seed);
        hash.update(dataBuf);
        hash.update(hashSeed.nonce);
        return hash.digest();
    }
}


class TCPChannel extends NetChannel {
    static _connInc = 0;

    constructor(options) {
        super({proto: 'tcp', ...options});
        this.conn = null;
    }

    async establish() {
        this.conn = net.createConnection({
            host: this.ip,
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
            this.conn.once('connect', resolve);
            this.conn.once('error', reject);
        });
        this.conn.on('close', () => this.shutdown());
        super.establish();
    }

    shutdown() {
        super.shutdown();
        if (this.conn) {
            this.conn.removeAllListeners();
            this.conn.end();
            this.conn = null;
        }
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
                    const plainBuf = this.decrypt(completeBuf);
                    this.emit('inPacket', protos.ServerToClient.decode(plainBuf), this);
                } catch(e) {
                    console.error('Decryption error:', e);
                }
            }
        }
    }

    async sendPacket(props, options={}) {
        const [pb, dataBuf] = this.makeDataPBAndBuffer(props);
        const headerBuf = this.encodeHeader(options);
        const magic = Buffer.from([0x01, options.hello ? 0 : 1]);
        const hashBuf = this.makeHashBuf(dataBuf, options);
        const plainBuf = Buffer.concat([magic, dataBuf, hashBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf);
        const sizeBuf = Buffer.alloc(2);
        sizeBuf.writeUInt16BE(headerBuf.byteLength + cipherBuf.byteLength);
        const wireBuf = Buffer.concat([sizeBuf, headerBuf, cipherBuf]);
        await new Promise(resolve => this.conn.write(wireBuf, resolve));
        this.emit('outPacket', pb);
    }
}


class UDPChannel extends NetChannel {
    static _connInc = 0;

    constructor(options) {
        super({proto: 'udp', ...options});
        this.athleteId = options.athleteId;
        this.courseId = options.courseId;
        this.sock = null;
        this.isDirect = options.isDirect;
    }

    toString() {
        return `<UDPChannel [${this.isDirect ? 'DIRECT' : 'LB'}] courseId: ${this.courseId} ` +
            `connId: ${this.connId} relayId: ${this.relayId}>`;
    }

    async establish() {
        this.sock = dgram.createSocket('udp4');
        this.sock.on('message', this.onUDPData.bind(this));
        this.sock.on('close', () => this.shutdown());
        this.sock.on('error', () => this.shutdown());
        await new Promise((resolve, reject) =>
            this.sock.connect(3024, this.ip, e => void (e ? reject(e) : resolve())));
        super.establish();
    }
 
    shutdown() {
        super.shutdown();
        if (this.sock) {
            this.sock.removeAllListeners();
            this.sock.close();
            this.sock = null;
        }
    }

    onUDPData(buf) {
        try {
            this._onUDPData(buf);
        } catch(e) {
            console.error(e);
            debugger;
        }
    }

    _onUDPData(buf, rinfo) {
        this.emit('inPacket', protos.ServerToClient.decode(this.decrypt(buf)), this);
    }

    async sendPacket(props, options={}) {
        const [pb, dataBuf] = this.makeDataPBAndBuffer(props);
        const prefixBuf = options.dfPrefix ? Buffer.from([0xdf]) : Buffer.alloc(0);
        const headerBuf = this.encodeHeader({forceSeq: true, ...options});
        const hashBuf = this.makeHashBuf(dataBuf, options);
        const plainBuf = Buffer.concat([prefixBuf, dataBuf, hashBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf, this._udpSendIV);
        const wireBuf = Buffer.concat([headerBuf, cipherBuf]);
        await new Promise((resolve, reject) =>
            this.sock.send(wireBuf, e => void (e ? reject(e) : resolve())));
        this.emit('outPacket', pb);
    }

    async sendHandshake() {
        await this.sendPacket({
            athleteId: this.athleteId,
            realm: 1,
            _worldTime: 0,
        }, {hello: true});
    }

    async sendPlayerState(state) {
        const wt = dateToWorldTime(new Date());
        await this.sendPacket({
            athleteId: this.athleteId,
            realm: 1,
            _worldTime: wt,
            state: {
                athleteId: this.athleteId,
                _worldTime: wt,
                justWatching: true,
                x: 0,
                altitude: 0,
                y: 0,
                courseId: this.courseId,
                ...state,
            }
        }, {dfPrefix: true});
    }
}


export class GameClient extends events.EventEmitter {
    constructor(options={}) {
        super();
        this.api = options.zwiftAPI;
        this.athleteId = this.api.profile.id;
        this.monitorAthleteId = options.monitorAthleteId;
        this.watchingAthleteId = this.monitorAthleteId;
        this.relayId = null;
        this.udpServerPools = new Map();
        this.tcpChannel = null;
        this.udpChannel = null;
        this.connected = false;
    }

    async login(options) {
        this.aesKey = crypto.randomBytes(16);
        const login = await this.api.fetchPB('/api/users/login', {
            method: 'POST',
            pb: protos.LoginRequest.encode({
                aesKey: this.aesKey,
                properties: {
                    entries: [
                        {key: 'OS Type', value: 'macOS'},
                        {key: 'OS', value: 'OSX 10.X 64bit'},
                        {key: 'COMPUTER', value: 'MacBookPro18,2'},
                        {key: 'Machine Id', value: '2-d9d8235c-f1b5-4415-b90e-deadbeef098c'}
                    ],
                }
            }),
            protobuf: 'LoginResponse',
            ...options,
        });
        this.hashSeeds = await this.api.getHashSeeds();
        this.relayId = login.relaySessionId;
        this.tcpServers = login.session.tcpConfig.servers;
    }

    async logout() {
        // XXX does this do anything?
        const resp = await this.api.fetch('/api/users/logout', {method: 'POST'});
        if (!resp.ok) {
            throw new Error("Game client logout failed:", await resp.text());
        }
    }

    async connect(options) {
        this.connected = false;
        await this.login(options);
        await sleep(1000); // No joke this is required (100ms works about 50% of the time)
        await this.establishConnection(options);
        await this.sayHello(options);
        this.connected = true;
    }

    disconnect(options={}) {
        this.connected = false;
        clearInterval(this.sendLoop);
        if (this.udpChannel) {
            this.udpChannel.shutdown();
            this.udpChannel = null;
        }
        if (this.tcpChannel) {
            this.tcpChannel.shutdown();
            this.tcpChannel = null;
        }
    }

    async establishConnection(options={}) {
        this._connectingTime = Date.now();
        if (this.tcpChannel) {
            this.tcpChannel.shutdown();
        }
        const servers = this.tcpServers.filter(x => x.realm === 0 && x.courseId === 0);
        const ip = servers[0].ip;
        console.info(`Establishing TCP channel to:`, ip);
        this.tcpChannel = new TCPChannel({ip, relayId: this.relayId, hashSeeds: this.hashSeeds, aesKey: this.aesKey});
        this.tcpChannel.on('shutdown', this.onChannelShutdown.bind(this));
        this.tcpChannel.on('inPacket', this.onInPacket.bind(this));
        await this.tcpChannel.establish();
    }

    makeUDPChannel(courseId) {
        let servers = this.udpServerPools.get(courseId);
        const isDirect = !!servers;
        if (!servers) {
            servers = this.udpServerPools.get(0);
        }
        const ip = servers[0].ip;
        console.info(`Establishing UDP channel to course=${courseId}:`, ip);
        return new UDPChannel({
            ip,
            courseId,
            athleteId: this.athleteId,
            relayId: this.relayId,
            hashSeeds: this.hashSeeds,
            aesKey: this.aesKey,
            isDirect,
        });
    }

    onChannelShutdown(ch) {
        console.warn("TBD: TCP channel shutdown behavior", ch);
    }

    async sayHello(options={}) {
        const udpServersAvailable = new Promise(resolve =>
            this.once('udpServerPoolsUpdated', resolve));
        await this.tcpChannel.sendPacket({
            athleteId: this.athleteId,
            _worldTime: 0,
            largWaTime: 0,
        }, {hello: true});
        await udpServersAvailable;
        await this.setUDPChannel(6);
        this.sendLoop = setInterval(this.sendPlayerState.bind(this), 1000);
    }

    async sendPlayerState() {
        await this.udpChannel.sendPlayerState({watchingAthleteId: this.watchingAthleteId});
        if (this.watchingAthleteId !== this.monitorAthleteId) {
            await this.udpChannel.sendPlayerState({watchingAthleteId: this.monitorAthleteId});
        }
    }

    setWatching(athleteId) {
        console.info("Setting watched athlete to:", athleteId);
        this.watchingAthleteId = athleteId;
        this.sendPlayerState(); // bg okay
        this.emit("watching-athlete", athleteId);
    }

    async setUDPChannel(courseId) {
        if (this.udpChannel) {
            console.warn("Replacing UDP Channel for:", courseId);
            this.udpChannel.shutdown();
            this.udpChannel = null;
        }
        const ch = this.makeUDPChannel(courseId);
        ch.on('shutdown', () => {
            console.warn("UDP Channel shutdown", ch.toString());
            const old = this.udpChannel;
            if (old === ch) {
                this.udpChannel = null;
            }
        });
        ch.on('inPacket', this.onInPacket.bind(this));
        this.udpChannel = ch;
        await ch.establish();
        for (let i = 0; i < 5; i++) { // be like real game
            await ch.sendHandshake();
        }
        await ch.sendPlayerState();
    }

    async sendHandshake(ch) {
        await ch.sendPacket({
            athleteId: this.athleteId,
            realm: 1,
            _worldTime: 0,
        }, {hello: true});
    }

    async sendDisconnect() {
        await this.udpChannel.sendPacket({
            athleteId: this.athleteId,
            realm: -1,
            _worldTime: 0,
        });
    }

    onInPacket(pb, ch) {
        if (pb.udpConfigVOD && pb.udpConfigVOD.pools) {
            for (const x of pb.udpConfigVOD.pools) {
                this.udpServerPools.set(x.courseId, x.servers);
            }
            this.emit('udpServerPoolsUpdated', this.udpServerPools);
            const available = new Set(this.udpServerPools.keys());
            const udpCh = this.udpChannel;
            if (udpCh && !udpCh.isDirect && available.has(udpCh.courseId)) {
                console.info("Upgrading UDP channel to direct server:", udpCh.toString());
                this.setUDPChannel(udpCh.courseId);
            }
        }
        if (pb.playerStates && pb.playerStates.length) {
            console.debug(`IN DATA| states: ${pb.playerStates.length} ${ch.toString()}`);
            const state = pb.playerStates.find(x => x.athleteId === this.monitorAthleteId);
            if (state && state.watchingAthleteId !== this.watchingAthleteId) {
                this.setWatching(state.watchingAthleteId);
            }
        }
        this.emit('inPacket', pb);
    }
}


export class GameConnectionServer extends net.Server {
    constructor({ip, zwiftAPI}) {
        super();
        this.ip = ip;
        this.api = zwiftAPI;
        this._socket = null;
        this._msgSize = null;
        this._msgOfft = 0;
        this._msgBuf = null;
        this._seqno = 1;
        this._cmdSeqno = 1;
        this.athleteId = zwiftAPI.profile.id;
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
        await this.api.fetch('/relay/profiles/me/phone', {
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
                firstName: this.api.profile.firstName,
                lastName: this.api.profile.lastName,
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
        //await this.sendCommands({
        //    command: protos.CompanionToGameCommandType.PAIRING_AS,
        //    athleteId: this.athleteId,
        //});
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
