import storage from './storage.mjs';
import Sentry from '@sentry/node';
import fetch from 'node-fetch';

let error;

class NonMember extends Error {}


async function _api(res, options) {
    const r = await fetch('https://api.saucellc.io' + res, options);
    const body = await r.text();
    const data = body ? JSON.parse(body) : null;
    if (r.status === 404) {
        throw new NonMember();
    } else if (!r.ok) {
        throw new Error(JSON.stringify({status: r.status, data}, null, 4));
    } else {
        return data;
    }
}


function setError(e) {
    error = e.message;
    Sentry.captureException(e);
}


export function getError() {
    return error;
}


export async function link(code) {
    let isMember;
    try {
        await _link(code);
        isMember = true;
    } catch(e) {
        isMember = false;
        if (!(e instanceof NonMember)) {
            setError(e);
        }
    }
    return isMember;
}


async function _link(code) {
    await storage.save('patreon-auth', null);
    const auth = await _api('/patreon/auth', {
        method: 'POST',
        headers: {'x-sauce-app': 'zwift'},
        body: JSON.stringify({code}),
    });
    await storage.save('patreon-auth', auth);
}


export async function getMembership() {
    try {
        return await _getMembership({detailed: true});
    } catch(e) {
        setError(e);
    }
}


async function _getMembership(options={}) {
    const auth = await storage.load('patreon-auth');
    if (auth) {
        const q = options.detailed ? 'detailed=1' : '';
        const r = await fetch(`https://api.saucellc.io/patreon/membership?${q}`, {
            headers: {
                'x-sauce-app': 'zwift',
                Authorization: `${auth.id} ${auth.secret}`
            }
        });
        if (!r.ok) { 
            if ([401, 403].includes(r.status)) {
                await storage.save('patreon-auth', null);
            }
            if (r.status !== 404) {
                Sentry.captureException(new Error('Failed to get patreon membership: ' + r.status));
            }
        } else {
            const data = await r.json(); 
            await setPatronCache((data && data.patronLevel) || 0, false);
            return data;
        }
    }
}


async function _setPatronCache(level, isLegacy) {
    const info = {
        level,
        legacy: isLegacy || false,
        expiration: Date.now() + (level ? (7 * 86400 * 1000) : (3600 * 1000))
    };
    await storage.set('patron', info);
    return info;
}
