
//const metersPerMile = 1609.344;

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


/*function isRoughlyEqual(a, b, sameness) {
    sameness = sameness || 0.01;
    const delta = Math.abs(a - b);
    return delta < sameness;
}*/


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
    return humanNumber(kg, 1);
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


function humanTimer(elapsed, options={}) {
    if (!elapsed) {
        return '-';
    }
    const endSlice = options.ms ? 12 : 8;
    let s = (new Date(elapsed * 1000)).toISOString().substr(11, endSlice);
    if (!options.full) {
        s = s.replace(/^00:/, '');
    }
    return s;
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



function humanNumber(value, precision=0) {
    if (value == null || value === '') {
        return '-';
    }
    const n = Number(value);
    if (isNaN(n)) {
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


function weightUnconvert(localeWeight) {
    throw new Error("TBD");
    //return ns.weightFormatter.unitSystem === 'metric' ? localeWeight : localeWeight / 2.20462;
}


function elevationUnconvert(localeEl) {
    throw new Error("TBD");
    //return ns.elevationFormatter.unitSystem === 'metric' ? localeEl : localeEl * 0.3048;
}


function velocityUnconvert(localeV, options={}) {
    throw new Error("TBD");
}


function distanceUnconvert(localeDist) {
    throw new Error("TBD");
    //return ns.distanceFormatter.unitSystem === 'metric' ? localeDist * 1000 : localeDist * metersPerMile;
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
        //elevation: humanElevation,
        number: humanNumber,
        //pace: humanPace,
        dayOfWeek: humanDayOfWeek,
        //distance: humanDistance,
        date: humanDate,
        datetime: humanDateTime,
        time: humanTime,
        timer: humanTimer,
        //stride: humanStride,
    },
};
