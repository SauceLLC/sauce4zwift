import * as storage from './storage.mjs';
//import * as rpc from './rpc.mjs';
import fetch from 'node-fetch';


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
    const token = getToken();
    if (!token) {
        throw new TypeError('Auth token not found');
    }
    const r = await fetch(`https://us-or-rly101.zwift.com/${urn.replace(/^\//, '')}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Zwift-Api-Version': '2.5',
            'Authority': 'us-or-rly101.zwift.com',
            'User-Agent': 'CNL/3.18.0 (Windows 10; Windows 10.0.19044) zwift/1.0.100641 curl/7.78.0-DEV',
            ...headers,
        },
        ...options,
    });
    if (!r.ok) {
        const msg = await r.text();
        console.error('Zwift API Error:', msg);
        throw new Error('Zwift HTTP Error: ' + r.status);
    }
    return r;
}


export async function jsonAPI(urn, options) {
    const r = await api(urn, options, {
        'accept': 'application/json',
        'content-type': 'application/json',
    });
    return await r.json();
}


export async function protobufAPI(urn, options) {
    const r = await api(urn, options, {accept: 'application/x-protobuf-lite'});
    return await r.arrayBuffer();
}

/* Endpoint notes:
 *
 * protobufs:
 * /relay/worlds
 * /api/profiles/?id=1&id=2
 * /api/tcp-config
 *
 * json:
 * /relay/worlds (yup works in json too)
 * /api/profiles/1
 * /api/telemetry/config 
 * /api/zfiles/list
 * /api/game_info (woah, all the things)
 * 
 *
 */


export async function getProfile(id) {
    return await jsonAPI(`/api/profiles/${id}`);
}


export async function searchProfiles(query, options={}) {
    const limit = options.limit || 100;
    const results = [];
    let start = 0;
    let pages = 0;
    const pageLimit = options.pageLimit ? options.pageLimit : 10;
    while (true) {
        const q = new URLSearchParams({start, limit});
        const page = await jsonAPI(`/api/search/profiles?${q}`, {
            method: 'POST',
            body: JSON.stringify({query}),
        });
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
    await jsonAPI(`/api/profiles/${to}/activities/0/rideon`, {
        method: 'POST',
        body: JSON.stringify({profileId: from})
    });
}


export async function getNotifications() {
    return await jsonAPI(`/api/notifications`);
}



// XXX devtools prototyping
global.zwift = {
    api,
    jsonAPI,
    protobufAPI,
    getProfile,
    searchProfiles,
    giveRideon,
    getNotifications,
};
