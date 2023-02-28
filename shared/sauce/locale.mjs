import {LRUCache} from './base.mjs';

let imperial = false;
export function setImperial(en) {
    imperial = en;
}


export function isImperial() {
    return imperial;
}


export const metersPerMile = 1609.344;
export const metersPerFoot = 0.3048;
export const kgsPerLbs = 2.20462;

const hdUnits = {
    year: 'year',
    week: 'week',
    day: 'day',
    hour: 'hour',
    min: 'min',
    sec: 'sec',
    years: 'years',
    weeks: 'weeks',
    days: 'days',
    hours: 'hours',
    mins: 'mins',
    secs: 'secs',
    ago: 'ago',
    in: 'in',
    now: 'now',
    today: 'today',
};

const humanEmpty = '-';


function _realNumber(n) {
    return n != null && n < Infinity && n > -Infinity && !isNaN(n) && n !== '';
}


function humanDuration(elapsed, options={}) {
    if (!_realNumber(elapsed)) {
        return humanEmpty;
    }
    let units = [
        ['year', 365 * 86400],
        ['week', 7 * 86400],
        ['day', 86400],
        ['hour', 3600],
        ['min', 60],
        ['sec', 1]
    ];
    if (options.maxPeriod || options.minPeriod) {
        units = units.filter(([, period]) =>
            (options.maxPeriod ? period <= options.maxPeriod : true) &&
            (options.minPeriod ? period >= options.minPeriod : true));
    }
    elapsed = options.precision ? Number(elapsed.toFixed(options.precision)) : Math.round(elapsed);
    let sign = '';
    if (elapsed < 0) {
        sign = '-';
        elapsed = -elapsed;
    }
    const maxParts = options.maxParts === undefined ? 2 : options.maxParts;
    const stack = [];
    for (let i = 0; i < units.length && stack.length < maxParts; i++) {
        let [key, period] = units[i];
        const isLast = i === units.length - 1;
        if (elapsed >= period || isLast) {
            const val = isLast || stack.length === maxParts - 1 ?
                humanNumber(elapsed / period, {precision: options.precision}) :
                humanNumber(Math.floor(elapsed / period));
            if (val !== '0' || (isLast && !stack.length)) {
                key += val !== '1' ? 's' : '';
                const unit = options.short ? hdUnits[key][0] : ` ${hdUnits[key]}`;
                const suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
                stack.push(`${val}${suffix}`);
            }
            elapsed %= period;
        }
    }
    if (stack.length) {
        return sign + stack.join(options.seperator || ', ');
    } else {
        return '-';
    }
}


function humanRelDuration(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date)) {
        return humanEmpty;
    }
    const elapsed = (Date.now() - date.getTime()) / 1000;
    return humanDuration(Math.abs(elapsed), options);
}


function humanRelTime(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date)) {
        return humanEmpty;
    }
    const elapsed = (Date.now() - date.getTime()) / 1000;
    const duration = humanDuration(Math.abs(elapsed), options);
    if (duration) {
        if (elapsed > 0) {
            return `${duration} ${hdUnits.ago}`;
        } else {
            return `${hdUnits.in} ${duration}`;
        }
    } else {
        if (options.precision && options.precision >= 86400) {
            return hdUnits.today;
        } else {
            return hdUnits.now;
        }
    }
}


const _intlDateFormats = {
    'long': new Intl.DateTimeFormat([], {year: 'numeric', month: 'long', day: 'numeric'}),
    'default': new Intl.DateTimeFormat([], {year: 'numeric', month: 'short', day: 'numeric'}),
    'short': new Intl.DateTimeFormat([], {year: 'numeric', month: 'numeric', day: 'numeric'}),
    'shortDay': new Intl.DateTimeFormat([], {month: 'numeric', day: 'numeric'}),
    'monthYear': new Intl.DateTimeFormat([], {year: 'numeric', month: 'short'}),
    'month': new Intl.DateTimeFormat([], {month: 'short'}),
    'monthDay': new Intl.DateTimeFormat([], {month: 'short', day: 'numeric'}),
    'weekday': new Intl.DateTimeFormat([], {weekday: 'short', month: 'short', day: 'numeric'}),
    'weekdayYear': new Intl.DateTimeFormat([], {weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'}),
};
function humanDate(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date)) {
        return humanEmpty;
    }
    const style = options.style || 'default';
    return _intlDateFormats[style].format(date);
}


