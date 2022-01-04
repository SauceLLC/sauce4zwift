
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


class RollingAverage {
    constructor(period, options={}) {
        this.period = period || undefined;
        this.idealGap = options.idealGap !== undefined ? options.idealGap : 1;
        this.breakGap = options.breakGap !== undefined ? options.breakGap : 3600;
        this.maxGap = options.maxGap;
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
        const instance = new this.constructor(options.period || this.period);
        instance.idealGap = this.idealGap;
        instance.breakGap = this.breakGap;
        instance.maxGap = this.maxGap;
        instance._active = this._active;
        instance._ignoreZeros = this._ignoreZeros;
        instance._times = this._times;
        instance._values = this._values;
        instance._offt = this._offt;
        instance._length = this._length;
        instance._activeAcc = this._activeAcc;
        instance._valuesAcc = this._valuesAcc;
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

    elapsed(options={}) {
        const len = this._length;
        const offt = (options.offt || 0) + this._offt;
        if (len - offt <= 1) {
            return 0;
        }
        return this._times[len - 1] - this._times[offt];
    }

    active(options={}) {
        let adj = 0;
        if (options.offt) {
            const lim = Math.min(this._length, this._offt + options.offt);
            for (let i = this._offt; i < lim; i++) {
                if (this._isActiveValue(this._values[i])) {
                    const gap = i ? this._times[i] - this._times[i - 1] : 0;
                    adj += gap;
                }
            }
        }
        return this._activeAcc - adj;
    }

    _isActiveValue(value) {
        return !!(value || (!this._ignoreZeros && !(value instanceof Zero)));
    }

    add(ts, value) {
        if (this._length) {
            const prevTS = this._times[this._length - 1];
            const gap = ts - prevTS;
            if (this.maxGap && gap > this.maxGap) {
                const zeroPad = new Zero();
                let idealGap = this.idealGap;
                if (!idealGap) {
                    const gaps = recommendedTimeGaps(this.times());
                    idealGap = gaps.ideal || 1;
                }
                if (gap > this.breakGap) {
                    // Handle massive gaps between time stamps seen by Garmin devices glitching.
                    // Note, to play nice with elapsed time based rolling avgs, we include the
                    // max number of zero pads on either end of the gap.
                    const bookEndTime = Math.floor(this.breakGap / 2) - idealGap;
                    for (let i = idealGap; i < bookEndTime; i += idealGap) {
                        this._add(prevTS + i, zeroPad);
                    }
                    this._add(prevTS + bookEndTime, new Break(gap - (bookEndTime * 2)));
                    for (let i = gap - bookEndTime; i < gap; i += idealGap) {
                        this._add(prevTS + i, zeroPad);
                    }
                } else {
                    for (let i = idealGap; i < gap; i += idealGap) {
                        this._add(prevTS + i, zeroPad);
                    }
                }
            } else if (this.idealGap && gap > this.idealGap) {
                for (let i = this.idealGap; i < gap; i += this.idealGap) {
                    this._add(prevTS + i, new Pad(value));
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

    processIndex(i) {
        const value = this._values[i];
        if (this._isActiveValue(value)) {
            const gap = i ? this._times[i] - this._times[i - 1] : 0;
            this._activeAcc += gap;
            this._valuesAcc += value * gap;
        }
    }

    shiftValue(value, i) {
        if (this._isActiveValue(value)) {
            // XXX write test that shifts to zero len and validate activeAcc is 0
            //const gap = this._length > 1 ? this._times[i + 1] - this._times[i] : 0;
            const gap = i ? this._times[i] - this._times[i - 1] : 0;
            this._activeAcc -= gap;
            this._valuesAcc -= value * gap;
        }
    }

    popValue(value, i) {
        debugger;  // XXX just want to see it once.
        if (this._isActiveValue(value)) {
            // XXX write test that pops to zero len and validate activeAcc is 0
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
        for (let i = this._length; i < length; i++) {
            this.processIndex(i);
        }
        this._length = length;
        if (this.period) {
            while (this.full({offt: 1})) {
                this.shift();
            }
        }
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

    timeAt(i) {
        return this._times[i < 0 ? this._length + i : this._offt + i];
    }

    valueAt(i) {
        return this._values[i < 0 ? this._length + i : this._offt + i];
    }

    *entries() {
        for (let i = this._offt; i < this._length; i++) {
            yield [this._times[i], this._values[i]];
        }
    }

    shift() {
        const i = this._offt++;
        if (this._offt >= this._values.length) {
            debugger;
        }
        this.shiftValue(this._values[i], i);
    }

    pop() {
        this._length--;
        const value = this._values[this._length];
        this.popValue(value, this._length);
    }

    full(options={}) {
        const offt = options.offt;
        const active = options.active != null ? options.active : this._active;
        const time = active ? this.active({offt}) : this.elapsed({offt});
        return time >= this.period;
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


function smooth(period, rawValues) {
    return rawValues.map((_, i) => avg(rawValues.slice(i, i + period)));
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
    RollingAverage,
    Break,
    Zero,
    Pad,
    peakAverage,
    smooth,
    overlap,
};
