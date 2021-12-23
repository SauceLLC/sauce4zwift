/* global sauce */

function humanNumber(num, fallback='-') {
    if (num != null && !isNaN(num)) {
        return Math.round(num).toLocaleString();
    } else {
        return fallback;
    }
}


async function main() {
    const content = document.querySelector('#content');
    const pwrCurEl = content.querySelector('.power .current .value');
    const hrCurEl = content.querySelector('.hr .current .value');
    const cadCurEl = content.querySelector('.cadence .current .value');
    const draftCurEl = content.querySelector('.draft .current .value');
    const pwrAvgEl = content.querySelector('.power .avg .value');
    const hrAvgEl = content.querySelector('.hr .avg .value');
    const cadAvgEl = content.querySelector('.cadence .avg .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');
    const pwrMaxEl = content.querySelector('.power .max .value');
    const hrMaxEl = content.querySelector('.hr .max .value');
    let powerSelections = [
        x => Math.round(x.power) + ' c',
        x => Math.round(x.stats.peak5s) + ' 5s',
        x => Math.round(x.stats.peak30s) + ' 30s',
    ];
    let powerFunc = powerSelections[0];
    content.querySelector('.power .current').addEventListener('click', ev => {
        powerFunc = powerSelections[(powerSelections.indexOf(powerFunc) + 1) % powerSelections.length];
    });
    sauce.subscribe('watching', watching => {
        const stats = watching.stats;

        //pwrCurEl.textContent = humanNumber(watching.power);
        pwrCurEl.textContent = powerFunc(watching);
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
