/* global sauce */

(function () {
    'use strict';

    self.sauce = (self.sauce || {});


    sauce.humanDuration = function(elapsed, options={}) {
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
        const short = options.short;
        for (let [key, period] of units) {
            i++;
            if (precision > period) {
                break;
            }
            if (elapsed >= period || (!stack.length && i === units.length)) {
                if (!short && (elapsed >= 2 * period || elapsed < period)) {
                    key += 's';
                }
                if (short) {
                    key = key[0];
                }
                const suffix = options.html ? `<abbr class="unit">${key}</abbr>` : key;
                let val;
                if (options.digits && units[units.length - 1][1] === period) {
                    val = sauce.humanNumber(elapsed / period, options.digits);
                } else {
                    val = sauce.humanNumber(Math.floor(elapsed / period));
                }
                stack.push(`${val}${short ? '' : ' '}${suffix}`);
                elapsed %= period;
            }
        }
        return stack.slice(0, 2).join(', ');
    }

    sauce.humanNumber = function(value, precision=0) {
        if (value == null || value === '') {
            return '';
        }
        const n = Number(value);
        if (isNaN(n)) {
            console.warn("Value is not a number:", value);
            return value;
        }
        if (precision === null) {
            return n.toLocaleString();
        } else if (precision === 0) {
            return Math.round(n).toLocaleString();
        } else {
            return Number(n.toFixed(precision)).toLocaleString();
        }
    }
})();
