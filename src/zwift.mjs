import Path from 'node:path';
import Net from 'node:net';
import Dgram from 'node:dgram';
import Events from 'node:events';
import Crypto from 'node:crypto';
import OS from 'node:os';
import Protobuf from 'protobufjs';
import * as Env from './env.mjs';
import {fileURLToPath} from 'node:url';

const __dirname = Path.dirname(fileURLToPath(import.meta.url));
const _case = Protobuf.parse.defaults.keepCase;
Protobuf.parse.defaults.keepCase = true;
export const protos = Protobuf.loadSync([Path.join(__dirname, 'zwift.proto')]).root;
Protobuf.parse.defaults.keepCase = _case;

const zOffline = null;  // 'localhost';
const HOUR = 3600 * 1000;

// NOTE: this options object does not contain callback functions (as it might appear).
// A static type comparison is used by protobufjs's toObject function instead. :(
const _pbJSONOptions = {
    ...Protobuf.util.toJSONOptions,
    longs: Number,
    bytes: null,  // pass through
};


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


class WorldTimer extends Events.EventEmitter {
    constructor() {
        super();
        this._epoch = 1414016074400;
        this._offt = 0;
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

    adjustOffset(diff) {
        this._offt = Math.round(this._offt + diff);
        this.emit('offset', diff);
        if (Math.abs(diff) > 5000) {
            console.warn("Shifted WorldTime offset:", diff, this._offt);
        }
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

    async getProfile(id, options) {
        if (this.exclusions.has(getIDHash(id))) {
            return;
        }
        try {
            return await this.fetchJSON(`/api/profiles/${id}`, options);
        } catch(e) {
            if (e.status === 404) {
                return;
            }
            throw e;
        }
    }

    async getPowerProfile() {
        return await this.fetchJSON(`/api/power-curve/power-profile`);
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
            x.privacy = {
                defaultActivityPrivacy: x.defaultActivityPrivacy,
            };
            delete x.defaultActivityPrivacy;
            for (const [k, flag] of Object.entries(pbProfilePrivacyFlags)) {
                x.privacy[k] = !!(+x.privacyBits & flag);
            }
            for (const [k, flag] of Object.entries(pbProfilePrivacyFlagsInverted)) {
                x.privacy[k] = !(+x.privacyBits & flag);
            }
            delete x.privacyBits;
            x.powerSourceModel = {
                VIRTUAL: 'zPower', // consistent with JSON api; applies to runs too
                POWER_METER: 'Power Meter',
                SMART_TRAINER: 'Smart Trainer',
            }[x.powerType];
            delete x.followerStatusOfLoggedInPlayer;
            return x;
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

    async getEventSubgroupResults(id) {
        let start = 0;
        const limit = 50;  // 50 is max, but the endpoint is wicked fast
        const results = [];
        while (true) {
            const data = await this.fetchJSON(`/api/race-results/entries`, {
                query: {
                    event_subgroup_id: id,
                    start,
                    limit,
                },
            });
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
        const ivBuf = Buffer.allocUnsafe(12);
        ivBuf.writeUInt16BE(deviceTypes[this.deviceType], 2);
        ivBuf.writeUInt16BE(channelTypes[this.channelType], 4);
        ivBuf.writeUInt16BE(this.connId || 0, 6);
        ivBuf.writeUInt32BE(this.seqno || 0, 8);
        return ivBuf;
    }

    toString() {
        return `RelayIV deviceType:${this.deviceType} channelType:${this.channelType} ` +
            `connId:${this.connId} seqno:${this.seqno}`;
    }
}


class NetChannel extends Events.EventEmitter {
    static getConnInc() {
        return this._connInc++ % 0xffff; // Defined by subclasses so tcp and udp each have their own counter
    }

    constructor(options) {
        super();
        this.ip = options.ip;
        this.proto = options.proto;
        this.connId = this.constructor.getConnInc();
        this.relayId = options.session.relayId;
        this.aesKey = options.session.aesKey;
        this._sendSeqno = 0;
        this.sendIV = new RelayIV({channelType: `${options.proto}Client`, connId: this.connId});
        this.recvIV = new RelayIV({channelType: `${options.proto}Server`, connId: this.connId});
        this.recvCount = 0;
        this.sendCount = 0;
        this.errCount = 0;
        this.timeout = options.timeout || 30000;
        this.active = undefined;
    }

    toString() {
        return `<NetChannel [${this.proto}] connId: ${this.connId}, relayId: ${this.relayId}, ` +
            `recv: ${this.recvCount}, send: ${this.sendCount}, ip: ${this.ip}>`;
    }

    incError() {
        this.errCount++;
        const limit = 10;
        if (this.errCount > limit) {
            console.error("Error count exceeded limit:", limit);
            this.shutdown();
        }
    }

    decrypt(data) {
        const iv = this.recvIV;
        const flags = data.readUint8(0);
        let headerOfft = 1;
        if (flags & headerFlags.relayId) {
            const relayId = data.readUInt32BE(headerOfft);
            if (relayId !== this.relayId) {
                console.error("Unexpected relayId:", relayId, this.toString());
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
        const decipher = Crypto.createDecipheriv('aes-128-gcm', this.aesKey, ivBuf, {authTagLength: 4});
        decipher.setAAD(data.subarray(0, headerOfft));
        decipher.setAuthTag(data.subarray(-4));
        const plain = Buffer.concat([decipher.update(data.subarray(headerOfft, -4)), decipher.final()]);
        iv.seqno++;
        return plain;
    }

    encrypt(aad, data) {
        const cipher = Crypto.createCipheriv('aes-128-gcm', this.aesKey, this.sendIV.toBuffer(),
                                             {authTagLength: 4});
        cipher.setAAD(aad);
        const cb1 = cipher.update(data);
        const cb2 = cipher.final();
        const authTag = cipher.getAuthTag();  // must follow final
        const dataBuf = Buffer.concat([cb1, cb2, authTag]);
        this.sendIV.seqno++;
        return dataBuf;
    }

    encodeHeader(options={}) {
        const iv = this.sendIV;
        let flags = 0;
        let headerOfft = 1;
        const header = Buffer.allocUnsafe(11);
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
        if (!this._shutdownTimeout) {
            // We're scheduled for shutdown, don't enable watchdog..
            this._enableWatchdog();
        }
        this.active = true;
    }

    shutdown() {
        this._disableWatchdog();
        if (this.active !== false) {
            this.active = false;
            queueMicrotask(() => this.emit('shutdown', this));
        }
    }

    schedShutdown(time) {
        this._disableWatchdog();
        if (!this._shutdownTimeout) {
            this._shutdownTimeout = setTimeout(this.shutdown.bind(this), time);
        }
    }

    cancelShutdown() {
        clearTimeout(this._shutdownTimeout);
        this._shutdownTimeout = null;
        this._enableWatchdog();
    }

    _enableWatchdog() {
        if (!this._watchdogLoop) {
            this._watchdogLoop = setInterval(this._checkWatchdog.bind(this), this.timeout / 2);
        }
        this.tickleWatchdog();
    }

    _disableWatchdog() {
        if (this._watchdogLoop) {
            clearInterval(this._watchdogLoop);
            this._watchdogLoop = null;
        }
    }

    _checkWatchdog() {
        const elapsed = Date.now() - this._watchdogTS;
        if (elapsed > this.timeout) {
            this.tickleWatchdog();
            this.emit('timeout', this, elapsed);
        }
    }

    tickleWatchdog() {
        this._watchdogTS = Date.now();
    }

    makeDataPBAndBuffer(props) {
        const seqno = this._sendSeqno++;
        // create is faster than fromObject but less safe (no conversions)
        const pb = protos.ClientToServer.fromObject({seqno, ...props});
        return [pb, protos.ClientToServer.encode(pb).finish()];
    }
}


class TCPChannel extends NetChannel {
    static _connInc = 0;

    constructor(options) {
        super({proto: 'tcp', ...options});
        this.conn = null;
    }

    async establish() {
        this.conn = Net.createConnection({
            host: this.ip,
            port: 3025,
            timeout: 31000,
            onread: {
                buffer: Buffer.alloc(65536),
                callback: this.onTCPData.bind(this),
            }
        });
        // Note: do not use setKeepAlive...
        // https://github.com/nodejs/node/issues/40764
        await new Promise((resolve, reject) => {
            this.conn.once('connect', resolve);
            this.conn.once('error', reject);
        });
        this.conn.on('close', () => this.shutdown());
        this.conn.on('timeout', () => this.shutdown());
        this.conn.on('error', () => this.shutdown());
        super.establish();
    }

    shutdown() {
        super.shutdown();
        if (this.conn) {
            this.conn.removeAllListeners();
            this.conn.destroy();
            this.conn = null;
        }
    }

    onTCPData(nread, buf) {
        try {
            this._onTCPData(nread, buf);
        } catch(e) {
            console.error("TCP recv handler error:", e);
            this.incError();
        }
    }

    _onTCPData(nread, buf) {
        this.recvCount++;
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
                const plainBuf = this.decrypt(completeBuf);
                this.emit('inPacket', protos.ServerToClient.decode(plainBuf), this);
            }
        }
        this.tickleWatchdog();
    }

    async sendPacket(props, options={}) {
        const {0: pb, 1: dataBuf} = this.makeDataPBAndBuffer(props);
        const headerBuf = this.encodeHeader(options);
        const version = 2;
        const prefixBuf = Buffer.from([version, options.hello ? 0 : 1]);
        const plainBuf = Buffer.concat([prefixBuf, dataBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf);
        const sizeBuf = Buffer.allocUnsafe(2);
        sizeBuf.writeUInt16BE(headerBuf.byteLength + cipherBuf.byteLength);
        const wireBuf = Buffer.concat([sizeBuf, headerBuf, cipherBuf]);
        await new Promise(resolve => this.conn.write(wireBuf, resolve));
        this.sendCount++;
        this.emit('outPacket', pb);
        return pb;
    }
}


class InactiveChannelError extends Error {}


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
        const world = this.courseId ?
            `${Env.worldMetas[this.courseId]?.name} (${this.courseId})` :
            'UNATTACHED';
        return `<UDPChannel [${this.isDirect ? 'DIRECT' : 'LB'}] ${world}, ` +
            `connId: ${this.connId}, relayId: ${this.relayId}, recv: ${this.recvCount}, ip: ${this.ip}>`;
    }

    async establish() {
        this.sock = Dgram.createSocket('udp4');
        this.sock.on('message', this.onUDPData.bind(this));
        this.sock.on('close', () => this.shutdown());
        this.sock.on('error', () => this.shutdown());
        await new Promise((resolve, reject) =>
            this.sock.connect(3024, this.ip, e => void (e ? reject(e) : resolve())));
        if (this.active === false) {
            throw new InactiveChannelError();
        }
        const syncStamps = new Map();
        let complete = false;
        const offsets = [];
        const syncComplete = new Promise((resolve, reject) => {
            const onPacket = packet => {
                if (this.active === false) {
                    reject(new InactiveChannelError());
                }
                const localWorldTime = worldTimer.now();
                const sent = syncStamps.get(packet.ackSeqno);
                if (sent === undefined) {
                    return;  // already measured / non-hello packet
                }
                syncStamps.delete(packet.ackSeqno);
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
                        const meanOffset = validOffsets.reduce((a, x) => a + x.offt, 0) / validOffsets.length;
                        worldTimer.adjustOffset(-meanOffset);
                        this.off('inPacket', onPacket);
                        complete = true;
                        this.emit('latency', median);
                    }
                }
            };
            this.on('inPacket', onPacket);
        });
        for (let i = 1; i < 25 && !complete; i++) {
            // Send hankshake packets with `hello` option (full IV in AAD).  Even if they
            // are dropped the AES decrypt and IV state machine setup will succeed and pave the
            // way for sends that only require `seqno`, even with packet loss on this socket.
            //
            // The primary goal is to inform the servers we are here and ready for data,
            // but if our clock is too far off they will ignore us, so we need to sync our
            // worldTime offset too.  Some research on common game timer sync methods
            // suggests SNTP should be fine here.
            const ts = worldTimer.now();
            const {seqno} = await this.sendPacket({
                athleteId: this.athleteId,
                realm: 1,
                worldTime: 0,
            }, {hello: true});
            syncStamps.set(seqno, ts);
            await Promise.race([sleep(10 * i), syncComplete]);
        }
        if (!complete) {
            console.error("Timeout waiting for handshake sync:", this.toString());
            this.shutdown();
            return;
        }
        if (this.active === false) {
            throw new InactiveChannelError();
        }
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
            console.error("UDP recv handler error:", e);
            this.incError();
        }
    }

