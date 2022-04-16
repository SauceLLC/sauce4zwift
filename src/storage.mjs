import path from 'node:path';
import fs from 'node:fs/promises';
import {SqliteDatabase, deleteDatabase} from './db.mjs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');

let db;


function getFilePath(id) {
    return path.join(app.getPath('userData'), `storage-${id}.json`);
}


export async function reset() {
    db = null;
    await deleteDatabase('storage');
}


export async function init() {
    if (db) {
        return db;
    }
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


export async function load(id) {
    if (!db) {
        throw new Error("Must call init() first");
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


export async function save(id, data) {
    if (!db) {
        throw new Error("Must call init() first");
    }
    await db.run('INSERT OR REPLACE INTO store (id, data) VALUES(?, ?);',
        [id, JSON.stringify(data)]);
}
