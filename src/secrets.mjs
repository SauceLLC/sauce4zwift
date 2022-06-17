import keytar from 'keytar';

const service = 'Zwift Credentials - Sauce for Zwift';


export async function get(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    const raw = await keytar.getPassword(service, key);
    return raw ? JSON.parse(raw) : undefined;
}


export async function set(key, data) {
    if (!key || !data) {
        throw new TypeError('key and data required');
    }
    await keytar.setPassword(service, key, JSON.stringify(data));
}


export async function remove(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    return await keytar.deletePassword(service, key);
}
