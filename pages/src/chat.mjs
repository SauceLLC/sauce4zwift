import * as Sauce from '../../shared/sauce/index.mjs';
import * as Common from './common.mjs';

Common.enableSentry();

const H = Sauce.locale.human;
const doc = document.documentElement;
const settings = Common.settingsStore.get(null, {
    cleanup: 120,
    solidBackground: false,
    reverseOrder: false,
    rightAlign: false,
    backgroundColor: '#00ff00',
    messageTransparency: 30,
});
const athleteChatElements = new Map();


function getTime() {
    const ts = Common.getRealTime();
    return (ts instanceof Promise) ? Date.now() : ts;
}


setInterval(() => {
    for (const els of athleteChatElements.values()) {
        for (const el of els) {
            const age = fmtAge(Number(el.dataset.ts));
            if (el._lastAge !== age) {
                el.querySelector('.header .age').innerHTML = age;
                el._lastAge = age;
            }
        }
    }
}, 5000);


function athleteHue(id) {
    return id % 360;
}


function fmtAge(ts) {
    const now = getTime();
    const age = (now - ts) / 1000 | 0;
    if (age < 15) {
        return 'now';
    }
    return H.relTime(ts, {short: true, maxParts: 1, html: true});
}


function fmtGap(gap) {
    const d = H.duration(Math.abs(gap), {short: true, separator: ' ', html: true});
    const placement = gap > 0 ? 'behind' : 'ahead';
    return `${d} <abbr class="unit">${placement}</abbr>`;
}


function handleAthleteData(data) {
    const liveHtml = liveDataFormatter(data);
    for (const el of athleteChatElements.get(data.athleteId)) {
        if (el._lastLiveHtml !== liveHtml) {
            el.querySelector('.live').innerHTML = liveHtml;
            el._lastLiveHtml = liveHtml;
        }
    }
}


function liveDataFormatter(data) {
    if (!data) {
        return '';
    }
    const items = [
        data.stats.power.smooth[15] != null ?
            H.power(data.stats.power.smooth[15], {suffix: true, html: true}) :
            null,
        data.state.heartrate ? H.number(data.state.heartrate, {suffix: 'bpm', html: true}) : null,
    ];
    const gap = data.watching ? null : data.gap;
    if (gap != null) {
        items.push(fmtGap(gap));
    }
    return items.filter(x => x != null).join(', ');
}


function setMsgOpacity() {
    const {messageTransparency} = settings;
    const opacity = messageTransparency == null ? 0.7 : 1 - (messageTransparency / 100);
    doc.style.setProperty('--message-background-opacity', opacity);
}


