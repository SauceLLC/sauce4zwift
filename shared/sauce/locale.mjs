
const metersPerMile = 1609.344;
const msgCache = new Map();
const warned = new Set();

let initialized;
const hdUnits = {
    year: 'year',
    weak: 'weak',
    day: 'day',
    hour: 'hour',
    min: 'min',
    sec: 'sec',
    years: 'years',
    weaks: 'weaks',
    days: 'days',
    hours: 'hours',
    mins: 'mins',
    secs: 'secs',
    ago: 'ago',
    in: 'in',
    now: 'now',
    today: 'today',
};


function warnOnce(msg) {
    if (!warned.has(msg)) {
        warned.add(msg);
        console.warn(msg);
    }
}


function isRoughlyEqual(a, b, sameness) {
    sameness = sameness || 0.01;
    const delta = Math.abs(a - b);
    return delta < sameness;
}


function getPaceFormatter(options) {
    let f;
    if (options.type) {
        f = {
            swim: ns.swimPaceFormatter,
            speed: ns.speedFormatter,
            pace: ns.paceFormatter
        }[options.type];
    } else if (options.activityType) {
        f = {
            swim: ns.swimPaceFormatter,
            ride: ns.speedFormatter,
            workout: ns.speedFormatter,
            ski: ns.speedFormatter,
            run: ns.paceFormatter,
        }[options.activityType];
    }
    return f || ns.paceFormatter;
}


function humanDuration(elapsed, options={}) {
    const min = 60;
    const hour = min * 60;
    const day = hour * 24;
    const week = day * 7;
    const year = day * 365;
    const units = [
        ['year', year],
        ['week', week],
        ['day', day],
        ['hour', hour],
        ['min', min],
        ['sec', 1]
    ].filter(([, period]) =>
        (options.maxPeriod ? period <= options.maxPeriod : true) &&
        (options.minPeriod ? period >= options.minPeriod : true));
    const stack = [];
    const precision = options.precision || 1;
    elapsed = Math.round(elapsed / precision) * precision;
    let i = 0;
    for (let [key, period] of units) {
        i++;
        if (precision > period) {
            break;
        }
        if (elapsed >= period || (!stack.length && i === units.length)) {
            if (elapsed >= 2 * period || elapsed < period) {
                key += 's';
            }
            let unit = ' ' + hdUnits[key];
            if (options.short) {
                unit = unit.substr(1, 1);
            }
            const suffix = options.html ? `<abbr class="unit">${unit}</abbr>` : unit;
            let val;
            if (options.digits && units[units.length - 1][1] === period) {
                val = humanNumber(elapsed / period, options.digits);
            } else {
                val = humanNumber(Math.floor(elapsed / period));
            }
            stack.push(`${val}${suffix}`);
            elapsed %= period;
        }
    }
    return stack.slice(0, 2).join(options.seperator || ', ');
}


function humanRaceDistance(value) {
    let label;
    if (value < 1000) {
        label = `${value} m`;
    } else {
        const miles = value / metersPerMile;
        if (isRoughlyEqual(miles, 13.1) ||
            isRoughlyEqual(miles, 26.2) ||
            isRoughlyEqual(miles, Math.round(miles))) {
            label = ns.imperialDistanceFormatter.formatShort(value);
        } else {
            label = ns.metricDistanceFormatter.formatShort(value);
        }
    }
    return label.replace(/\.0 /, ' ');
}


function humanRelTime(date, options={}) {
    if (!(date instanceof Date)) {
        date = new Date(date);
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


function humanWeight(kg) {
    return humanNumber(ns.weightFormatter.convert(kg), 1);
}


function humanTimer(seconds) {
    return ns.timeFormatter.display(seconds);
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
    const style = options.style || 'default';
    return _intlTimeFormats[style].format(date);
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


function humanDistance(meters, precision=1, options={}) {
    if (options.html) {
        const save = ns.distanceFormatter.precision;
        ns.distanceFormatter.precision = precision;
        try {
            return ns.distanceFormatter.abbreviated(meters, precision);
        } finally {
            ns.distanceFormatter.precision = save;
        }
    } else if (options.suffix) {
        return ns.distanceFormatter.formatShort(meters, precision);
    } else {
        return ns.distanceFormatter.format(meters, precision);
    }
}


function humanPace(raw, options={}) {
    const mps = options.velocity ? raw : 1 / raw;
    const formatter = getPaceFormatter(options);
    const minPace = 0.1;  // About 4.5 hours / mile
    const precision = options.precision;
    if (options.suffix) {
        if (options.html) {
            if (mps < minPace) {
                return '<abbr class="unit short" title="Stopped">-</abbr>';
            }
            return formatter.abbreviated(mps);
        } else {
            if (mps < minPace) {
                return '-';
            }
            return formatter.formatShort(mps, precision);
        }
    } else {
        if (mps < minPace) {
            return '-';
        }
        return formatter.format(mps, precision);
    }
}


function humanNumber(value, precision=0) {
    if (value == null || value === '') {
        return '-';
    }
    const n = Number(value);
    if (isNaN(n)) {
        console.warn("Value is not a number:", value);
        return '-';
    }
    if (precision === null) {
        return n.toLocaleString();
    } else if (precision === 0) {
        return Math.round(n).toLocaleString();
    } else {
        return Number(n.toFixed(precision)).toLocaleString();
    }
}


function humanElevation(meters, options={}) {
    if (options.html) {
        return ns.elevationFormatter.abbreviated(meters);
    } else if (options.suffix) {
        if (options.longSuffix) {
            return ns.elevationFormatter.formatLong(meters);
        } else {
            return ns.elevationFormatter.formatShort(meters);
        }
    } else {
        return ns.elevationFormatter.format(meters);
    }
}


function humanStride(meters) {
    const metric = ns.weightFormatter.unitSystem === 'metric';
    if (metric) {
        return humanNumber(meters, 2);
    } else {
        const feet = meters / metersPerMile * 5280;
        return humanNumber(feet, 1);
    }
}


function weightUnconvert(localeWeight) {
    return ns.weightFormatter.unitSystem === 'metric' ? localeWeight : localeWeight / 2.20462;
}


function elevationUnconvert(localeEl) {
    return ns.elevationFormatter.unitSystem === 'metric' ? localeEl : localeEl * 0.3048;
}


function velocityUnconvert(localeV, options={}) {
    const f = getPaceFormatter(options);
    return (f.unitSystem === 'metric' ? localeV * 1000 : localeV * metersPerMile) / 3600;
}


function distanceUnconvert(localeDist) {
    return ns.distanceFormatter.unitSystem === 'metric' ? localeDist * 1000 : localeDist * metersPerMile;
}


export default {
    weightUnconvert,
    elevationUnconvert,
    velocityUnconvert,
    distanceUnconvert,
    human: {
        duration: humanDuration,
        relTime: humanRelTime,
        weight: humanWeight,
        elevation: humanElevation,
        number: humanNumber,
        pace: humanPace,
        dayOfWeek: humanDayOfWeek,
        distance: humanDistance,
        raceDistance: humanRaceDistance,
        timer: humanTimer,
        date: humanDate,
        datetime: humanDateTime,
        time: humanTime,
        stride: humanStride,
    },
};
