/* global electron */

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import zlib from 'zlib';

const wd = path.dirname(fileURLToPath(import.meta.url));


async function getFilePath(id) {
    await electron.app.whenReady();
    return path.join(electron.app.getPath('userData'), `storage-${id}.json`);
}


async function load(id, defaultFile) {
    let f;
    try {
        f = await fs.open(await getFilePath(id));
    } catch(e) {
        if (e.code !== 'ENOENT') {
            throw e;
        } else if (defaultFile) {
            const f = await fs.open(path.join(wd, defaultFile));
            try {
                let data = await f.readFile();
                if (defaultFile.endsWith('.gz')) {
                    data = zlib.gunzipSync(data);
                }
                return JSON.parse(data);
            } finally {
                await f.close();
            }
        } else {
            return;
        }
    }
    try {
        return JSON.parse(await f.readFile());
    } finally {
        await f.close();
    }
}


async function save(id, data) {
    const file = await getFilePath(id);
    const tmpFile = file + '.tmp';
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