const _intlTimeFormats = {
    'default': new Intl.DateTimeFormat([], {hour: 'numeric', minute: 'numeric', second: 'numeric'}),
};
function humanTime(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date)) {
        return humanEmpty;
    }
    const style = options.style || 'default';
    return _intlTimeFormats[style].format(date);
}


function humanTimer(elapsed, options={}) {
    if (!_realNumber(elapsed)) {
        return humanEmpty;
    }
    elapsed = elapsed || 0;
    if (!options.ms) {
        elapsed = Math.round(elapsed);
    }
    let sign = '';
    if (elapsed < 0) {
        elapsed = -elapsed;
        sign = '-';
    }
    const hours = elapsed / 3600 | 0;
    const mins = elapsed % 3600 / 60 | 0;
    const secsStr = (elapsed % 60 | 0).toString();
    const msStr = options.ms ? '.' + Math.round(elapsed % 1 * 1000).toString().padStart(3, '0') : '';
    if (hours) {
        return `${sign}${hours}:${mins.toString().padStart(2, '0')}:${secsStr.padStart(2, '0')}${msStr}`;
    } else if (mins || options.long) {
        return `${sign}${mins}:${secsStr.padStart(2, '0')}${msStr}`;
    } else {
        return `${sign}${secsStr}${msStr}`;
    }
}


const _intlDateTimeFormats = {
    'long': new Intl.DateTimeFormat([], {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: 'numeric'
    }),
    'default': new Intl.DateTimeFormat([], {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: 'numeric'
    }),
    'short': new Intl.DateTimeFormat([], {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric'
    }),
    'weekday': new Intl.DateTimeFormat([], {
        weekday: 'short',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: 'numeric'
    }),
};
function humanDateTime(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    const now = new Date();
    if (now.getDate() === date.getDate() &&
        now.getMonth() === date.getMonth() &&
        now.getFullYear() === date.getFullYear()) {
        const time = humanTime(date, {...options, style: 'default'});
        if (options.concise) {
            return time;
        }
        const today = hdUnits.today;
        const Today = today.substr(0, 1).toLocaleUpperCase() + today.substr(1);
        return [Today, time].join(', ');
    }
    const style = options.style || 'default';
    return _intlDateTimeFormats[style].format(date);
}


const _utcSundayRef = new Date(1638700000000);
function humanDayOfWeek(sunOfft, options={}) {
    const weekday = options.long ? 'long' : 'short';
    const d = new Date(_utcSundayRef);
    d.setDate(d.getDate() + sunOfft);
    return d.toLocaleString(undefined, {timezone: 'UTC', weekday});
}


function _humanNumber(value, options) {
    if (!_realNumber(value)) {
        return humanEmpty;
    }
    let n = Number(value);
    const p = options.precision || 0;
    const v = n.toLocaleString(undefined, {
        useGrouping: n >= 10000 || n <= -10000,
        maximumFractionDigits: p,
        minimumFractionDigits: options.fixed ? p : undefined,
    });
    const sep = options.suffix && options.seperator || '';
    const suffix = options.suffix ?
        options.html ? `<abbr class="unit">${options.suffix}</abbr>` : options.suffix :
        '';
    return (v === '-0' ? '0' : v) + sep + suffix;
}


const _hnLRU = new LRUCache(4096 * 16);
function humanNumber(value, options={}) {
    const p = options.precision || 0;
    const t = typeof value;
    // Improve LRU hit rate..
    const sv = (t === 'number' && !p) ? Math.round(value) : value;
    const sig = `${t} ${sv} ${p} ${options.fixed} ${options.suffix} ${options.html} ${options.seperator}`;
    let r = _hnLRU.get(sig);
    if (r === undefined) {
        r = _humanNumber(value, options);
        _hnLRU.set(sig, r);
    }
    return r;
}


function humanPower(p, options={}) {
    if (!_realNumber(p)) {
        return humanEmpty;
    }
    if (options.suffix) {
        options.suffix = options.html ? `<abbr class="unit">w</abbr>` : 'w';
    }
    return humanNumber(p, options);
}


function humanWkg(wkg, options={}) {
    if (!_realNumber(wkg)) {
        return humanEmpty;
    }
    if (options.suffix) {
        options.suffix = options.html ? `<abbr class="unit">w/kg</abbr>` : 'w/kg';
    }
    return humanNumber(wkg, {precision: 1, ...options});
}


