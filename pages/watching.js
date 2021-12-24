/* global sauce */

function humanNumber(num, fallback='-') {
    if (num != null && !isNaN(num)) {
        return Math.round(num).toLocaleString();
    } else {
        return fallback;
    }
}


function rotateField(label, fields, cur, defIndex) {
    let i;
    if (!cur) {
        i = localStorage.getItem(label) || defIndex;
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
        },
        key: () => `Peak ${sauce.locale.humanDuration(period, {short: true})}`
    };
}


async function main() {
    const content = document.querySelector('#content');
    const pwrMainValueEl = content.querySelector('.power .main .value');
    const pwrMainLabelEl = content.querySelector('.power .main .label');
    const pwrUpperValueEl = content.querySelector('.power .upper .value');
    const pwrUpperKeylEl = content.querySelector('.power .upper .key');
    const pwrLowerValueEl = content.querySelector('.power .lower .value');
    const pwrLowerKeyEl = content.querySelector('.power .lower .key');
    const hrCurEl = content.querySelector('.hr .current .value');
    const cadCurEl = content.querySelector('.cadence .current .value');
    const draftCurEl = content.querySelector('.draft .current .value');
    const hrAvgEl = content.querySelector('.hr .avg .value');
    const cadAvgEl = content.querySelector('.cadence .avg .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');
    const hrMaxEl = content.querySelector('.hr .max .value');
    const powerFields = [{
        value: x => x.power,
        label: () => 'watts',
        key: () => 'Watts',
    }, {
        value: x => x.stats.powerMax,
        label: () => 'max',
        key: () => 'Max',
    }, {
        value: x => x.stats.powerAvg,
        label: () => 'avg (elapsed)',
        key: () => 'eAvg',
    }, {
        value: x => x.stats.powerAvgActive,
        label: () => 'avg (active)',
        key: () => 'aAvg',
    }, {
        value: x => x.stats.powerNP,
        label: () => 'np',
        key: () => 'NP',
    }, {
        value: x => x.stats.power5s,
        label: () => '5s watts',
        key: () => '5s',
    }, {
        value: x => x.stats.power30s,
        label: () => '30s watts',
        key: () => '30s',
    },
        makePeakField(5),
        makePeakField(60),
        makePeakField(300),
    ];
    let lastDraw = 0;
    let powerFieldMain = rotateField('power-main', powerFields, null, 0);
    content.querySelector('.power .main').addEventListener('click', ev => {
        powerFieldMain = rotateField('power-main', powerFields, powerFieldMain);
        lastDraw = 0;
    });
    let powerFieldLower = rotateField('power-lower', powerFields, null, 1);
    content.querySelector('.power .lower').addEventListener('click', ev => {
        powerFieldLower = rotateField('power-lower', powerFields, powerFieldLower);
        lastDraw = 0;
    });
    let powerFieldUpper = rotateField('power-upper', powerFields, null, 2);
    content.querySelector('.power .upper').addEventListener('click', ev => {
        powerFieldUpper = rotateField('power-upper', powerFields, powerFieldUpper);
        lastDraw = 0;
    });


    sauce.subscribe('watching', watching => {
        const ts = Date.now();
        const sinceLast = ts - lastDraw;
        if (sinceLast < 700) {
            return;
        }
        lastDraw = ts;
        const stats = watching.stats;

        pwrMainValueEl.textContent = humanNumber(powerFieldMain.value(watching));
        pwrMainLabelEl.innerHTML = powerFieldMain.label(watching);
        pwrUpperValueEl.textContent = humanNumber(powerFieldUpper.value(watching));
        pwrUpperKeylEl.innerHTML = powerFieldUpper.key(watching);
        pwrLowerValueEl.textContent = humanNumber(powerFieldLower.value(watching));
        pwrLowerKeyEl.innerHTML = powerFieldLower.key(watching);

        hrCurEl.textContent = humanNumber(watching.heartrate || null);
        cadCurEl.textContent = humanNumber(watching.cadence);
        draftCurEl.textContent = humanNumber(watching.draft);

        hrAvgEl.textContent = humanNumber(stats.hrSum / stats.hrDur);
        cadAvgEl.textContent = humanNumber(stats.cadenceSum / stats.cadenceDur);
        draftAvgEl.textContent = humanNumber(stats.draftSum / stats.draftDur);

        hrMaxEl.textContent = humanNumber(stats.hrMax || null);
    });
}

addEventListener('DOMContentLoaded', () => main());
