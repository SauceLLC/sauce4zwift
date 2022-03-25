import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;


export async function main() {
    common.initInteractionListeners();
    const options = common.storage.get('groups-options', {
        detectAttacks: true,
        maxAhead: 3,
        maxBehind: 3,
    });
    const content = document.querySelector('#content');
    const groupEls = new Map();
    common.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        let centerIdx = groups.findIndex(x => x.watching);
        groups = groups.slice(
            Math.max(0, centerIdx - (options.maxAhead || 3)),
            centerIdx + (options.maxBehind || 3) + 1);
        centerIdx = groups.findIndex(x => x.watching);
        const center = groups[centerIdx];
        if (!center) {
            return;
        }
        const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
        const totGap = Math.round(groups[groups.length - 1].gap - groups[0].gap);
        content.style.setProperty('--total-athletes', totAthletes);
        content.style.setProperty('--total-gap', totGap);
        const active = new Set();
        for (const [i, group] of groups.entries()) {
            // NOTE: gap measurement is always to the next group or null.
            const next = groups[i + 1];
            const relPos = i - centerIdx;
            active.add(relPos);
            if (!groupEls.has(relPos)) {
                const group = document.createElement('div');
                group.classList.add('group');
                group.style.setProperty('--rel-pos', relPos);
                group.innerHTML = `
                    <div class="bubble"></div>
                    <div class="desc">
                        <div class="lines"></div>
                    </div>
                `;
                const gap = document.createElement('div');
                gap.classList.add('gap');
                gap.style.setProperty('--rel-pos', relPos);
                gap.innerHTML = `
                    <div class="desc">
                        <div class="lines">
                            <div class="line time"></div>
                            <div class="line minor est" title="Estimated gap">(est)</div>
                        </div>
                    </div>
                `;
                content.appendChild(group);
                content.appendChild(gap);
                groupEls.set(relPos, group);
            }
            const groupEl = groupEls.get(relPos);
            groupEl.classList.toggle('watching', !!group.watching);
            groupEl.style.setProperty('--athletes', group.athletes.length);
            let bubble;
            let power;
            const lines = [];
            if (group.athletes.length === 1 && group.athletes[0].athlete) {
                const n = group.athletes[0].athlete.name;
                bubble = n.map(x => x[0].toUpperCase()).join('').substr(0, 2);
                groupEl.classList.remove('attn', 'attack');
            } else {
                bubble = group.athletes.length.toLocaleString();
                let max = -Infinity;
                for (const x of group.athletes) {
                    const p = x.stats.power.smooth[5];
                    if (p > max) {
                        max = p;
                    }
                }
                if (max > 400 && (max / group.power) > 2) {
                    groupEl.classList.add('attn', 'attack');
                    lines.push(`<div class="line attn">${Math.round(max).toLocaleString()}w <small>Attacker!</small></div>`);
                } else {
                    groupEl.classList.remove('attn', 'attack');
                }
            }
            groupEl.querySelector('.bubble').textContent = bubble;
            lines.push(...[
                Math.round(group.power).toLocaleString() + 'w',
                Math.round(group.speed).toLocaleString() + 'kph',
            ].map((x, i) => `<div class="line ${i ? 'minor' : ''}">${x}</div>`));
            groupEl.querySelector('.desc .lines').innerHTML = lines.join('');
            const gapEl = groupEl.nextSibling;
            const innerGap = next ? Math.round(group.innerGap) : 0;
            const gap = relPos < 0 ? group.gap : next ? next.gap : 0;
            gapEl.style.setProperty('--inner-gap', innerGap);
            gapEl.style.setProperty('--outer-gap', Math.abs(gap));
            gapEl.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
            gapEl.classList.toggle('real', !!next && !next.isGapEst);
            gapEl.classList.toggle('alone', !innerGap);
            const dur = innerGap && H.duration(Math.abs(gap), {short: true, seperator: ' '});
            gapEl.querySelector('.desc .line.time').textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
        }
        for (const [pos, x] of groupEls.entries()) {
            x.classList.toggle('hidden', !active.has(pos));
        }
    });
}


export function options() {
    common.initInteractionListeners();
    common.initOptionsForm('form', 'groups-options');
}