function humanPace(kph, options={}) {
    if (!_realNumber(kph)) {
        return humanEmpty;
    }
    const sport = options.sport || 'cycling';
    if (sport === 'running') {
        if (options.suffix) {
            const unit = imperial ? '/mi' : '/km';
            options.suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
        }
        return humanTimer(3600 / (imperial ? kph * 1000 / metersPerMile : kph), options);
    } else {
        if (options.suffix) {
            const unit = imperial ? 'mph' : 'kph';
            options.suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
        }
        return humanNumber(imperial ? kph * 1000 / metersPerMile : kph, {fixed: true, ...options});
    }
}


function humanDistance(meters, options={}) {
    if (!_realNumber(meters)) {
        return humanEmpty;
    }
    if (options.suffix) {
        const unit = imperial ? 'mi' : 'km';
        options.suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
    }
    return humanNumber(imperial ? meters / metersPerMile : meters / 1000,
        {fixed: true, precision: 1, ...options});
}


function humanWeight(kg, options={}) {
    if (!_realNumber(kg)) {
        return humanEmpty;
    }
    if (options.suffix) {
        const unit = imperial ? 'lbs' : 'kg';
        options.suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
    }
    return humanNumber(imperial ? kg * kgsPerLbs : kg, {precision: 1, ...options});
}


function humanWeightClass(kg, options={}) {
    if (!_realNumber(kg)) {
        return humanEmpty;
    }
    const unit = imperial ? 'lbs' : 'kg';
    const range = imperial ? 20 : 10;
    const suffix = options.suffix ? options.html ? `<abbr class="unit">${unit}</abbr>` : unit : false;
    const v = imperial ? kg * kgsPerLbs : kg;
    const vOfRange = v / range;
    const lower = Math.floor(vOfRange) * range;
    const upper = (vOfRange % 1) ? Math.ceil(vOfRange) * range : (vOfRange + 1) * range;
    return `${humanNumber(lower)}⭤${humanNumber(upper, {suffix})}`;
}


function humanHeight(cm, options={}) {
    if (!_realNumber(cm)) {
        return humanEmpty;
    }
    if (imperial) {
        const feet = cm / 100 / 0.3048;
        const wholeFeet = Math.trunc(feet);
        const inches = Math.round((feet % 1) * 12);
        return `${wholeFeet}'` + (inches ? ` ${inches}"` : '');
    } else {
        const unit = options.html ? '<abbr class="unit">m</abbr>' : 'm';
        return (cm / 100).toFixed(2) + unit;
    }
}


function humanElevation(meters, options={}) {
    if (!_realNumber(meters)) {
        return humanEmpty;
    }
    const unit = imperial ? 'ft' : 'm';
    if (options.suffix) {
        options.suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
    }
    return humanNumber(imperial ? meters * metersPerFoot : meters, options);
}


const placePluralRules = new Intl.PluralRules('en-US', {type: 'ordinal'});
const placeSuffixes = {
    one: 'st',
    two: 'nd',
    few: 'rd',
    other: 'th',
};
function humanPlace(p, options={}) {
    if (!p) {
        return options.suffixOnly ? '' : humanEmpty;
    }
    const suffix = placeSuffixes[placePluralRules.select(p)];
    if (options.suffixOnly) {
        return suffix;
    }
    const hp = humanNumber(p);
    if (options.html) {
        return `${hp}<abbr class="unit">${suffix}</abbr>`;
    } else {
        return `${hp}${suffix}`;
    }
}


export function weightUnconvert(localeWeight) {
    return imperial ? localeWeight / kgsPerLbs : localeWeight;
}


export function elevationUnconvert(localeEl) {
    return imperial ? localeEl * metersPerFoot : localeEl;
}


export function velocityUnconvert(localeV, options={}) {
    throw new Error("TBD");
}


export function distanceUnconvert(localeDist) {
    return imperial ? localeDist * metersPerMile : localeDist * 1000;
}


export const human = {
    duration: humanDuration,
    relTime: humanRelTime,
    relDuration: humanRelDuration,
    weight: humanWeight,
    weightClass: humanWeightClass,
    height: humanHeight,
    elevation: humanElevation,
    number: humanNumber,
    pace: humanPace,
    power: humanPower,
    wkg: humanWkg,
    place: humanPlace,
    distance: humanDistance,
    dayOfWeek: humanDayOfWeek,
    date: humanDate,
    datetime: humanDateTime,
    time: humanTime,
    timer: humanTimer,
};
