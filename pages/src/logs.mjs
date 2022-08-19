import * as common from './common.mjs';

const logsBody = document.querySelector('table.logs tbody');
function addEntry(o) {
    logsBody.insertAdjacentHTML('beforeend', `
        <tr data-level="${o.level}">
            <td class="time">${(new Date(o.date)).toLocaleTimeString()}</td>
            <td class="level">${o.level.toUpperCase()}</td>
            <td class="message"></td>
            <td class="file">${o.file}</td>
        </tr>
    `);
    logsBody.querySelector(':scope > tr:last-child .message').textContent = o.message;
}


export async function main() {
    common.initInteractionListeners();
    let lastSeqno = 0;
    common.subscribe('message', o => {
        if (o.seqno < lastSeqno) {
            return;
        }
        addEntry(o);
        lastSeqno = o.seqno;
        console.log(o);
    }, {source: 'logs', persistent: true});
    for (const x of await common.rpc.getLogs()) {
        lastSeqno = x.seqno;
        addEntry(x);
    }
    requestAnimationFrame(() => {
        document.querySelector('#content').scrollTop = Number.MAX_SAFE_INTEGER;
    });
}
