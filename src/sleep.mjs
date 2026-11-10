
let badTimeoutDelayPenalty = 0;
const maxSafeDelay = 0x7fff_ffff;


export function schedule(callback, ms) {
    const handle = _timeout(callback, ms);
    return {cancel: () => clearTimeout(handle.timeout)};
}


export function sleep(ms) {
    return new Promise(resolve => void _timeout(resolve, ms));
}


function _timeoutChain(handle) {
    // Handle overflow of max signed int without turning into a event queue bomb
    if (handle.remaining > maxSafeDelay) {
        handle.remaining -= maxSafeDelay;
        handle.timeout = setTimeout(_timeoutChain, maxSafeDelay, handle);
    } else {
        handle.timeout = setTimeout(handle.callback, handle.remaining);
    }
    return handle;
}


function _timeout(callback, ms) {
    if (Number.isNaN(ms)) {
        ms = badTimeoutDelayPenalty += 10;
        console.error(`NaN is not a timestamp.  Timeout penatly: ${ms}`);
    } else if (ms < 0) {
        ms = 0;
    }
    return ms <= maxSafeDelay ?
        {timeout: setTimeout(callback, ms)} :
        _timeoutChain({remaining: ms, callback});
}
