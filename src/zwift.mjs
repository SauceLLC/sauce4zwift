import Path from 'node:path';
import Net from 'node:net';
import Dgram from 'node:dgram';
import Events from 'node:events';
import Crypto from 'node:crypto';
import OS from 'node:os';
import Protobuf from 'protobufjs';
import * as Env from './env.mjs';
import {parseXml} from '@rgrove/parse-xml';
import {fileURLToPath} from 'node:url';

const __dirname = Path.dirname(fileURLToPath(import.meta.url));

export const protos = new Protobuf.Root();
protos.loadSync(Path.join(__dirname, 'zwift.proto'), {keepCase: true});

const zOffline = null;  // 'localhost';
const HOUR = 3600 * 1000;

// NOTE: this options object does not contain callback functions (as it might appear).
// A static type comparison is used by protobufjs's toObject function instead. :(
const _pbJSONOptions = {
    ...Protobuf.util.toJSONOptions,
    longs: Number,
    bytes: null,  // pass through
};

const sockTerminatedSymbol = Symbol('sauceTerminatedSocket');

export class ChannelShutdownError extends Error {
    constructor({reason, error}={}) {
        super(`Shutdown: ${reason || 'unset-reason'}`);
        this.reason = reason;
        this.parentError = error;
    }
}

export class GameMonitorSessionNotReadyError extends Error {}


export function pbToObject(pb) {
    return pb.$type.toObject(pb, _pbJSONOptions);
}


export function pbToObjectWithOptions(pb, options) {
    return pb.$type.toObject(pb, {..._pbJSONOptions, ...options});
}


export const eventRulesBits = {
    0: 'NO_POWERUPS',
    1: 'NO_DRAFTING',
    2: 'NO_TT_BIKES',
    3: 'LADIES_ONLY',
    4: 'MEN_ONLY',
    5: 'DISABLE_CONTROLLED_ROLLOUT', // likely deprecated
    6: 'SHOW_RACE_RESULTS',
    7: 'REVERSE_ROUTE', // likely deprecated
    8: 'ALLOWS_LATE_JOIN',
    9: '_UNKNOWN', // likely deprecated
    10: 'RUBBERBANDING',
    11: 'ENFORCE_NO_ZPOWER',
    12: 'ONLY_ZPOWER',
    13: 'ENFORCE_HRM',
};

const eventRulesMasks = Object.entries(eventRulesBits)
    .map(([bit, flag]) => [1 << bit, flag]);

// When game lags it can send huge values.  BLE testing suggests 240 is
// their normal limit and they just drop values over this and send 1. So
// we'll emulate that behavior.
const cadenceMax = 240 * 1e6 / 60;
const halfCircle = 1e6 * Math.PI;
const pbProfilePrivacyFlags = {
    privateMessaging: 0x1,
    minor: 0x2,
    displayWeight: 0x4,
    approvalRequired: 0x8,
    defaultFitnessDataPrivacy: 0x10,
    suppressFollowerNotification: 0x20,
};
const pbProfilePrivacyFlagsInverted = {
    displayAge: 0x40,
};

export const powerUpsEnum = new Array(0xf);
for (const [k, v] of Object.entries(protos.POWERUP_TYPE)) {
    powerUpsEnum[v] = k;
}
powerUpsEnum[0xf] = null;  // masked

const turningEnum = [
    null,
    'RIGHT',
    'LEFT',
];


export class WorldTimer extends Events.EventEmitter {

    constructor() {
        super();
        this._epoch = 1414016074400;
        this._offt = 0;
    }

    clone() {
        const clone = new this.constructor();
        clone._epoch = this._epoch;
        clone._offt = this._offt;
        return clone;
    }

    now() {
        return Date.now() + this._offt - this._epoch;
    }

    serverNow() {
        return Date.now() + this._offt;
    }

    toLocalTime(wt) {
        return wt + this._epoch - this._offt;
    }

    fromLocalTime(ts) {
        return ts - this._epoch + this._offt;
    }

    toServerTime(wt) {
        return wt + this._epoch;
    }

    getOffset() {
        return this._offt;
    }

    setOffset(ms) {
        const offt = Math.round(ms);
        const shift = offt - this._offt;
        this._offt = offt;
        this.emit('offset', this._offt);
        this.emit('shift', shift);
    }
}

export const worldTimer = new WorldTimer();


export function parseEventRules(rulesId=0) {
    const flags = [];
    for (const {0: mask, 1: flag} of eventRulesMasks) {
        if (rulesId & mask) {
            flags.push(flag);
        }
    }
    return flags;
}


export function convertSegmentResultProtobufToObject(pb) {
    const ret = pbToObject(pb);
    const activityId = pb.activityId.isZero() ? null : pb.activityId.toString();
    Object.assign(ret, {
        activityId,  // fix overflow
        id: pb.id.toString(),  // fix overflow
        segmentId: pb._unsignedSegmentId.toSigned().toString(),
        ts: worldTimer.toServerTime(ret.worldTime),
        weight: pb.weight / 1000,
        elapsed: pb.elapsed / 1000,
        gender: pb.male === false ? 'female' : 'male',
    });
    delete ret.finishTime; // worldTime and ts are better and always available
    delete ret._unsignedSegmentId;
    delete ret.male;
    return ret;
}


// Optimized for fast path perf...
const _idHashes = new Map();
const _idHashTimestamps = new Map();
let _idHashUse = 0;
export function getIDHash(id) {
    let hash = _idHashes.get(id);
    if (!hash) {
        _idHashUse++;
        hash = sha256('' + id);
        const now = performance.now();
        _idHashes.set(id, hash);
        _idHashTimestamps.set(id, now);
        if (_idHashUse % 100 === 0) {
            for (const [x_id, ts] of _idHashTimestamps.entries()) {
                if (now - ts > 900000) {
                    _idHashes.delete(x_id);
                    _idHashTimestamps.delete(x_id);
                }
            }
        }
    }
    return hash;
}


function sha256(str) {
    return Crypto.createHash('sha256').update(str).digest('hex');
}


function fmtTime(ms) {
    if (isNaN(ms)) {
        return ms;
    }
    const sign = ms < 0 ? '-' : '';
    ms = Math.abs(ms);
    if (ms > 90_000) {
        const seconds = Math.round(ms / 1000);
        const m = Math.trunc(seconds / 60);
        const s = Math.round(seconds % 60);
        return s ? `${sign}${m}m, ${s}s` : `${sign}${m}m`;
    } else if (ms > 1500) {
        return `${sign}${(ms % 60_000 / 1000).toFixed(1)}s`;
    } else {
        return `${sign}${Math.round(ms)}ms`;
    }
}


