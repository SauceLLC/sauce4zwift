
export function sum(data, offt) {
    let total = 0;
    for (let i = offt || 0, len = data.length; i < len; i++) {
        total += data[i];
    }
    return total;
}


export function avg(data, offt) {
    if (!data || !data.length) {
        return;
    }
    return sum(data, offt) / (data.length - (offt || 0));
}


export function expWeightedAvg(size=2, seed=0) {
    const cPrev = Math.exp(-1 / size);
    const cNext = 1 - cPrev;
    let avg = seed;
    const setGet = v => avg = (avg * cPrev) + (v * cNext);
    setGet.get = () => avg;
    return setGet;
}


export function max(data, options={}) {
    // Avoid stack overflow by only use Math.max on small arrays
    if (!data || (!options.index && data.length < 65535)) {
        return Math.max.apply(null, data);
    } else {
        let m;
        let index;
        let i = 0;
        for (const x of data) {
            if (m === undefined || x > m) {
                m = x;
                index = i;
            }
            i++;
        }
        return options.index ? index : m;
    }
}


export function min(data, options={}) {
    // Avoid stack overflow by only use Math.min on small arrays
    if (!data || (!options.index && data.length < 65535)) {
        return Math.min.apply(null, data);
    } else {
        let m;
        let index;
        let i = 0;
        for (const x of data) {
            if (m === undefined || x < m) {
                m = x;
                index = i;
            }
            i++;
        }
        return options.index ? index : m;
    }
}


export function mode(data) {
    // Calc math mode for a data array.
    if (!data || !data.length) {
        return;
    }
    const countMap = {};
    let mostFreq;
    for (const value of data) {
        const count = value in countMap ? countMap[value] + 1 : 1;
        countMap[value] = count;
        if (!mostFreq || mostFreq.count < count) {
            mostFreq = {count, value};
            if (count > data.length / 2) {
                break;  // Nobody can possibly overtake now.
            }
        }
    }
    return mostFreq && mostFreq.value;
}


export function median(data) {
    // Calc math median for a data array.
    if (!data || !data.length) {
        return;
    }
    const sorted = Array.from(data).sort((a, b) => a - b);
    const midPoint = sorted.length / 2;
    if (sorted.length % 2) {
        return sorted[Math.floor(midPoint)];
    } else {
        // even length calls for avg of middle pair.
        return (sorted[midPoint - 1] + sorted[midPoint]) / 2;
    }
}


export function stddev(data) {
    const mean = avg(data);
    const variance = data.map(x => (mean - x) ** 2);
    return Math.sqrt(avg(variance));
}


export function resample(inData, outLen, options={}) {
    const smoothing = options.smoothing || 0.10;
    const inLen = inData.length;
    const step = inLen / outLen;
    const period = Math.round(step * smoothing);
    if (period >= 2) {
        inData = smooth(period, inData);
    }
    const outData = [];
    for (let i = 0; i < outLen; i++) {
        // Round 0.5 down to avoid single use of index 0 and tripple use of final index.
        outData.push(inData[Math.min(inLen - 1, -Math.round(-i * step))]);
    }
    return outData;
}


export function createActiveStream(streams, options={}) {
    // Some broken time streams have enormous gaps.
    const maxImmobileGap = options.maxImmobileGap != null ? options.maxImmobileGap : 300;
    const useCadence = options.isTrainer || options.isSwim;
    const timeStream = streams.time;
    const movingStream = streams.moving;
    const cadenceStream = useCadence && streams.cadence;
    const wattsStream = streams.watts;
    const distStream = streams.distance;
    const activeStream = [];
    const speedMin = 0.447;  // meter/second (1mph)
    for (let i = 0; i < movingStream.length; i++) {
        activeStream.push(!!(
            movingStream[i] ||
            (!i || timeStream[i] - timeStream[i - 1] < maxImmobileGap) && (
                (cadenceStream && cadenceStream[i]) ||
                (wattsStream && wattsStream[i]) ||
                (distStream && i &&
                 (distStream[i] - distStream[i - 1]) /
                 (timeStream[i] - timeStream[i - 1]) >= speedMin))
        ));
    }
    return activeStream;
}


