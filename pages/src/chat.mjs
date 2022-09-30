import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const doc = document.documentElement;
const nearby = new Map();
const settings = common.settingsStore.get(null, {
    cleanup: 120,
    solidBackground: false,
    backgroundColor: '#00ff00',
});

const idleCallback = window.requestIdleCallback || (cb => setTimeout(cb, 0));

// GC for nearby data...
setInterval(() => {
    idleCallback(() => {
        const now = Date.now();
        let i = 0;
        for (const [k, {ts}] of nearby.entries()) {
            if (now - ts > 300 * 1000) {
                i++;
                nearby.delete(k);
            }
        }
        if (i) {
            console.debug(`Garbage collected ${i} nearby entries`);
        }
    });
}, 3000);


function athleteHue(id) {
    return id % 360;
}


async function liveDataTask(content) {
    while (true) {
        for (const x of content.querySelectorAll('.live')) {
            const athlete = x.closest('[data-from]').dataset.from;
            x.innerText = liveDataFormatter(Number(athlete));
        }
        await sauce.sleep(1000);
    }
}


function humanDuration(t) {
    return sauce.locale.human.duration(t, {short: true, seperator: ' '});
}


function liveDataFormatter(athlete) {
    const data = nearby.get(athlete);
    if (!data) {
        return '';
    }
    const items = [
        data.stats.power.smooth[15] != null ? Math.round(data.stats.power.smooth[15]).toLocaleString() + 'w' : null,
        data.state.heartrate ? data.state.heartrate.toLocaleString() + 'bpm' : null,
    ];
    const gap = data.gap;
    if (gap != null) {
        items.push(humanDuration(Math.abs(gap)) + (gap > 0 ? ' behind' : ' ahead'));
    }
    return items.filter(x => x != null).join(', ');
}


function setBackground() {
    const {solidBackground, backgroundColor} = settings;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    liveDataTask(content);  // bg okay
    const fadeoutTime = 5;
    content.style.setProperty('--fadeout-time', `${fadeoutTime}s`);
    setBackground();
    common.settingsStore.addEventListener('changed', ev => {
        setBackground();
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


    function addContentEntry(el, age) {
        content.appendChild(el);
        void el.offsetLeft; // force layout/reflow so we can trigger animation.
        el.classList.add('slidein');
        if (settings.cleanup) {
            let to;
            el._resetCleanup = () => {
                clearTimeout(to);
                to = setTimeout(() => {
                    el.classList.add('fadeout');
                    setTimeout(() => el.remove(), fadeoutTime * 1000);
                }, (settings.cleanup - (age || 0)) * 1000);
            };
            el._resetCleanup();
        }
    }


    function onChatMessage(chat, age) {
        const lastEntry = getLastEntry();
        if (lastEntry && Number(lastEntry.dataset.from) === chat.from &&
            !lastEntry.classList.contains('fadeout')) {
            const chunk = document.createElement('div');
            chunk.classList.add('chunk');
            chunk.textContent = chat.message;
            lastEntry.querySelector('.message').appendChild(chunk);
            if (lastEntry._resetCleanup) {
                lastEntry._resetCleanup();
            }
            return;
        }
        const entry = document.createElement('div');
        entry.dataset.from = chat.from;
        entry.classList.add('entry');
        if (chat.to) {
            entry.classList.add('private');
            console.warn("XXX validate it's to us.  I think it must be though.", chat.to);
        } else {
            entry.classList.add('public');
        }
        if (!chat.muted) {
            const name = [chat.firstName, chat.lastName].filter(x => x).join(' ');
            entry.style.setProperty('--message-hue', athleteHue(chat.from) + 'deg');
            entry.innerHTML = `
                <a href="athlete.html?athleteId=${chat.from}&width=800&height=350" target="_blank"
                   class="avatar"><img src="${chat.avatar || 'images/blankavatar.png'}"/></a>
                <div class="content">
                    <div class="header">
                        <div class="name">${common.sanitize(name)}</div>
                        ${common.teamBadge(chat.team)}
                    </div>
                    <div class="live">${liveDataFormatter(chat.from)}</div>
                    <div class="message">
                        <div class="chunk">${common.sanitize(chat.message)}</div>
                    </div>
                </div>
            `;
        } else {
            const initials = [chat.firstName[0].toUpperCase(), chat.lastName[0].toUpperCase()].filter(x => x).join('');
            entry.classList.add('muted');
            entry.innerHTML = `<div class="content">Muted message from ${initials}</div>`;
        }
        entry.addEventListener('dblclick', async () => {
            await common.rpc.watch(chat.from);
        });
        addContentEntry(entry, age);
    }

    common.subscribe('nearby', data => {
        for (const x of data) {
            nearby.set(x.athleteId, x);
        }
    });
    for (const x of (await common.rpc.getChatHistory()).reverse()) {
        const age = (Date.now() - x.ts) / 1000;
        if (settings.cleanup && age > settings.cleanup) {
            continue;
        }
        onChatMessage(x, age);
    }
    common.subscribe('chat', onChatMessage, {persistent: true});

    if (location.search.includes('test')) {
        const wordsURL = 'https://raw.githubusercontent.com/mayfield/mad-libs-json/master/words.json';
        const w = await (await fetch(wordsURL)).json();
        const _ = arr => arr[Math.floor(Math.random() * arr.length)];
        const phrases = [
            () => `I ${_(w.verbPast)} through a ${_(w.noun)} in the ${_(w.noun)} and found ${_(w.number)} ${_(w.nounPlural)}.`,
            () => `${_(w.celebrityM)} is a ${_(w.adv)} ${_(w.adj)} ${_(w.noun)}.`,
            () => `My ${_(w.bodyPart)} has ${_(w.verbPast)} to ${_(w.place)}.`,
        ];
        for (let i = 1; i < 100; i++) {
            const from = Array.from(nearby.keys())[Math.floor(Math.random() * nearby.size / 10)] || 0;
            onChatMessage({
                firstName: _([...w.celebrityF, ...w.celebrityM]),
                lastName: '',
                message: _(phrases)(),
                from,
                to: 0,
                avatar: 'images/blankavatar.png',
            });
            await sauce.sleep(1000 * i);
        }
    }
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
