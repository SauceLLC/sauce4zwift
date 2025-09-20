import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

common.enableSentry();

const L = sauce.locale;
const H = L.human;
const positions = new Map();
let zoomedGroup = common.storage.get('zoomedGroup');
let curGroups;
let eventSubgroup;
let contentEl;
let metaEl;
let aheadEl;
let behindEl;
let containerEl;
const doc = document.documentElement;

common.settingsStore.setDefault({
    detectAttacks: true,
    maxAhead: 4,
    maxBehind: 2,
    maxZoomed: 8,
    groupsPrimaryField: 'power',
    zoomedPrimaryField: 'power',
    groupsSecondaryField: 'speed',
    zoomedSecondaryField: 'draft',
    zoomedGapField: 'distance',
    solidBackground: false,
    backgroundColor: '#00ff00',
    refreshInterval: 2,
    hideHeader: false,
    labelAngle: 50,
    horizLTR: true,
    zoomPriority: 'position',
});

// XXX Need a migration system.
const legacyZoomedPosition = common.storage.get('zoomedPosition');
if (zoomedGroup == null && legacyZoomedPosition != null) {
    common.storage.set('zoomedGroup', {position: legacyZoomedPosition});
    common.storage.set('zoomedPosition', null);
}
common.settingsStore.get('zoomPriority', 'position');
common.settingsStore.get('groupsPrimaryField', 'power');
common.settingsStore.get('zoomedPrimaryField', 'power');

const settings = common.settingsStore.get();


function getSubgroupLazy(id) {
    const sg = common.getEventSubgroup(id);
    if (!sg || sg instanceof Promise) {
        return null;
    }
    return sg;
}


function setMaxPositions() {
    let v;
    if (zoomedGroup != null) {
        v = settings.maxZoomed || 8;
    } else {
        v = (settings.maxAhead || 0) + (settings.maxBehind || 0) + 1;
    }
    doc.style.setProperty('--max-positions', v);
}


function pwrFmt(p, options) {
    return H.power(p, {suffix: true, html: true, ...options});
}