function zwiftCompatDate(date) {
    return date && (date.toISOString().slice(0, -5) + 'Z');
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function decodePlayerStateFlags1(bits) {
    return decodePlayerStateFlags1Into(bits, {});
}


export function decodePlayerStateFlags1Into(bits, obj) {
    // micoroptimized
    obj.powerMeter = !!(bits & 0b1);
    obj.companionApp = !!(bits & 0b10);
    obj.reverse = !(bits & 0b100);  // It's actually a forward bit
    obj.uTurn = !!(bits & 0b1000);
    obj.auxCourseId = bits >>> 16 & 0xff;
    obj.rideons = bits >>> 24;
    return obj;
}


export function decodePlayerStateFlags1IntoWithDebug(bits, obj) {
    // micoroptimized
    decodePlayerStateFlags1Into(bits, obj);
    obj._b4_15 = bits >>> 4 & 0xfff;  // Client seems to send 0x1 when no-sensor/not-moving
    return obj;
}


export function encodePlayerStateFlags1(props) {
    let bits = 0;
    bits |= props.rideons & 0xff;
    bits <<= 8;
    bits |= props.auxCourseId & 0xff;
    bits <<= 12;
    bits |= props._b4_15 & 0xfff;
    bits <<= 1;
    bits |= props.uTurn;
    bits <<= 1;
    bits |= !props.reverse;
    bits <<= 1;
    bits |= props.companionApp;
    bits <<= 1;
    bits |= props.powerMeter;
    return bits;
}


export function decodePlayerStateFlags2(bits) {
    return decodePlayerStateFlags2Into(bits, {});
}


export function decodePlayerStateFlags2Into(bits, obj) {
    // micoroptimized
    obj.activePowerUp = powerUpsEnum[bits & 0xf];
    obj.turning = turningEnum[bits >>> 4 & 0x3],
    obj.turnChoice = bits >>> 6 & 0x3;
    obj.roadId = bits >>> 8 & 0xffff;
    return obj;
}


export function decodePlayerStateFlags2IntoWithDebug(bits, obj) {
    // micoroptimized
    decodePlayerStateFlags2Into(bits, obj);
    obj._rem =bits >>> 24; // client seems to send 0x1 or 0x2 when no-sensor and not moving
    return obj;
}


export function encodePlayerStateFlags2(props) {
    let bits = 0;
    bits |= props._rem & 0xff;
    bits <<= 16;
    bits |= props.roadId & 0xffff;
    bits <<= 2;
    bits |= props.turnChoice & 0x3;
    bits <<= 2;
    bits |= {
        RIGHT: 1,
        LEFT: 2,
    }[props.turning] || 0;
    bits <<= 4;
    let powerUping = 0xf;
    if (props.activePowerUp) {
        powerUping = protos.POWERUP_TYPE[props.activePowerUp];
    }
    bits |= powerUping & 0xf;
    return bits;
}


export function processPlayerStateMessage(msg, now=worldTimer.now()) {
    const o = {...msg};
    decodePlayerStateFlags1Into(msg._flags1, o);
    decodePlayerStateFlags2Into(msg._flags2, o);
    o.worldTime = msg.worldTime.toNumber();
    o.latency = now - o.worldTime;
    o.routeId = msg.portal ? undefined : (msg.routeId || undefined);
    o.progress = (msg._progress >> 8 & 0xff) / 0xff;
    o.workoutZone = (msg._progress & 0xF) || null;
    o.kj = msg._mwHours * 0.0036;
    o.heading = (((msg._heading + halfCircle) / (2 * halfCircle)) * 360) % 360;
    o.speed = msg._speed / 1e6;
    o.sport = protos.Sport[msg.sport];
    o.cadence = (msg._cadence && msg._cadence < cadenceMax) ? Math.round(msg._cadence * 6e-5) : 0;
    o.eventDistance = msg._eventDistance / 100;
    o.roadCompletion = o.reverse ? 1005000 - msg.roadTime : msg.roadTime - 5000,
    o.coffeeStop = o.activePowerUp === 'COFFEE_STOP';
    return o;
}


export class ZwiftAPI {
    constructor(options={}) {
        this.exclusions = options.exclusions || new Set();
        this.getTime = options.getTime || (() => Date.now());
    }

    async authenticate(username, password, options={}) {
        if (options.host) {
            this.host = options.host;
        }
        if (options.scheme) {
            this.scheme = options.scheme;
        }
        const r = await this.fetch('/auth/realms/zwift/protocol/openid-connect/token', {
            host: this.host || zOffline || 'secure.zwift.com',
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
        this.username = username;
        this._authToken = resp;
        this._authTokenTime = this.getTime();
        console.debug("Zwift auth token acquired");
        this._schedRefresh(this._authToken.expires_in * 1000 / 2);
        this.profile = await this.getProfile('me');
    }

    setExclusions(exclusions) {
        this.exclusions = exclusions;
    }

    refreshToken() {
        if (!this._authToken) {
            throw new Error('No auth token available');
        }
        if (!this._refreshingToken) {
            this._refreshingToken = this._refreshToken();
            this._refreshingToken.catch(e => console.error('Problem refreshing auth token:', e));
            this._refreshingToken.finally(() => this._refreshingToken = null);
        }
        return this._refreshingToken;
    }

    async _refreshToken() {
        const r = await this.fetch('/auth/realms/zwift/protocol/openid-connect/token', {
            host: this.host || zOffline || 'secure.zwift.com',
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
        this._authTokenTime = this.getTime();
        console.info("Zwift auth token refreshed");
        this._schedRefresh(this._authToken.expires_in * 1000 / 2);
    }

    _schedRefresh(delay) {
        clearTimeout(this._nextRefresh);
        console.debug('Refresh Zwift auth token in:', fmtTime(delay));
        this._nextRefresh = setTimeout(this.refreshToken.bind(this), Math.min(0x7fffffff, delay));
    }

    isAuthenticated() {
        return !!(
            this._authToken &&
            this._authToken.access_token &&
            this._authTokenTime &&
            this._authTokenTime + this._authToken.expires_in * 1000 > this.getTime()
        );
    }

    canRefreshToken() {
        return !!(
            this._authToken &&
            this._authToken.refresh_token &&
            this._authTokenTime &&
            this._authTokenTime + (this._authToken.refresh_expires_in - 30) * 1000 > this.getTime()
        );
    }

    async fetch(urn, options={}, headers={}) {
        headers = headers || {};
        if (!options.noAuth) {
            if (this._refreshingToken) {
                await this._refreshingToken;
            }
            if (!this.isAuthenticated()) {
                if (this.canRefreshToken()) {
                    await this.refreshToken();
                } else {
                    throw new TypeError('Missing valid Zwift auth token');
                }
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
        const defHeaders = {
            'Platform': 'OSX',
            'Source': 'Game Client',
            'User-Agent': 'CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0'
        };
        let query = options.query;
        if (query && !(query instanceof URLSearchParams)) {
            query = new URLSearchParams(Object.entries(query).filter(([k, v]) => v != null));
        }
        const q = query ? `?${query}` : '';
        let uri = options.uri;
        if (!uri) {
            const host = options.host || this.host || zOffline || 'us-or-rly101.zwift.com';
            const scheme = options.scheme || this.scheme || 'https';
            uri = `${scheme}://${host}/${urn.replace(/^\//, '')}`;
        }
        if (!options.silent) {
            console.debug(`Fetch: ${options.method || 'GET'} ${uri}${q}`);
        }
        const timeout = options.timeout !== undefined ? options.timeout : 30000;
        const r = await fetch(`${uri}${q}`, {
            signal: timeout ? AbortSignal.timeout(timeout) : undefined,
            headers: {...defHeaders, ...headers},
            ...options,
        });
        if (!r.ok && (!options.ok || !options.ok.includes(r.status))) {
            const msg = await r.text();
            if (r.status === 401 && !options.noAuth) {
                console.warn("Unlikely Zwift auth expiration.");
                if (this.canRefreshToken()) {
                    this._schedRefresh(100);
                }
            }
            const e = new Error(`Zwift HTTP Error: [${r.status}]: ${msg}`);
            e.status = r.status;
            throw e;
        }
        return r;
    }

    async fetchPaged(urn, options={}, headers) {
        const results = [];
        let start = options.start || 0;
        let pages = 0;
        const pageLimit = options.pageLimit == null ? 10 : options.pageLimit;
        const query = options.query || new URLSearchParams();
        const limit = options.limit || 100;
        query.set('limit', limit);
        while (true) {
            query.set('start', start);
            const page = await this.fetchJSON(urn, {query, ...options}, headers);
            for (const x of page) {
                results.push(x);
            }
            if (options.onPage && page.length) {
                if (await options.onPage(page) === false) {
                    break;
                }
            }
            if (page.length < limit || (pageLimit && ++pages >= pageLimit)) {
                break;
            }
            start = results.length;
        }
        return results;
    }

    async fetchJSON(urn, options, headers) {
        const r = await this.fetch(urn, {accept: 'json', ...options}, headers);
        if (r.status === 204) {
            return;
        }
        return await r.json();
    }

    async fetchPB(urn, options, headers) {
        const r = await this.fetch(urn, {accept: 'protobuf', ...options}, headers);
        const data = Buffer.from(await r.arrayBuffer());
        if (options.debug) {
            console.debug('PB API DEBUG', urn, data.toString('hex'));
        }
        const ProtoBuf = protos.get(options.protobuf);
        return ProtoBuf.decode(data);
    }

    async getPowerProfile() {
        return await this.fetchJSON(`/api/power-curve/power-profile`);
    }

    _profileFieldsOnlyJSON = new Set([
        'competitionMetrics',
        'socialFacts',
        'currentActivityId',
        'likelyInGame',
        'b',  // shadow banned
    ]);

    _profileFieldsOnlyProtobuf = new Set([
        'equipment',
    ]);

    async getProfile(id, {required}={}) {
        if (this.exclusions.has(getIDHash(id))) {
            return;
        }
        // Some fields are only available on the JSON or PB endpoint
        const fetching = [];
        if (required) {
            if (required.some(x => this._profileFieldsOnlyJSON.has(x))) {
                fetching.push(this._getProfileJSON(id));
            }
            if (required.some(x => this._profileFieldsOnlyProtobuf.has(x))) {
                fetching.push(this._getProfilePB(id));
            }
        }
        if (!fetching.length) {
            fetching.push(this._getProfileJSON(id));
        }
        const merged = {};
        for (const x of await Promise.all(fetching)) {
            Object.assign(merged, x);
        }
        return merged;
    }

    async _getProfileJSON(id) {
        try {
            // Profile JSON is invalid for `currentActivityId` (Number type overflow).
            // Use custom JSON.parse(..., replacer) to return the uncoerced value.
            const resp = await this.fetch(`/api/profiles/${id}`, {accept: 'json'});
            const json = await resp.text();
            const data = JSON.parse(json, (k, v, {source}) =>
                (k === 'currentActivityId' && v !== null) ? source : v);
            return data;
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
    }

    async _getProfilePB(id) {
        try {
            return this._shapeProfileProtobufToJSON(
                pbToObject(await this.fetchPB(`/api/profiles/${id}`, {protobuf: 'PlayerProfile'})));
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
    }

    _shapeProfileProtobufToJSON(profile) {
        profile.privacy = {
            defaultActivityPrivacy: profile.defaultActivityPrivacy,
        };
        delete profile.defaultActivityPrivacy;
        for (const {0: k, 1: flag} of Object.entries(pbProfilePrivacyFlags)) {
            profile.privacy[k] = !!(+profile.privacyBits & flag);
        }
        for (const {0: k, 1: flag} of Object.entries(pbProfilePrivacyFlagsInverted)) {
            profile.privacy[k] = !(+profile.privacyBits & flag);
        }
        delete profile.privacyBits;
        profile.powerSourceModel = {
            VIRTUAL: 'zPower',
            POWER_METER: 'Power Meter',
            SMART_TRAINER: 'Smart Trainer',
        }[profile.powerType];
        delete profile.followerStatusOfLoggedInPlayer;
        return profile;
    }

    async getProfiles(ids, options) {
        ids = Array.from(ids);
        const unordered = pbToObject(await this.fetchPB('/api/profiles', {
            query: new URLSearchParams(ids.map(id => ['id', id])),
            protobuf: 'PlayerProfiles',
            ...options,
        })).profiles;
        // Reorder and make results similar to getProfile
        const m = new Map(unordered.map(x => [x.id, x]));
        return ids.map(_id => {
            const id = +_id;
            if (this.exclusions.has(getIDHash(id))) {
                return;
            }
            const x = m.get(id);
            if (!x) {
                console.debug('Missing profile:', id);
                return;
            }
            return this._shapeProfileProtobufToJSON(x);
        });
    }

    async getActivities(id) {
        if (this.exclusions.has(getIDHash(id))) {
            return;
        }
        try {
            return await this.fetchJSON(`/api/profiles/${id}/activities`);
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
    }

    async getPlayerState(id) {
        if (this.exclusions.has(getIDHash(id))) {
            return;
        }
        let pb;
        try {
            pb = await this.fetchPB(`/relay/worlds/1/players/${id}`, {protobuf: 'PlayerState'});
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
        const state = processPlayerStateMessage(pb);
        if (state.activePowerUp === 'NINJA' && state.athleteId !== this.profile.id) {
            return;
        }
        return state;
    }

    async getLiveSegmentLeaders() {
        const data = await this.fetchPB(
            `/live-segment-results-service/leaders`, {protobuf: 'SegmentResults'});
        return data.results.filter(x => +x.id).map(convertSegmentResultProtobufToObject);
    }

    async getLiveSegmentLeaderboard(segmentId) {
        const data = await this.fetchPB(
            `/live-segment-results-service/leaderboard/${segmentId}`, {protobuf: 'SegmentResults'});
        return data.results.map(convertSegmentResultProtobufToObject);
    }

    async getSegmentResults(segmentIds, options={}) {
        const query = new URLSearchParams({
            world_id: 1,  // mislabeled realm
        });
        if (options.athleteId != null) {
            query.set('player_id', options.athleteId);
        }
        if (!segmentIds) {
            throw new TypeError("segmentIds argument required");
        }
        if (Array.isArray(segmentIds)) {
            for (const x of segmentIds) {
                query.append('segment_id', x);
            }
        } else {
            query.set('segment_id', segmentIds);
        }
        // be nice...
        if ((options.from || options.to) && options.athleteId == null) {
            const now = Date.now();
            const range = new Date(options.to || now) - new Date(options.from || now);
            if (range > 2 * 86400_000) {
                throw new TypeError("Excessively large range");
            }
        }
        if (options.from) {
            query.set('from', zwiftCompatDate(new Date(options.from)));
        }
        if (options.to) {
            query.set('to', zwiftCompatDate(new Date(options.to)));
        }
        const data = await this.fetchPB('/api/segment-results', {query, protobuf: 'SegmentResults'});
        data.results.sort((a, b) => a.elapsed - b.elapsed);
        return data.results.map(convertSegmentResultProtobufToObject);
    }

    async getGameInfo() {
        const r = await this.fetch('/api/game_info', {accept: 'json'}, {apiVersion: '2.7'});
        const json = await r.text();
        const root = JSON.parse(json);
        const sourceRoot = JSON.parse(json, (k, v, {source}) => typeof v === 'number' ? source : v);
        for (let i = 0; i < root.segments.length; i++) {
            root.segments[i].id = sourceRoot.segments[i].id;
        }
        return root;
    }

    _getGameDictionary() {
        if (!this._gameDictPromise) {
            this._gameDictPromise = fetch('https://cdn.zwift.com/gameassets/GameDictionary.xml')
                .then(async r => {
                    if (r.status !== 200) {
                        console.error("Network error:", r.status);
                        throw new Error('Invalid Network Response');
                    }
                    const xml = await r.text();
                    return parseXml(xml).root;
                }).catch(e => {
                    this._gameDictPromise = null;
                    throw e;
                });
        }
        return this._gameDictPromise;
    }

    async getGameEquipment() {
        const dict = await this._getGameDictionary();
        const types = new Map([
            'jerseys', 'runShirts', 'runShorts', 'runShoes', 'bikeShoes', 'bikeFrontWheels',
            'bikeRearWheels', 'bikeFrames', 'paintJobs', 'socks', 'glasses', 'headgears'
        ].map(x => [x.toUpperCase(), x]));
        const numberAttrs = /InMeters$|^price[0-9]*$|lvId|signature/;
        const boolAttrs = /isTT/;
        const equipment = {};
        for (const typeParent of dict.children) {
            if (!types.has(typeParent.name)) {
                continue;
            }
            const bucket = equipment[types.get(typeParent.name)] = new Map();
            for (const node of typeParent.children) {
                if (node.type !== 'element') {
                    continue;
                }
                const entry = {};
                for (const {0: k, 1: v} of Object.entries(node.attributes)) {
                    if (numberAttrs.test(k)) {
                        entry[k] = +v;
                    } else if (boolAttrs.test(k)) {
                        entry[k] = !!+v;
                    } else {
                        entry[k] = v;
                    }
                }
                if (bucket.has(entry.signature)) {
                    throw new Error("Assertion failed");
                }
                bucket.set(entry.signature, entry);
            }
        }
        return equipment;
    }

    async getDropInWorldList() {
        return pbToObject(await this.fetchPB(`/relay/dropin`, {protobuf: 'DropInWorldList'})).worlds;
    }

    async searchProfiles(searchText, options={}) {
        return await this.fetchPaged('/api/search/profiles', {
            method: 'POST',
            json: {query: searchText},
            ...options
        });
    }

    async getFollowing(athleteId, options={}) {
        if (this.exclusions.has(getIDHash(athleteId))) {
            return [];
        }
        return await this.fetchPaged(`/api/profiles/${athleteId}/followees`, options);
    }

    async getFollowers(athleteId, options={}) {
        if (this.exclusions.has(getIDHash(athleteId))) {
            return [];
        }
        return await this.fetchPaged(`/api/profiles/${athleteId}/followers`, options);
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
        if (this.exclusions.has(getIDHash(to))) {
            return;
        }
        await this.fetchJSON(`/api/profiles/${to}/activities/${activity}/rideon`, {
            method: 'POST',
            json: {profileId: from},
        });
    }

    async getNotifications() {
        return await (await this.fetch(`/api/notifications`, {accept: 'json'})).json();
    }

    async getEventFeed(options={}) {
        const urn = '/api/events/search';
        const aboutMaxBack = worldTimer.serverNow() - 1 * HOUR;
        const from = new Date(options.from || aboutMaxBack);
        if (from < aboutMaxBack) {
            console.warn("Event feed query is probably out of range:", from);
        }
        const to = new Date(options.to || (worldTimer.serverNow() + 4 * HOUR));
        const query = {limit: options.limit};
        const json = {
            dateRangeStartISOString: from.toISOString(),
            dateRangeEndISOString: to.toISOString(),
        };
        const obj = pbToObject(await this.fetchPB(urn, {method: 'POST', protobuf: 'Events', json, query}));
        return obj.events || [];
    }

    async getEventFeedFullRangeBuggy(options={}) {
        // WARNING: this API is not stable.  It returns dups and skips entries on page boundaries.
        const urn = '/api/event-feed';
        const from = options.from && +options.from;
        const to = options.to && +options.to;
        const pageLimit = options.pageLimit ? options.pageLimit : 5; // default pageSize is 25
        const limit = options.pageSize;
        const query = {from, to, limit};
        const ids = new Set();
        const results = [];
        let pages = 0;
        let done;
        while (!done) {
            const page = await this.fetchJSON(urn, {query, protobuf: 'Events'});
            await Promise.all(page.data.map(async x => {
                if (to && new Date(x.event.eventStart) >= to) {
                    done = true;
                } else if (!ids.has(x.event.id)) {
                    if (!options.jsonMode) {
                        results.push(await this.getEvent(x.event.id));
                    } else {
                        results.push(x.event);
                    }
                    ids.add(x.event.id);
                }
            }));
            if (!page.data.length || (limit && page.data.length < limit) || ++pages >= pageLimit) {
                break;
            }
            query.cursor = page.cursor;
        }
        return results;
    }

    async getPrivateEventFeed(from) {
        // There is a start_date and end_data param but they are buggy and should be avoided.
        const start_date = from ? +new Date(from) : worldTimer.serverNow() - 2 * HOUR;
        const query = {organizer_only_past_events: false, start_date};
        return await this.fetchJSON('/api/private_event/feed', {query});
    }

    async getEvent(id) {
        return pbToObject(await this.fetchPB(`/api/events/${id}`, {protobuf: 'Event'}));
    }

    async getPrivateEvent(id) {
        return await this.fetchJSON(`/api/private_event/${id}`);
    }

    getEventSubgroupResults(id) {
        // Serialize to avoid too many 429s..
        if (!this._pendingGetEventSubgroupResults) {
            this._pendingGetEventSubgroupResults = Promise.resolve();
        }
        const pendingPromise = this._pendingGetEventSubgroupResults;
        const resultsPromise = pendingPromise.then(() => this._getEventSubgroupResults(id));
        const timeoutPromise = pendingPromise.then(() => sleep(1000));
        this._pendingGetEventSubgroupResults = Promise.race([resultsPromise, timeoutPromise]);
        return resultsPromise;
    }

    async _getEventSubgroupResults(id) {
        let start = 0;
        const limit = 50;  // 50 is max, but the endpoint is wicked fast
        const results = [];
        let rateLimitCount = 0;
        while (true) {
            let data;
            try {
                data = await this.fetchJSON(`/api/race-results/entries`, {
                    query: {
                        event_subgroup_id: id,
                        start,
                        limit,
                    },
                });
            } catch(e) {
                if (e.status === 429) {
                    if (rateLimitCount > 20) {
                        console.error("Exceeded rate limit backoff limit in subgroup results API");
                        throw e;
                    }
                    const delay = 200 * 1.2 ** rateLimitCount++;
                    console.warn(`Hit rate limit for event results.  Sleeping for ${delay | 0}ms`);
                    await sleep(delay);
                    continue;
                } else {
                    throw e;
                }
            }
            for (const x of data.entries) {
                x.profileData.male = x.profileData.gender === 'MALE';
                results.push(x);
            }
            if (data.entries.length < limit) {
                break;
            }
            start += data.entries.length;
        }
        return results;
    }

    async getEventSubgroupEntrants(id, options={}) {
        // WARNING: Yet another buggy event endpoint.
        // When using participation=signed_up:
        //   Many duplicates are returned during recent large events.
        //   Paging is completely broken.
        const entrants = [];
        const limit = options.limit || 100;
        let start = (options.page != null) ? options.page * limit : 0;
        // There is some cruft around participation type:
        //   "signed_up" is just signed up.
        //   "registered" is actually athletes that joined the event in-game.
        //   The companion app shows a value of 'entered' but this doesn't work.
        //   So this API will allow asking for {joined: true} as a yet-another-variant
        //   as a means of abstracting from the ambiguous other names.
        const ids = new Set();
        const mergeFetchPageFrom = async start => {
            const data = await this.fetchJSON(`/api/events/subgroups/entrants/${id}`, {
                query: {
                    type: options.type || 'all', // or 'leader', 'sweeper', 'favorite', 'following', 'other'
                    participation: options.joined ? 'registered' : 'signed_up',
                    limit,
                    start,
                }
            });
            for (const x of data) {
                if (!ids.has(x.id)) {
                    ids.add(x.id);
                    entrants.push(x);
                }
            }
            return data;
        };
        const overlappingHackGets = [];
        do {
            const page = await mergeFetchPageFrom(start);
            if (!options.joined && (start || page.length === limit)) {
                // XXX Hack: To get even close to the true signed_up list redundant pages must be fetched..
                const step = 20;
                for (let i = step; i < limit; i += step) {
                    overlappingHackGets.push(mergeFetchPageFrom(start + i));
                }
            }
            if (page.length < limit) {
                break;
            }
            start += page.length;
        } while (options.page == null);
        await Promise.all(overlappingHackGets);
        return entrants;
    }

    async getQueue() {
        const results = await this.fetchJSON(`/api/queue`, {});
        return results;
    }

    // XXX this returns different data types and values depending on options.all
    // XXX probably should be two unrelated functions
    async getWorkout(workoutId, options={}) {
        console.warn('XXX: subject to change');
        let results = {};
        if (options.all) {
            let page = 1;
            const pageSize = 100;
            const allWorkouts = [];
            while (true) {
                const workouts = await this.fetchJSON(`/api/workout/workouts`, {
                    query: {
                        filter: null,
                        sort: null,
                        page: page,
                        pageSize,
                    }
                });
                if (workouts.length) {
                    for (const w of workouts) {
                        allWorkouts.push(w);
                    }
                    page++;
                } else {
                    break;
                }
            }
            results = allWorkouts;
        } else {
            const workout = await this.fetchJSON(`/api/workout/workouts/${workoutId}`);
            const detailsResp = await this.fetch(null, {uri: workout.workoutAssetUrl});
            const details = await detailsResp.text();
            return details; // XXX should probably return workout with property containing parsed xml
        }
        return results;
    }

    async getWorkoutCollection(collectionID, options={}) {
        let results = {};
        if (options.all) {
            // XXX Handle paging...
            results = await this.fetchJSON(`/api/workout/collections?pageSize=100`);
        } else {
            // XXX Handle paging...
            results = await this.fetchJSON(`/api/workout/collections/${collectionID}/workouts?pageSize=100`);
        }
        return results;
    }

    async getWorkoutSchedule() {
        return await this.fetchJSON(`/api/workout/schedule/list`);
    }

    async deleteEventSignup(eventId) {
        await this.fetchJSON(`/api/events/signup/${eventId}`, {method: 'DELETE'});
    }

    async addEventSubgroupSignup(subgroupId) {
        try {
            const resp = await this.fetchJSON(`/api/events/subgroups/signup/${subgroupId}`, {method: 'POST'});
            return resp.signedUp;
        } catch(e) {
            if (!e.message.match(/event\.access\.validation/)) {
                console.error('Unexpected event signup error:', e);
            }
            return false;
        }
    }

    async getUpcomingEvents() {
        return await this.fetchJSON(`/api/events/upcoming`);
    }

    async postWorldUpdate(attrs) {
        return await this.fetch('/relay/worlds/1/attributes', {
            method: 'POST',
            pb: protos.WorldUpdate.encode(attrs),
        });
    }

    async setInGameFields(fields) {
        const id = this.profile.id;
        const resp = await this.fetch(`/api/profiles/${id}/in-game-fields`, {
            method: 'PUT',
            pb: protos.PlayerProfile.encode({
                id,
                ...fields,
            }),
        });
        if (!resp.ok) {
            throw new Error(resp.status);
        }
        return resp;
    }
}


function lookupTable(obj) {
    // Objects are fast for lookup by subject to prototype injection
    // without guards.  This just provides some piece of mind without
    // resorting to Object.hasOwn, Map() or a bunch of variables.
    return Object.freeze(Object.assign(Object.create(null), obj));
}


export class RelayIV {

    static deviceTypes = lookupTable({
        game: 1,
        companion: 2
    });

    static channelTypes = lookupTable({
        udpClient: 1,
        udpServer: 2,
        tcpClient: 3,
        tcpServer: 4
    });

    constructor({deviceType, channelType, connId}) {
        this.seqno = 0;
        this.connId = connId || 0;
        this.deviceType = deviceType;
        this.channelType = channelType;
        this._defaultBuf = Buffer.allocUnsafe(12);
        this._defaultBuf.fill(0);
        this._defaultBuf.writeUInt16BE(this.constructor.deviceTypes[deviceType], 2);
        this._defaultBuf.writeUInt16BE(this.constructor.channelTypes[channelType], 4);
        this._defaultBuf.writeUInt16BE(this.connId, 6);
    }

    toBuffer(seqno=this.seqno) {
        const ivBuf = Buffer.from(this._defaultBuf);
        ivBuf.writeUInt32BE(seqno, 8);
        return ivBuf;
    }

    toString() {
        return `RelayIV deviceType:${this.deviceType} channelType:${this.channelType} ` +
            `connId:${this.connId} seqno:${this.seqno}`;
    }
}


class NetChannel extends Events.EventEmitter {

    static headerFlags = lookupTable({
        seqno: 1,
        connId: 2,
        relayId: 4
    });

    static getConnInc() {
        return this._connInc++ % 0xffff; // Defined by subclasses so tcp and udp each have their own counter
    }

    constructor({host, port, protocol, session, connectTimeout=10000, dataTimeout=30000}) {
        super();
        this.host = host;
        this.port = port;
        this.connId = this.constructor.getConnInc();
        this.relayId = session.relayId;
        this.aesKey = session.aesKey;
        this.athleteId = session.athleteId;
        this.session = session;
        this.connectTimeout = connectTimeout;
        this.dataTimeout = dataTimeout;
        this._sendSeqno = 1;
        this.sendIV = new RelayIV({
            deviceType: 'game',
            channelType: `${protocol}Client`,
            connId: this.connId
        });
        this.recvIV = new RelayIV({
            deviceType: 'game',
            channelType: `${protocol}Server`,
            connId: this.connId
        });
        this.recvCount = 0;
        this.sendCount = 0;
        this.errCount = 0;
        this.errLast = null;
        this.sock = null;
        this.isShutdown = false;
        this.isEstablished = false;
        this._establishing = false;
    }

    toString() {
        return `<NetChannel connId: ${this.connId}, relayId: ${this.relayId}, ` +
            `recv: ${this.recvCount}, send: ${this.sendCount}, ${this.host}>`;
    }

    socketFactory() {
        throw new TypeError('Subclass Impl Requried');
    }

    socketTerminateImpl() {
        throw new TypeError('Subclass Impl Requried');
    }

    sendPacketImpl() {
        throw new TypeError('Subclass Impl Requried');
    }

    socketTerminate() {
        if (this.sock && !this.sock[sockTerminatedSymbol]) {
            this.sock[sockTerminatedSymbol] = true;
            this.socketTerminateImpl();
        }
    }

    async sendPacket() {
        await this.sendPacketNoWait.apply(this, arguments).promise;
    }

    sendPacketNoWait() {
        if (this.isShutdown) {
            throw new ChannelShutdownError();
        }
        const {promise: interrupted, reject: intrReject} = Promise.withResolvers();
        const onShutdown = ev => intrReject(new ChannelShutdownError(ev));
        this.on('shutdown', onShutdown);
        const {promise: sending, packet} = this.sendPacketImpl.apply(this, arguments);
        const promise = Promise.race([interrupted, sending])
            .finally(() => this.off('shutdown', onShutdown));
        return {packet, promise};
    }

    async connect() {
        if (this.sock) {
            throw new Error('NetChannel already has socket');
        }
        if (this.isShutdown) {
            throw new ChannelShutdownError();
        }
        this.sock = this.socketFactory();
        let cleanup;
        try {
            await new Promise((resolve, reject) => {
                const onConnect = resolve;
                const onClose = () => reject(new Error('Close During Connect'));
                const onError = reject;
                const onShutdown = ev => reject(new ChannelShutdownError(ev));
                let timeoutId;
                cleanup = () => {
                    clearTimeout(timeoutId);
                    this.off('shutdown', onShutdown);
                    this.sock.off('error', onError);
                    this.sock.off('close', onClose);
                    this.sock.off('connect', onConnect);
                };
                this.sock.on('connect', onConnect);
                this.sock.on('close', onClose);
                this.sock.on('error', onError);
                this.on('shutdown', onShutdown);
                timeoutId = setTimeout(() => {
                    reject(new Error('Connect Timeout'));
                    this.socketTerminate();
                }, this.connectTimeout);
                this.sock.connect(this.port, this.host);
            });
        } catch(e) {
            if (this.isShutdown) {
                if (!(e instanceof ChannelShutdownError)) {
                    // This is a strange path now.. Not saying impossible, but I would like a
                    // test case to prove it to me. Chuck?  Hey, this is one I'm still curious about.
                    debugger;
                    console.warn("XXX converted error to shhutdown err, is fine", e);
                }
                throw (e instanceof ChannelShutdownError) ? e : new ChannelShutdownError();
            } else {
                this.shutdown('error', e);
            }
            throw e;
        } finally {
            cleanup();
        }
        if (!this.isShutdown) {
            this.sock.on('close', hadError =>
                this.shutdown('close', hadError ? new Error('Transmit Error') : undefined));
            this.sock.on('timeout', () => this.shutdown('timeout'));
            this.sock.on('error', e => this.shutdown('error', e));
        }
    }

    handshake() {}

    incError(e) {
        this.errCount++;
        this.errLast = e;
        const limit = 10;
        if (this.errCount > limit) {
            console.error("Error count exceeded limit:", limit);
            this.shutdown('error', this.errLast);
        }
    }

    decrypt(data) {
        const iv = this.recvIV;
        const flags = data.readUint8(0);
        let headerOfft = 1;
        const flagBits = this.constructor.headerFlags;
        if (flags & flagBits.relayId) {
            // In practice as a client, this never happens.
            const relayId = data.readUInt32BE(headerOfft);
            if (relayId !== this.relayId) {
                throw new Error("Bad Relay ID");
            }
            headerOfft += 4;
        }
        if (flags & flagBits.connId) {
            // In practice as a client, this never happens.
            const connId = data.readUInt16BE(headerOfft);
            if (connId !== this.connId) {
                throw new Error('Bad Conn ID');
            }
            headerOfft += 2;
        }
        let seqno = iv.seqno;
        if (flags & flagBits.seqno) {
            seqno = data.readUInt32BE(headerOfft);
            headerOfft += 4;
        }
        const ivBuf = iv.toBuffer(seqno);
        const decipher = Crypto.createDecipheriv('aes-128-gcm', this.aesKey, ivBuf, {authTagLength: 4});
        decipher.setAAD(data.subarray(0, headerOfft));
        decipher.setAuthTag(data.subarray(-4));
        const plain = Buffer.concat([decipher.update(data.subarray(headerOfft, -4)), decipher.final()]);
        iv.seqno = seqno + 1;
        return plain;
    }

    encrypt(aad, data) {
        const iv = this.sendIV;
        const cipher = Crypto.createCipheriv('aes-128-gcm', this.aesKey, iv.toBuffer(), {authTagLength: 4});
        cipher.setAAD(aad);
        const cb1 = cipher.update(data);
        const cb2 = cipher.final();
        const authTag = cipher.getAuthTag();  // must follow final
        const dataBuf = Buffer.concat([cb1, cb2, authTag]);
        iv.seqno++;  // auto increment near wire
        return dataBuf;
    }

    encodeHeader({hello, forceSeq}) {
        const iv = this.sendIV;
        let flags = 0;
        let headerOfft = 1;
        const header = Buffer.allocUnsafe(11);
        // We are only required to send relayId and connId when values change.
        const flagBits = this.constructor.headerFlags;
        if (hello) {
            flags |= flagBits.relayId | flagBits.connId;
            header.writeUInt32BE(this.relayId, headerOfft);
            header.writeUInt16BE(iv.connId, headerOfft + 4);
            headerOfft += 6;
        }
        if ((hello && iv.seqno) || forceSeq) {
            flags |= flagBits.seqno;
            header.writeUInt32BE(iv.seqno || 0, headerOfft);
            headerOfft += 4;
        }
        header.writeUInt8(flags, 0);
        return header.subarray(0, headerOfft);
    }

    async establish() {
        if (this._establishing) {
            throw new TypeError('Invalid State');
        }
        this._establishing = true;
        if (this.isShutdown) {
            throw new ChannelShutdownError();
        }
        await this.connect();
        await this.handshake();
        this.isEstablished = true;
    }

    shutdown(reason='requested', error) {
        if (this.isShutdown) {
            return;
        }
        this.isShutdown = true;
        if (this.sock) {
            this.sock.removeAllListeners();
            this.socketTerminate();
        }
        try {
            this.emit('shutdown', {reason, error, channel: this, type: 'shutdown'});
        } finally {
            this.removeAllListeners();
        }
    }

    makeDataPBAndBuffer(props) {
        props.seqno = this._sendSeqno++;
        // create is faster than fromObject but less safe (no conversions)
        const pb = protos.ClientToServer.fromObject(props);
        return {pb, buf: protos.ClientToServer.encode(pb).finish()};
    }
}


class TCPChannel extends NetChannel {

    static _connInc = 0;

    constructor({initialWorldUpdateTimestamp, ...baseOptions}) {
        super({protocol: 'tcp', ...baseOptions});
        this.initialWorldUpdateTimestamp = initialWorldUpdateTimestamp;
    }

    socketFactory() {
        const sock = new Net.Socket({
            noDelay: true,
            onread: {
                buffer: Buffer.alloc(65536),
                callback: this.onData.bind(this),
            }
        });
        sock.setTimeout(this.dataTimeout);
        const interval = this.dataTimeout / 2;
        // Prevent and detect network partitioning on impatient peering.
        sock.setKeepAlive(true, /*initialDelay*/ interval, interval, /*count*/ 4);
        return sock;
    }

    socketTerminateImpl() {
        if (this.sock && this.sock.readyState !== 'closed') {
            this.sock.resetAndDestroy();
        }
    }

    async handshake() {
        // This packet causes Zwift to close any other TCP connections for this athlete.
        // Also any UDP channels for those relay sessions will stop flowing.
        let onPacket, onShutdown;
        const completed = new Promise((resolve, reject) => {
            onPacket = packet => {
                if (!packet.udpConfigVOD) {
                    // unlikely but this is a new assumption. XXX
                    console.error("TCP connection handshake did not yield UDP server pools");
                }
                resolve();
            };
            onShutdown = ({reason, error}) => {
                if (reason === 'close' && !error && !this.recvCount && !this.errCount) {
                    reject(new GameMonitorSessionNotReadyError());
                } else {
                    reject(new ChannelShutdownError({reason, error}));
                }
            };
        });
        this.on('shutdown', onShutdown);
        this.on('inPacket', onPacket);
        try {
            await this.sendPacket({
                athleteId: this.athleteId,
                worldTime: 0,
                largestWorldAttributeTimestamp: this.initialWorldUpdateTimestamp,
            }, {hello: true});
            await completed;
        } finally {
            this.off('inPacket', onPacket);
            this.off('shutdown', onShutdown);
        }
    }

    onData(nread, buf) {
        try {
            this._onData(nread, buf);
        } catch(e) {
            console.error("TCP recv handler:", e);
            this.incError(e);
        }
    }

    _onData(nread, buf) {
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
                this.recvCount++;
                const plainBuf = this.decrypt(completeBuf);
                const stc = protos.ServerToClient.decode(plainBuf);
                try {
                    this.emit('inPacket', stc, this);
                } catch(e) {
                    // Internally catch these to void IV ratchet corruption..
                    console.error("inPacket event handler", e);
                    this.incError(e);
                }
            }
        }
    }

    sendPacketImpl(props, {hello}={}) {
        const {pb: packet, buf: dataBuf} = this.makeDataPBAndBuffer(props);
        const headerBuf = this.encodeHeader({hello});
        const version = 2;
        const prefixBuf = Buffer.from([version, hello ? 0 : 1]);
        const plainBuf = Buffer.concat([prefixBuf, dataBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf);
        const sizeBuf = Buffer.allocUnsafe(2);
        sizeBuf.writeUInt16BE(headerBuf.byteLength + cipherBuf.byteLength);
        const wireBuf = Buffer.concat([sizeBuf, headerBuf, cipherBuf]);
        const promise = new Promise((resolve, reject) =>
            this.sock.write(wireBuf, e => e ? reject(e) : resolve()));
        this.sendCount++;
        return {packet, promise};
    }
}


class UDPChannel extends NetChannel {

    static _connInc = 0;

    constructor({courseId, isDirect, ...baseOptions}) {
        super({protocol: 'udp', ...baseOptions});
        this.courseId = courseId;
        this.isDirect = isDirect;
    }

    toString() {
        const world = this.courseId ?
            `${Env.worldMetas[this.courseId]?.name} (${this.courseId})` :
            'UNATTACHED';
        return `<UDPChannel [${this.isDirect ? 'DIRECT' : 'LB'}] ${world}, ` +
            `connId: ${this.connId}, relayId: ${this.relayId}, recv: ${this.recvCount}, ${this.host}>`;
    }

    socketFactory() {
        const sock = new Dgram.Socket('udp4');
        sock.on('message', this.onData.bind(this));
        return sock;
    }

    socketTerminateImpl() {
        if (this.sock && this.sock.readyState !== 'closed') {
            this.sock.close();
        }
    }

    async connect() {
        await super.connect();
        if (!this.isShutdown && !this._shutdownTimeout) {
            this.enableWatchdog();
        }
    }

    async handshake() {
        const syncStamps = new Map();
        let complete = false;
        let onSyncPacket;
        const offsets = [];
        const frozenWorldTimer = worldTimer.clone();
        const syncComplete = new Promise((resolve, reject) => {
            onSyncPacket = packet => {
                if (this.isShutdown) {
                    reject(new ChannelShutdownError());
                }
                const localWorldTime = frozenWorldTimer.now();
                const sent = syncStamps.get(packet.ackSeqno);
                if (sent === undefined) {
                    return;  // already measured / non-hello packet
                }
                syncStamps.delete(packet.ackSeqno);  // ackSeqno gets reused, only respond to first round-trip
                const latency = (localWorldTime - sent) / 2;
                const offt = localWorldTime - (packet.worldTime.toNumber() + latency);
                offsets.push({latency, offt});
                if (offsets.length > 5) {
                    // SNTP ...
                    offsets.sort((a, b) => a.latency - b.latency);
                    const mean = offsets.reduce((a, x) => a + x.latency, 0) / offsets.length;
                    const variance = offsets.map(x => (mean - x.latency) ** 2);
                    const stddev = Math.sqrt(variance.reduce((a, x) => a + x, 0) / variance.length);
                    const median = offsets[offsets.length / 2 | 0].latency;
                    const validOffsets = offsets.filter(x => Math.abs(x.latency - median) < stddev);
                    if (validOffsets.length > 4) {
                        const shift = validOffsets.reduce((a, x) => a + x.offt, 0) / validOffsets.length;
                        const offset = shift - frozenWorldTimer.getOffset();
                        complete = true;
                        resolve();
                        queueMicrotask(() => this.emit('clock-offset', {
                            offset,
                            shift,
                            latency: median,
                        }));
                    }
                }
            };
        });
        syncComplete.catch(() => {});
        this.on('inPacket', onSyncPacket);
        const startTime = Date.now();
        try {
            let inflightMax = 1;
            for (let sends = 0; sends < 30 && !complete; sends++) {
                // Send handshake packets with `hello` option (full IV in AAD).  Even if they
                // are dropped the AES decrypt and IV state machine setup will succeed and pave the
                // way for sends that only require `seqno`, even with packet loss on this socket.
                //
                // The primary goal is to inform the servers we are here and ready for data,
                // but if our clock is too far off they will ignore us, so we need to sync our
                // worldTime offset too.  Some research on common game timer sync methods
                // suggests SNTP should be fine here.
                const ts = frozenWorldTimer.now();
                const {packet, promise} = this.sendPacketNoWait({
                    athleteId: this.athleteId,
                    realm: 1,
                    worldTime: 0,
                }, {hello: true});
                syncStamps.set(packet.seqno, ts);
                await promise;
                // Attempt to send the next packet as soon as the syncStamps drains to a normalized
                // inflight max.  We still need to be tolerant to lost messages.
                while (!complete && syncStamps.size > inflightMax && !this.isShutdown &&
                       frozenWorldTimer.now() - ts < 200) {
                    await Promise.race([syncComplete, sleep(30)]);
                }
                if (!complete && syncStamps.size > inflightMax) {
                    inflightMax++;
                    console.debug("Possibly lossy/slow connection, send queue:", syncStamps.size,
                                  {inflightMax});
                }
            }
        } finally {
            this.off('inPacket', onSyncPacket);
        }
        if (this.isShutdown) {
            throw new ChannelShutdownError();
        }
        if (!complete) {
            throw new Error("Handshake Timeout");
        }
        console.debug("Time sync took:", Date.now() - startTime);
    }

    enableWatchdog() {
        if (!this._watchdogLoop) {
            this._watchdogLoop = setInterval(() => {
                const elapsed = Date.now() - this._watchdogTS;
                if (elapsed > this.dataTimeout) {
                    if (this.sock) {
                        this.sock.emit('timeout');
                    }
                }
            }, this.dataTimeout / 2);
        }
        this.tickleWatchdog();
    }

    disableWatchdog() {
        if (this._watchdogLoop) {
            clearInterval(this._watchdogLoop);
            this._watchdogLoop = null;
        }
    }

    tickleWatchdog() {
        this._watchdogTS = Date.now();
    }

    schedShutdown(delay=30000) {
        this.disableWatchdog();
        this._clearSchedShutdown();
        if (!this.isShutdown) {
            this._shutdownTimeout = setTimeout(() => this.shutdown('idle'), delay);
        }
    }

    cancelShutdown() {
        this._clearSchedShutdown();
        if (!this.isShutdown) {
            this.enableWatchdog();
        }
    }

    _clearSchedShutdown() {
        if (this._shutdownTimeout) {
            clearTimeout(this._shutdownTimeout);
            this._shutdownTimeout = null;
        }
    }

    shutdown(...args) {
        this.disableWatchdog();
        this._clearSchedShutdown();
        super.shutdown(...args);
    }

    onData(buf) {
        try {
            this._onData(buf);
        } catch(e) {
            console.error("UDP recv handler:", e);
            this.incError(e);
        }
    }

    _onData(buf) {
        this.recvCount++;
        const stc = protos.ServerToClient.decode(this.decrypt(buf));
        this.emit('inPacket', stc, this);
        if (this._watchdogLoop) {
            this.tickleWatchdog();
        }
    }

    sendPacketImpl(props, {hello}={}) {
        const {pb: packet, buf: dataBuf} = this.makeDataPBAndBuffer(props);
        const version = 1;  // Deprecates hash-seeds and 0xDF (dont-forward) byte.
        const prefixBuf = Buffer.from([version]);
        const headerBuf = this.encodeHeader({hello, forceSeq: true});
        const plainBuf = Buffer.concat([prefixBuf, dataBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf);
        const wireBuf = Buffer.concat([headerBuf, cipherBuf]);
        const promise = new Promise((resolve, reject) =>
            this.sock.send(wireBuf, e => e ? reject(e) : resolve()));
        this.sendCount++;
        return {packet, promise};
    }

    async sendPlayerState(extraState) {
        const worldTime = worldTimer.now();
        const state = {
            athleteId: this.athleteId,
            worldTime,
            justWatching: true,
            x: 0,
            y: 0,
            z: 0,
            courseId: this.courseId,
            ...extraState,
        };
        await this.sendPacket({
            athleteId: this.athleteId,
            realm: 1,
            worldTime,
            state,
        });
    }
}


export class GameMonitor extends Events.EventEmitter {

    _stateRefreshDelayMin = 3000;

    constructor(options={}) {
        super();
        this.api = options.zwiftMonitorAPI;
        this.randomWatch = options.randomWatch;
        this.selfAthleteId = options.selfAthleteId;
        this.athleteId = this.api.profile.id;
        this.exclusions = options.exclusions || new Set();
        this.watchingAthleteId = null;
        this.courseId = null;
        this._udpChannels = [];
        this._udpServerPools = new Map();
        this._starting = false;
        this._stopping = false;
        this._disconnecting = false;
        this._errCount = 0;
        this.connectingTS = 0;
        this.connectingCount = 0;
        this._session = null;
        this._setWatchingWorldTime = 0;
        this._lastSelfStateUpdated = 0;
        this._lastWatchingStateUpdated = 0;
        this._lastWorldUpdate = 0;
        this._failedTCPServer;
        this._stateRefreshDelay = this._stateRefreshDelayMin;
        this._latency;
        this._dropList = [];
        const wupt = protos.WorldUpdate.WorldUpdatePayloadType;
        this.binaryWorldUpdateDecoders = {
            [wupt.PlayerRegisteredForEvent]: this.decodePlayerRegisteredForEvent,
            [wupt.NotableMoment]: this.decodeNotableMoment,
            [wupt.WorldTime]: this.decodeWorldTime,
            [wupt.SegmentResult]: this.decodeSegmentResult,
            [wupt.PerformAction]: this.decodePerformAction,
            [wupt.PlayerFlag]: this.ignoreWorldUpdate,
            [wupt.FenceConfig]: this.ignoreWorldUpdate,
        };
        if (Object.hasOwn(this.binaryWorldUpdateDecoders, 'undefined')) {
            console.error('Missing binary world update payload type:',
                          this.binaryWorldUpdateDecoders, wupt);
            throw new Error('Internal Protobuf Alignment Error');
        }
    }

    toString() {
        const tcpCh = (this._session && this._session.tcpChannel) ?
            this._session.tcpChannel.toString() :
            'none';
        const pad = '    ';
        const now = Date.now();
        const lss = this._lastSelfStateUpdated ? now - this._lastSelfStateUpdated : '-';
        const lws = this._lastWatchingStateUpdated ? now - this._lastWatchingStateUpdated : '-';
        return `GameMonitor [self-id: ${this.selfAthleteId}, monitor-id: ${this.athleteId}]\n${pad}` + [
            `course-id:            ${this.courseId}`,
            `watching-id:          ${this.watchingAthleteId}`,
            `connect-duration:     ${fmtTime(now - this.connectingTS)}`,
            `connect-count:        ${this.connectingCount}`,
            `last-self-state:      ${fmtTime(lss)} ago`,
            `last-watching-state:  ${fmtTime(lws)} ago`,
            `state-refresh-delay:  ${fmtTime(this._stateRefreshDelay)}`,
            `tcp-channel:`,        `${pad}${tcpCh}`,
            `udp-channels:`,       `${pad}${this._udpChannels.map(x => x.toString()).join(`\n${pad}${pad}`)}`,
        ].join('\n    ');
    }

    getConnectionInfo() {
        let status = 'disconnected';
        let active = false;
        if (this._session?.tcpChannel) {
            active = this._udpChannels.some(x => x.isEstablished && !x.isShutdown);
            status = 'connected';
        }
        return {
            status,
            active,
            latency: this._latency,
            connectTime: Math.round((Date.now() - this.connectingTS) / 1000),
            connectCount: this.connectingCount,
        };
    }

    getDebugInfo() {
        const {status, active, ...info} = this.getConnectionInfo();
        const now = Date.now();
        const lss = this._lastSelfStateUpdated ? now - this._lastSelfStateUpdated : '-';
        const lws = this._lastWatchingStateUpdated ? now - this._lastWatchingStateUpdated : '-';
        return {
            ...info,
            connectionStatus: status,
            active: active,
            lastSelfState: lss,
            lastWatchingState: lws,
            stateRefreshDelay: this._stateRefreshDelay,
            worldTime: worldTimer.now(),
            serverTime: worldTimer.serverNow(),
            localTime: now,
            worldTimeOffset: worldTimer._offt,
        };
    }

    logStatus() {
        console.debug(this.toString());
    }

    decodePlayerRegisteredForEvent(buf) {
        return {
            athleteId: buf.readUInt32LE(8),
            subgroupId: buf.readUInt32LE(16),
            unknownFlags1: buf.readUInt32LE(20),
            unknownFlags2: buf.readUInt32LE(24),
            unknownFlags3: buf.readUInt32LE(28),
            worldTime: buf.readDoubleLE(32),
        };
    }

    decodeNotableMoment(buf) {
        const _f1 = buf.readUInt32LE(0);
        const athleteId = Number(buf.readBigUInt64LE(8));
        const worldTime = Number(buf.readBigUInt64LE(16));
        const _f4 = buf.readUInt32LE(24);
        const _f5 = buf.readUInt32LE(28);
        console.debug("Partially decoded NotableMoment data:", {athleteId, worldTime, _f1, _f4, _f5});
        return {athleteId, worldTime, _f1, _f4, _f5};
    }

    decodeWorldTime(buf) {
        const intLE = buf.readInt32LE();
        const intBE = buf.readInt32BE();
        const floatLE = buf.readFloatLE();
        const floatBE = buf.readFloatBE();
        console.debug("Partially decoded WorldTime data:", {intLE, intBE, floatLE, floatBE});
        return {};
    }

    decodeSegmentResult(buf) {
        // This one actually is a protobuf..
        return convertSegmentResultProtobufToObject(protos.SegmentResult.decode(buf));
    }

    decodePerformAction(buf) {
        const athleteId = Number(buf.readBigInt64LE(0));
        const _f2 = buf.readInt32LE(8);
        const _f3 = buf.readInt32LE(12);
        console.debug("Partially decoded PerformAction data:", {athleteId, _f2, _f3}, buf);
        return {athleteId, _f2, _f3};
    }

    ignoreWorldUpdate() {
    }

    async login() {
        const aesKey = Crypto.randomBytes(16);
        const t1 = worldTimer.serverNow();
        const login = await this.api.fetchPB('/api/users/login', {
            method: 'POST',
            pb: protos.LoginRequest.encode({aesKey}),
            protobuf: 'LoginResponse',
        });
        const t2 = worldTimer.serverNow();
        const tMean = t1 + ((t2 - t1) / 2);
        const serverTime = login.session.time.toNumber() * 1000;
        const tOffset = serverTime - tMean;
        if (Math.abs(tOffset) > 60000) {
            // Perform course clock correction prior to any SNTP fine tuning to avoid hash seed errors
            console.warn('System clock is highly inaccurate:', fmtTime(tOffset));
            worldTimer.setOffset(tOffset);
        }
        const expires = Date.now() + (login.expiration * 60 * 1000);
        return {
            aesKey,
            relayId: login.relaySessionId,
            tcpServers: login.session.tcpConfig.servers,
            expires,
            athleteId: this.athleteId,
        };
    }

    async leave() {
        return await this.api.fetchJSON('/relay/worlds/1/leave', {method: 'POST', json: {}});
    }

    async logout() {
        // XXX This might take arguments... inspect with zwift-offline
        const resp = await this.api.fetch('/api/users/logout', {method: 'POST'});
        if (!resp.ok) {
            throw new Error("Game client logout failed:" + await resp.text());
        }
        console.error("XXX", await resp.text());
    }

    async getTCPConfig() {
        return await this.api.fetchPB('/relay/tcp-config', {protobuf: 'TCPConfig'});
    }

    async getRandomAthleteId(courseId) {
        const worlds = (await this.api.getDropInWorldList()).filter(x =>
            typeof courseId !== 'number' || x.courseId === courseId);
        while (worlds.length) {
            const index = Math.random() * worlds.length | 0;
            const world = worlds[index];
            worlds.splice(index, 1);
            const athletes = [].concat(world.others || [],
                                       world.followees || [],
                                       world.pacerBots || [],
                                       world.proPlayers || []).filter(x => x);
            athletes.sort((a, b) => (b.power || 0) - (a.power || 0));
            // Avoid pacer bots if possible
            const athlete = athletes.find(x => x.playerType !== 'PACER_BOT') || athletes[0];
            if (athlete) {
                return athlete.athleteId;
            }
        }
        console.warn("Nobody public in any world");
    }

    async initPlayerState() {
        if (this.randomWatch != null) {
            this.selfAthleteId = await this.getRandomAthleteId(this.randomWatch);
            this.emit("self-athlete", this.selfAthleteId);
        }
        if (this.selfAthleteId != null) {
            const s = await this.api.getPlayerState(this.selfAthleteId);
            this.setCourse(s ? s.courseId : null);
            if (s) {
                this.setWatching(s.watchingAthleteId);
                if (s.watchingAthleteId === this.selfAthleteId) {
                    this._setWatchingState(s);
                }
            } else {
                this.setWatching(this.selfAthleteId);
            }
        }
    }

    async start() {
        if (this._starting) {
            throw new TypeError('Invalid State');
        }
        this._stopping = false;
        this._starting = true;
        console.info("Starting Zwift Game Monitor...");
        this._setWatchingWorldTime = 0;
        this._onWorldTimeShift = shift => {
            if (Math.abs(shift) > 200) {
                // Otherwise we could be stuck watching the wrong athlete.
                this._setWatchingWorldTime = 0;
            }
        };
        worldTimer.on('shift', this._onWorldTimeShift);
        this._logStatusInterval = setInterval(() => this.logStatus(), 60000);
        await this.connect();
    }

    stop() {
        console.info("Stopping Zwift Game Monitor...");
        this._stopping = true;
        worldTimer.off('shift', this._onWorldTimeShift);
        clearInterval(this._logStatusInterval);
        this.disconnect();
        this._starting = false;
    }

    async connect() {
        console.info("Connecting to Zwift relay network...");
        if (this._connectAborter) {
            this._connectAborter.abort();
        }
        const aborter = this._connectAborter = new AbortController();
        try {
            await this._connect(aborter);
        } catch(e) {
            aborter.abort();
            if (e.message === 'fetch failed' || e.name === 'TimeoutError') {
                console.warn('GameMonitor connect network problem:', e.cause?.message || e);
            } else {
                console.error('GameMonitor connect failed:', e);
            }
            this._schedReconnect();
        }
    }

    async _connect(aborter) {
        this.connectingTS = Date.now();
        this.connectingCount++;
        this._disconnecting = false;
        const session = await this.login();
        await this.initPlayerState();
        // tcpServers don't have courseId set anymore, but be safe and exclude any
        // that might come in the future because they certainly won't work for us.
        const servers = session.tcpServers.filter(x => (!x.realm || x.realm === 1) && !x.courseId);
        const offt = this._failedTCPServer ?
            servers.findIndex(x => `${x.host}:${x.securePort}` === this._failedTCPServer) + 1 :
            0;
        const server = servers[offt % servers.length];
        if (!server) {
            throw new Error('No Server Available');
        }
        const host = server.host;
        const port = server.securePort;
        try {
            // Zwift servers do not immediately recognize our session and will close our tcp channel
            // immediately until they do.  Try a few times with increasing delays while in this limbo.
            console.info(`Establishing TCP channel to: ${host}:${port || 3025}`);
            for (let attempts = 1;; attempts++) {
                const delay = 100 * attempts ** 1.5;
                await sleep(delay);
                if (aborter.signal.aborted) {
                    return;
                }
                const ch = new TCPChannel({
                    host,
                    port: port || 3025,
                    session,
                    initialWorldUpdateTimestamp: this._lastWorldUpdate,
                });
                ch.on('inPacket', this.onInPacket.bind(this));
                const onAbort = () => ch.shutdown('session-aborted');
                aborter.signal.addEventListener('abort', onAbort);
                try {
                    await ch.establish();
                } catch(e) {
                    ch.shutdown();
                    if (aborter.signal.aborted) {
                        return;
                    } else if (attempts < 5 && e instanceof GameMonitorSessionNotReadyError) {
                        continue;
                    }
                    throw e;
                } finally {
                    aborter.signal.removeEventListener('abort', onAbort);
                }
                session.tcpChannel = ch;
                break;
            }
        } catch(e) {
            if (!aborter.signal.aborted) {
                this._failedTCPServer = `${host}:${port}`;
                throw e;
            }
        }
        if (this._disconnecting) {
            session.tcpChannel.shutdown('session-disconnecting');
            return;
        }
        if (aborter.signal.aborted) {
            return;
        }
        this._session = session;
        session.tcpChannel.on('shutdown', this.onTCPChannelShutdown.bind(this));
        console.info("Activated Zwift Relay session with:", session.tcpChannel.toString());
        this._schedSessionRefresh(session.expires);
        this._failedTCPServer = null;
        this._playerStateInterval = setInterval(this.broadcastPlayerState.bind(this), 1000);
        this._refreshStatesTimeout = setTimeout(() => this._refreshStates(), this._stateRefreshDelay);
        if (!this.suspended) {
            if (this.courseId) {
                this.selectUDPChannel();
            } else {
                console.warn("User not in game: waiting for activity...");
                this.suspend();
            }
        }
        this.logStatus();
    }

    async refreshSession() {
        if (!this._starting || this._disconnecting || !this._session) {
            throw new TypeError('Invalid State');
        }
        console.info("Refreshing Zwift relay session...");
        const session = this._session;
        // XXX I've seen the real client trying /relay/session/renew as well
        const resp = await this.api.fetchPB('/relay/session/refresh', {
            method: 'POST',
            pb: protos.RelaySessionRefreshRequest.encode({relaySessionId: session.relayId}),
            protobuf: 'RelaySessionRefreshResponse',
        });
        if (session !== this._session) {
            console.warn("Session became invalid during refresh");
            return;
        }
        session.expires = Date.now() + (resp.expiration * 60 * 1000);
        this._schedSessionRefresh(session.expires);
    }

    disconnect() {
        if (this._disconnecting) {
            return;
        }
        console.info("Disconnecting from Zwift relay network...");
        this._disconnecting = true;
        if (this._connectAborter) {
            this._connectAborter.abort();
            this._connectAborter = null;
        }
        clearInterval(this._playerStateInterval);
        clearTimeout(this._sessionTimeout);
        clearTimeout(this._refreshStatesTimeout);
        const channels = Array.from(this._udpChannels);
        this._udpChannels.length = 0;
        if (this._session?.tcpChannel) {
            channels.push(this._session.tcpChannel);
        }
        this._session = null;
        for (const ch of channels) {
            try {
                ch.shutdown('disconnect');
            } catch(e) {
                console.error(e);
            }
        }
    }

    reconnect() {
        if (this._stopping) {
            throw new Error('Zwift Monitor is stopped');
        }
        this._schedReconnect();
    }

    makeUDPChannel(host, port) {
        const isDirect = !!host;
        if (!host) {
            // Use a load balancer..
            ({host, securePort: port} = this._udpServerPools.get(0).servers[0]);
        }
        const ch = new UDPChannel({
            host,
            port: port || 3024,
            courseId: this.courseId,
            athleteId: this.athleteId,
            session: this._session,
            isDirect,
        });
        console.info(`Making new: ${ch}`);
        ch.on('shutdown', ({reason}) => {
            console.info(`Zwift Relay UDP channel shutdown [${reason}]:`, ch.toString());
            const idx = this._udpChannels.indexOf(ch);
            if (idx !== -1) {
                this._udpChannels.splice(idx, 1);
                if (!this.suspended && !this._disconnecting && this._session &&
                    (idx === 0 || !this._udpChannels.length)) {
                    console.info("Last/primary channel shutdown");
                    const delay = ch.recvCount < 2 ? 3000 : ch.recvCount < 10 ? 1000 : 100;
                    setTimeout(() => this.selectUDPChannel(), delay);
                }
            }
        });
        ch.on('inPacket', this.onInPacket.bind(this));
        ch.on('clock-offset', ({latency, offset, shift}) => {
            this._latency = latency;
            const absShift = Math.abs(shift);
            if (absShift > 20) {
                worldTimer.setOffset(-offset);
                if (absShift > 5000) {
                    console.warn(`Shifted WorldTime offset by ${shift}ms to: ${offset}`);
                }
            }
        });
        return ch;
    }

    onTCPChannelShutdown({reason, error, channel}) {
        console.warn(`Zwift Relay TCP channel shutdown [${reason}]:`, channel.toString());
        if (error) {
            console.debug("TCP Relay shutdown:", error);
        }
        if (this._session?.tcpChannel === channel && !this._stopping) {
            this._schedReconnect();
        }
    }

    _schedReconnect() {
        clearTimeout(this._connectRetryTimeout);
        this.disconnect();
        const backoffCount = this.connectingCount + this._errCount;
        const delay = Math.max(1000, (1000 * 1.2 ** backoffCount) - (Date.now() - this.connectingTS));
        console.warn('Scheduling Zwift connect in:', fmtTime(delay));
        this._connectRetryTimeout = setTimeout(this.connect.bind(this), delay);
    }

    _schedSessionRefresh(expires) {
        const refreshDelay = (expires - Date.now()) * 0.90;
        console.debug('Next session refresh:', fmtTime(refreshDelay));
        if (this._sessionTimeout) {
            clearTimeout(this._sessionTimeout);
        }
        this._sessionTimeout = setTimeout(async () => {
            try {
                await this.refreshSession();
            } catch(e) {
                console.error("Refresh Session:", e);
                this.incErrorCount();
            }
        }, refreshDelay);
    }

    incErrorCount() {
        this._errCount++;
        if (this._errCount % 10 === 0) {
            console.warn('Error count too high:', this._errCount);
            this._schedReconnect();
        }
    }

    async broadcastPlayerState() {
        if (this.suspended || this._disconnecting) {
            return;
        }
        const lws = this._lastWatchingState;
        const portal = lws ? lws.portal : undefined;
        for (const ch of this._udpChannels) {
            if (ch.isEstablished && !ch.isShutdown) {
                try {
                    await ch.sendPlayerState({
                        watchingAthleteId: this.watchingAthleteId,
                        _flags2: portal ? encodePlayerStateFlags2({roadId: lws.roadId}) : undefined,
                        portal,
                        eventSubgroupId: lws?.eventSubgroupId || 0,
                        ...this.watchingStateExtra});
                    break;
                } catch(e) {
                    if (!(e instanceof ChannelShutdownError)) {
                        if (e.code && e.syscall) {
                            console.warn('SendPlayerState network problem:', e.syscall, e.code);
                        } else {
                            console.error('SendPlayerState error:', e);
                        }
                        this.incErrorCount();
                    }
                }
            }
        }
    }

    suspend() {
        if (this.suspended) {
            return;
        }
        console.warn("Suspending game monitor...");
        this.suspended = true;
        if (this._session) {
            this._session.announcedCourseId = null;
        }
        for (const x of this._udpChannels) {
            x.schedShutdown();
        }
    }

    resume() {
        if (!this.suspended) {
            return;
        }
        this.suspended = false;
        if (this._disconnecting) {
            return;
        }
        console.info("Resuming game monitor...");
        if (this.courseId) {
            this.selectUDPChannel();
        }
    }

    async _refreshStates() {
        if (this._disconnecting) {
            return;
        }
        const id = this._refreshStatesTimeout;
        try {
            const age = await this._refreshSelfState();
            if (this.selfAthleteId !== this.watchingAthleteId) {
                await this._refreshWatchingState();
            }
            if (age > 15000) {
                // Stop harassing relay network and relax state fetch...
                this.suspend();
                this._stateRefreshDelay = Math.min(this._stateRefreshDelay * 1.02, 30000);
            } else {
                this._stateRefreshDelay = Math.max(this._stateRefreshDelay * 0.99,
                                                   this._stateRefreshDelayMin);
            }
        } catch(e) {
            this._stateRefreshDelay = Math.min(this._stateRefreshDelay * 1.15, 300000);
            if (e.status !== 429) {
                if (e.message === 'fetch failed' || e.name === 'TimeoutError') {
                    console.warn("Refresh states network problem:", e.cause?.message || e);
                } else {
                    console.error("Refresh states error:", e);
                }
            }
        }
        if (!this._disconnecting && id === this._refreshStatesTimeout) {
            this._refreshStatesTimeout = setTimeout(() => this._refreshStates(), this._stateRefreshDelay);
        }
    }

    async _refreshSelfState() {
        const age = Date.now() - this._lastSelfStateUpdated;
        if (age < this._stateRefreshDelay * 0.95) {
            // Optimized out by data stream
            return age;
        }
        const state = this.selfAthleteId != null ? await this.api.getPlayerState(this.selfAthleteId) : null;
        if (!state) {
            if (this.randomWatch != null) {
                this.selfAthleteId = await this.getRandomAthleteId(this.randomWatch);
                this.emit("self-athlete", this.selfAthleteId);
                if (this.selfAthleteId != null) {
                    console.info("Switching to new random athlete:", this.selfAthleteId);
                } else {
                    console.info("No random athlete available for now");
                }
            }
        } else {
            // The stats proc works better with these being recently available.
            this.emit('inPacket', this._createFakeServerPacket(state));
            this._updateSelfState(state);
            if (state.athleteId === this.watchingAthleteId) {
                this._updateWatchingState(state);
            }
        }
        return Date.now() - this._lastSelfStateUpdated;
    }

    async _refreshWatchingState() {
        if (this.suspended || this._stopping ||
            Date.now() - this._lastWatchingStateUpdated < this._stateRefreshDelay * 0.95) {
            return;
        }
        console.warn("Fallback to API fetch of watching state:", this.watchingAthleteId);
        const state = await this.api.getPlayerState(this.watchingAthleteId);
        if (!state) {
            return;
        }
        // The stats proc works better with these being recently available.
        this.emit('inPacket', this._createFakeServerPacket(state));
        this._updateWatchingState(state);
    }

    _createFakeServerPacket(state) {
        const stc = protos.ServerToClient.create({
            athleteId: this.athleteId,
            worldTime: state.worldTime,
            msg: 1,
            msgCount: 1,
        });
        stc.playerStates = [state];  // Assign after so our extensions work.
        return stc;
    }

    setWatching(athleteId) {
        this._setWatchingWorldTime = worldTimer.now();
        if (athleteId === this.watchingAthleteId) {
            return;
        }
        this.watchingAthleteId = athleteId;
        this.emit("watching-athlete", athleteId);
    }

    _isChannelReusable(ch, host) {
        const isDirect = !!host;
        return !!(
            ch.isDirect === isDirect &&
            (!isDirect || ch.host === host) &&
            ch.athleteId === this.athleteId &&
            ch.courseId === this.courseId &&
            ch.relayId === this._session?.relayId &&
            !ch.isShutdown
        );
    }

    selectUDPChannel() {
        if (this.suspended || this._disconnecting || !this._session) {
            return;
        }
        const channels = this._udpChannels;
        if (!this.courseId) {
            this._session.announcedCourseId = null;
            for (const x of channels.slice()) {
                x.shutdown();
            }
            return;
        }
        let host, port;
        if (this._session.announcedCourseId === this.courseId && this._lastWatchingState) {
            const best = this.findBestUDPServer(this._lastWatchingState);
            if (best) {
                host = best.host;
                port = best.securePort;
            }
        }
        if (!host) {
            this._session.announcedCourseId = this.courseId;
        }
        // Optimize hot paths a bit..
        let promotedIdx;
        if (channels.length) {
            for (let i = 0; i < channels.length; i++) {
                const x = channels[i];
                if (this._isChannelReusable(x, host)) {
                    if (i === 0) {
                        return;  // no change
                    }
                    x.cancelShutdown();
                    promotedIdx = i;
                    break;
                }
            }
            // Send off old primary..
            const old = channels[0];
            const linger = this._isChannelReusable(old, old.host) ? 60000 : 5000;
            old.schedShutdown(linger);
        }
        if (promotedIdx !== undefined) {
            this._udpChannels.unshift(this._udpChannels.splice(promotedIdx, 1)[0]);
            console.debug("Switching to:", channels[0].toString());
        } else {
            const newCh = this.makeUDPChannel(host, port);
            this._udpChannels.unshift(newCh);
            queueMicrotask(() => this.establishUDPChannel(newCh));
        }
    }

    async establishUDPChannel(ch) {
        try {
            await ch.establish();
            await ch.sendPlayerState({watchingAthleteId: this.watchingAthleteId});
        } catch(e) {
            if (e instanceof ChannelShutdownError) {
                return;
            }
            console.error('Error during UDP establish:', e);
            ch.shutdown('error', e);
            this.incErrorCount();
        }
        console.info(`Established:`, ch.toString());
    }

    onInPacket(pb, ch) {
        if (pb.multipleLogins) {
            console.warn("Multiple logins detected!");
        }
        if (pb.tcpConfig) {
            if (this._session != null) {
                const curServers = new Set(this._session.tcpServers.map(JSON.stringify));
                const newServers = new Set(pb.tcpConfig.servers.map(JSON.stringify));
                if (curServers.symmetricDifference(newServers).size) {
                    console.error("Unimplemented TCP server config change:", curServers, '->', newServers);
                }
            }
        }
        if (pb.udpConfigVOD) {
            for (const x of pb.udpConfigVOD.pools) {
                this._udpServerPools.set(x.courseId, x);
            }
            if (pb.udpConfigVOD.portalPools) {
                if (pb.udpConfigVOD.portalPools.length > 1) {
                    // It's technically an array but the course and realm are 0 so it's not clear
                    // how we disambiguate.
                    console.warn("Unexpected length for portal pool:", pb.udpConfigVOD);
                }
                this._udpServerPools.set('portal', pb.udpConfigVOD.portalPools[0]);
            }
            queueMicrotask(() => this.selectUDPChannel());
        }
        if (pb.worldUpdates.length) {
            for (let i = 0; i < pb.worldUpdates.length; i++) {
                const wupb = pb.worldUpdates[i];
                const wu = pb.worldUpdates[i] = pbToObject(wupb);
                this._lastWorldUpdate = wu.ts;
                if (wupb.payloadType < 100) {
                    const PT = wu.payloadType && protos.lookup(wu.payloadType);
                    if (PT) {
                        wu.payload = pbToObject(PT.decode(wupb._payload));
                    } else {
                        console.warn("No protobuf for world-update payload:", wupb.payloadType,
                                     wupb._payload?.toString('hex'));
                    }
                } else {
                    const decoder = this.binaryWorldUpdateDecoders[wupb.payloadType];
                    if (decoder) {
                        wu.payload = decoder.call(this, wupb._payload, wupb);
                    } else {
                        console.warn("No binary decoder for world-update payload:",
                                     wupb.payloadType, wupb._payload?.toString('hex'));
                    }
                }
            }
        }
        const now = worldTimer.now();
        for (let i = 0; i < pb.playerStates.length; i++) {
            const state = pb.playerStates[i] = processPlayerStateMessage(pb.playerStates[i], now);
            if (state.athleteId === this.selfAthleteId) {
                this._updateSelfState(state);
            } else if (state.activePowerUp === 'NINJA' || this.exclusions.has(getIDHash(state.athleteId))) {
                this._dropList.push(i);
            }
            if (state.athleteId === this.watchingAthleteId) {
                this._updateWatchingState(state);
            }
        }
        if (this._dropList.length) {
            for (let i = this._dropList.length - 1; i >= 0; i--) {
                pb.playerStates.splice(this._dropList[i], 1);
            }
            this._dropList.length = 0;
        }
        this.emit('inPacket', pb);
    }

    _updateSelfState(state) {
        if (this._lastSelfState && this._lastSelfState.worldTime >= state.worldTime) {
            return;
        }
        this._lastSelfState = state;
        this._lastSelfStateUpdated = Date.now();
        if (this._stopping) {
            return;
        }
        if (this.suspended) {
            this.resume();
        }
        if (state.watchingAthleteId !== this.watchingAthleteId &&
            state.worldTime > this._setWatchingWorldTime) {
            this.setWatching(state.watchingAthleteId);
        }
        if (state.courseId !== this.courseId) {
            this.setCourse(state.courseId);
        }
    }

    setCourse(courseId) {
        const moving = this.courseId !== courseId && !!this._session;
        this.courseId = courseId;
        if (moving) {
            console.info(`Moving to ${Env.worldMetas[courseId]?.name}, courseId: ${courseId}`);
            this.selectUDPChannel();
        }
    }

    _setWatchingState(state) {
        const lws = this._lastWatchingState;
        if (lws && lws.worldTime >= state.worldTime) {
            // Dedup & filter stale
            return false;
        }
        if (state.courseId !== this.courseId) {
            console.warn('Ignoring incongruent courseId for watching state:',
                         state.courseId, this.courseId);
            return false;
        }
        this._lastWatchingState = state;
        this._lastWatchingStateUpdated = Date.now();
        const age = lws ? state.worldTime - lws.worldTime : 0;
        const connectTime = Date.now() - this.connectingTS;
        const active = state._speed || state.power || state._cadence;
        if (age > 3000 && connectTime > 30000 && active) {
            console.warn(`Slow watching state update: ${fmtTime(age)}`, state);
        }
    }

    _updateWatchingState(state) {
        const isValid = this._setWatchingState(state) !== false;
        if (!isValid || !this._session) {
            return;
        }
        this.selectUDPChannel();
    }

    findBestUDPServer({x: xCoord, y: yCoord, portal, courseId}) {
        const pool = this._udpServerPools.get(portal ? 'portal' : courseId);
        if (!pool) {
            return;
        }
        if (pool.useFirstInBounds) {
            const servers = pool.servers;
            // TBD: check for xBoundMin and yBoundMin
            for (let i = 0; i < servers.length; i++) {
                const x = servers[i];
                if (xCoord <= x.xBound && yCoord <= x.yBound) {
                    return x;
                }
            }
            return;
        } else {
            // Haven't seen this used in years..
            let closestServer;
            let closestDelta = Infinity;
            for (const server of pool.servers) {
                const xDelta = server.xBound - xCoord;
                const yDelta = server.yBound - yCoord;
                // Can simplify the sqrt out since we only need the winner
                const delta = xDelta * xDelta + yDelta * yDelta;
                if (delta < closestDelta) {
                    closestDelta = delta;
                    closestServer = server;
                }
            }
            return closestServer;
        }
    }
}


// TODO: maove all gameconnection into seperate module, too many parallels
export class GameConnection extends Events.EventEmitter {

    constructor(socket) {
        super();
        this._socket = socket;
        this._pendingMsgBuf = null;
        this._seqno = 1;
        socket.setKeepAlive(true, 5000);
        socket.on('data', this.onData.bind(this));
        socket.on('close', this.onClose.bind(this));
        socket.on('error', this.onError.bind(this));
    }

    onData(frag) {
        let buf = this._pendingMsgBuf ? Buffer.concat([this._pendingMsgBuf, frag]) : frag;
        while (buf.byteLength >= 4) {
            const msgSize = buf.readUint32BE(0);
            const msgTail = msgSize + 4;
            if (msgSize > 1 * 1024 * 1024) {
                const error = new Error('Invalid Msg Size');
                this._socket.resetAndDestroy();
                throw error;
            } else if (msgTail > buf.byteLength) {
                break;
            }
            const msgBuf = buf.subarray(4, msgTail);
            const msg = protos.GameToCompanion.decode(msgBuf);
            buf = buf.subarray(msgTail);
            queueMicrotask(() => this.emit('message', msg, msgBuf));
        }
        this._pendingMsgBuf = buf.byteLength ? buf : null;
    }

    onClose() {
        console.info("Game connection closed");
        this._shutdown('disconnected', null);
    }

    onError(error) {
        console.error("Game connection network error:", error);
        this._shutdown('error', error);
    }

    send(obj) {
        const pb = protos.CompanionToGame.fromObject({
            ...obj,
            seqno: this._seqno++,
        });
        const buf = protos.CompanionToGame.encode(pb).finish();
        const size = Buffer.allocUnsafe(4);
        size.writeUInt32BE(buf.byteLength);
        return new Promise((resolve, reject) =>
            this._socket.write(Buffer.concat([size, buf]), e => e ? reject(e) : resolve()));
    }

    shutdown() {
        this._shutdown(null, null);
    }

    _shutdown(state, error) {
        const s = this._socket;
        this._socket = null;
        try {
            if (s) {
                s.removeAllListeners();
                this.emit('shutdown', {state, error});
            }
        } finally {
            this.removeAllListeners();
        }
    }
}


// TODO: maove all gameconnection into seperate module, too many parallels
export class GameConnectionServer extends Net.Server {

    static _powerUpSeqno = 1;

    constructor({ip, zwiftAPI}) {
        super({noDelay: true});
        this.ip = ip;
        this.api = zwiftAPI;
        this._cmdSeqno = 1;
        this.athleteId = zwiftAPI.profile.id;
        this._userActions = new Map();
        const gct = protos.GameToCompanionCommandType;
        this._commandHandlers = {
            [gct.SET_POWER_UP]: this.onPowerupSetCommand,
            [gct.ACTIVATE_POWER_UP]: this.onPowerupActivateCommand,
            [gct.CLEAR_POWER_UP]: this.onPowerupClearCommand,
            [gct.SOCIAL_PLAYER_ACTION]: this.onSocialPlayerActionCommand,
            [gct.PACKET]: this.onPacketCommand,
            [gct.BLE_PERIPHERAL_REQUEST]: this.onIgnoringCommand,
            [gct.PAIRING_STATUS]: this.onIgnoringCommand,
            [gct.SEND_IMAGE]: this.onIgnoringCommand,
            [gct.SEND_VIDEO]: this.onIgnoringCommand,
            [gct.CUSTOMIZE_ACTION_BUTTON]: this.onIgnoringCommand,  // basically deprecated by user actions
        };
        if (Object.hasOwn(this._commandHandlers, 'undefined')) {
            console.error('GameToCompanionCommandType protobuf mismatch:',
                          this._commandHandlers['undefined']);
            throw new Error('Internal Protobuf Alignment Error');
        }
        const gpt = protos.GamePacketType;
        this._gamePacketHandlers = {
            [gpt.GAME_SESSION_INFO]: this.onGameSessionPacket,
            [gpt.USER_ACTION_SET]: this.onUserActionSet,
            [gpt.USER_ACTION_ACTION]: this.onUserActionAction,
            [gpt.WORKOUT_INFO]: this.onWorkoutInfo,
            [gpt.WORKOUT_STATE]: this.onWorkoutState,
            [gpt.PLAYER_FITNESS_INFO]: this.onIgnoringPacket,
            [gpt.MAPPING_DATA]: this.onIgnoringPacket,
            [gpt.SEGMENT_RESULT_ADD]: this.onIgnoringPacket,
            [gpt.SEGMENT_RESULT_REMOVE]: this.onIgnoringPacket,
            [gpt.SEGMENT_RESULT_NEW_LEADER]: this.onIgnoringPacket,
            [gpt.PLAYER_ACTIVE_SEGMENTS]: this.onIgnoringPacket,
            [gpt.INTERSECTION_AHEAD]: this.onIgnoringPacket,
            [gpt.SPORTS_DATA_REQUEST]: this.onIgnoringPacket,
            [gpt.EFFECT_REQUEST]: this.onIgnoringPacket,
            [gpt.PLAYER_STOPWATCH_SEGMENT]: this.onIgnoringPacket,
        };
        if (Object.hasOwn(this._gamePacketHandlers, 'undefined')) {
            console.error('GamePacketType protobuf mismatch:',
                          this._gamePacketHandlers['undefined']);
            throw new Error('Internal Protobuf Alignment Error');
        }
        this._reset('init');
        this.on('connection', this.onConnection.bind(this));
        this.on('error', this.onError.bind(this));
        // Listen on any available port..
        this.listenDone = new Promise(resolve => this.listen({address: this.ip, port: 0}, resolve));
    }

    onPacketCommand(command) {
        const gp = command.gamePacket;
        const handler = this._gamePacketHandlers[gp.type] || this.onUnhandledPacket;
        handler.call(this, gp, command);
    }

    onUnhandledCommand(command, gtc, buf) {
        console.debug('Unhandled command', command, pbToObject(command), buf.toString('hex'));
    }

    onIgnoringCommand() {}

    onPowerupSetCommand(command) {
        const o = pbToObject(command);
        o.powerUpType = protos.POWERUP_TYPE[command.powerUpId - 1];
        o.powerUpSeqno = this.constructor._powerUpSeqno++;
        this.emit('powerup-set', o);
    }

    onPowerupActivateCommand(command) {
        const o = pbToObject(command);
        o.powerUpType = protos.POWERUP_TYPE[command.powerUpId - 1];
        this.emit('powerup-activate', o);
    }

    onPowerupClearCommand(command) {
        console.warn("powerup clear command", command);
        this.emit('powerup-clear');
    }

    onSocialPlayerActionCommand(command, gtc) {
        const action = pbToObject(command.socialAction);
        this.emit('social-action', action, gtc.worldTime.toNumber());
    }

    onUnhandledPacket(packet) {
        console.debug('unhandled packet', pbToObject(packet));
    }

    onIgnoringPacket() {}

    onGameSessionPacket({gameSessionInfo}) {
        const info = pbToObject(gameSessionInfo);
        const actIdLong = gameSessionInfo.activityId;
        info.activityId = actIdLong.isZero() ? null : actIdLong.toString();
        info.sport = protos.Sport[info.sport - 1];
        this._gameSessionInfo = info;
        this.emit('game-session', info);
    }

    onUserActionSet({userActionSet}) {
        userActionSet = pbToObjectWithOptions(userActionSet, {arrays: true});
        const removed = [];
        if (userActionSet.type === 'INITIAL') {
            this._userActions.clear();
        } else if (userActionSet.expandedUserActionURI &&
                   ['EXPAND', 'UPDATE'].includes(userActionSet.type)) {
            for (const [k, ua] of this._userActions) {
                if (ua.parentURI === userActionSet.expandedUserActionURI &&
                    !userActionSet.userActions.some(x => x.uri === ua.uri)) {
                    removed.push(ua.uri);
                    this._userActions.delete(k);
                }
            }
        }
        for (const x of userActionSet.userActions) {
            this._userActions.set(x.uri, x);
        }
        const prettyKeys = userActionSet.userActions
            .map(x => `${x.uri}${x.presentable && x.enabled ? '' : '[UNAVAIL]'}`)
            .toSorted()
            .concat(removed.map(x => `${x}[REMOVED]`));
        if (prettyKeys.length) {
            console.info('Updated game connection user actions:', prettyKeys.join(', '));
        }
        this.emit('user-actions-set', userActionSet);
    }

    onUserActionAction({userActionAction, ...other}) {
        const resp = pbToObject(userActionAction);
        const pr = this._pendingUserActionResolvers;
        if (!pr || resp.userActionURI !== pr.uri) {
            return;
        }
        clearTimeout(pr.timeoutId);
        this._pendingUserActionResolvers = null;
        if (resp.acknowledgement === 'SUCCESSFUL') {
            pr.resolve(resp);
        } else {
            pr.reject(new Error('User Action Failed'));
        }
    }

    onWorkoutInfo({workoutInfo}) {
        const info = pbToObject(workoutInfo);
        if (info.workoutXML) {
            info.file = parseXml(info.workoutXML.toString()).root.toJSON();
            delete info.workoutXML;
        }
        this._workoutStatus = {info, state: null};
        this.emit('workout-status', this._workoutStatus);
    }

    onWorkoutState({workoutState}) {
        if (!this._workoutStatus) {
            return;
        }
        const state = pbToObject(workoutState);
        this._workoutStatus.state = state;
        this.emit('workout-status', this._workoutStatus);
    }

    getWorkoutStatus() {
        return this._workoutStatus;
    }

    getGameSessionInfo() {
        return this._gameSessionInfo;
    }

    getUserActions() {
        return Array.from(this._userActions.values()).toSorted((a, b) => a.uri < b.uri ? -1 : 1);
    }

    async start() {
        try {
            await this._start();
        } catch(e) {
            this._reset('error', e);
            throw e;
        }
    }

    async _start() {
        await this.listenDone;
        const {port} = this.address();
        console.info("Registering game connection server:", this.ip, port);
        this.port = port;
        this._state = 'waiting';
        await this.api.fetch('/relay/profiles/me/phone', {
            method: 'PUT',
            json: {
                phoneAddress: this.ip,
                port,
                protocol: 'TCP',
            }
        });
    }

    async setCamera(value) {
        await this.runUserAction(`camera:${value}`);
    }

    async changeCamera() {
        await this._sendCommand({type: 'CHANGE_CAMERA_ANGLE'});
    }

    async elbow() {
        await this._sendCommand({type: 'ELBOW_FLICK'});
    }

    async wave() {
        await this._sendCommand({type: 'WAVE'});
    }

    async powerup() {
        await this._sendCommand({type: 'ACTIVATE_POWER_UP'});
    }

    async say(what) {
        const type = {
            rideon: 'RIDE_ON',
            bell: 'BELL',
            hammertime: 'HAMMER_TIME',
            toast: 'TOAST',
            nice: 'NICE',
            bringit: 'BRING_IT',  // DEPRECATED
        }[what];
        if (!type) {
            throw new TypeError(`Invalid say type: ${what}`);
        }
        await this._sendCommand({type});
    }

    async ringBell() {
        await this._sendCommand({type: 'BELL'});
    }

    async endRide() {
        await this._sendCommand({type: 'DONE_RIDING'});
    }

    async takePicture() {
        await this._sendCommand({type: 'TAKE_SCREENSHOT'});
    }

    async takeVideo() {
        await this._sendCommand({type: 'TAKE_VIDEO_SCREENSHOT'});
    }

    async enableHUD(en=true) {
        await this._hud(en);
    }

    async disableHUD(en=false) {
        await this._hud(en);
    }

    async _hud(en=true) {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: en ? 1080 : 1081,
        });
    }

    async toggleGraphs() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1060,
        });
    }

    async turnLeft() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1010,
        });
    }

    async goStraight() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1011,
        });
    }

    async turnRight() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1012,
        });
    }

    async coffeeStop() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1090,
        });
    }

    async discardPowerUp() {
        await this._sendCommand({
            type: 'CUSTOM_ACTION',
            subCommand: 1030,  // there are type specific discard subcommands > 1030 as well
        });
    }

    async reverse() {
        await this._sendCommand({type: 'U_TURN'});
    }

    async chatMessage(message, options={}) {
        const p = this.api.profile;
        await this._sendCommand({
            type: 'SOCIAL_PLAYER_ACTION',
            socialAction: {
                athleteId: p.id,
                type: 'TEXT_MESSAGE',
                firstName: p.firstName,
                lastName: p.lastName,
                avatar: p.imageSrc,
                countryCode: p.countryCode,
                messageGroupType: options.to ? 'DIRECT' : 'GLOBAL',
                toAthleteId: options.to || 0,
                message,
            }
        });
    }

    async watch(id) {
        await this._sendCommand({
            type: 'FAN_VIEW',
            subject: id,
        });
        this.emit('watch-command', id);
    }

    async join(id) {
        await this._sendCommand({
            type: 'JOIN_ANOTHER_PLAYER',
            subject: id,
        });
    }

    async teleportHome() {
        await this._sendCommand({type: 'TELEPORT_TO_START'});
    }

    async teleportToAthlete(id) {
        await this._sendCommand({type: 'JOIN_ANOTHER_PLAYER', subject: id});
    }

    async _sendGamePacket(gamePacket) {
        await this._sendCommand({
            type: 'PHONE_TO_GAME_PACKET',
            gamePacket,
        });
    }

    async _sendClientAction(clientAction) {
        await this._sendGamePacket({
            type: 'CLIENT_ACTION',
            clientAction,
        });
    }

    async _sendUserAction(userActionAction) {
        await this._sendGamePacket({
            type: 'USER_ACTION_ACTION',
            userActionAction,
        });
    }

    doUserAction(...args) {
        // We can't strongly correlate user action responses because of gaps in the
        // companion protocol design.  Serialize them instead.  Also it's not clear if
        // the game would tolerate concurrent user actions.
        const gc = this._gameConnection;
        const p = this._pendingUserAction.then(() => {
            if (this._gameConnection !== gc) {
                throw new Error('Connection Invalidated');
            }
            return this._doUserAction(...args);
        });
        this._pendingUserAction = p.catch(() => null);
        return p;
    }

    async _doUserAction(type, uri, {noAck, runParameters}={}) {
        if (!this._userActions.has(uri)) {
            console.error('User action not available:', uri,
                          `(available: ${Array.from(this._userActions.keys()).join()}`);
            throw new TypeError('Invalid User Action URI');
        }
        let pr;
        if (!noAck) {
            pr = this._pendingUserActionResolvers = Promise.withResolvers();
            pr.timeoutId = setTimeout(() => pr.reject(new Error('timeout')), 15_000);
            pr.uri = uri;
        }
        const sendPromise = this._sendUserAction({
            runParameters,
            type,
            userActionURI: uri,
        });
        await Promise.all([pr?.promise, sendPromise]);
    }

    async runUserAction(uri, options) {
        const runParameters = options ?
            Object.entries(options).map(x => ({name: x[0], value: x[1]})) :
            undefined;
        await this.doUserAction('RUN', uri, {runParameters});
    }

    async expandUserAction(uri) {
        await this.doUserAction('EXPAND', uri);
    }

    async collapseUserAction(uri) {
        await this.doUserAction('COLLAPSE', uri, {noAck: true});
    }

    async _sendCommand(command) {
        if (!this._gameConnection) {
            throw new Error('Not Connected');
        }
        await this._gameConnection.send({
            athleteId: this.athleteId,
            commands: [{
                ...command,
                seqno: this._cmdSeqno++
            }]
        });
    }

    async onConnection(socket) {
        console.info('Game connection established from:', socket.remoteAddress);
        if (this._gameConnection) {
            debugger;
            this._gameConnection.shutdown();
        }
        this._reset('connected');
        const gc = this._gameConnection = new GameConnection(socket);
        gc.on('message', this.onGameConnectionMessage.bind(this));
        gc.on('shutdown', this.onGameConnectionShutdown.bind(this));
        this._gameConnection = gc;
        this.emit('status', this.getStatus());
        await this._sendCommand({
            type: 'PHONE_TO_GAME_PACKET',
            gamePacket: {
                type: 'CLIENT_INFO',
                clientInfo: {
                    appVersion: '0.1.0',
                    deviceModel: OS.machine(),
                    platform: OS.platform(),
                    osVersion: OS.release(),
                    capabilities: {orientation: false, headphones: false},
                }
            }
        });
        await this._sendCommand({
            type: 'PAIRING_AS',
            athleteId: this.athleteId,
        });
        await this._sendClientAction({type: 'START_CONNECTED_SESSION'});
        await this._sendClientAction({type: 'ACTION_BAR_OPEN'});  // triggers userActionSet
    }

    getStatus() {
        const connected = !!this._gameConnection;
        return {
            connected,
            port: this.port,
            state: this._state,
            error: this._state === 'error' ? this._error.message : undefined,
        };
    }

    onError(e) {
        console.error('Game connection server error:', e);
        this._reset('error', e);
        this.emit('status', this.getStatus());
    }

    onGameConnectionMessage(msg, msgBuf) {
        for (const x of msg.commands) {
            const handler = this._commandHandlers[x.type] || this.onUnhandledCommand;
            try {
                handler.call(this, x, msg, msgBuf);
            } catch(e) {
                console.error("Companion command handler:", x.type, x, e);
            }
        }
        if (msg.playerState) {
            this.emit('outgoing-player-state', msg.playerState);
        }
    }

    onGameConnectionShutdown({state, error}) {
        console.warn("Game connection shutdown:", state, error);
        this._reset(state, error);
        this.emit('status', this.getStatus());
    }

    _reset(state, error=null) {
        const oldGameConn = this._gameConnection;
        this._gameConnection = null;
        this._state = state;
        this._error = error;
        this._pendingUserAction = Promise.resolve();
        if (oldGameConn) {
            oldGameConn.shutdown();
        }
    }
}
