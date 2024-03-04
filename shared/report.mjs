
let Sentry;
const fingerprints = new Map();


export function setSentry(s) {
    Sentry = s;
}


function fingerprintError(e) {
    return `${e.constructor.name} ${e.name} ${e.message} ${e.stack}`;
}


function incErrorRef(e) {
    const fp = fingerprintError(e);
    const count = (fingerprints.get(fp) || 0) + 1;
    fingerprints.set(fp, count);
    return count;
}


function _throttledLog(e, count) {
    const eps = count / performance.now() * 1000;
    const logEvery = Math.round(5 / (1 / eps));  // max log rate is 1 msg every 5 seconds
    if (logEvery < 1 || count % logEvery === 0) {
        console.error(`Error report [throttled: ${count}]:`, e);
    }
}


export function errorOnce(e) {
    const count = incErrorRef(e);
    if (count === 1) {
        error(e);
    } else {
        _throttledLog(e, count);
    }
}


export function errorThrottled(e) {
    const count = incErrorRef(e);
    if (Math.log2(count) % 1 === 0) { // power of two
        error(e);
    } else {
        _throttledLog(e, count);
    }
}


export function error(e) {
    console.error('Error report:', e);
    if (Sentry) {
        Sentry.captureException(e);
    }
}


export function message(msg) {
    console.warn('Message report:', msg);
    if (Sentry) {
        Sentry.captureMessage(msg);
    }
}


// Note that these are not spec validation matches and should
// only be used for scrubbing (and tuned as such too).
const homeExp = /([/\\](?:[uU]sers|home)[/\\]).*?([/\\\s)\]:}]|$)/gm;
const ipAddrExp = /(\W|^)(?:[0-9]{1,3}\.){3}[0-9]{1,3}(\W|$)/gm;
const emailExp = /(\W|^)[a-zA-Z0-9]+[a-zA-Z0-9._\-+]*?[a-zA-Z0-9_]+@[a-zA-Z0-9]+(?:\.[a-zA-Z0-9-]+)+(\W|$)/gm;

function scrubSensitive(m) {
    return m && m
        .replace(homeExp, '$1REDACTED$2')
        .replace(ipAddrExp, '$1*.*.*.*$2')
        .replace(emailExp, '$1redacted@email.address$2');
}


export function beforeSentrySend(result) {
    // The deep copy in here is because integrations like dedupe break if we
    // just modify the values of this data on the original objects.
    if (typeof structuredClone === 'function') {
        result = structuredClone(result);
    } else {
        result = JSON.parse(JSON.stringify(result));
    }
    if (Sentry._sauceSpecialState) {
        const uptime = Date.now() - Sentry._sauceSpecialState.startClock;
        const runtime = performance.now() - Sentry._sauceSpecialState.startTimer;
        const sleepOrClockDrift = uptime - runtime;
        result.extra = Object.assign(result.extra || {}, {uptime, runtime, sleepOrClockDrift});
    }
    try {
        if (result.exception && result.exception.values) {
            for (const exc of result.exception.values) {
                if (!exc.stacktrace || !exc.stacktrace.frames) {
                    continue;
                }
                for (const f of exc.stacktrace.frames) {
                    if (f.filename) {
                        f.filename = scrubSensitive(f.filename);
                    }
                }
            }
        }
        if (result.request) {
            const r = result.request;
            if (r.url) {
                r.url = scrubSensitive(r.url);
            }
            if (r.headers) {
                for (const [k, v] of Object.entries(r.headers)) {
                    r.headers[k] = scrubSensitive(v);
                }
            }
        }
        if (result.breadcrumbs) {
            for (const x of result.breadcrumbs) {
                if (x.message) {
                    x.message = scrubSensitive(x.message);
                }
                if (x.category === 'console' && x.data && x.data.arguments) {
                    delete x.data.arguments;
                }
            }
        }
    } catch(e) {/*no-pragma*/}
    return result;
}