export function activeTime(timeStream, activeStream) {
    if (timeStream.length < 2) {
        return 0;
    }
    let maxGap;
    if (activeStream == null) {
        maxGap = recommendedTimeGaps(timeStream).max;
    }
    let accumulated = 0;
    let last = timeStream[0];
    for (let i = 0; i < timeStream.length; i++) {
        const ts = timeStream[i];
        const delta = ts - last;
        if (maxGap != null) {
            if (delta <= maxGap) {
                accumulated += delta;
            }
        } else {
            if (activeStream[i]) {
                accumulated += delta;
            }
        }
        last = ts;
    }
    return accumulated;
}


const _timeGapsCache = new WeakMap();
export function recommendedTimeGaps(timeStream) {
    const hash = `${timeStream.length}-${timeStream[0]}-${timeStream[timeStream.length - 1]}`;
    if (!_timeGapsCache.has(timeStream) || _timeGapsCache.get(timeStream).hash !== hash) {
        const gaps = timeStream.map((x, i) => timeStream[i + 1] - x);
        gaps.pop();  // last entry is not a number (NaN)
        const ideal = mode(gaps) || 1;
        _timeGapsCache.set(timeStream, {
            hash,
            value: {
                ideal,
                max: Math.round(Math.max(ideal, median(gaps))) * 4
            }
        });
    }
    return _timeGapsCache.get(timeStream).value;
}


export function *range(startOrCount, stop, step) {
    step = step || 1;
    let start;
    if (stop == null) {
        start = 0;
        stop = startOrCount;
    } else {
        start = startOrCount;
    }
    let last;
    for (let i = start; i < stop; i += step) {
        if (last !== undefined) {
            // Prevent infinite loop when step and value are huge/tiny due to ieee754.
            for (let j = 2; last === i; j++) {
                i += j * step;
            }
        }
        yield i;
        last = i;
    }
}


export class Pad extends Number {}


export class Break extends Pad {
    constructor(pad) {
        super(0);
        this.pad = pad;
    }
}

const _padCache = new Map();
function getSoftPad(n) {
    // To save mem we just keep a cache of all the pad objects and return a ref
    // to the cached object when the reference number is close to that value.
    const sig = Math.round(n * 10);
    if (!_padCache.has(sig)) {
        _padCache.set(sig, new Pad(sig / 10));
    }
    return _padCache.get(sig);
}

const ZERO = new Pad(0);


export class RollingAverage {
    constructor(period, options={}) {
        this.period = period || undefined;
        this.idealGap = options.idealGap;
        this.maxGap = options.maxGap;
        this._padThreshold = this.idealGap ? this.idealGap * 1.61803 : null;
        this._active = options.active;
        this._ignoreZeros = options.ignoreZeros;
        this._times = [];
        this._values = [];
        this._offt = 0;
        this._length = 0;
        this._activeAcc = 0;
        this._valuesAcc = 0;
    }

    clone(options={}) {
        const period = options.period != null ? options.period : this.period;
        const instance = new this.constructor(period, {
            idealGap: this.idealGap,
            maxGap: this.maxGap,
            active: this._active,
            ignoreZeros: this._ignoreZeros,
            ...options,
        });
        instance._times = this._times;
        instance._values = this._values;
        instance._length = this._length;
        if (options.reset) {
            instance._offt = this._length;
        } else {
            instance._offt = this._offt;
            instance._activeAcc = this._activeAcc;
            instance._valuesAcc = this._valuesAcc;
        }
        return instance;
    }

    avg(options={}) {
        const active = options.active != null ? options.active : this._active;
        return this._valuesAcc / (active ? this.active() : this.elapsed());
    }

    slice(startTime, endTime) {
        const clone = this.clone();
        if (startTime < 0) {
            startTime = clone.lastTime() + startTime;
        }
        while (clone.firstTime() < startTime) {
            clone.shift();
        }
        if (endTime != null) {
            while (clone.lastTime() > endTime) {
                clone.pop();
            }
        }
        return clone;
    }

    importData(times, values, active) {
        if (times.length !== values.length) {
            throw new TypeError("times and values not same length");
        }
        for (let i = 0; i < times.length; i++) {
            this.add(times[i], values[i], active && active[i]);
        }
    }

