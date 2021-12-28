/* global sauce */
import sauce from '../shared/base.mjs';

async function main() {
    const content = document.querySelector('#content');
    const groupEls = new Map();
    sauce.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        let centerIdx = groups.findIndex(x => x.watching);
        const behindCount = (groups.length - 1) - centerIdx;
        const adjacent = 3;
        const firstIndex = Math.max(0, centerIdx - adjacent - (behindCount < adjacent ? adjacent - behindCount : 0));
        groups = groups.filter((x, i) => i >= firstIndex && i - firstIndex <= (adjacent * 2));
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
        for (const [i, x] of groups.entries()) {
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
            const group = groupEls.get(relPos);
            group.classList.toggle('watching', !!x.watching);
            group.style.setProperty('--athletes', x.athletes.length);
            let bubble;
            if (x.athletes.length === 1 && x.athletes[0].athlete) {
                const n = x.athletes[0].athlete.name;
                bubble = n.map(x => x[0].toUpperCase()).join('').substr(0, 2);
            } else {
                bubble = x.athletes.length.toLocaleString();
            }
            group.querySelector('.bubble').textContent = bubble;
            group.querySelector('.desc .lines').innerHTML = [
                Math.round(x.power).toLocaleString() + sauce.locale.thinSpace + 'w',
                Math.round(x.speed).toLocaleString() + sauce.locale.thinSpace + 'kph',
            ].map((x, i) => `<div class="line ${i ? 'minor' : ''}">${x}</div>`).join('');
            const gapEl = group.nextSibling;
            const innerGap = next ? Math.round(x.innerGap) : 0;
            const gap = relPos < 0 ? x.gap : next ? next.gap : 0;
            gapEl.style.setProperty('--inner-gap', innerGap);
            gapEl.style.setProperty('--outer-gap', Math.abs(gap));
            gapEl.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
            gapEl.classList.toggle('real', !!next && !next.isGapEst);
            gapEl.classList.toggle('alone', !innerGap);
            const dur = innerGap && sauce.locale.humanDuration(Math.abs(gap), {short: true, seperator: ' '});
            gapEl.querySelector('.desc .line.time').textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
        }
        console.info("");
        for (const [pos, x] of groupEls.entries()) {
            x.classList.toggle('hidden', !active.has(pos));
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
