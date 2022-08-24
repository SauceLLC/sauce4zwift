import * as common from './common.mjs';

let lastSeqno = 0;
let curFilters = [];
let countEl;
let curLevel = 'debug';
const totals = [0, 0, 0, 0];
const filtered = [0, 0, 0, 0];
const levelIndexes = {
    'debug': 0,
    'info': 1,
    'warn': 2,
    'error': 3,
};
const msgEls = new Map();
const resizeObs = new ResizeObserver(onMsgResize);


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
    const msg = msgEl.textContent.toLowerCase();
    const msgTextEl = msgEl.childNodes[0];
    const tuple = [row, msgEl, msgTextEl, msg, o.level];
    msgEls.set(msgEl, tuple);
    const update = filterMsg(tuple);
    resizeObs.observe(msgEl);
    requestAnimationFrame(() => {
        updateRow(update);
        updateCount();
    });
}


function onFilterInput(ev) {
    filter(ev.currentTarget.value);
}


function filter(value) {
    curFilters = value === undefined ?
        curFilters :
        value.split('|').map(x => x.toLowerCase()).filter(x => x.length);
    const updates = Array.from(msgEls.values()).map(filterMsg);
    requestAnimationFrame(() => {
        updates.forEach(updateRow);
        updateCount();
    });
}


function filterMsg([row, msgEl, msgTextEl, msg, level]) {
    if (!curFilters.length) {
        return [true, row, msgEl, [], level];
    } else {
        const range = document.createRange();
        const highlights = [];
        for (const x of curFilters) {
            let offt = 0;
            while(true) {
                const start = msg.indexOf(x, offt);
                if (start !== -1) {
                    offt = start + 1;
                    range.setStart(msgTextEl, start);
                    range.setEnd(msgTextEl, start + x.length);
                    const msgRect = msgEl.getBoundingClientRect();
                    const rangeRect = range.getBoundingClientRect();
                    highlights.push({
                        top: `${rangeRect.top - msgRect.top}px`,
                        left: `${rangeRect.left - msgRect.left}px`,
                        width: `${rangeRect.width}px`,
                        height: `${rangeRect.height}px`,
                    });
                } else {
                    break;
                }
            }
        }
        return [highlights.length > 0, row, msgEl, highlights, level];
    }
}


function updateRow([visible, row, msgEl, highlights, level]) {
    if (visible) {
        for (let i = 0; i < highlights.length; i++) {
            let el;
            if (msgEl.childNodes.length > i + 1) {
                el = msgEl.childNodes[i + 1];
            } else {
                el = document.createElement('div');
                el.classList.add('hi');
                msgEl.appendChild(el);
            }
            Object.assign(el.style, highlights[i]);
        }
        while (msgEl.childNodes.length > highlights.length + 1) {
            msgEl.lastChild.remove();
        }
        if (row.style.display) {
            row.style.display = '';
            filtered[levelIndexes[level]]--;
        }
    } else {
        while (msgEl.childNodes.length > 1) {
            msgEl.lastChild.remove();
        }
        if (!row.style.display) {
            row.style.display = 'none';
            filtered[levelIndexes[level]]++;
        }
    }
}


let _pendingResize;
const _pendingResizeEls = new Set();
function onMsgResize(entries) {
    cancelAnimationFrame(_pendingResize);
    for (let i = 0; i < entries.length; i++) {
        _pendingResizeEls.add(entries[i].target);
    }
    _pendingResize = requestAnimationFrame(() => {
        const updates = [];
        const pending = Array.from(_pendingResizeEls);
        _pendingResizeEls.clear();
        for (let i = 0; i < pending.length; i++) {
            updates.push(filterMsg(msgEls.get(pending[i])));
        }
        requestAnimationFrame(() => {
            for (let i = 0; i < updates.length; i++) {
                updateRow(updates[i]);
            }
            updateCount();
        });
    });
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
    msgEls.clear();
    filtered.length = totals.length = 0;
    totals.push(0, 0, 0, 0);
    filtered.push(0, 0, 0, 0);
    updateCount();
}


export async function main() {
    common.initInteractionListeners();
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
    requestAnimationFrame(() => {
        document.querySelector('#content').scrollTop = Number.MAX_SAFE_INTEGER >>> 1;
    });
    countEl = document.querySelector('header .count');
    document.querySelector('input[name="filter"]').addEventListener('input', onFilterInput);
    document.querySelector('select[name="level"]').addEventListener('change', onLevelChange);
    document.querySelector('.button.clear').addEventListener('click', onClearClick);
    document.querySelector('.button.show-folder').addEventListener('click', () => common.rpc.showLogInFolder());
}
