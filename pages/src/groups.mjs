import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const positions = new Map();
const settingsKey = 'groups-settings-v6';
let zoomedPosition = common.storage.get('zoomedPosition');
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let settings;
let curGroups;
let contentEl;
let metaEl;
let aheadEl;
let behindEl;
let containerEl;
const doc = document.documentElement;


function pwrFmt(p) {
    return H.power(p, {suffix: true, html: true});
}


function spdFmt(s) {
    return H.pace(s, {precision: 0, suffix: true, html: true});
}


function getOrCreatePosition(relPos) {
    if (!positions.has(relPos)) {
        const el = document.createElement('div');
        el.classList.add('position');
        el.style.setProperty('--rel-pos', relPos);
        el.innerHTML = `
            <div class="desc left empty">
                <div class="actions">
                    <ms data-action="watch" title="Watch">video_camera_front</ms>
                </div>
                <div class="lines"></div>
            </div>
            <a class="bubble" target="_blank"></a>
            <div class="desc right empty">
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
        containerEl.appendChild(el);
        containerEl.appendChild(gap);
        const nodes = {
            watchTarget: null,
            el,
            leftDesc: el.querySelector('.desc.left'),
            leftLines: el.querySelector('.desc.left .lines'),
            rightDesc: el.querySelector('.desc.right'),
            rightLines: el.querySelector('.desc.right .lines'),
            bubble: el.querySelector('.bubble'),
            gap: {
                el: gap,
                leftLine: gap.querySelector('.lines .line.time'),
            },
            actions: {
                watch: el.querySelector('[data-action="watch"]'),
            },
        };
        positions.set(relPos, nodes);
        nodes.bubble.addEventListener('click', ev => {
            if (!ev.currentTarget.href && zoomedPosition == null) {
                ev.preventDefault();
                zoomedPosition = relPos;
                common.storage.set('zoomedPosition', zoomedPosition);
                render();
            }
        });
        nodes.leftDesc.querySelector('.actions').addEventListener('click', async ev => {
            const ms = ev.target.closest('ms[data-action]');
            if (!ms) {
                return;
            }
            if (ms.dataset.action === 'watch') {
                await common.rpc.watch(nodes.watchTarget);
            }
        });
    }
    return positions.get(relPos);
}


function render() {
    const zoomed = zoomedPosition != null;
    contentEl.classList.toggle('zoomed', zoomed);
    if (zoomed) {
        renderZoomed(curGroups);
    } else {
        renderGroups(curGroups);
    }
}


function renderZoomed(groups) {
    if (!groups) {
        return;
    }
    const groupCenterIdx = groups.findIndex(x => x.watching);
    const pos = zoomedPosition;
    const idx = Math.max(0, Math.min(groupCenterIdx + pos, groups.length - 1));
    const group = groups[idx];
    if (!group) {
        console.warn("XXX Unexpected missing group");
        return;
    }
    const groupSize = group.athletes.length;
    const watchingCenterIdx = pos === 0 ? group.athletes.findIndex(x => x.watching) : 0;
    const ahead = Math.max(0, watchingCenterIdx - Math.ceil(settings.maxZoomed / 2));
    const end = Math.min(group.athletes.length, ahead + settings.maxZoomed);
    const behind = group.athletes.length - end;
    const athletes = group.athletes.slice(ahead, end);
    const gapField = settings.zoomedGapField || 'distance';
    const gapProp = gapField === 'distance' ? 'gapDistance' : 'gap';
    const totGap = athletes[athletes.length - 1][gapProp] - athletes[0][gapProp];
    // Keep total flex-grow < 1 for tight groups.  I.e. prevent 100% height usage when small
    const flexFactor = gapField === 'distance' ? 0.015 : 0.1;
    contentEl.style.setProperty('--total-athletes', athletes.length);  // visual only
    contentEl.style.setProperty('--total-gap', totGap * flexFactor);
    const athletesLabel = groupSize === 1 ? 'Athlete' : 'Athletes';
    const groupLabel = pos ? `${H.place(Math.abs(pos))} ${pos > 0 ? 'behind' : 'ahead'}` : 'Your Group';
    metaEl.innerHTML = [
        `${groupLabel}, ${groupSize} ${athletesLabel}`,
        `${pwrFmt(group.power)}, ${spdFmt(group.speed)}`,
    ].map(x => `<div class="line">${x}</div>`).join('');
    const active = new Set();
    const bikeLength = 2;  // meters
    aheadEl.classList.toggle('visible', !!ahead);
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    behindEl.classList.toggle('visible', !!behind);
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    for (const [i, athlete] of athletes.entries()) {
        // NOTE: gap measurement is always to the next athlete or null.
        const next = athletes[i + 1];
        active.add(i);
        const pos = getOrCreatePosition(i);
        pos.bubble.title = `Click for athlete details`;
        pos.bubble.href = `athlete.html?athleteId=${athlete.athleteId}&widthHint=900&heightHint=375`;
        pos.el.classList.toggle('watching', !!athlete.watching);
        pos.el.style.setProperty('--athletes', 1);
        let label;
        let avatar = 'images/blankavatar.png';
        let fLast;
        let team;
        if (athlete.athlete) {
            const a = athlete.athlete;
            team = a.team;  // hehehe
            if (a.sanitizedName && a.sanitizedName.length) {
                fLast = a.sanitizedName.length > 1 ?
                    [a.sanitizedName[0][0], a.sanitizedName[1]].filter(x => x).join('. ') :
                    fLast = a.sanitizedName[0];
            }
            if (a.avatar) {
                avatar = a.avatar;
            } else {
                label = a.initials;
            }
        }
        if (label) {
            pos.bubble.textContent = label;
        } else {
            pos.bubble.innerHTML = `<img src="${avatar}"/>`;
        }
        const leftLines = [];
        const attacker = settings.detectAttacks &&
            athlete.state.power > 400 &&
            (athlete.state.power / group.power) > 2;
        if (attacker) {
            pos.el.classList.add('attn', 'attack');
            leftLines.push(`<div class="line major attn">Attacking!</div>`);
        } else {
            pos.el.classList.remove('attn', 'attack');
            if (fLast) {
                leftLines.push(`<div class="line minor">${fLast}</div>`);
                if (team) {
                    const hue = common.badgeHue(team);
                    leftLines.push(`<div class="badge" style="--hue: ${hue};">${team}</div>`);
                }
            }
        }
        const rightLines = [`<div class="line">${pwrFmt(athlete.state.power)}</div>`];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (athlete.state.heartrate) {
                rightLines.push(`<div class="line minor">${H.number(athlete.state.heartrate)}<abbr class="unit">bpm</abbr></div>`);
            }
        } else if (minorField === 'draft') {
            if (athlete.state.draft != null) {
                rightLines.push(`<div class="line minor">${H.number(athlete.state.draft)}<abbr class="unit">% (draft)</abbr></div>`);
            }
        } else if (minorField === 'speed') {
            if (athlete.state.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                rightLines.push(`<div class="line minor">${H.pace(athlete.state.speed, {precision: 0})}<abbr class="unit">${unit}</abbr></div>`);
            }
        } else if (minorField === 'power-60s') {
            const p = athlete.stats.power.smooth[60];
            if (p != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(p)} ` +
                    `<abbr class="unit">(1m)</abbr></div>`);
            }
        }
        pos.leftLines.innerHTML = leftLines.join('');
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightLines.innerHTML = rightLines.join('');
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        let gap = next ? Math.abs(next[gapProp] - athlete[gapProp]) : 0;
        if (gapField === 'distance') {
            gap = Math.max(0, gap - bikeLength);
        }
        pos.gap.el.style.setProperty('--inner-gap', gap * flexFactor);
        pos.gap.el.style.setProperty('--outer-gap', gap * flexFactor);
        pos.gap.el.style.setProperty('--gap-sign', -1);
        let dur;
        pos.gap.el.classList.toggle('real', true);
        if (gapField === 'time') {
            dur = gap && gap >= 0.5 && H.number(gap, {precision: 1}) + 's';
        } else {
            dur = gap && gap > bikeLength * 1.3 &&
                (H.number(Math.max(0, gap) * (imperial ? 3.28084 : 1)) + (imperial ? 'ft' : 'm'));
        }
        pos.gap.leftLine.textContent = dur ? dur : '';
        pos.gap.el.classList.toggle('alone', !dur);
        pos.actions.watch.classList.toggle('hidden', athlete.watching);
        if (!athlete.watching) {
            pos.watchTarget = athlete.athleteId;
        }
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
    }
}


