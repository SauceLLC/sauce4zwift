import path from 'node:path';
import fs from 'node:fs/promises';
import {SqliteDatabase} from './db.mjs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');

let db;


function getFilePath(id) {
    return path.join(app.getPath('userData'), `storage-${id}.json`);
}


async function initDatabase() {
    db = await SqliteDatabase.factory('storage', {
        tables: {
            store: {
                id: 'TEXT PRIMARY KEY',
                data: 'TEXT',
            }
        }
    });
    return db;
}


async function load(id) {
    if (!db) {
        db = await initDatabase();
    }
    const r = await db.get('SELECT data from store WHERE id = ?;', [id]);
    if (!r) {
        let f;
        try {
            f = await fs.open(getFilePath(id));
        } catch(e) {
            if (e.code === 'ENOENT') {
                return;
            }
            throw e;
        }
        let legacyData;
        try {
            legacyData = JSON.parse(await f.readFile());
        } catch(e) {
            console.error("Ignoring legacy data load fail:", e);
        } finally {
            await f.close();
        }
        if (legacyData) {
            await db.run('REPLACE INTO store (id, data) VALUES(?, ?);',
                [id, JSON.stringify(legacyData)]);
            return legacyData;
        }
    }
    return r ? JSON.parse(r.data) : undefined;
}


async function save(id, data) {
    if (!db) {
        db = await initDatabase();
    }
    await db.run('INSERT OR REPLACE INTO store (id, data) VALUES(?, ?);',
        [id, JSON.stringify(data)]);
}


export default {load, save};
