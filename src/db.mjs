import path from 'node:path';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');


function getFilename(name) {
    return path.join(app.getPath('userData'), name + '.sqlite');
}


export class SqliteDatabase extends Database {
    constructor(name, {tables, ...options}={}) {
        const filename = getFilename(name);
        super(filename, options);
        for (const [table, schema] of Object.entries(tables)) {
            const schemaText = Object.entries(schema).map(([col, type]) => `${col} ${type}`).join(', ');
            this.prepare(`CREATE TABLE IF NOT EXISTS ${table}(${schemaText});`).run();
        }
    }
}


export async function deleteDatabase(name) {
    const filename = getFilename(name);
    await fs.rm(filename, {force: true});
}
