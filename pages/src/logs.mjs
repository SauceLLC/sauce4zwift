import * as common from './common.mjs';

common.enableSentry();

let lastSeqno = 0;
let curFilters = [];
let filterSeq = 0;
let countEl;
let contentEl;
let curLevel = 'debug';
const totals = [0, 0, 0, 0];
const filtered = [0, 0, 0, 0];
const levelIndexes = {
    'debug': 0,
    'info': 1,
    'warn': 2,
    'error': 3,
};
const msgEls = [];


function fmtLogDate(d) {
    const h = d.getHours().toString();
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}


let _nextUpdateCount;
function updateCount() {
    cancelAnimationFrame(_nextUpdateCount);
    _nextUpdateCount = requestAnimationFrame(() => {
        let count = 0;
        for (let i = levelIndexes[curLevel]; i < totals.length; i++) {
            count += totals[i];
        }
        for (let i = levelIndexes[curLevel]; i < filtered.length; i++) {
            count -= filtered[i];
        }
        countEl.textContent = count.toLocaleString();
    });
}


const logsBody = document.querySelector('table.logs tbody');
function addEntry(o) {
    const time = fmtLogDate(new Date(o.date));
    logsBody.insertAdjacentHTML('beforeend', `
        <tr data-level="${o.level}">
            <td class="time">${time}</td>
            <td class="level">${o.level.toUpperCase()}</td>
            <td class="message"></td>
            <td class="file">${o.file}</td>
        </tr>
    `);
    totals[levelIndexes[o.level]]++;
    const row = logsBody.lastElementChild;
    const msgEl = row.querySelector('.message');
    msgEl.textContent = o.message;
    const tuple = [row, msgEl, o.level];
    msgEls.push(tuple);
    // jump onto any existing updates by using cur seq
    filterMsgs(filterSeq, [tuple]);
}


function onFilterInput(ev) {
    filter(ev.currentTarget.value);
}


function filter(value) {
    curFilters = value === undefined ?
        curFilters :
        value.split('|').map(x => x.toLowerCase()).filter(x => x.length);
    const batch = Array.from(msgEls);
    const scrollTop = contentEl.scrollTop;
    batch.sort(([a], [b]) => {
        const aDist = Math.abs(a.offsetTop - scrollTop);
        const bDist = Math.abs(b.offsetTop - scrollTop);
        return aDist < bDist ? 1 : -1;
    });
    filterMsgs(++filterSeq, batch);
}


function filterMsgs(seq, batch) {
    if (seq !== filterSeq) {
        return;
    }
    for (let j = 0; j < Math.min(100, batch.length); j++) {
        const [row, msgEl, level] = batch.pop();
        if (msgEl.childNodes.length > 1) {
            // fast normalize (make eslint happy by breaking it up)
            const t = msgEl.textContent;
            msgEl.textContent = t;
        }
        let visible;
        if (!curFilters.length) {
            visible = true;
        } else {
            const range = document.createRange();
            for (const x of curFilters) {
                for (const n of msgEl.childNodes) {
                    if (n.nodeType !== Node.TEXT_NODE) {
                        continue;
                    }
                    const indexes = [];
                    let offt = 0;
                    const text = n.data.toLowerCase();
                    while (true) {
                        offt = text.indexOf(x, offt);
                        // eslint-disable-next-line max-depth
                        if (offt !== -1) {
                            indexes.push(offt++);
                            visible = true;
                        } else {
                            break;
                        }
                    }
                    for (let i = indexes.length - 1; i >= 0; i--) {
                        const start = indexes[i];
                        range.setStart(n, start);
                        range.setEnd(n, start + x.length);
                        const hi = document.createElement('span');
                        hi.classList.add('hi');
                        range.surroundContents(hi);
                    }
                }
            }
        }
        if (visible) {
            if (row.style.display) {
                row.style.display = '';
                filtered[levelIndexes[level]]--;
            }
        } else {
            if (!row.style.display) {
                row.style.display = 'none';
                filtered[levelIndexes[level]]++;
            }
        }
    }
    if (batch.length) {
        requestAnimationFrame(() => filterMsgs(seq, batch));
    } else {
        updateCount();
    }
}


function onLevelChange(ev) {
    document.documentElement.dataset.level = curLevel = ev.currentTarget.value;
    updateCount();
}


async function onClearClick() {
    await common.rpc.clearLogs();
    clear();
}


function clear() {
    logsBody.innerHTML = '';
    lastSeqno = -1;
    msgEls.length = 0;
    filtered.length = totals.length = 0;
    totals.push(0, 0, 0, 0);
    filtered.push(0, 0, 0, 0);
    updateCount();
}


export async function main() {
    common.initInteractionListeners();
    countEl = document.querySelector('header .count');
    contentEl = document.querySelector('#content');
    common.subscribe('message', async o => {
        if (o.seqno < lastSeqno) {
            clear();
            addEntry({
                date: Date.now(),
                level: 'info',
                message: 'Sauce restart detected...',
                file: '',
            });
            for (const x of await common.rpc.getLogs()) {
                lastSeqno = x.seqno;
                addEntry(x);
            }
            return;
        }
        addEntry(o);
        lastSeqno = o.seqno;
    }, {source: 'logs', persistent: true});
    for (const x of await common.rpc.getLogs()) {
        lastSeqno = x.seqno;
        addEntry(x);
    }
    requestAnimationFrame(() => contentEl.scrollTop = Number.MAX_SAFE_INTEGER >>> 1);
    document.querySelector('input[name="filter"]').addEventListener('input', onFilterInput);
    document.querySelector('select[name="level"]').addEventListener('change', onLevelChange);
    document.querySelector('.button.clear').addEventListener('click', onClearClick);
    document.querySelector('.button.show-folder').addEventListener('click', () =>
        common.rpc.showLogInFolder());
}
