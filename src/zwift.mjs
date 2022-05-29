import * as storage from './storage.mjs';
import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protos = protobuf.loadSync(path.join(__dirname, 'zwift.proto')).root;

let xRequestId = 1;


let _token;
function getToken() {
    if (_token === undefined) {
        _token = storage.load('zwift-token') || null;
    }
    return _token;
}


function setToken(token) {
    _token = token;
}
void setToken;


function refreshToken() {
    throw new Error('TBD'); // use refresh jwt or just reload the zwift login browser page.
}
void refreshToken;


export async function api(urn, options, headers) {
    headers = headers || {};
    if (!options.noAuth) {
        const token = getToken();
        if (!token) {
            throw new TypeError('Auth token not found');
        }
        headers['Authorization'] = `Bearer ${token}`;
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
    if (!r.ok) {
        const msg = await r.text();
        console.error('Zwift API Error:', r.status, msg);
        console.debug('Zwift API Request:', options, headers, r);
        throw new Error('Zwift HTTP Error: ' + r.status);
    }
    return r;
}


export async function getProfile(id) {
    return await (await api(`/api/profiles/${id}`)).json();
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
    })).json();
}


export async function getNotifications() {
    return await (await api(`/api/notifications`)).json();
}


export async function getEventFeed() {  // from=epoch, limit=25, sport=CYCLING
    return await (await api(`/api/event-feed`)).json();
}


export async function login(username, password) {
    return await (await api('/auth/realms/zwift/protocol/openid-connect/token', {
        host: 'secure.zwift.com',
        noAuth: true,
        method: 'POST',
        body: new URLSearchParams({
            client_id: 'Zwift Game Client',
            grant_type: 'password',
            password,
            username,
        })
    })).json();
}


// XXX devtools prototyping
global.zwift = {
    api,
    getProfile,
    searchProfiles,
    giveRideon,
    getNotifications,
    getEventFeed,
    login,
};
