import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const num = H.number;

function spd(v) {
    return v ? `${num(v)}<small>kph</small>` : v == null ? '-' : v;
}

function pwr(v) {
    return v ? `${num(v)}<small>w</small>`: v == null ? '-' : v;v
}

function hr(v) {
    return v ? `${num(v)}<small>bpm</small>` : '-';;
}

function clearSelection() {
    window.getSelection().empty();
}

async function main() {
    common.initInteractionListeners();

    const fields = {
        'ID': x => x.athleteId,

        'Gap': x => `${num(x.gap)}s`,

        'Pwr': x => pwr(x.power),
        '5s Pwr': x => pwr(x.stats.power.smooth['5']),
        '1m Pwr': x => pwr(x.stats.power.smooth['60']),
        '5m Pwr': x => pwr(x.stats.power.smooth['300']),
        'Avg Pwr': x => pwr(x.stats.power.avg),
        'NP Pwr': x => pwr(x.stats.power.np),
        'Max Pwr': x => pwr(x.stats.power.max),
        '5s Peak Pwr': x => pwr(x.stats.power.peaks[5].avg),
        '1m Peak Pwr': x => pwr(x.stats.power.peaks[60].avg),
        '5m Peak Pwr': x => pwr(x.stats.power.peaks[300].avg),

        'Spd': x => spd(x.speed),
        '1m Spd': x => spd(x.stats.speed.smooth[60]),
        'Avg Spd': x => spd(x.stats.speed.avg),
        '1m Peak Spd': x => spd(x.stats.speed.peaks[60].avg),

        'HR': x => hr(x.heartrate),
        '1m HR': x => hr(x.stats.hr.smooth[60]),
        'Avg HR': x => hr(x.stats.hr.avg),
        '1m Peak HR': x => hr(x.stats.hr.peaks[60].avg),
    };

    const table = document.querySelector('#content table');
    const tbody = table.querySelector('tbody');
    const theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = Object.keys(fields).map((x, i) => `<td data-id="${i}">${x}</td>`).join('');
 
    let hiRow;
    tbody.addEventListener('dblclick', ev => {
        const row = ev.target.closest('tr');
        if (row) {
            clearSelection();
            hiRow = Number(row.dataset.id);
            const oldHi = tbody.querySelector('tr.hi');
            if (oldHi) {
                oldHi.classList.remove('hi');
            }
            row.scrollIntoView({block: 'center'});  // forces smooth
            setTimeout(() => row.classList.add('hi'), 200); // smooth scroll hack.
        }
    });

    let hiCol;
    theadRow.addEventListener('dblclick', ev => {
        const col = ev.target.closest('td');
        if (col) {
            clearSelection();
            hiCol = Number(col.dataset.id);
            for (const td of table.querySelectorAll('td.hi')) {
                td.classList.remove('hi');
            }
            for (const td of table.querySelectorAll(`td[data-id="${hiCol}"]`)) {
                td.classList.add('hi');
            }
        }
    });
    let pause;
    document.addEventListener('selectionchange', ev => pause = !!getSelection().toString());

    let nextAnimFrame;
    let frames = 0;
    common.subscribe('nearby', async nearby => {
        if (!nearby.length || pause || document.hidden) {
            return;
        }
        nearby.sort((a, b) => a.gap - b.gap);
        const html = nearby.map(x => {
            const classes = [];
            if (x.watching) {
                classes.push('watching');
            }
            if ((x.watching && !hiRow) || x.athleteId === hiRow) {
                classes.push('hi');
            }
            return `
                <tr data-id="${x.athleteId}" class="${classes.join(' ')}">
                    ${Object.values(fields).map((fmt, i) =>
                        `<td data-id="${i}" class="${hiCol === i ? 'hi' : ''}">${fmt(x)}</td>`
                    ).join('')}
                </tr>
            `;
        }).join('\n');
        if (nextAnimFrame) {
            cancelAnimationFrame(nextAnimFrame);
            console.log("drop frame");
        }
        nextAnimFrame = requestAnimationFrame(() => {
            nextAnimFrame = null;
            tbody.innerHTML = html;
            if (!frames++) {
                queueMicrotask(() => {
                    const w = document.querySelector('tr.watching');
                    if (w) {
                        w.scrollIntoView({block: 'center'});
                    }
                });
            }
        });
    });
}

addEventListener('DOMContentLoaded', () => main());
