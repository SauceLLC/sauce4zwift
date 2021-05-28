/* global sauce */

async function main() {
    const content = document.querySelector('#content');
    const tBody = content.querySelector('table tbody');
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'groups') {
            return;
        }
        const groups = ev.data.data;
        const tRows = [];
        let i = 0;
        const center = groups.find(x => x.watching);
        let centerDistGap = center.totDistGap;
        let centerTimeGap = center.totTimeGap;
        for (const x of groups) {
            i++;
            const timeGap = x.totTimeGap - centerTimeGap;
            const distGap = x.totDistGap - centerDistGap;
            tRows.push([
                i,
                distGap ? (Math.round(distGap).toLocaleString() + 'm') : '-',
                timeGap ? ((timeGap > 0 ? '+' : '-') + sauce.humanDuration(Math.abs(timeGap), {short: true})) : '-',
                x.athletes.length.toLocaleString(),
                Math.round(x.power) + 'w',
                Math.round(x.draft) + '%',
            ]);
        }
        tBody.innerHTML = `<tr>${tRows.map((x, i) => `
            <tr class="${groups[i].watching ? 'watching' : ''}">
                <td>${x.join('</td><td>')}</td>
            </tr>`).join('</tr><tr>')}</tr>`;
    });
}

addEventListener('DOMContentLoaded', () => main());
