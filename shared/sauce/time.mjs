
let _timeOfft;
const _ephemeral = new Map();

const sessionStorage = globalThis.sessionStorage || {
    getItem: k => _ephemeral.get(k),
    setItem: (k, v) => _ephemeral.set(k, '' + v),
};

(() => {
    const lastEstablish = Number(sessionStorage.getItem('sauce_time_last_establish'));
    if (lastEstablish && Date.now() - lastEstablish < 900_000) {
        const offt = Number(sessionStorage.getItem('sauce_time_offset'));
        if (offt != null && !isNaN(offt)) {
            _timeOfft = offt;
        }
    }
})();


function timeOffsetCalc(offsets, forceAnswer) {
    // Basically emulate NTP's more macroscopic features...
    //  * We assume lower latency is reduced error
    //  * Remove 33% of RTT offsets by latency (toss slowest)
    //  * Calculate stddev and filter out more outliers
    //  * Finally calculate a weighted avg for the offsets using latency
    if (offsets.length > 5 || forceAnswer) {
        offsets = offsets.toSorted((a, b) => a.latency - b.latency);
        offsets.length -= offsets.length * 0.333 | 0;
        const mean = offsets.reduce((a, x) => a + x.latency, 0) / offsets.length;
        const variance = offsets.reduce((a, x) => a + (mean - x.latency) ** 2, 0) / offsets.length;
        const stddev = Math.sqrt(variance);
        const valids = offsets.filter(x => Math.abs(x.latency - mean) <= 4 * stddev);
        if (valids.length > 0) {
            const maxLatency = valids.reduce((max, x) => x.latency > max ? x.latency : max, -1e6);
            const weights = valids.map(x => maxLatency - x.latency + 1);
            const totalWeight = weights.reduce((a, w) => a + w, 0);
            return valids.reduce((a, x, i) => a + x.offt * weights[i], 0) / totalWeight;
        }
    }
}


export async function establish(force) {
    if (!force && _timeOfft != null) {
        return;
    }
    _timeOfft = null;
    const ws = new WebSocket('wss://time.sauce-llc.workers.dev');
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
    });
    let localSendTime;
    let resolve, reject;
    ws.addEventListener('error', ev => {
        console.error('Time server error:', ev);
        reject(new Error('WebSocket Error'));
    });
    ws.addEventListener('close', ev => {
        if (ev.code !== 1000) {
            console.warn('Time server abnormal close:', ev.code, ev.reason);
        }
        resolve();
    });
    ws.addEventListener('message', ev => {
        const localRecvTime = Date.now();
        const serverTime = Number(ev.data);
        const latency = (localRecvTime - localSendTime) / 2;
        const offt = localRecvTime - (serverTime + latency);
        resolve({offt, latency});
    });
    const offsets = [];
    let offt;
    for (let i = 0; i < 12; i++) {
        const p = new Promise((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        localSendTime = Date.now();
        ws.send('GET_TIME');
        const r = await p;
        if (!r) {
            break;
        }
        offsets.push(r);
        offt = timeOffsetCalc(offsets);
        if (offt !== undefined) {
            break;
        }
    }
    if (ws.readyState < 2) {
        ws.send('CLOSE'); // cloudflare workers don't like us calling ws.close()
    }
    if (offt === undefined) {
        if (offsets.length) {
            console.warn("Substandard time protocol offset estimation");
            offt = timeOffsetCalc(offsets, /*force*/ true);
        } else {
            console.error("Unable to get sauce time");
        }
    }
    console.debug('Clock offset:', offt);
    _timeOfft = Math.round(offt);
    sessionStorage.setItem('sauce_time_last_establish', Date.now());
    sessionStorage.setItem('sauce_time_offset', _timeOfft);
}


export function getTime() {
    if (_timeOfft === undefined) {
        throw new Error("use establish() first");
    }
    return Date.now() - _timeOfft;
}
