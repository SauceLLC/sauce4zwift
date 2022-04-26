/* global structuredClone */

let Sentry;


export function setSentry(s) {
    Sentry = s;
}


let excs = new Set();
export function captureExceptionOnce(e) {
    const sig = [e.name, e.message, e.stack].join('');
    if (!excs.has(sig)) {
        excs.add(sig);
        console.error('Error captured:', e);
        if (Sentry) {
            Sentry.captureException(e);
        }
    } else {
        console.warn('Error capture throttled:', e);
    }
}


function scrubSensitive(m) {
    return m && m
        .replace(/([/\\]users[/\\]).*?([/\\])/i, '$1***$2/')
        .replace(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/, '*.*.*.*')
        .replace(/http:\/\/.*?:1080\//, 'http://<anonymous>:1080/');
}


export function beforeSentrySend(result) {
    // The deep copy in here is because integrations like dedupe break if we
    // just modify the values of this data on the original objects.
    if (typeof structuredClone === 'function') {
        result = structuredClone(result);
    } else {
        result = JSON.parse(JSON.stringify(result));
    }
    try {
        if (result.exception && result.exception.values) {
            for (const exc of result.exception.values) {
                if (exc.stacktrace && exc.stacktrace.frames) {
                    for (const f of exc.stacktrace.frames) {
                        if (f.filename) {
                            f.filename = scrubSensitive(f.filename);
                        }
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
