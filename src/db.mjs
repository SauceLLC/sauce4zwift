import path from 'node:path';
import fs from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {app} = require('electron');


function getFilename(name) {
    return path.join(app.getPath('userData'), name + '.sqlite');
}


export class SqliteDatabase {
    constructor(name, {tables}) {
        const filename = getFilename(name);
        this.ready = new Promise((resolve, reject) => {
            this._db = new sqlite3.Database(filename, e => {
                if (e) {
                    reject(e);
                    return;
                }
                let refCnt = 0;
                for (const [table, schema] of Object.entries(tables)) {
                    const schemaText = Object.entries(schema).map(([col, type]) => `${col} ${type}`).join(', ');
                    const sql = `CREATE TABLE IF NOT EXISTS ${table}(${schemaText});`;
                    refCnt++;
                    this._db.run(sql, e => {
                        refCnt--;
                        if (e) {
                            reject(e);
                        } else if (!refCnt) {
                            this.ready = true; 
                            resolve();
                        }
                    });
                }
                if (!refCnt) {
                    this.ready = true; 
                    resolve();
                }
            });
        });
    }

    static async factory(...args) {
        const db = new this(...args);
        await db.ready;
        return db;
    }

    configure(...args) {
        return this._db.configure(...args);
    }

    run(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        return new Promise((resolve, reject) =>
            this._db.run(...args, e => (e && reject(e) || resolve())));
    }

    get(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        return new Promise((resolve, reject) =>
            this._db.get(...args, (e, data) => (e && reject(e) || resolve(data))));
    }

    all(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        return new Promise((resolve, reject) =>
            this._db.all(...args, (e, data) => (e && reject(e) || resolve(data))));
    }

    async *each(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        let resolve;
        let reject;
        let complete;
        this._db.each(...args, (e, data) => (e && reject(e) || resolve(data)), () => complete = true);
        while (!complete) {
            yield await new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
        }
    }

    exec(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        return new Promise((resolve, reject) =>
            this._db.exec(...args, e => (e && reject(e) || resolve())));
    }

    prepare(...args) {
        if (this.ready !== true) {
            throw new Error("DB not ready");
        }
        return new Promise((resolve, reject) => {
            // TBD: Wrap statment with asyncify class.
            const stmt = this._db.exec(...args, e => (e && reject(e) || resolve(stmt)));
        });
    }
}


export async function deleteDatabase(name) {
    const filename = getFilename(name);
    await fs.rm(filename, {force: true});
}
