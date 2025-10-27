import {LRUCache} from './base.mjs';

let imperial = false;
export function setImperial(en) {
    imperial = en;
}


export function isImperial() {
    return imperial;
}


export const narrowNoBreakSpace = '\u202f';
export const milesPerKm = 1000 / 1609.344;
export const feetPerMeter = 1 / 0.3048;
export const poundsPerKg = 2.20462;

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

export const humanDateTimeFormats = {
    date: {
        long: {year: 'numeric', month: 'long', day: 'numeric'},
        default: {year: 'numeric', month: 'short', day: 'numeric'},
        day: {month: 'short', day: 'numeric'},
        short: {year: 'numeric', month: 'numeric', day: 'numeric'},
        shortDay: {month: 'numeric', day: 'numeric'},
        monthYear: {year: 'numeric', month: 'short'},
        month: {month: 'short'},
        monthDay: {month: 'short', day: 'numeric'},
        weekday: {weekday: 'short', month: 'short', day: 'numeric'},
        weekdayYear: {weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'},
    },
    time: {
        short: {hour: 'numeric', minute: 'numeric'},
        default: {hour: 'numeric', minute: 'numeric', second: 'numeric'},
        ms: {hour: 'numeric', minute: 'numeric', second: 'numeric', fractionalSecondDigits: 3},
        date: {weekday: 'short', hour: 'numeric', minute: 'numeric', timeZoneName: 'short'},
    },
    datetime: {
        long: {year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric'},
        default: {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric'},
        day: {month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric'},
        short: {year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'},
        shortDay: {month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'},
        weekday: {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric',
                  weekday: 'short'},
        weekdayDay: {month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short'},
    }
};


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
                const unit = options.short ? hdUnits[key][0] : hdUnits[key];
                const suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
                stack.push(`${val}${!options.html && !options.short ? ' ' : ''}${suffix}`);
            }
            elapsed %= period;
        }
    }
    if (stack.length) {
        return sign + stack.join(options.separator || ', ');
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


function humanDate(date, options={}) {
    const format = humanDateTimeFormats.date[options.style || 'default'];
    return _humanDateTimeFormat(date, format, options);
}


function humanTime(date, options={}) {
    const format = humanDateTimeFormats.time[options.style || 'default'];
    return _humanDateTimeFormat(date, format, options);
}


function humanDateTime(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    const now = new Date();
    if (now.getYear() === date.getYear() &&
        now.getMonth() === date.getMonth() &&
        now.getDate() === date.getDate()) {
        const time = humanTime(date, {...options, style: options.today_style});
        if (options.concise) {
            return time;
        }
        const today = hdUnits.today;
        const Today = today.substr(0, 1).toLocaleUpperCase() + today.substr(1);
        return `${Today}, ${time}`;
    }
    let style = options.style;
    if (options.concise && now.getYear() === date.getYear()) {
        if (style) {
            humanDateTimeFormats.datetime[style + 'Day'];
            style += 'Day';
        } else {
            style = 'day';
        }
    }
    const format = humanDateTimeFormats.datetime[style || 'default'];
    return _humanDateTimeFormat(date, format, options);
}


const _dtFormatters = new Map();
function _humanDateTimeFormat(date, format, options) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date)) {
        return humanEmpty;
    }
    let formatter = _dtFormatters.get(format);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat([], format);
        _dtFormatters.set(format, formatter);
    }
    if (options.parts) {
        return formatter.formatToParts(date);
    } else if (!options.html) {
        return formatter.format(date);
    } else {
        return partsToHTML(formatter.formatToParts(date).map(x => ({
            ...x,
            type: {literal: 'separator', dayPeriod: 'unit'}[x.type] || 'value',
            name: x.type,
        })));
    }
}


function humanTimer(elapsed, options={}) {
    if (options.suffixOnly) {
        return _realNumber(elapsed) && options.suffix || '';
    }
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
    const parts = [{type: 'value', name: 'sign', value: sign}];
    switch (true) {
        case !!(hours || options.full):
            parts.push({type: 'value', name: 'hours', value: hours.toString()},
                       {type: 'separator', name: 'hours', value: ':'});
            // falls through
        case !!(mins || options.long || options.full): {
            const value = (options.short && !hours) ? mins.toString() : mins.toString().padStart(2, '0');
            parts.push({type: 'value', name: 'minutes', value},
                       {type: 'separator', name: 'minutes', value: ':'});
            // falls through
        }
        default: {
            const s = (elapsed % 60 | 0).toString();
            parts.push({type: 'value', name: 'seconds', value: parts.length > 1 ? s.padStart(2, '0') : s});
        }
    }
    if (options.ms) {
        const value = Math.round(elapsed % 1 * 1000).toString().padStart(3, '0');
        parts.push({type: 'separator', name: 'milliseconds', value: '.'},
                   {type: 'value', name: 'milliseconds', value});
    }
    if (options.suffix) {
        if (options.separator) {
            parts.push({type: 'separator', name: 'suffix', value: options.separator});
        }
        parts.push({type: 'unit', name: 'suffix', value: options.suffix});
    }
    if (options.parts) {
        return parts;
    } else if (options.html) {
        return partsToHTML(parts);
    } else {
        return parts.map(x => x.value).join('');
    }
}


function partsToHTML(parts) {
    const tags = {value: 'span', separator: 'span', unit: 'abbr'};
    const inner = parts.map(x =>
        `<${tags[x.type]} class="${x.type} ${x.name}">${x.value}</${tags[x.type]}>`).join('');
    return `<localized style="display: contents">${inner}</localized>`;
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
    const n = Number(value);
    const p = options.precision || 0;
    const v = n.toLocaleString(undefined, {
        useGrouping: n >= 10000 || n <= -10000,
        maximumFractionDigits: p,
        minimumFractionDigits: options.fixed ? p : undefined,
        signDisplay: options.signDisplay || 'negative',
    });
    const sep = options.suffix && options.separator || '';
    const suffix = options.suffix ?
        options.html ? `<abbr class="unit">${options.suffix}</abbr>` : options.suffix :
        '';
    return (v === '-0' ? '0' : v) + sep + suffix;
}


const _hnLRU = new LRUCache(4096 * 16);
function humanNumber(value, options={}) {
    if (options.suffixOnly) {
        return _realNumber(value) && options.suffix || '';
    }
    const p = options.precision || 0;
    const t = typeof value;
    // Improve LRU hit rate..
    const sv = (t === 'number' && !p) ? Math.round(value) : value;
    const sig = `${t} ${sv} ${p} ${options.fixed} ${options.suffix} ${options.html} ${options.separator}`;
    let r = _hnLRU.get(sig);
    if (r === undefined) {
        r = _humanNumber(value, options);
        _hnLRU.set(sig, r);
    }
    return r;
}


function humanPower(p, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = 'w';
    }
    return humanNumber(p, options);
}


