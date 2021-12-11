
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
    content.querySelector('.power .current').addEventListener('click', ev => {
        console.log("click");
    });
    content.querySelector('.power .current').addEventListener('dblclick', ev => {
        console.log("dblclick");
    });
    content.querySelector('.power .current').addEventListener('contextmenu', ev => {
        console.log("right click");
    });
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'watching') {
            return;
        }
        const watching = ev.data.data;
        const stats = watching.stats;

        pwrCurEl.textContent = humanNumber(watching.power);
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
