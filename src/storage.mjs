import path from 'node:path';
import {SqliteDatabase, deleteDatabase} from './db.mjs';


let _initialized = false;
let _dir;
let _db;


function getName() {
    if (!_initialized) {
        throw new Error("initialize(...) required before use");
    }
    return path.join(_dir, 'storage.sqlite');
}


function getDB() {
    if (_db) {
        return _db;
    }
    _db = new SqliteDatabase(getName(), {
        tables: {
            store: {
                id: 'TEXT PRIMARY KEY',
                data: 'TEXT',
            }
        }
    });
    return _db;
}


export function initialize(dir) {
    if (_initialized) {
        throw new Error("Already initialized");
    }
    _dir = dir;
    _initialized = true;
}


export function reset() {
    deleteDatabase(getName());
}


export function get(key) {
    const db = getDB();
    const r = db.prepare('SELECT data from store WHERE id = ?').get(key);
    return r ? JSON.parse(r.data) : undefined;
}


export function set(key, data) {
    const db = getDB();
    db.prepare('INSERT OR REPLACE INTO store (id, data) VALUES(?, ?)').run(key, JSON.stringify(data));
}


export function remove(key) {
    const db = getDB();
    db.prepare('DELETE FROM store WHERE id = ?').run(key);
}