function wkgFmt(wkg) {
    return H.wkg(wkg, {suffix: true, html: true});
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
                <div class="lines"></div>
                <div class="actions"><ms data-action="watch" title="Watch">video_camera_front</ms></div>
            </div>
            <div class="bubble-holder">
                <div class="rings"></div>
                <a class="bubble" target="_blank"></a>
            </div>
            <div class="desc right empty"><div class="lines"></div></div>
        `;
        const gap = document.createElement('div');
        gap.classList.add('gap');
        gap.style.setProperty('--rel-pos', relPos);
        gap.innerHTML = `<div class="desc"><div class="lines"></div></div>`;
        containerEl.appendChild(el);
        containerEl.appendChild(gap);
        const nodes = {
            watchTarget: null,
            el,
            bubbleHolder: el.querySelector('.bubble-holder'),
            bubble: el.querySelector('.bubble'),
            leftDesc: el.querySelector('.desc.left'),
            leftLines: el.querySelector('.desc.left .lines'),
            rightDesc: el.querySelector('.desc.right'),
            rightLines: el.querySelector('.desc.right .lines'),
            gap: {
                el: gap,
                desc: gap.querySelector('.desc'),
                lines: gap.querySelector('.desc .lines'),
            },
            actions: {
                watch: el.querySelector('[data-action="watch"]'),
            },
        };
        positions.set(relPos, nodes);
        nodes.bubble.addEventListener('click', ev => {
            if (!ev.currentTarget.href && zoomedGroup == null) {
                ev.preventDefault();
                const groupCenterIdx = curGroups.findIndex(x => x.watching);
                const group = curGroups[groupCenterIdx + relPos];
                if (!group) {
                    return;
                }
                if (settings.zoomPriority === 'position') {
                    zoomedGroup = {
                        position: relPos
                    };
                } else {
                    if (group.id != null) {
                        zoomedGroup = {id: group.id};
                    } else {
                        zoomedGroup = {athleteId: group.athletes[0].athleteId};
                    }
                }
                common.storage.set('zoomedGroup', zoomedGroup);
                setMaxPositions();
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
    const zoomed = zoomedGroup != null;
    contentEl.classList.toggle('zoomed', zoomed);
    if (zoomed) {
        renderZoomed(curGroups);
    } else {
        renderGroups(curGroups);
    }
}


function isAttack(power, groupPower=Infinity) {
    return settings.detectAttacks &&
        (power > 650 || (power > 400 && power > groupPower * 2));
}


function fmtLine(html, classes='', title='') {
    return `<div class="line ${classes}" title="${title}">${html}</div>`;
}


function renderZoomed(groups) {
    if (!groups) {
        return;
    }
    const groupCenterIdx = groups.findIndex(x => x.watching);
    let group;
    let selectedBy;
    if (settings.zoomPriority === 'position') {
        if (zoomedGroup.position != null) {
            const idx = Math.max(0, Math.min(groupCenterIdx + zoomedGroup.position, groups.length - 1));
            group = groups[idx];
            selectedBy = 'position';
        }
    } else {
        if (zoomedGroup.id != null) {
            group = groups.find(x => x.id === zoomedGroup.id);
            if (group) {
                selectedBy = 'id';
            }
        }
        if (!group && zoomedGroup.athleteId != null) {
            group = groups.find(x => x.athletes.some(xx => xx.athleteId === zoomedGroup.athleteId));
            if (group) {
                selectedBy = 'athlete';
            }
        }
        if (!group && zoomedGroup.position != null) {
            const idx = Math.max(0, Math.min(groupCenterIdx + zoomedGroup.position, groups.length - 1));
            group = groups[idx];
            if (group) {
                selectedBy = 'position';
            }
        }
    }
    if (!group) {
        console.warn("Group not found: fallback to watching group");
        group = groups[groupCenterIdx];
        selectedBy = 'position';
    }
    const position = groups.indexOf(group) - groupCenterIdx;
    const groupSize = group.athletes.length;
    const athleteCenterIdx = position === 0 ?
        group.athletes.findIndex(x => x.watching) :
        zoomedGroup.athleteId != null ?
            group.athletes.findIndex(x => x.athleteId === zoomedGroup.athleteId) :
            0;
    const ahead = Math.max(0, athleteCenterIdx - Math.ceil(settings.maxZoomed / 2));
    const end = Math.min(group.athletes.length, ahead + settings.maxZoomed);
    const behind = group.athletes.length - end;
    const athletes = group.athletes.slice(ahead, end);
    contentEl.style.setProperty('--total-athletes', athletes.length);  // visual only
    const athletesLabel = groupSize === 1 ? 'Athlete' : 'Athletes';
    let groupLabel;
    if (selectedBy === 'position') {
        groupLabel = position ?
            `${H.place(Math.abs(position), {suffix: true})} Group ${position > 0 ? 'behind' : 'ahead'}` :
            'Your Group';
    } else if (selectedBy === 'athlete') {
        const a = group.athletes.find(x => x.athleteId === zoomedGroup.athleteId);
        if (a?.athlete) {
            groupLabel = `Group of ${a.athlete.fLast}`;
        } else {
            groupLabel = `Group of <${a.athleteId}>`;
        }
    } else if (selectedBy === 'id') {
        groupLabel = `Group ID: ${zoomedGroup.id}`;
    } else {
        console.error("Internal group label error");
        groupLabel = `Unknown Group`;
    }
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.zoomedPrimaryField || 'power'];
    common.softInnerHTML(metaEl, [groupLabel,
        `${groupSize} ${athletesLabel}`,
        `${primaryFmt(group)}, ${spdFmt(group.speed)}`,
    ].map(x => `<div class="line">${x}</div>`).join(''));
    const active = new Set();
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
        pos.bubble.href = `profile.html?id=${athlete.athleteId}&windowType=profile`;
        pos.el.classList.toggle('watching', !!athlete.watching);
        pos.el.style.setProperty('--athletes', 1);
        let label;
        let avatar = 'images/blankavatar.png';
        let fLast;
        let team;
        if (athlete.athlete) {
            const a = athlete.athlete;
            team = a.team;  // lol
            fLast = a.fLast;
            if (a.avatar) {
                avatar = a.avatar;
            } else {
                label = a.initials;
            }
        }
        const unusedLabels = pos.subgroupsInUse || new Set();
        if (eventSubgroup) {
            const sg = getSubgroupLazy(athlete.state.eventSubgroupId);
            const sgLabel = sg && sg.subgroupLabel;
            if (sgLabel) {
                pos.bubbleHolder.style.setProperty(`--subgroup-${sgLabel}`, 1);
                unusedLabels.delete(sgLabel);
            }
            pos.subgroupsInUse = new Set(sgLabel ? [sgLabel] : []);
            pos.bubbleHolder.classList.toggle('subgroup-wheel', !!sgLabel);
        } else {
            if (pos.subgroupsInUse) {
                pos.subgroupsInUse.clear();
            } else {
                pos.subgroupsInUse = new Set();
            }
            pos.bubbleHolder.classList.remove('subgroup-wheel');
        }
        for (const x of unusedLabels) {
            pos.bubbleHolder.style.removeProperty(`--subgroup-${x}`);
        }
        common.softInnerHTML(pos.bubble, label || `<img src="${avatar}"/>`);
        const leftLines = [];
        const attacking = isAttack(athlete.state.power, group.power);
        pos.el.classList.toggle('attn', attacking);
        if (attacking) {
            leftLines.push(fmtLine('Attack!', 'major attn'));
        } else {
            if (fLast) {
                leftLines.push(fmtLine(fLast, 'minor', fLast));
                if (team) {
                    leftLines.push(common.teamBadge(team));
                }
            }
        }
        const priLine = primaryFmt({
            power: athlete.state.power,
            weight: athlete.athlete && athlete.athlete.weight
        });
        const rightLines = [fmtLine(priLine)];
        const minorField = settings.zoomedSecondaryField || 'heartrate';
        if (minorField === 'heartrate') {
            if (athlete.state.heartrate) {
                rightLines.push(fmtLine(
                    H.number(athlete.state.heartrate, {suffix: 'bpm', html: true}),
                    'minor'));
            }
        } else if (minorField === 'draft') {
            if (athlete.state.draft != null) {
                rightLines.push(fmtLine(
                    H.number(athlete.state.draft, {suffix: 'w <ms large>air</ms>', html: true}),
                    'minor', 'Draft'));
            }
        } else if (minorField === 'speed') {
            if (athlete.state.speed != null) {
                rightLines.push(fmtLine(
                    H.pace(athlete.state.speed, {precision: 0, suffix: true, html: true}),
                    'minor'));
            }
        } else if (minorField === 'power-60s') {
            const p = athlete.stats.power.smooth[60];
            if (p != null) {
                rightLines.push(fmtLine(pwrFmt(p), 'minor', '60s smoothed power'));
            }
        }
        const gap = next ? Math.abs(next.gap - athlete.gap) : 0;
        let gapLine = '';
        if (gap) {
            let dur;
            if (settings.zoomedGapField === 'time') {
                dur = gap > 0.5 && (H.number(gap) + 's');
            } else {
                const gapDistance = Math.abs(next.gapDistance - athlete.gapDistance);
                const units = common.imperialUnits ? 'ft' : 'm';
                dur = gapDistance && gapDistance > 2 &&
                    (H.number(gapDistance * (common.imperialUnits ? 3.28084 : 1)) + units);
            }
            if (dur) {
                gapLine = fmtLine(dur);
            }
        }
        common.softInnerHTML(pos.leftLines, leftLines.join(''));
        common.softInnerHTML(pos.rightLines, rightLines.join(''));
        common.softInnerHTML(pos.gap.lines, gapLine);
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        pos.gap.desc.classList.toggle('empty', !gapLine);
        pos.gap.el.style.setProperty('--inner-gap', gap);
        pos.gap.el.style.setProperty('--outer-gap', gap);
        pos.gap.el.style.setProperty('--gap-sign', -1);
        pos.actions.watch.classList.toggle('hidden', !!athlete.watching);
        if (!athlete.watching) {
            pos.watchTarget = athlete.athleteId;
        }
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
    }
}


function getSubgroupDistro(group) {
    const sgLabels = new Map();
    let total = 0;
    for (const x of group.athletes) {
        const sg = getSubgroupLazy(x.state.eventSubgroupId);
        const label = sg && sg.subgroupLabel;
        if (label) {
            const c = sgLabels.get(label) || 0;
            sgLabels.set(label, c + 1);
            total++;
        }
    }
    return new Map(Array.from(sgLabels).map(([k, v]) => [k, v / total]));
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
    const primaryFmt = {
        power: ({power}) => pwrFmt(power),
        wkg: ({power, weight}) => weight ? wkgFmt(power / weight) : pwrFmt(power),
    }[settings.groupsPrimaryField || 'power'];
    const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
    contentEl.style.setProperty('--total-athletes', totAthletes);
    const athletesLabel = totAthletes === 1 ? 'Athlete' : 'Athletes';
    common.softInnerHTML(metaEl, fmtLine(`${totAthletes} ${athletesLabel}`));
    const active = new Set();
    if (ahead) {
        aheadEl.textContent = `+${ahead} ahead`;
    }
    if (behind) {
        behindEl.textContent = `+${behind} behind`;
    }
    aheadEl.classList.toggle('visible', !!ahead);
    behindEl.classList.toggle('visible', !!behind);
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
        const unusedLabels = pos.subgroupsInUse || new Set();
        if (eventSubgroup) {
            const labels = getSubgroupDistro(group);
            for (const [label, pct] of labels.entries()) {
                pos.bubbleHolder.style.setProperty(`--subgroup-${label}`, pct.toFixed(6));
                unusedLabels.delete(label);
            }
            pos.subgroupsInUse = new Set(labels.keys());
            pos.bubbleHolder.classList.toggle('subgroup-wheel', labels.size > 0);
        } else {
            if (pos.subgroupsInUse) {
                pos.subgroupsInUse.clear();
            } else {
                pos.subgroupsInUse = new Set();
            }
            pos.bubbleHolder.classList.remove('subgroup-wheel');
        }
        for (const x of unusedLabels) {
            pos.bubbleHolder.style.removeProperty(`--subgroup-${x}`);
        }
        let label;
        let attacking = false;
        const leftLines = [];
        const rightLines = [];
        if (group.athletes.length === 1 && group.athletes[0].athlete) {
            label = group.athletes[0].athlete.initials || '1';
            attacking = isAttack(group.power);
            if (attacking) {
                const weight = group.athletes[0].athlete.weight;
                leftLines.push(fmtLine('Attack!', 'attn'));
                leftLines.push(fmtLine(primaryFmt({power: group.power, weight}), 'minor attn'));
            }
        } else {
            label = H.number(group.athletes.length);
            let max = -Infinity;
            let weight;
            for (const x of group.athletes) {
                const p = x.stats.power.smooth[5];
                if (p > max) {
                    max = p;
                    weight = x.athlete && x.athlete.weight;
                }
            }
            attacking = isAttack(max, group.power);
            if (attacking) {
                leftLines.push(fmtLine('Attack!', 'attn'));
                leftLines.push(fmtLine(primaryFmt({power: max, weight}), 'minor attn'));
            }
        }
        pos.el.classList.toggle('attn', attacking);
        common.softInnerHTML(pos.bubble, label);
        rightLines.push(fmtLine(primaryFmt(group), '', 'Group average'));
        const minorField = settings.groupsSecondaryField || 'speed';
        if (minorField === 'heartrate') {
            if (group.heartrate) {
                rightLines.push(fmtLine(H.number(group.heartrate, {suffix: 'bpm', html: true}), 'minor'));
            }
        } else if (minorField === 'draft') {
            if (group.draft != null) {
                rightLines.push(fmtLine(
                    H.number(group.draft, {suffix: 'w <ms large>air</ms>', html: true}),
                    'minor', 'Draft'));
            }
        } else if (minorField === 'speed') {
            if (group.speed != null) {
                rightLines.push(fmtLine(
                    H.pace(group.speed, {precision: 0, suffix: true, html: true}),
                    'minor'));
            }
        } else if (group.athletes.length > 1 || settings.groupsPrimaryField !== 'power') {
            if (minorField === 'power-highest') {
                const highest = sauce.data.max(group.athletes.map(x => x.state.power));
                if (highest != null) {
                    rightLines.push(fmtLine(
                        pwrFmt(highest, {suffix: '!'}),
                        'minor', 'Highest individual power'));
                }
            } else if (minorField === 'power-median') {
                const med = sauce.data.median(group.athletes.map(x => x.state.power));
                if (med != null) {
                    rightLines.push(fmtLine(pwrFmt(med, {suffix: 'M'}), 'minor', 'Median group power'));
                }
            }
        }
        const innerGap = next ? group.innerGap : 0;
        const gap = relPos < 0 ? group.gap : next ? next.gap : 0;
        const dur = innerGap && H.duration(Math.abs(gap), {short: true, separator: ' '});
        const gapText = dur ? (gap > 0 ? '+' : '-') + dur : '';
        const gapLines = [];
        if (gapText) {
            gapLines.push(fmtLine(gapText));
            if (next && next.isGapEst) {
                gapLines.push(fmtLine('(est)', 'minor', 'est'));
            }
        }
        common.softInnerHTML(pos.leftLines, leftLines.join(''));
        common.softInnerHTML(pos.rightLines, rightLines.join(''));
        common.softInnerHTML(pos.gap.lines, gapLines.join(''));
        pos.leftDesc.classList.toggle('empty', !leftLines.length);
        pos.rightDesc.classList.toggle('empty', !rightLines.length);
        pos.gap.desc.classList.toggle('empty', !gapLines.length);
        pos.gap.el.style.setProperty('--inner-gap', innerGap);
        pos.gap.el.style.setProperty('--outer-gap', Math.abs(gap));
        pos.gap.el.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
        pos.gap.el.classList.toggle('alone', !innerGap);
        pos.actions.watch.classList.toggle('hidden', !!group.watching);
        pos.el.classList.toggle('pack-position', !!group.watching && group.athletes.length > 1);
        if (group.watching) {
            if (group.athletes.length > 1) {
                const wIdx = group.athletes.findIndex(x => x.watching);
                pos.el.style.setProperty('--pack-position', (wIdx / (group.athletes.length - 1)).toFixed(6));
            }
        } else {
            pos.watchTarget = group.athletes[Math.trunc(group.athletes.length / 2)].athleteId;
        }
    }
    for (const [i, {el}] of positions.entries()) {
        el.classList.toggle('hidden', !active.has(i));
    }
}


function setStyles() {
    common.setBackground(settings);
    if (settings.horizMode != null) {
        doc.classList.toggle('horizontal', settings.horizMode);
        if (settings.horizLTR != null) {
            doc.classList.toggle('horizontal-ltr', settings.horizLTR);
        }
    }
    if (settings.hideHeader != null) {
        doc.classList.toggle('hide-header', settings.hideHeader);
    }
    if (settings.labelAngle != null) {
        doc.style.setProperty('--label-angle', settings.labelAngle);
    }
    setMaxPositions();
}


export async function main() {
    common.initInteractionListeners();
    setStyles();
    contentEl = document.querySelector('#content');
    metaEl = document.querySelector('#meta');
    containerEl = document.querySelector('#container');
    aheadEl = document.querySelector('#ahead');
    behindEl = document.querySelector('#behind');
    contentEl.querySelector('.zoom-out').addEventListener('click', ev => {
        zoomedGroup = null;
        common.storage.set('zoomedGroup', zoomedGroup);
        setMaxPositions();
        render();
    });
    common.settingsStore.addEventListener('set', ev => {
        setStyles();
        render();
    });
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        common.subscribe('status',
                         status => doc.classList.toggle('game-connection', status.connected),
                         {source: 'gameConnection', persistent: true});
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
            eventSubgroup = groups.find(x => x.watching)
                ?.athletes.find(x => x.watching)
                ?.state.eventSubgroupId;
            render();
        }
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
