import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import Database from 'better-sqlite3';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');

export const databases = new Map();


function getFilename(name) {
    return path.join(app.getPath('userData'), name + '.sqlite');
}


export class SqliteDatabase extends Database {
    constructor(name, {tables, indexes={}, ...options}={}) {
        const filename = getFilename(name);
        console.info("Opening DB:", filename);
        super(filename, options);
        this.pragma('journal_mode = WAL');  // improve performance substantially
        for (const [table, schema] of Object.entries(tables)) {
            const schemaText = Object.entries(schema).map(([col, type]) => `${col} ${type}`).join(', ');
            this.prepare(`CREATE TABLE IF NOT EXISTS ${table} (${schemaText})`).run();
        }
        for (const [index, x] of Object.entries(indexes)) {
            this.prepare(`CREATE ${x.unique ? 'UNIQUE' : ''} INDEX IF NOT EXISTS ${index} ON ` +
                `${x.table} (${x.columns.join(',')})`).run();
        }
        databases.set(name, this);
    }
}


export async function deleteDatabase(name) {
    const db = databases.get(name);
    if (db) {
        db.close();
    }
    const filename = getFilename(name);
    try {
        await fs.rm(filename, {force: true});
    } finally {
        if (db) {
            databases.delete(name);
        }
    }
}


function shutdown(origin) {
    const dbs = Array.from(databases.values());
    databases.clear();
    for (const db of dbs) {
        console.warn(`Closing DB [via ${origin}]:`, db.name);
        try {
            db.close();
        } catch(e) {
            console.error(e);
        }
    }
}

// NOTE: we don't handle kill signal's because it's only useful
// in dev and can cause interop problems.
process.on('exit', shutdown);
