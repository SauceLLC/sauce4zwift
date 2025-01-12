import fs from './fs-safe.js';
import process from 'node:process';
import Database from 'better-sqlite3';

export const databases = new Map();


export class SqliteDatabase extends Database {
    constructor(name, {tables, indexes={}, ...options}={}) {
        console.info("Opening DB:", name);
        super(name, options);
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


export function deleteDatabase(name) {
    const db = databases.get(name);
    if (db) {
        console.warn(`Closing DB [via delete]:`, name);
        db.close();
        databases.delete(name);
    }
    console.warn(`Deleting DB:`, name);
    fs.rmSync(name, {force: true});
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
