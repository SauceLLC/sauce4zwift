
const _maxTimeout = 0x7fffffff;  // `setTimeout` max valid value.
export async function sleep(ms) {
    while (ms > _maxTimeout) {
        // Support sleeping longer than the javascript max setTimeout...
        await new Promise(resolve => setTimeout(resolve, _maxTimeout));
        ms -= _maxTimeout;
    }
    return await new Promise(resolve => setTimeout(resolve, ms));
}


/*
 * Only use for async callbacks.
 *
 * - First call will run the async fn.
 * - While that function is running if a another invocation is made it will queue
 *   behind the active invocation.
 * - IF another invocation comes in before the queued invocation takes place, the
 *   waiting invocation will be cancelled.
 *
 * I.e. Only run with the latest set of arguments, drop any invocations between
 * the active one and the most recent.  Great for rendering engines.
 *
 * The return promise will resolve with the arguments used for next invocation.
 */
export function debounced(asyncFn) {
    let nextArgs;
    let nextPromise;
    let nextResolve;
    let nextReject;
    let active;
    const runner = function() {
        const [scope, args] = nextArgs;
        const resolve = nextResolve;
        const reject = nextReject;
        nextArgs = null;
        nextPromise = null;
        return asyncFn.apply(scope, args)
            .then(x => resolve(args))
            .catch(reject)
            .finally(() => active = nextArgs ? runner() : null);
    };
    const wrap = function() {
        nextArgs = [this, arguments];
        if (!nextPromise) {
            nextPromise = new Promise((resolve, reject) =>
                (nextResolve = resolve, nextReject = reject));
        }
        const p = nextPromise;
        if (!active) {
            active = runner();
        }
        return p;
    };
    if (asyncFn.name) {
        Object.defineProperty(wrap, 'name', {value: `sauce.debounced[${asyncFn.name}]`});
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
