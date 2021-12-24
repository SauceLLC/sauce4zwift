/* global sauce */

function humanNumber(num, fallback='-') {
    if (num != null && !isNaN(num)) {
        return Math.round(num).toLocaleString();
    } else {
        return fallback;
    }
}


function rotateField(label, fields, cur) {
    let i;
    if (!cur) {
        i = localStorage.getItem(label);
    } else {
        i = fields.indexOf(cur) + 1;
        localStorage.setItem(label, i);
    }
    return fields[i % fields.length];
}


function makePeakField(period) {
    return {
        value: x => {
            const o = x.stats[`peakPower${period}s`];
            return o && o.avg;
        },
        label: x => {
            const label = `peak ${sauce.locale.humanDuration(period, {short: true})}`;
            const o = x.stats[`peakPower${period}s`];
            if (!o) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            return `${label}<br/><small>${sauce.locale.humanDuration(ago)} ago</small>`;
        }
    };
}


async function main() {
    const content = document.querySelector('#content');
    const pwrCurValueEl = content.querySelector('.power .current .value');
    const pwrCurLabelEl = content.querySelector('.power .current .label');
    const hrCurEl = content.querySelector('.hr .current .value');
    const cadCurEl = content.querySelector('.cadence .current .value');
    const draftCurEl = content.querySelector('.draft .current .value');
    const pwrAvgEl = content.querySelector('.power .avg .value');
    const hrAvgEl = content.querySelector('.hr .avg .value');
    const cadAvgEl = content.querySelector('.cadence .avg .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');
    const pwrMaxEl = content.querySelector('.power .max .value');
    const hrMaxEl = content.querySelector('.hr .max .value');
    const powerFields = [{
        value: x => x.power,
        label: () => 'watts',
    }, {
        value: x => x.stats.powerAvg,
        label: () => 'Roll eAVG',
    }, {
        value: x => x.stats.powerAvgActive,
        label: () => 'Roll aAVG',
    }, {
        value: x => x.stats.powerNP,
        label: () => 'NP',
    }, {
        value: x => x.stats.power5s,
        label: () => '5s watts',
    }, {
        value: x => x.stats.power30s,
        label: () => '30s watts',
    },
        makePeakField(5),
        makePeakField(30),
        makePeakField(60),
        makePeakField(120),
        makePeakField(300),
        makePeakField(1200),
        makePeakField(3600),
    ];
    let powerField = rotateField('power', powerFields);
    content.querySelector('.power .current').addEventListener('click', ev => {
        powerField = rotateField('power', powerFields, powerField);
    });
    sauce.subscribe('watching', watching => {
        const stats = watching.stats;

        console.log('adsf', watching.power);
        pwrCurValueEl.textContent = humanNumber(powerField.value(watching));
        pwrCurLabelEl.innerHTML = powerField.label(watching);
        hrCurEl.textContent = humanNumber(watching.heartrate || null);
        cadCurEl.textContent = humanNumber(watching.cadence);
        draftCurEl.textContent = humanNumber(watching.draft);

        pwrAvgEl.textContent = humanNumber(stats.powerSum / stats.powerDur);
        hrAvgEl.textContent = humanNumber(stats.hrSum / stats.hrDur);
        cadAvgEl.textContent = humanNumber(stats.cadenceSum / stats.cadenceDur);
        draftAvgEl.textContent = humanNumber(stats.draftSum / stats.draftDur);

        pwrMaxEl.textContent = humanNumber(stats.powerMax || null);
        hrMaxEl.textContent = humanNumber(stats.hrMax || null);
    });
}

addEventListener('DOMContentLoaded', () => main());
