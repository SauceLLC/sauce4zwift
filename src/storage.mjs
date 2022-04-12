import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');


function getFilePath(id) {
    return path.join(app.getPath('userData'), `storage-${id}.json`);
}


async function load(id, defaultFile) {
    let f;
    try {
        f = await fs.open(getFilePath(id));
    } catch(e) {
        if (e.code === 'ENOENT') {
            return;
        }
        throw e;
    }
    try {
        return JSON.parse(await f.readFile());
    } finally {
        await f.close();
    }
}


async function save(id, data) {
    const file = getFilePath(id);
    const tmpFile = file + `.tmp.${Date.now()}.${Math.round(Math.random() * 10000000)}`;
    const serialized = JSON.stringify(data);
    const f = await fs.open(tmpFile, 'w');
    try {
        await f.writeFile(serialized);
    } finally {
        await f.close();
    }
    await fs.rename(tmpFile, file);
}

export default {load, save};
