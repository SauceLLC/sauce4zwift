/* global sauce */

async function main() {
    const content = document.querySelector('#content');
    const tBody = content.querySelector('table tbody');
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'nearby') {
            return;
        }
        const nearby = ev.data.data;
        const tRows = [];
        for (const x of nearby) {
            tRows.push([
                x.id,
                x.position,
                sauce.locale.humanDistance(x.relDistance),
                sauce.locale.humanDuration(x.timeGap),
                (x.roadLocation / 10000).toFixed(1) + sauce.locale.thinSpace + '%',
                'roadid: ' + x.roadId,
                x.overlapping,
                x.athlete && `${x.athlete.firstName[0]}.${x.athlete.lastName}`,
            ]);
        }
        tBody.innerHTML = `<tr>${tRows.map(x => `<tr><td>${x.join('</td><td>')}</td></tr>`).join('</tr><tr>')}</tr>`;
    });
}

addEventListener('DOMContentLoaded', () => main());