function renderGroups(groups) {
    if (!groups) {
        return;
    }
    let centerIdx = groups.findIndex(x => x.watching);
    const ahead = Math.max(0, centerIdx - (settings.maxAhead || 3));
    const end = Math.min(groups.length, centerIdx + (settings.maxBehind || 3) + 1);
    const behind = groups.length - end;
    groups = groups.slice(ahead, end);
    centerIdx = groups.findIndex(x => x.watching);
    if (centerIdx === -1) {
        return;
    }
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    const totGap = groups[groups.length - 1].gap - groups[0].gap;
    const flexFactor = Math.min(1, 0.5 / 15);
    contentEl.style.setProperty('--total-athletes', totAthletes);
    contentEl.style.setProperty('--total-gap', totGap * flexFactor);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    metaEl.innerHTML = `<div class="line">${totAthletes} ${athletesLabel}</div>`;
    const active = new Set();
    aheadEl.classList.toggle('visible', !!ahead);
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    behindEl.classList.toggle('visible', !!behind);
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    for (const [i, group] of groups.entries()) {
        // NOTE: gap measurement is always to the next group or null.
        const next = groups[i + 1];
        const relPos = i - centerIdx;
        active.add(relPos);
        const pos = getOrCreatePosition(relPos);
        pos.bubble.title = `Click to switch to zoomed in view`;
        if (pos.bubble.href) {
            pos.bubble.removeAttribute('href');
        }
        pos.el.classList.toggle('watching', !!group.watching);
        pos.el.style.setProperty('--athletes', group.athletes.length);
        let label;
        const leftLines = [];
        const rightLines = [];
        if (group.athletes.length === 1 && group.athletes[0].athlete) {
            const n = group.athletes[0].athlete.name;
            label = n ? n.map(x => x[0].toUpperCase()).join('').substr(0, 2) : '1';
            pos.el.classList.remove('attn', 'attack');
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                }
            }
            const attacker = settings.detectAttacks &&
                group.athletes.length > 1 &&
                max > 400 &&
                (max / group.power) > 2;
            if (attacker) {
                pos.el.classList.add('attn', 'attack');
                leftLines.push(`<div class="line attn">Attacker!</div>`);
                leftLines.push(`<div class="line minor attn">${pwrFmt(max)}</div>`);
            } else {
                pos.el.classList.remove('attn', 'attack');
            }
        }
        pos.bubble.textContent = label;
        rightLines.push(`<div class="line">${pwrFmt(group.power)}</div>`);
        const minorField = settings.groupsSecondaryField || 'speed';
        if (minorField === 'heartrate') {
            if (group.heartrate) {
                rightLines.push(`<div class="line minor">${H.number(group.heartrate)}<abbr class="unit">bpm</abbr></div>`);
            }
        } else if (minorField === 'draft') {
            if (group.draft != null) {
                rightLines.push(`<div class="line minor">${H.number(group.draft)}<abbr class="unit">% (draft)</abbr></div>`);
            }
        } else if (minorField === 'speed') {
            if (group.speed != null) {
                const unit = imperial ? 'mph' : 'kph';
                rightLines.push(`<div class="line minor">${H.pace(group.speed, {precision: 0})}<abbr class="unit">${unit}</abbr></div>`);
            }
        } else if (minorField === 'power-highest') {
            const highest = sauce.data.max(group.athletes.map(x => x.state.power));
            if (highest != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(highest)} ` +
                    `<abbr class="unit">(highest)</abbr></div>`);
            }
        } else if (minorField === 'power-median') {
            const med = sauce.data.median(group.athletes.map(x => x.state.power));
            if (med != null) {
                rightLines.push(`<div class="line minor">${pwrFmt(med)} ` +
                    `<abbr class="unit">(median)</abbr></div>`);
            }
        }
        pos.leftLines.innerHTML = leftLines.join('');
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightLines.innerHTML = rightLines.join('');
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        const innerGap = next ? group.innerGap : 0;
        const gap = relPos < 0 ? group.gap : next ? next.gap : 0;
        pos.gap.el.style.setProperty('--inner-gap', innerGap * flexFactor);
        pos.gap.el.style.setProperty('--outer-gap', Math.abs(gap) * flexFactor);
        pos.gap.el.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
        pos.gap.el.classList.toggle('real', !!next && !next.isGapEst);
        pos.gap.el.classList.toggle('alone', !innerGap);
        const dur = innerGap && H.duration(Math.abs(gap), {short: true, seperator: ' '});
        pos.gap.leftLine.textContent = dur ? (gap > 0 ? '+' : '-') + dur : '';
        pos.actions.watch.classList.toggle('hidden', group.watching);
        if (!group.watching) {
            pos.watchTarget = group.athletes[Math.trunc(group.athletes.length / 2)].athleteId;
        }
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
    }
}


function setBackground({solidBackground, backgroundColor}) {
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    common.initInteractionListeners();
    contentEl = document.querySelector('#content');
    metaEl = document.querySelector('#meta');
    containerEl = document.querySelector('#container');
    aheadEl = document.querySelector('#ahead');
    behindEl = document.querySelector('#behind');
    settings = common.storage.get(settingsKey, {
        detectAttacks: true,
        maxAhead: 4,
        maxBehind: 2,
        maxZoomed: 8,
        groupsSecondaryField: 'speed',
        zoomedSecondaryField: 'draft',
        zoomedGapField: 'distance',
        solidBackground: false,
        backgroundColor: '#00ff00',
        refreshInterval: 2,
    });
    setBackground(settings);
    contentEl.querySelector('.zoom-out').addEventListener('click', ev => {
        zoomedPosition = null;
        common.storage.set('zoomedPosition', zoomedPosition);
        render();
    });
    common.storage.addEventListener('update', ev => {
        if (ev.data.key !== settingsKey) {
            return;
        }
        settings = ev.data.value;
        setBackground(settings);
        render();
    });
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        }
    });
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        common.subscribe('status', status =>
            doc.classList.toggle('game-connection', status.connected),
            {source: 'gameConnection'});
        doc.classList.toggle('game-connection', gcs.connected);
    }
    let ts = 0;
    common.subscribe('groups', groups => {
        if (!groups.length) {
            return;
        }
        curGroups = groups;
        const now = Date.now();
        if (now - ts > (settings.refreshInterval * 1000 - 100)) {
            ts = now;
            render();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey})();
}