    importReduce(times, values, active, getter, comparator, cloneOptions) {
        if (times.length !== values.length) {
            throw new TypeError("times and values not same length");
        }
        let leadValue;
        let leadRoll;
        for (let i = 0; i < times.length; i++) {
            this.add(times[i], values[i], active && active[i]);
            if (this.full()) {
                const value = getter(this);
                if (leadValue !== undefined) {
                    if (!comparator(value, leadValue)) {
                        continue;
                    }
                }
                leadValue = value;
                leadRoll = this.clone(cloneOptions);
            }
        }
        return leadRoll;
    }

    elapsed(options={}) {
        const len = this._length;
        const offt = (options.offt || 0) + this._offt;
        if (len - offt === 0) {
            return 0;
        }
        return this._times[len - 1] - this._times[offt];
    }

    active(options={}) {
        let t = this._activeAcc;
        const predicate = options.predicate || 0;
        if (options.offt) {
            const lim = Math.min(this._length, this._offt + options.offt);
            for (let i = this._offt; i < lim && t >= predicate; i++) {
                if (this._isActiveValue(this._values[i + 1])) {
                    const gap = this._times[i + 1] - this._times[i];
                    t -= gap;
                }
            }
        }
        return t;
    }

    _isActiveValue(value) {
        return !!(
            +value || (
                value != null &&
                !Number.isNaN(value) &&
                (!this._ignoreZeros && !(value instanceof Pad))
            )
        );
    }

    add(ts, value, active) {
        if (this._length) {
            const prevTS = this._times[this._length - 1];
            const gap = ts - prevTS;
            if ((active == null && (this.maxGap && gap > this.maxGap)) || active === false) {
                const idealGap = this.idealGap || Math.min(1, gap / 2);
                const breakGap = 3600;
                if (gap > breakGap) {
                    // Handle massive gaps between time stamps seen by Garmin devices glitching.
                    // Note, to play nice with elapsed time based rolling avgs, we include the
                    // max number of zero pads on either end of the gap.
                    const bookEndTime = Math.floor(breakGap / 2) - idealGap;
                    for (let i = idealGap; i < bookEndTime; i += idealGap) {
                        this._add(prevTS + i, ZERO);
                    }
                    this._add(prevTS + bookEndTime, new Break(gap - (bookEndTime * 2)));
                    for (let i = gap - bookEndTime; i < gap; i += idealGap) {
                        this._add(prevTS + i, ZERO);
                    }
                } else {
                    for (let i = idealGap; i < gap; i += idealGap) {
                        this._add(prevTS + i, ZERO);
                    }
                }
            } else if (this.idealGap && gap > this._padThreshold) {
                for (let i = this.idealGap; i < gap; i += this.idealGap) {
                    this._add(prevTS + i, getSoftPad(value));
                }
            }
        }
        return this._add(ts, value);
    }

    _add(ts, value) {
        this._times.push(ts);
        this._values.push(value);
        this.resize(1);
        return value;
    }

    processAdd(i) {
        const value = this._values[i];
        if (this._isActiveValue(value)) {
            const gap = i ? this._times[i] - this._times[i - 1] : 0;
            this._activeAcc += gap;
            this._valuesAcc += value * gap;
        }
    }

    processShift(i) {
        // Somewhat counterintuitively we care about the value and index after the one
        // being shifted off because index 0 is always just a reference point and our
        // new state will have the `this._offt + 1` as the new ref point whose value
        // and gap are no longer in consideration.
        const value = i < this._length ? this._values[i + 1] : null;
        if (this._isActiveValue(value)) {
            const gap = i < this._length ? this._times[i + 1] - this._times[i] : 0;
            this._activeAcc -= gap;
            this._valuesAcc -= value * gap;
        }
    }

    processPop(i) {
        const value = i >= this._offt ? this._values[i] : null;
        if (this._isActiveValue(value)) {
            const gap = i ? this._times[i] - this._times[i - 1] : 0;
            this._activeAcc -= gap;
            this._valuesAcc -= value * gap;
        }
    }

    resize(size) {
        const length = size ? this._length + size : this._values.length;
        if (length > this._values.length) {
            throw new Error('resize underflow');
        }
        let added = 0;
        for (let i = this._length; i < length; i++) {
            this.processAdd(i);
            this._length++;
            added++;
            if (this.period) {
                while (this.full({offt: 1})) {
                    this.shift();
                }
            }
        }
        return added;
    }

