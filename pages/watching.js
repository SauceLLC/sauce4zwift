
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
        const avgPower = (stats.powerSum / stats.powerDur) || 0;
        const avgHR = (stats.hrSum / stats.hrDur) || 0;
        const avgDraft = (stats.draftSum / stats.draftDur) || 0;
        const avgCad = (stats.cadenceSum / stats.cadenceDur) || 0;
        const maxPower = stats.powerMax;
        const maxHR = stats.hrMax;

        pwrCurEl.textContent = cur.power != null ? cur.power.toLocaleString() : '-';
        hrCurEl.textContent = cur.heartrate != null ? cur.heartrate.toLocaleString() : '-';
        cadCurEl.textContent = cur.cadence != null && Math.round(cur.cadence).toLocaleString();
        draftCurEl.textContent = cur.draft != null ? cur.draft.toLocaleString() : '-';

        pwrAvgEl.textContent = Math.round(avgPower).toLocaleString();
        hrAvgEl.textContent = Math.round(avgHR).toLocaleString();
        cadAvgEl.textContent = Math.round(avgCad).toLocaleString();
        draftAvgEl.textContent = Math.round(avgDraft).toLocaleString();

        pwrMaxEl.textContent = maxPower != null ? maxPower.toLocaleString() : '-';
        hrMaxEl.textContent = maxHR != null ? maxHR.toLocaleString() : '-';
    });
}

addEventListener('DOMContentLoaded', () => main());
