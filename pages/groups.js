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
        for (const x of groups) {
            i++;
            tRows.push([
                i,
                x.gap != null ? Math.round(x.gap) + 'm' : '-',
                x.timeGap != null ? Math.round(x.timeGap) + 's' : '-',
                x.athletes.length.toLocaleString() + ' athletes',
                x.watching ? 'WATCHING' : '',
                Math.round(x.power) + 'w (power avg)',
                Math.round(x.draft) + '% (draft avg)',
            ]);
        }
        tBody.innerHTML = `<tr>${tRows.map(x => `<tr><td>${x.join('</td><td>')}</td></tr>`).join('</tr><tr>')}</tr>`;
    });
}

addEventListener('DOMContentLoaded', () => main());
