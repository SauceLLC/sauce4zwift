
function sum(data, offt) {
    let total = 0;
    for (let i = offt || 0, len = data.length; i < len; i++) {
        total += data[i];
    }
    return total;
}


function avg(data, offt) {
    if (!data || !data.length) {
        return;
    }
    return sum(data, offt) / (data.length - (offt || 0));
}


function max(data, options={}) {
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


function min(data, options={}) {
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


function mode(data) {
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


function median(data) {
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


function stddev(data) {
    const mean = avg(data);
    const variance = data.map(x => (mean - x) ** 2);
    return Math.sqrt(avg(variance));
}


function resample(inData, outLen, options={}) {
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


function createActiveStream(streams, options={}) {
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


function activeTime(timeStream, activeStream) {
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


let _timeGapsCache = new Map();
function recommendedTimeGaps(timeStream) {
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


function *range(startOrCount, stop, step) {
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


class Pad extends Number {}


class Zero extends Pad {}


class Break extends Zero {
    constructor(pad) {
        super(0);
        this.pad = pad;
    }
}


class RollingBase {
    constructor(period, options) {
        options = options || {};
        this.period = period || undefined;
        this._times = [];
        this._values = [];
        this._offt = 0;
        this._length = 0;
    }

    clone(options={}) {
        const instance = new this.constructor(options.period || this.period);
        instance._times = this._times;
        instance._values = this._values;
        instance._offt = this._offt;
        instance._length = this._length;
        return instance;
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

    *_importIter(times, values) {
        if (times.length !== values.length) {
            throw new TypeError("times and values not same length");
        }
        for (let i = 0; i < times.length; i++) {
            yield this.add(times[i], values[i]);
        }
    }

    importData(times, values) {
        if (times.length !== values.length) {
            throw new TypeError("times and values not same length");
        }
        for (let i = 0; i < times.length; i++) {
            this.add(times[i], values[i]);
        }
    }

    importReduce(times, values, comparator) {
        let leader;
        for (const x of this._importIter(times, values)) {
            void x;
            if (this.full() && (!leader || comparator(this, leader))) {
                leader = this.clone();
            }
        }
        return leader;
    }

    elapsed(options) {
        options = options || {};
        const len = this._length;
        const offt = (options.offt || 0) + this._offt;
        if (len - offt <= 1) {
            return 0;
        }
        return this._times[len - 1] - this._times[offt];
    }

    add(ts, value) {
        this._times.push(ts);
        this._values.push(value);
        this.resize(1);
        return value;
    }

    resize(size) {
        const length = size ? this._length + size : this._values.length;
        if (length > this._values.length) {
            throw new Error('resize underflow');
        }
        for (let i = this._length; i < length; i++) {
            this.processIndex(i);
        }
        this._length = length;
        while (this.full({offt: 1})) {
            this.shift();
        }
    }

    processIndex(index) {
    }

    shiftValue() {
    }

    popValue() {
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

    values() {
        return this._values.slice(this._offt, this._length);
    }

    times() {
        return this._times.slice(this._offt, this._length);
    }

    *entries() {
        for (let i = this._offt; i < this._length; i++) {
            yield [this._times[i], this._values[i]];
        }
    }

    shift() {
        this.shiftValue(this._values[this._offt++]);
    }

    pop() {
        this._length--;
        const value = this._values[this._length];
        this.popValue(value, this._length);
    }

    full(options={}) {
        const offt = options.offt;
        return this.elapsed({offt}) >= this.period;
    }
}


class RollingAverage extends RollingBase {
    constructor(period, options) {
        super(period);
        options = options || {};
        this._ignoreZeros = options.ignoreZeros;
        if (this._ignoreZeros) {
            this._zeros = 0;
        }
        this._sum = 0;
    }

    avg(options) {
        options = options || {};
        if (options.active) {
            // XXX this is wrong.  active != ignore zeros  It means ignore gaps we zero padded.
            const count = (this._length - this._offt - (this._zeros || 0));
            return count ? this._sum / count : 0;
        } else {
            if (this._ignoreZeros) {
                throw new TypeError("Elasped avg unsupported when ignoreZeros=true");
            }
            return (this._sum - this._values[this._offt]) / this.elapsed();
        }
    }

    processIndex(i) {
        const value = this._values[i];
        this._sum += value;
        if (this._ignoreZeros && !value) {
            this._zeros++;
        }
    }

    shiftValue(value) {
        this._sum -= value;
        if (this._ignoreZeros && !value) {
            this._zeros--;
        }
    }

    popValue(value) {
        this._sum -= value;
        if (this._ignoreZeros && !value) {
            this._zeros--;
        }
    }

    clone(...args) {
        const instance = super.clone(...args);
        instance._sum = this._sum;
        instance._ignoreZeros = this._ignoreZeros;
        instance._zeros = this._zeros;
        return instance;
    }
}


function peakAverage(period, timeStream, valuesStream, options) {
    if (timeStream.length < 2 || timeStream[timeStream.length - 1] < period) {
        return;
    }
    options = options || {};
    const active = options.active;
    const ignoreZeros = options.ignoreZeros;
    const roll = new RollingAverage(period, {ignoreZeros});
    return roll.importReduce(timeStream, valuesStream,
        (cur, lead) => cur.avg({active}) >= lead.avg({active}));
}


function smooth(period, valuesStream) {
    const values = [];
    const roll = new RollingAverage(period);
    for (let i = 0; i < valuesStream.length; i++) {
        const v = valuesStream[i];
        if (i < period - 1) {
            // soften the leading edge by unweighting the first values.
            const weighted = valuesStream.slice(i, period - 1);
            weighted.push(v);
            roll.add(i, avg(weighted));
        } else {
            roll.add(i, v);
        }
        values.push(roll.avg({active: true}));
    }
    return values;
}


function overlap([aStart, aEnd], [bStart, bEnd]) {
    const interStart = Math.max(aStart, bStart);
    const interEnd = Math.min(aEnd, bEnd);
    const overlap = interEnd - interStart;
    return overlap < 0 ? null : overlap + 1;
}


export default {
    sum,
    avg,
    min,
    max,
    mode,
    median,
    stddev,
    resample,
    createActiveStream,
    activeTime,
    recommendedTimeGaps,
    range,
    RollingBase,
    RollingAverage,
    Break,
    Zero,
    Pad,
    peakAverage,
    smooth,
    overlap,
};
