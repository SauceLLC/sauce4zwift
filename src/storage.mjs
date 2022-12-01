import {SqliteDatabase, deleteDatabase} from './db.mjs';


let _db;
function getDB() {
    if (_db) {
        return _db;
    }
    _db = new SqliteDatabase('storage', {
        tables: {
            store: {
                id: 'TEXT PRIMARY KEY',
                data: 'TEXT',
            }
        }
    });
    return _db;
}


export async function reset() {
    if (_db) {
        _db.close();
        _db = null;
    }
    await deleteDatabase('storage');
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
