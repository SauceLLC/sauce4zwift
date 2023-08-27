
const _maxTimeout = 0x7fffffff;  // `setTimeout` max valid value.
export async function sleep(ms) {
    while (ms > _maxTimeout) {
        // Support sleeping longer than the javascript max setTimeout...
        await new Promise(resolve => setTimeout(resolve, _maxTimeout));
        ms -= _maxTimeout;
    }
    return await new Promise(resolve => setTimeout(resolve, ms));
}


/* Only use for non-async callbacks */
export function debounced(scheduler, callback) {
    let nextPending;
    const wrap = function() {
        const waiting = !!nextPending;
        nextPending = [this, arguments];
        if (waiting) {
            return;
        }
        scheduler(() => {
            try {
                callback.apply(...nextPending);
            } finally {
                nextPending = null;
            }
        });
    };
    if (callback.name) {
        Object.defineProperty(wrap, 'name', {value: `sauce.debounced[${callback.name}]`});
    }
    return wrap;
}


export function formatInputDate(ts) {
    // Return a input[type="date"] compliant value from a ms timestamp.
    return ts ? (new Date(ts)).toISOString().split('T')[0] : '';
}


export async function blobToArrayBuffer(blob) {
    const reader = new FileReader();
    const done = new Promise((resolve, reject) => {
        reader.addEventListener('load', resolve);
        reader.addEventListener('error', () => reject(new Error('invalid blob')));
    });
    reader.readAsArrayBuffer(blob);
    await done;
    return reader.result;
}


export class LRUCache extends Map {
    constructor(capacity) {
        super();
        this._capacity = capacity;
        this._head = null;
    }

    get(key) {
        const entry = super.get(key);
        if (entry === undefined) {
            return;
        }
        this._moveToHead(entry);
        return entry.value;
    }

    set(key, value) {
        let entry = super.get(key);
        if (entry === undefined) {
            if (this.size === this._capacity) {
                // Fast path: just replace tail and rotate.
                entry = this._head.prev;
                this._head = entry;
                this.delete(entry.key);
            } else {
                entry = {};
                if (!this.size) {
                    entry.next = entry.prev = entry;
                    this._head = entry;
                } else {
                    this._moveToHead(entry);
                }
            }
            entry.key = key;
            entry.value = value;
            super.set(key, entry);
        } else {
            entry.value = value;
            this._moveToHead(entry);
        }
    }

    _moveToHead(entry) {
        if (entry === this._head) {
            return;
        }
        if (entry.next) {
            entry.next.prev = entry.prev;
            entry.prev.next = entry.next;
        }
        entry.next = this._head;
        entry.prev = this._head.prev;
        this._head.prev.next = entry;
        this._head.prev = entry;
        this._head = entry;
    }

    clear() {
        this._head = null;
        super.clear();
    }
}
