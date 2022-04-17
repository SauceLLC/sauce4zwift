import {SqliteDatabase, deleteDatabase} from './db.mjs';


export async function reset() {
    _db = null;
    await deleteDatabase('storage');
}


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


export function load(id) {
    const db = getDB();
    const r = db.prepare('SELECT data from store WHERE id = ?').get(id);
    return r ? JSON.parse(r.data) : undefined;
}


export function save(id, data) {
    const db = getDB();
    db.prepare('INSERT OR REPLACE INTO store (id, data) VALUES(?, ?)').run(id, JSON.stringify(data));
}


export function remove(id) {
    const db = getDB();
    db.prepare('DELETE FROM store WHERE id = ?').run(id);
}
