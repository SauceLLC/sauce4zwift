import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protos = protobuf.loadSync(path.join(__dirname, 'zwift.proto')).root;
void protos;

let xRequestId = 1;
let authToken;


export function isAuthenticated() {
    return !!authToken;
}


export async function api(urn, options, headers) {
    headers = headers || {};
    if (!options.noAuth) {
        if (!authToken) {
            throw new TypeError('Auth token not set');
        }
        headers['Authorization'] = `Bearer ${authToken}`;
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


export async function authenticate(username, password) {
    const r = await api('/auth/realms/zwift/protocol/openid-connect/token', {
        host: 'secure.zwift.com',
        noAuth: true,
        method: 'POST',
        ok: [200, 401],
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
