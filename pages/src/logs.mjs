import * as common from './common.mjs';

let lastSeqno = 0;
let curFilters = [];
const msgTrigrams = [];
const resizeObs = new ResizeObserver(onMsgResize);


function trigramify(s) {
    s = s.toLowerCase();
    const trigrams = [];
    for (let i = 0; i < s.length - 2; i++) {
        trigrams.push(s.slice(i, i + 3));
    }
    return trigrams;
}


function fmtLogDate(d) {
    const h = d.getHours().toString();
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
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
    const el = logsBody.querySelector(':scope > tr:last-child');
    const msgEl = el.querySelector('.message');
    msgEl.textContent = o.message;
    const trigrams = trigramify(msgEl.textContent);
    msgTrigrams.push([el, trigrams]);
    filterMsg(el, trigrams);
    resizeObs.observe(msgEl);
}


function onFilterInput(ev) {
    filter(ev.currentTarget.value);
}


function filter(value) {
    for (const x of document.querySelectorAll('td.message .hi')) {
        x.remove();
    }
    curFilters = value === undefined ?
        curFilters :
        value.split('|').map(trigramify).filter(x => x.length);
    for (const x of msgTrigrams) {
        filterMsg.apply(null, x);
    }
}


function filterMsg(el, trigrams) {
    if (!curFilters.length) {
        if (el.style.display) {
            el.style.display = '';
        }
    } else {
        let visible = false;
        for (const filterTG of curFilters) {
            let matches = 0;
            const highlights = new Set();
            for (let i = 0; i < filterTG.length; i++) {
                for (let j = 0; j < trigrams.length; j++) {
                    if (trigrams[j] === filterTG[i]) {
                        matches++;
                        highlights.add(j);
                        highlights.add(j + 1);
                        highlights.add(j + 2);
                    }
                }
                if (i > 4 && matches < (i + 1) * 0.10) {
                    break; // optimize hopeless causes
                }
            }
            const matchPct = matches / filterTG.length;
            /*if (matchPct) {
                console.log(matchPct, el.children[2].textContent);
            }*/
            if (matchPct >= 0.80) {
                visible = true;
            } else {
                continue;
            }
            const indexes = Array.from(highlights).sort((a, b) => a - b);
            const ranges = [];
            let range;
            const msgEl = el.querySelector('.message');
            const msgTextEl = el.querySelector('.message').childNodes[0];
            for (const [i, index] of indexes.entries()) {
                if (!range) {
                    range = document.createRange();
                    range.setStart(msgTextEl, index);
                } else if (indexes[i - 1] !== index - 1) {
                    range.setEnd(msgTextEl, indexes[i - 1] + 1);
                    ranges.push(range);
                    range = document.createRange();
                    range.setStart(msgTextEl, index);
                } else if (i === indexes.length - 1) {
                    range.setEnd(msgTextEl, index + 1);
                    ranges.push(range);
                }
            }
            const msgRect = msgEl.getBoundingClientRect();
            for (const x of ranges) {
                const rect = x.getBoundingClientRect();
                const hi = document.createElement('div');
                hi.classList.add('hi');
                hi.style.top = `${rect.top - msgRect.top}px`;
                hi.style.left = `${rect.left - msgRect.left}px`;
                hi.style.width = `${rect.width}px`;
                hi.style.height = `${rect.height}px`;
                requestAnimationFrame(() => msgEl.appendChild(hi));
            }
        }
        if (visible) {
            if (el.style.display) {
                requestAnimationFrame(() => el.style.display = '');
            }
        } else {
            if (!el.style.display) {
                requestAnimationFrame(() => el.style.display = 'none');
            }
        }
    }
}


let _pendingResize;
function onMsgResize(entries) {
    cancelAnimationFrame(_pendingResize);
    _pendingResize = requestAnimationFrame(() => filter());
}


function onLevelChange(ev) {
    document.documentElement.dataset.level = ev.currentTarget.value;
}


async function onClearClick() {
    await common.rpc.clearLogs();
    clear();
}


function clear() {
    logsBody.innerHTML = '';
    lastSeqno = -1;
    msgTrigrams.length = 0;
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
    document.querySelector('input[name="filter"]').addEventListener('input', onFilterInput);
    document.querySelector('select[name="level"]').addEventListener('change', onLevelChange);
    document.querySelector('.button.clear').addEventListener('click', onClearClick);
    document.querySelector('.button.show-folder').addEventListener('click', () => common.rpc.showLogInFolder());
}
