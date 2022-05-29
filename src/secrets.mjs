import keytar from 'keytar';

const service = 'Sauce, LLC';


export async function get(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    return JSON.parse(await keytar.getPassword(service, key));
}


export async function set(key, value) {
    if (!key || !value) {
        throw new TypeError('key and value required');
    }
    await keytar.getPassword(service, key, JSON.stringify(value));
}


export async function remove(key) {
    if (!key) {
        throw new TypeError('key required');
    }
    return await keytar.deletePassword(service, key);
}


export async function entries() {
    const data = await keytar.findCredentials(service);
    return data.map(({account, password}) => [account, JSON.parse(password)]);
}