    _onUDPData(buf) {
        this.recvCount++;
        const stc = protos.ServerToClient.decode(this.decrypt(buf));
        this.emit('inPacket', stc, this);
        this.tickleWatchdog();
    }

    async sendPacket(props, options={}) {
        if (this.active === false) {
            throw new InactiveChannelError();
        }
        const {0: pb, 1: dataBuf} = this.makeDataPBAndBuffer(props);
        const version = 1; // Deprecates hash-seeds and 0xDF (dont-forward) byte.
        const prefixBuf = Buffer.from([version]);
        const headerBuf = this.encodeHeader({forceSeq: true, ...options});
        const plainBuf = Buffer.concat([prefixBuf, dataBuf]);
        const cipherBuf = this.encrypt(headerBuf, plainBuf);
        const wireBuf = Buffer.concat([headerBuf, cipherBuf]);
        await new Promise((resolve, reject) =>
            this.sock.send(wireBuf, e => void (e ? reject(e) : resolve())));
        this.sendCount++;
        this.emit('outPacket', pb);
        return pb;
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
        this._errCount = 0;
        this.connectingTS = 0;
        this.connectingCount = 0;
        this._session = null;
        this._setWatchingWorldTime = 0;
        this._lastSelfStateUpdated = 0;
        this._lastWatchingStateUpdated = 0;
        this._lastWorldUpdate = 0;
        this._lastTCPServer;
        this._stateRefreshDelay = this._stateRefreshDelayMin;
        this._latency;
        const wupt = protos.WorldUpdate.WorldUpdatePayloadType;
        this.binaryWorldUpdateDecoders = {
            [wupt.PlayerRegisteredForEvent]: this.decodePlayerRegisteredForEvent,
            [wupt.NotableMoment]: this.decodeNotableMoment,
            [wupt.WorldTime]: this.decodeWorldTime,
            [wupt.SegmentResult]: this.decodeSegmentResult,
            [wupt.PerformAction]: this.decodePerformAction,
            [wupt.PlayerFlag]: this.decodePlayerFlag,
        };
        if (Object.hasOwn(this.binaryWorldUpdateDecoders, 'undefined')) {
            console.error('Missing binary world update payload type:',
                          this.binaryWorldUpdateDecoders, wupt);
            throw new Error('Internal Protobuf Alignment Error');
        }
        worldTimer.on('offset', diff => {
            const dev = Math.abs(diff);
            if (dev > 200) {
                // Otherwise we could be stuck watching the wrong athlete.
                this._setWatchingWorldTime = 0;
            }
        });
        setInterval(() => this.logStatus(), 60000);
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
            active = this._udpChannels.some(x => x.active);
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
        console.warn("figure this out (notable momemnt)", athleteId, worldTime, _f1, _f4, _f5);
        return {athleteId, worldTime, _f1, _f4, _f5};
    }

