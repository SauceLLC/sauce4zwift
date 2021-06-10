/* global sauce */

async function main() {
    const content = document.querySelector('#content');
    const bubbles = new Map();
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'groups') {
            return;
        }
        let groups = ev.data.data;
        let centerIdx = groups.findIndex(x => x.watching);
        const behindCount = (groups.length - 1) - centerIdx;
        const adjacent = 5;
        const firstIndex = Math.max(0, centerIdx - adjacent - (behindCount < adjacent ? adjacent - behindCount : 0));
        groups = groups.filter((x, i) => i >= firstIndex && i - firstIndex < (adjacent * 2));
        centerIdx = groups.findIndex(x => x.watching);
        const center = groups[centerIdx];
        const centerDistGap = center.totDistGap;
        const centerTimeGap = center.totTimeGap;
        const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
        const totGap = groups[groups.length - 1].totTimeGap - groups[0].totTimeGap;
        content.style.setProperty('--total-athletes', totAthletes);
        content.style.setProperty('--total-gap', totGap);
        const active = new Set();
        let i = 0;
        for (const x of groups) {
            const relPos = i++ - centerIdx;
            active.add(relPos);
            if (!bubbles.has(relPos)) {
                const bubble = document.createElement('div');
                bubble.classList.add('bubble');
                bubble.style.setProperty('--rel-pos', relPos);
                bubble.dataset.relPos = relPos;
                bubbles.set(relPos, bubble);
                content.appendChild(bubble);
                const line = document.createElement('div');
                line.classList.add('line');
                line.style.setProperty('--rel-pos', relPos);
                content.appendChild(line);
            }
            const bubble = bubbles.get(relPos);
            const timeGap = x.totTimeGap - centerTimeGap;
            const distGap = x.totDistGap - centerDistGap;
            bubble.classList.toggle('watching', !!x.watching);
            bubble.style.setProperty('--athletes', x.athletes.length);
            bubble.textContent = [
                relPos,
                distGap ? sauce.locale.humanDistance(distGap) : '-',
                timeGap ? ((timeGap > 0 ? '+' : '-') + sauce.locale.humanDuration(Math.abs(timeGap), {short: true})) : '-',
                x.athletes.length.toLocaleString(),
                Math.round(x.power) + sauce.locale.thinSpace + 'w',
                Math.round(x.draft) + sauce.locale.thinSpace + '%',
            ].join(" \n ");
            const line = bubble.nextSibling;
            line.style.setProperty('--abs-gap', Math.abs(i < groups.length ? groups[i].totTimeGap - x.totTimeGap : 0));
        }
        for (const [pos, x] of bubbles.entries()) {
            x.classList.toggle('hidden', !active.has(pos));
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