    firstTime(options) {
        options = options || {};
        if (options.noPad) {
            for (let i = this._offt; i < this._length; i++) {
                if (!(this._values[i] instanceof Pad)) {
                    return this._times[i];
                }
            }
        } else {
            return this._times[this._offt];
        }
    }

    lastTime(options) {
        options = options || {};
        if (options.noPad) {
            for (let i = this._length - 1; i >= this._offt; i--) {
                if (!(this._values[i] instanceof Pad)) {
                    return this._times[i];
                }
            }
        } else {
            return this._times[this._length - 1];
        }
    }

    size() {
        return this._length - this._offt;
    }

    values(offt=0, len) {
        const l = len === undefined ? this._length : Math.min(this._length, this._offt + len);
        return this._values.slice(this._offt + offt, l);
    }

    times(offt=0, len) {
        const l = len === undefined ? this._length : Math.min(this._length, this._offt + len);
        return this._times.slice(this._offt + offt, l);
    }

    timeAt(i) {
        const idx = i < 0 ? this._length + i : this._offt + i;
        return idx < this._length && idx >= this._offt ? this._times[idx] : undefined;
    }

    valueAt(i) {
        const idx = i < 0 ? this._length + i : this._offt + i;
        return idx < this._length && idx >= this._offt ? this._values[idx] : undefined;
    }

    *entries() {
        for (let i = this._offt; i < this._length; i++) {
            yield [this._times[i], this._values[i]];
        }
    }

    shift() {
        this.processShift(this._offt++);
    }

    pop() {
        this.processPop(--this._length);
    }

    full(options={}) {
        const offt = options.offt;
        const active = options.active != null ? options.active : this._active;
        const fn = active ? this.active : this.elapsed;
        const time = fn.call(this, {offt, predicate: this.period});
        return time >= this.period;
    }
}


export function correctedRollingAverage(timeStream, period, options={}) {
    if (timeStream.length < 2 || timeStream[timeStream.length - 1] < period) {
        return;
    }
    if (options.idealGap === undefined || options.maxGap === undefined) {
        const rec = recommendedTimeGaps(timeStream);
        if (options.idealGap === undefined) {
            options.idealGap = rec.ideal;
        }
        if (options.maxGap === undefined) {
            options.maxGap = rec.max;
        }
    }
    return new RollingAverage(period, options);
}


export function correctedAverage(timeStream, valuesStream, options={}) {
    const roll = correctedRollingAverage(timeStream, null, options);
    if (!roll) {
        return;
    }
    roll.importData(timeStream, valuesStream, options.activeStream);
    return roll;
}


export function peakAverage(period, timeStream, valuesStream, options={}) {
    const roll = correctedRollingAverage(timeStream, period, options);
    if (!roll) {
        return;
    }
    return roll.importReduce(
        timeStream, valuesStream, options.activeStream, x => x.avg(),
        (cur, lead) => cur >= lead);
}


export function smooth(period, rawValues) {
    const len = rawValues.length;
    if (period >= len) {
        throw new Error("smooth period must be less than values length");
    }
    const sValues = new Array(len);
    let sIndex = 0;
    const lead = Math.ceil(period / 2);
    const trail = Math.floor(period / 2);
    const buf = rawValues.slice(0, lead);
    let t = sum(buf);
    // Smooth leading edge with filling buf of period -> period / 2;
    for (let i = lead; i < period; i++) {
        const x = rawValues[i];
        buf.push(x);
        t += x;
        sValues[sIndex++] = t / (i + 1);
    }
    for (let i = period; i < len; i++) {
        const offt = i % period;
        t -= buf[offt];
        t += (buf[offt] = rawValues[i]);
        sValues[sIndex++] = t / period;
    }
    // Smooth trailing edge with draining buf of period -> period / 2;
    for (let i = len; i < len + (period - trail); i++) {
        t -= buf[i % period];
        sValues[sIndex++] = t / (period - 1 - (i - len));
    }
    if (sValues.length !== len) {
        debugger;
    }
    return sValues;
}


export function overlap([aStart, aEnd], [bStart, bEnd]) {
    const interStart = Math.max(aStart, bStart);
    const interEnd = Math.min(aEnd, bEnd);
    const o = interEnd - interStart;
    return o < 0 ? null : o + 1;
}