    decodeWorldTime(buf) {
        const intLE = buf.readInt32LE();
        const intBE = buf.readInt32BE();
        const floatLE = buf.readFloatLE();
        const floatBE = buf.readFloatBE();
        console.debug("Figure this out (worldTime):", {intLE, intBE, floatLE, floatBE});
        debugger;
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
        console.debug("try to figure out f2 and f3", {athleteId, _f2, _f3}, buf);
        return {athleteId, _f2, _f3};
    }

    decodePlayerFlag(buf) {
        // Absolutely no idea so far, encoded maybe?
        console.debug("Player Flag TBD:", buf.toString('hex'));
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
        const tDelta = tMean - serverTime;
        if (Math.abs(tDelta) > 60000) {
            // Perform course clock correction prior to any SNTP fine tuning to avoid hash seed errors
            console.warn('System clock is highly inaccurate:', fmtTime(tDelta));
            worldTimer.adjustOffset(-tDelta);
        }
        const expires = Date.now() + (login.expiration * 60 * 1000);
        await sleep(1000); // No joke this is required (100ms works about 50% of the time)
        return {
            aesKey,
            relayId: login.relaySessionId,
            tcpServers: login.session.tcpConfig.servers,
            expires,
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
            } else {
                console.debug("Nobody public in", world.courseId, world);
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

    start() {
        if (this._starting) {
            throw new TypeError('invalid state');
        }
        this._stopping = false;
        this._starting = true;
        console.info("Starting Zwift Game Monitor...");
        queueMicrotask(() => this.connect());
    }

    stop() {
        console.info("Stopping Zwift Game Monitor...");
        this._stopping = true;
        this.disconnect();
        this._starting = false;
    }

    _setConnecting() {
        this.connectingTS = Date.now();
        this.connectingCount++;
    }

    async connect() {
        console.info("Connecting to Zwift relay servers...");
        try {
            await this._connect();
        } catch(e) {
            if (e.message === 'fetch failed' || e.name === 'TimeoutError') {
                console.warn('GameMonitor connect network problem:', e.cause?.message || e);
            } else {
                console.error('GameMonitor connect failed:', e);
            }
            this._schedConnectRetry();
        }
    }

    async _connect() {
        this._setConnecting();
        const session = await this.login();
        await this.initPlayerState();
        await this.establishTCPChannel(session);
        await this.activateSession(session);
        this._playerStateInterval = setInterval(this.broadcastPlayerState.bind(this), 1000);
        this._refreshStatesTimeout = setTimeout(() => this._refreshStates(), this._stateRefreshDelay);
        this.logStatus();
    }

    async refreshSession() {
        if (!this._starting || this._stopping || !this._session) {
            throw new TypeError('invalid state');
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
        console.info("Disconnecting from Zwift relay servers...");
        clearInterval(this._playerStateInterval);
        clearTimeout(this._sessionTimeout);
        clearTimeout(this._refreshStatesTimeout);
        const channels = Array.from(this._udpChannels);
        this._udpChannels.length = 0;
        if (this._session && this._session.tcpChannel) {
            channels.push(this._session.tcpChannel);
            this._session.tcpChannel = null;
        }
        this._session = null;
        for (const ch of channels) {
            try {
                ch.shutdown();
            } catch(e) {
                console.error(e); // A little extra paranoid for now.
            }
        }
    }

    reconnect() {
        if (!this._stopping) {
            this._schedConnectRetry();
        }
    }

    async establishTCPChannel(session) {
        const servers = session.tcpServers.filter(x => x.realm === 0 && x.courseId === 0);
        // After countless hours of testing and experiments I've concluded that I really need
        // to stick to the same TCP server no matter what. :(
        let ip;
        if (this._lastTCPServer) {
            const lastServer = servers.find(x => x.ip === this._lastTCPServer);
            if (lastServer) {
                ip = lastServer.ip;
            }
        }
        if (!ip) {
            ip = servers[0].ip;
        }
        this._lastTCPServer = ip;
        console.info(`Establishing TCP channel to:`, ip);
        session.tcpChannel = new TCPChannel({ip, session});
        session.tcpChannel.on('shutdown', this.onTCPChannelShutdown.bind(this));
        session.tcpChannel.on('inPacket', this.onInPacket.bind(this));
        await session.tcpChannel.establish();
    }

    makeUDPChannel(ip) {
        const isDirect = !!ip;
        if (!ip) {
            // Use a load balancer initially, We'll get swapped to a direct server soon after..
            ip = this._udpServerPools.get(0).servers[0].ip;
        }
        const ch = new UDPChannel({
            ip,
            courseId: this.courseId,
            athleteId: this.athleteId,
            session: this._session,
            isDirect,
        });
        console.info(`Making new: ${ch}`);
        ch.on('shutdown', () => {
            console.info("Shutdown:", ch.toString());
            const i = this._udpChannels.indexOf(ch);
            if (i !== -1) {
                this._udpChannels.splice(i, 1);
                if (!this.suspended && this._session && (i === 0 || !this._udpChannels.length)) {
                    console.info("Last/primary channel shutdown");
                    this.setUDPChannel();
                }
            }
        });
        ch.on('inPacket', this.onInPacket.bind(this));
        ch.on('latency', x => this._latency = x);
        ch.on('timeout', () => {
            console.warn("Data watchdog timeout triggered:", ch.toString());
            ch.shutdown();
        });
        return ch;
    }

    onTCPChannelShutdown(ch) {
        console.warn("TCP channel shutdown:", ch.toString());
        if (this._session && this._session.tcpChannel === ch && !this._stopping) {
            this._schedConnectRetry();
        }
    }

    _schedConnectRetry() {
        clearTimeout(this._connectRetryTimeout);
        this.disconnect();
        const backoffCount = this.connectingCount + this._errCount;
        const delay = Math.max(1000, (1000 * 1.2 ** backoffCount) - (Date.now() - this.connectingTS));
        console.warn('Next connect retry:', fmtTime(delay));
        this._connectRetryTimeout = setTimeout(this.connect.bind(this), delay);
    }

    async activateSession(session) {
        const error = new Promise((_, reject) => {
            session.tcpChannel.once('shutdown', () => reject(new Error("shutdown")));
            setTimeout(() => reject(new Error('timeout')), 30000);
        });
        const udpServersPending = this._udpServerPools.size ||
            new Promise(resolve => this.once('udpServerPoolsUpdated', resolve));
        // This packet causes Zwift to close any other TCP connections for this athlete.
        // Also any UDP channels for those relay sessions will stop flowing.
        console.info("Activating session with:", session.tcpChannel.toString());
        await Promise.race([error, session.tcpChannel.sendPacket({
            athleteId: this.athleteId,
            worldTime: 0,
            largestWorldAttributeTimestamp: this._lastWorldUpdate,
        }, {hello: true})]);
        if (udpServersPending) {
            await Promise.race([error, udpServersPending]);
        }
        error.catch(() => void 0);
        const old = this._session;
        this._session = null;
        if (old) {
            if (old.tcpChannel) {
                try {
                    old.tcpChannel.shutdown();
                } catch(e) {
                    console.error(e); // A little extra paranoid for now.
                }
            }
        }
        this._session = session;
        this._schedSessionRefresh(session.expires);
        if (!this.suspended && this.courseId) {
            this.setUDPChannel();
        } else {
            console.warn("User not in game: waiting for activity...");
            this.suspend();
        }
    }

    _schedSessionRefresh(expires) {
        const refreshDelay = (expires - Date.now()) * 0.90;
        console.debug('Next session refresh:', fmtTime(refreshDelay));
        if (this._sessionTimeout) {
            clearTimeout(this._sessionTimeout);
        }
        this._sessionTimeout = setTimeout(this.refreshSession.bind(this), refreshDelay);
    }

    incErrorCount() {
        this._errCount++;
        if (this._errCount % 10 === 0) {
            console.warn('Error count too high:', this._errCount);
            this._schedConnectRetry();
        }
    }

    async broadcastPlayerState() {
        if (this.suspended || this._stopping) {
            return;
        }
        const lws = this._lastWatchingState;
        const portal = lws ? lws.portal : undefined;
        for (const ch of this._udpChannels) {
            if (ch.active) {
                try {
                    // XXX do more duration testing without a single send here..
                    await ch.sendPlayerState({
                        watchingAthleteId: this.watchingAthleteId,
                        _flags2: portal ? encodePlayerStateFlags2({roadId: lws.roadId}) : undefined,
                        portal,
                        eventSubgroupId: lws?.eventSubgroupId || 0,
                        ...this.watchingStateExtra});
                    break;
                } catch(e) {
                    if (!(e instanceof InactiveChannelError)) {
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
        for (const x of this._udpChannels) {
            x.schedShutdown(30000);
        }
    }

    resume() {
        if (!this.suspended) {
            return;
        }
        this.suspended = false;
        if (this._stopping) {
            return;
        }
        console.info("Resuming game monitor...");
        if (this.courseId && !this._udpChannels.length) {
            this.setUDPChannel();
        }
    }

    async _refreshStates() {
        if (this._stopping) {
            return;
        }
        const id = this._refreshStatesTimeout;
        try {
            const age = await this._refreshSelfState();
            if (this.selfAthleteId !== this.watchingAthleteId) {
                await this._refreshWatchingState();
            }
            if (age > 15000) {
                // Stop harassing relay servers and relax state fetch...
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
        if (!this._stopping && id === this._refreshStatesTimeout) {
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

    _isChannelReusable(ch) {
        return !!(
            ch.active !== false &&
            ch.isDirect &&
            ch.courseId === this.courseId &&
            ch.relayId === this._session.relayId
        );
    }

    setUDPChannel(ip) {
        const reuseIndex = this._udpChannels.findIndex(x =>
            ip && ip === x.ip && this._isChannelReusable(x));
        if (reuseIndex === 0) {
            console.error("Redundant call to setUDPChannel");
            return;
        }
        const legacyCh = this._udpChannels[0];
        if (legacyCh) {
            const grace = this._isChannelReusable(legacyCh) ? 60000 : 1000;
            legacyCh.schedShutdown(grace);
        }
        let ch;
        if (reuseIndex !== -1) {
            ch = this._udpChannels.splice(reuseIndex, 1)[0];
            ch.cancelShutdown();
            console.debug("Switching to:", ch.toString());
        } else {
            ch = this.makeUDPChannel(ip);
            queueMicrotask(() => this.establishUDPChannel(ch));
        }
        this._udpChannels.unshift(ch);
    }

    async establishUDPChannel(ch) {
        try {
            await ch.establish();
            await ch.sendPlayerState({watchingAthleteId: this.watchingAthleteId});
        } catch(e) {
            if (e instanceof InactiveChannelError) {
                console.warn("Channel became inactive during establish:", ch.toString(), e);
                return;
            }
            console.error('Error during UDP establish:', e);
            ch.shutdown();
            this.incErrorCount();
        }
        console.info(`Established:`, ch.toString());
    }

    onInPacket(pb, ch) {
        if (pb.multipleLogins) {
            console.warn("Multiple logins detected!");
        }
        if (pb.udpConfig) {
            // I believe this is the "load balancer" address, that can also be found in the VOD list..
        }
        if (pb.udpConfigVOD) {
            for (const x of pb.udpConfigVOD.pools) {
                this._udpServerPools.set(x.courseId, x);
            }
            if (pb.udpConfigVOD.portalPools) {
                if (pb.udpConfigVOD.portalPools.length > 1) {
                    // It's technically an array but the course and realm are 0 so it's not clear
                    // how we disambiguate.
                    debugger;
                }
                this._udpServerPools.set('portal', pb.udpConfigVOD.portalPools[0]);
            }
            this.emit('udpServerPoolsUpdated', this._udpServerPools);
        }
        if (pb.deletedWorldUpdates.length || pb.blockPlayerStates.length) {
            debugger;
        }
        const dropList = [];
        if (pb.worldUpdates.length) {
            for (let i = 0; i < pb.worldUpdates.length; i++) {
                const wupb = pb.worldUpdates[i];
                const wu = pb.worldUpdates[i] = pbToObject(wupb);
                if (wu.ts <= this._lastWorldUpdate) {
                    dropList.push(i);
                    debugger;
                    continue;
                }
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
            if (dropList.length) {
                for (let i = dropList.length - 1; i >= 0; i--) {
                    pb.worldUpdates.splice(i, 1);
                }
                dropList.length = 0;
            }
        }
        const now = worldTimer.now();
        for (let i = 0; i < pb.playerStates.length; i++) {
            const state = pb.playerStates[i] = processPlayerStateMessage(pb.playerStates[i], now);
            if (state.athleteId === this.selfAthleteId) {
                this._updateSelfState(state);
            } else if (state.activePowerUp === 'NINJA' || this.exclusions.has(getIDHash(state.athleteId))) {
                dropList.push(i);
            }
            if (state.athleteId === this.watchingAthleteId) {
                this._updateWatchingState(state);
            }
        }
        if (dropList.length) {
            for (let i = dropList.length - 1; i >= 0; i--) {
                pb.playerStates.splice(i, 1);
            }
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
            this.setUDPChannel();
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
        const curCh = this._udpChannels[0];
        if (curCh) {
            const best = this.findBestUDPServer(state);
            if (best && (best.ip !== curCh.ip || !curCh.isDirect)) {
                this.setUDPChannel(best.ip);
            }
        } else {
            console.info("Recovering UDP channel...");
            this.setUDPChannel();
        }
    }

    findBestUDPServer({x, y, portal, courseId}) {
        const pool = this._udpServerPools.get(portal ? 'portal' : courseId);
        if (!pool) {
            return;
        }
        if (pool.useFirstInBounds) {
            return pool.servers.find(server => x <= server.xBound && y <= server.yBound);
        } else {
            let closestServer;
            let closestDelta = Infinity;
            for (const server of pool.servers) {
                const xDelta = server.xBound - x;
                const yDelta = server.yBound - y;
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


export class GameMonitorSatellite extends GameMonitor {
    constructor(monitor, options) {
        super({
            zwiftMonitorAPI: monitor.api,
            exclusions: monitor.exclusions,
            ...options,
        });
        this._monitor = monitor;
    }

    get _session() {
        return this._monitor._session;
    }

    set _session(_) {}

    get _udpServerPools() {
        return this._monitor._udpServerPools;
    }

    set _udpServerPools(_) {}

    async start() {
        await this.initPlayerState();
        this._playerStateInterval = setInterval(this.broadcastPlayerState.bind(this), 1000);
        this._refreshStatesTimeout = setTimeout(() => this._refreshStates(), this._stateRefreshDelay);
        this.logStatus();
    }

    stop() {
        throw new TypeError('improper usage');
    }

    _setConnecting() {
        throw new TypeError('improper usage');
    }

    connect() {
        throw new TypeError('improper usage');
    }

    _connect() {
        throw new TypeError('improper usage');
    }

    disconnect() {
        throw new TypeError('improper usage');
    }

    refreshSession() {
        throw new TypeError('improper usage');
    }

    activateSession() {
        throw new TypeError('improper usage');
    }

    establishTCPChannel() {
        throw new TypeError('improper usage');
    }
}


export class GameConnectionServer extends Net.Server {
    constructor({ip, zwiftAPI}) {
        super({noDelay: true});
        this.ip = ip;
        this.api = zwiftAPI;
        this._socket = null;
        this._pendingMsgBuf = null;
        this._pendingUserAction = Promise.resolve();
        this._seqno = 1;
        this._cmdSeqno = 1;
        this.athleteId = zwiftAPI.profile.id;
        this._userActions = new Map();
        this.on('connection', this.onConnection.bind(this));
        this.on('error', this.onError.bind(this));
        // Listen on any available port..
        this.listenDone = new Promise(resolve => this.listen({address: this.ip, port: 0}, resolve));
        this._state = 'init';
        const gct = protos.GameToCompanionCommandType;
        this._commandHandlers = {
            [gct.SET_POWER_UP]: this.onPowerupSetCommand,
            [gct.ACTIVATE_POWER_UP]: this.onPowerupActivateCommand,
            [gct.CLEAR_POWER_UP]: this.onPowerupActivateCommand,
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
        this.emit('powerup-set', o);
    }

    onPowerupActivateCommand(command) {
        // This is also fired on connection establish when we don't have a powerup..
        if (!command.powerUpTimer) {
            return this.onPowerupClearCommand();
        }
        const o = pbToObject(command);
        o.powerUpType = protos.POWERUP_TYPE[command.powerUpId - 1];
        this.emit('powerup-activate', o);
    }

    onPowerupClearCommand(command) {
        this.emit('powerup-clear');
    }

    onSocialPlayerActionCommand(command, gtc) {
        const action = pbToObject(command.socialAction);
        this.emit('social-action', action, gtc.worldTime.toNumber());
    }

    onUnhandledPacket(packet) {
        console.debug('unhandled packet', packet, pbToObject(packet));
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
        if (userActionSet.type === 'INITIAL') {
            this._userActions.clear();
        }
        for (const x of userActionSet.userActions) {
            this._userActions.set(x.uri, x);
        }
        const prettyKeys = userActionSet.userActions
            .map(x => `${x.uri}${x.presentable && x.enabled ? '' : '[UNAVAIL]'}`)
            .toSorted();
        console.info('Updated game connection user actions:', prettyKeys.join(', '));
    }

    onUserActionAction({userActionAction}) {
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
            this._state = 'error';
            this._error = e;
            throw e;
        }
    }

    async _start() {
        await this.listenDone;
        const {port} = this.address();
        console.info("Registering game connection server:", this.ip, port);
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
            throw new TypeError(`Invalid say type: ${type}`);
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
                avatar: p.imageSrcLarge || p.imageSrc,
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

    runUserAction(...args) {
        // We can't strongly correlate user action responses because of gaps in the
        // companion protocol design.  Serialize them instead.  Also it's not clear if
        // the game would tolerate concurrent user actions.
        const p = this._pendingUserAction.then(() => this._runUserAction(...args));
        this._pendingUserAction = p.catch(() => null);
        return p;
    }

    async _runUserAction(uri, options) {
        if (!this._userActions.has(uri)) {
            console.error('User action not available:', uri,
                          `(available: ${Array.from(this._userActions.keys()).join()}`);
            throw new TypeError('Invalid User Action URI');
        }
        const runParameters = options ?
            Object.entries(options).map(x => ({name: x[0], value: x[1]})) :
            undefined;
        const pr = this._pendingUserActionResolvers = Promise.withResolvers();
        pr.timeoutId = setTimeout(() => pr.reject(new Error('timeout')), 15_000);
        pr.uri = uri;
        this._sendUserAction({
            type: 'RUN',
            userActionURI: uri,
            runParameters,
        });  // bg for timeout handling
        await pr.promise;
    }

    async _sendCommand(command) {
        await this._sendToGame({commands: [{...command, seqno: this._cmdSeqno++}]});
    }

    async _sendToGame(o) {
        const pb = protos.CompanionToGame.fromObject({
            ...o,
            athleteId: this.athleteId,
            seqno: this._seqno++,
        });
        const buf = protos.CompanionToGame.encode(pb).finish();
        //console.debug('sneding', pb);
        const size = Buffer.allocUnsafe(4);
        size.writeUInt32BE(buf.byteLength);
        await new Promise(resolve => this._socket.write(Buffer.concat([size, buf]), resolve));
    }

    async onConnection(socket) {
        console.info('Game connection established from:', socket.remoteAddress);
        this._socket = socket;
        this._state = 'connected';
        this._error = null;
        socket.setKeepAlive(true, 5000);
        socket.on('data', this.onData.bind(this));
        socket.on('close', this.onSocketClose.bind(this));
        socket.on('error', this.onSocketError.bind(this));
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

    onData(frag) {
        let buf = this._pendingMsgBuf ? Buffer.concat([this._pendingMsgBuf, frag]) : frag;
        while (buf.byteLength >= 4) {
            const msgSize = buf.readUint32BE(0);
            const msgTail = msgSize + 4;
            if (msgSize > 1 * 1024 * 1024) {
                console.error('Illegal msg size:', msgSize);
                this._socket.resetAndDestroy();
                throw new Error('Protocol Error');
            } else if (msgTail > buf.byteLength) {
                break;
            }
            const msgBuf = buf.subarray(4, msgTail);
            buf = buf.subarray(msgTail);
            try {
                this.onMessage(msgBuf);
            } catch(e) {
                console.error("Companion message handler:", e);
            }
        }
        this._pendingMsgBuf = buf.byteLength ? buf : null;
    }

    onMessage(msgBuf) {
        const gtc = protos.GameToCompanion.decode(msgBuf);
        //console.debug('from game', gtc);
        for (const x of gtc.commands) {
            const handler = this._commandHandlers[x.type] || this.onUnhandledCommand;
            try {
                handler.call(this, x, gtc, msgBuf);
            } catch(e) {
                console.error("Companion command handler:", x.type, x, e);
            }
        }
        if (gtc.playerState) {
            this.emit('outgoing-player-state', gtc.playerState);
        }
    }

    onSocketClose() {
        console.info("Game connection closed");
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
