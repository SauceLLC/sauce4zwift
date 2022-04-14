import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');

const brokenRename = process.platform === 'win32';

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


let save;
if (brokenRename) {
    const pendingSaves = new Map();
    save = async function(id, data) {
        console.warn("queue Saving", id);
        const file = getFilePath(id);
        const serialized = JSON.stringify(data);
        const pending = pendingSaves.get(id) || Promise.resolve();
        const saving = pending.finally(async () => {
            console.warn("start save", id);
            const f = await fs.open(file, 'w');
            try {
                await f.writeFile(serialized);
            } finally {
                await f.close();
                console.warn("end save", id);
            }
        });
        pendingSaves.set(id, saving);
        await saving;
    };
} else {
    save = async function(id, data) {
        const file = getFilePath(id);
        const serialized = JSON.stringify(data);
        const tmpFile = file + `.tmp.${Date.now()}.${Math.round(Math.random() * 100000)}`;
        const f = await fs.open(tmpFile, 'w');
        try {
            await f.writeFile(serialized);
        } finally {
            await f.close();
        }
        await fs.rename(tmpFile, file);
    };
}

export default {load, save};
