import Keytar from 'keytar';

const service = 'Zwift Credentials - Sauce for Zwift';


export async function get(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    const raw = await Keytar.getPassword(service, key);
    return raw ? JSON.parse(raw) : undefined;
}


export async function set(key, data) {
    if (!key || !data) {
        throw new TypeError('key and data required');
    }
    await Keytar.setPassword(service, key, JSON.stringify(data));
}


export async function remove(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    return await Keytar.deletePassword(service, key);
}