function humanWkg(wkg, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = 'w/kg';
    }
    return humanNumber(wkg, {precision: 1, fixed: true, ...options});
}


function humanPace(kph, options={}) {
    const sport = options.sport || 'cycling';
    let fixed;
    let short;
    let value;
    let humanFunc = humanNumber;
    if (_realNumber(kph)) {
        if (sport === 'running') {
            if (options.suffix === true || options.suffixOnly) {
                options.suffix = imperial ? '/mi' : '/km';
            }
            value = 3600 / (imperial ? kph * milesPerKm : kph);
            short = true;
            humanFunc = humanTimer;
        } else {
            if (options.suffix === true || options.suffixOnly) {
                options.suffix = imperial ? 'mph' : 'kph';
            }
            fixed = true;
            value = imperial ? kph * milesPerKm : kph;
        }
    }
    return humanFunc(value, {fixed, short, ...options});
}


function humanDistance(m, options={}) {
    let value;
    let precision;
    if (_realNumber(m)) {
        if (Math.abs(m) < 1000) {
            if (options.suffix === true || options.suffixOnly) {
                options.suffix = imperial ? 'ft' : 'm';
            }
            precision = 0;
            value = imperial ? m * feetPerMeter : m;
        } else {
            if (options.suffix === true || options.suffixOnly) {
                options.suffix = imperial ? 'mi' : 'km';
            }
            precision = 1;
            value = imperial ? m / 1000 * milesPerKm : m / 1000;
        }
    } else {
        value = NaN;
    }
    return humanNumber(value, {fixed: true, precision, ...options});
}


function humanWeight(kg, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = imperial ? 'lbs' : 'kg';
    }
    const value = _realNumber(kg) ? imperial ? kg * poundsPerKg : kg : NaN;
    return humanNumber(value, {precision: 1, ...options});
}


function humanWeightClass(kg, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = imperial ? 'lbs' : 'kg';
    }
    if (_realNumber(kg)) {
        const range = imperial ? 20 : 10;
        const v = imperial ? kg * poundsPerKg : kg;
        const vOfRange = v / range;
        const lower = humanNumber(Math.floor(vOfRange) * range);
        const upper = humanNumber((vOfRange % 1) ? Math.ceil(vOfRange) * range : (vOfRange + 1) * range,
                                  options);
        return `${lower}${narrowNoBreakSpace}-${narrowNoBreakSpace}${upper}`;
    } else {
        return humanNumber(NaN, options);
    }
}


function humanAgeClass(age, options={}) {
    if (!_realNumber(age)) {
        return humanEmpty;
    }
    if (age < 23) {
        return 'U23';
    }
    let lower, upper;
    if (age < 30) {
        lower = 23;
        upper = 29;
    } else if (age < 70) {
        lower = (age / 10 | 0) * 10;
        upper = lower + 9;
    } else {
        return '70+';
    }
    return `${lower}${narrowNoBreakSpace}-${narrowNoBreakSpace}${upper}`;
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
        const unit = options.suffix ? options.html ? '<abbr class="unit">m</abbr>' : 'm' : '';
        return (cm / 100).toFixed(2) + unit;
    }
}


function humanElevation(m, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = imperial ? 'ft' : 'm';
    }
    return humanNumber(_realNumber(m) ? imperial ? m * feetPerMeter : m : NaN, options);
}


const placePluralRules = new Intl.PluralRules('en-US', {type: 'ordinal'});
const placeSuffixes = {
    one: 'st',
    two: 'nd',
    few: 'rd',
    other: 'th',
};
function humanPlace(p, options={}) {
    if (options.suffix === true || options.suffixOnly) {
        options.suffix = placeSuffixes[placePluralRules.select(p)];
    }
    return humanNumber(p, options);
}


export const human = {
    duration: humanDuration,
    relTime: humanRelTime,
    relDuration: humanRelDuration,
    weight: humanWeight,
    weightClass: humanWeightClass,
    ageClass: humanAgeClass,
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