export async function main() {
    Common.initInteractionListeners();
    const content = document.querySelector('#content');
    const fadeoutTime = 5;
    content.style.setProperty('--fadeout-time', `${fadeoutTime}s`);
    content.classList.toggle('reverse-order', settings.reverseOrder === true);
    content.classList.toggle('right-align', settings.rightAlign === true);
    Common.setBackground(settings);
    setMsgOpacity();
    Common.getRealTime();  // prime, bg okay

    Common.settingsStore.addEventListener('set', ev => {
        Common.setBackground(settings);
        setMsgOpacity();
        content.classList.toggle('reverse-order', settings.reverseOrder === true);
        content.classList.toggle('right-align', settings.rightAlign === true);
        for (const el of document.querySelectorAll('.entry')) {
            if (el._resetCleanup) {
                el._resetCleanup();
            }
        }
    });


    function getLastEntry() {
        const entries = content.querySelectorAll(':scope > .entry');
        return entries[entries.length - 1];
    }


    function addContentEntry(chat, el, age, options={}) {
        const athleteId = chat.from;
        content.appendChild(el);
        if (!options.skipAnimation) {
            void el.offsetLeft; // force layout/reflow so we can trigger animation.
        }
        el.classList.add('slidein');
        let chatEls;
        if (!chat.muted) {
            if (!athleteChatElements.has(athleteId)) {
                athleteChatElements.set(athleteId, new Set());
            }
            chatEls = athleteChatElements.get(athleteId);
            if (!chatEls.size) {
                Common.subscribe(`athlete/${athleteId}`, handleAthleteData);
            }
            chatEls.add(el);
        }
        let to;
        el._resetCleanup = () => {
            clearTimeout(to);
            to = settings.cleanup ? setTimeout(() => {
                el.classList.add('fadeout');
                el._resetCleanup = null;
                if (chatEls) {
                    chatEls.delete(el);
                    if (!chatEls.size) {
                        Common.unsubscribe(`athlete/${athleteId}`, handleAthleteData);
                    }
                }
                setTimeout(() => el.remove(), fadeoutTime * 1000);
            }, (settings.cleanup - (age || 0)) * 1000) : null;
        };
        el._resetCleanup();
    }


    function onChatMessage(chat, age, options) {
        const lastEntry = getLastEntry();
        if (lastEntry && Number(lastEntry.dataset.from) === chat.from &&
            !lastEntry.classList.contains('fadeout')) {
            lastEntry.dataset.ts = chat.ts;
            if (!chat.muted) {
                const chunk = document.createElement('div');
                chunk.classList.add('chunk');
                chunk.textContent = chat.message;
                lastEntry.querySelector('.message').appendChild(chunk);
                if (lastEntry._resetCleanup) {
                    lastEntry._resetCleanup();
                }
            }
            return lastEntry;
        }
        const entry = document.createElement('div');
        entry.dataset.from = chat.from;
        entry.dataset.ts = chat.ts;
        entry.classList.add('entry');
        if (chat.to) {
            entry.classList.add('private');
        } else {
            entry.classList.add('public');
        }
        if (!chat.muted) {
            const name = [chat.firstName, chat.lastName].filter(x => x).join(' ');
            entry.style.setProperty('--message-hue', athleteHue(chat.from) + 'deg');
            entry.innerHTML = `
                <a href="profile.html?id=${chat.from}&windowType=profile"
                   target="profile_popup_${chat.from}"
                   class="avatar"><img src="${chat.avatar || 'images/blankavatar.png'}"/></a>
                <div class="content">
                    <div class="header">
                        <div class="name">${Common.sanitize(name)}</div>
                        ${Common.teamBadge(chat.team)}
                        <span class="age">${fmtAge(chat.ts)}</span>
                    </div>
                    <div class="live"></div>
                    <div class="message">
                        <div class="chunk">${Common.sanitize(chat.message)}</div>
                    </div>
                </div>
            `;
        } else {
            const name = [chat.firstName, chat.lastName].filter(x => x).join('');
            entry.classList.add('muted');
            entry.innerHTML = `<div class="content">Muted message from: ${Common.sanitize(name)}</div>`;
        }
        entry.addEventListener('dblclick', async () => {
            await Common.rpc.watch(chat.from);
        });
        addContentEntry(chat, entry, age, options);
        return entry;
    }

    let mostRecent;
    for (const x of (await Common.rpc.getChatHistory()).reverse()) {
        const age = (getTime() - x.ts) / 1000;
        if (settings.cleanup && age > settings.cleanup) {
            continue;
        }
        mostRecent = onChatMessage(x, age, {skipAnimation: true});
    }
    if (mostRecent) {
        mostRecent.scrollIntoView();
    }
    Common.subscribe('chat', onChatMessage, {persistent: true});

    if (window.location.search.includes('test')) {
        const wordsURL = 'https://raw.githubusercontent.com/mayfield/mad-libs-json/master/words.json';
        const w = await (await fetch(wordsURL)).json();
        const _ = arr => arr[Math.floor(Math.random() * arr.length)];
        const phrases = [
            () => `I ${_(w.verbPast)} through a ${_(w.noun)} in the ${_(w.noun)} and found ` +
                `${_(w.number)} ${_(w.nounPlural)}.`,
            () => `${_(w.nameM)} is a ${_(w.adv)} ${_(w.adj)} ${_(w.noun)}.`,
            () => `My ${_(w.animal)} wants to ${_(w.adv)} ${_(w.verb)} in ${_(w.place)}.`,
        ];
        const teams = ['EF', 'Trek', 'Postal', 'Mapei', 'CSC', 'Festina', 'CCC', 'Visma'];
        const athleteDatas = new Map();
        await Sauce.sleep(2000);
        setInterval(() => {
            for (const x of athleteDatas.values()) {
                x.stats.power.smooth[15] = 100 + Math.random() * 300;
                x.state.heartrate = 130 + Math.random() * 20;
                handleAthleteData(x);
            }
        }, 1000);
        for (let i = 1; i < 100; i++) {
            const id = Math.random() * 1e7 | 0;
            const randAvatarId = window.crypto.randomUUID().split('-')[0];
            if (!athleteDatas.has(id)) {
                athleteDatas.set(id, {
                    athleteId: id,
                    gap: Math.random() * 20 - 5,
                    state: {heartrate: 67},
                    stats: {power: {smooth: {15: Math.random() * 400}}}
                });
            }
            onChatMessage({
                firstName: _([...w.nameF, ...w.nameM]),
                lastName: _(w.pokemon),
                message: _(phrases)(),
                from: id,
                team: teams[Math.random() * teams.length * 1.5 | 0],
                to: 0,
                ts: getTime(),
                avatar: `https://gravatar.com/avatar/${randAvatarId}?s=200&d=monsterid&r=pg`
            });
            handleAthleteData(athleteDatas.get(id));
            await Sauce.sleep(1000 * i * 2);
        }
    }
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('form')();
}
