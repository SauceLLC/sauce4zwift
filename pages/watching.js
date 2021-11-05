
function humanNumber(num, fallback='-') {
    if (num != null) {
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
        const cur = watching.state;

        pwrCurEl.textContent = humanNumber(cur.power || null);
        hrCurEl.textContent = humanNumber(cur.heartrate || null);
        cadCurEl.textContent = humanNumber(cur.cadence || null);
        draftCurEl.textContent = humanNumber(cur.draft || null);

        pwrAvgEl.textContent = humanNumber((stats.powerSum / stats.powerDur) || null);
        hrAvgEl.textContent = humanNumber((stats.hrSum / stats.hrDur) || null);
        cadAvgEl.textContent = humanNumber((stats.cadenceSum / stats.cadenceDur) || null);
        draftAvgEl.textContent = humanNumber((stats.draftSum / stats.draftDur) || null);

        pwrMaxEl.textContent = humanNumber(stats.powerMax || null);
        hrMaxEl.textContent = humanNumber(stats.hrMax || null);
    });
}

addEventListener('DOMContentLoaded', () => main());
