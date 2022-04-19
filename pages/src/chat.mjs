import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const nearby = new Map();
const settingsKey = 'chat-settings-v2';


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
    const state = nearby.get(athlete);
    if (!state) {
        return '';
    }
    const items = [
        state.stats.power.smooth[15] != null ? Math.round(state.stats.power.smooth[15]).toLocaleString() + 'w' : null,
        state.heartrate ? state.heartrate.toLocaleString() + 'bpm' : null,
    ];
    const gap = state.gap;
    if (gap != null) {
        items.push(humanDuration(Math.abs(gap)) + (gap > 0 ? ' behind' : ' ahead'));
    }
    return items.filter(x => x != null).join(', ');
}


function setBackground({solidBackground, backgroundColor}) {
    const doc = document.documentElement;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    common.initInteractionListeners({settingsKey});
    const content = document.querySelector('#content');
    liveDataTask(content);  // bg okay
    let settings = common.storage.get(settingsKey, {
        cleanup: 120,
        solidBackground: false,
        backgroundColor: '#00ff00',
    });
    const fadeoutTime = 5;
    content.style.setProperty('--fadeout-time', `${fadeoutTime}s`);
    if (settings.cleanup) {
        content.style.setProperty('--cleanup-time', `${settings.cleanup}s`);
    }
    setBackground(settings);
    document.addEventListener('settings-updated', ev => {
        settings = ev.data;
        if (settings.cleanup) {
            content.style.setProperty('--cleanup-time', `${settings.cleanup}s`);
        } else {
            content.style.removeProperty('--cleanup-time');
        }
        setBackground(settings);
        for (const el of document.querySelectorAll('.entry')) {
            el._resetCleanup();
        }
    });


    function getLastEntry() {
        const entries = content.querySelectorAll(':scope > .entry');
        return entries[entries.length - 1];
    }


    function addContentEntry(el) {
        content.appendChild(el);
        void el.offsetLeft; // force layout/reflow so we can trigger animation.
        el.classList.add('slidein');
        let to;
        el._resetCleanup = () => {
            clearTimeout(to);
            el.classList.remove('fadeout');
            void el.offsetLeft; // force layout/reflow so we can trigger animation.
            if (settings.cleanup) {
                el.classList.add('fadeout');
                to = setTimeout(() => el.remove(), (fadeoutTime + settings.cleanup) * 1000);
            }
        };
        el._resetCleanup();
    }


    function onChatMessage(chat) {
        const lastEntry = getLastEntry();
        if (lastEntry && Number(lastEntry.dataset.from) === chat.from) {
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
        entry.style.setProperty('--message-hue', athleteHue(chat.from) + 'deg');
        entry.innerHTML = `
            <a href="${chat.avatar}" target="_blank" class="avatar"><img src="${chat.avatar || 'images/blankavatar.png'}"/></a>
            <div class="content">
                <div class="header"><span class="name"></span></div>
                <div class="live">${liveDataFormatter(chat.from)}</div>
                <div class="message"><div class="chunk"></div></div>
            </div>
        `;
        const name = [chat.firstName, chat.lastName].filter(x => x).join(' ');
        // Sanitize with `textContent`.  Don't use ^^^ string interpolation.
        entry.querySelector('.name').textContent = name;
        entry.querySelector('.message .chunk').textContent = chat.message;
        addContentEntry(entry);
    }

    common.subscribe('nearby', data => {
        for (const x of data) {
            nearby.set(x.athleteId, x);
        }
    });
    common.subscribe('chat', onChatMessage);

    if (location.search.includes('testing')) {
        for (let i = 1; i < 100; i++) {
            const from = Array.from(nearby.keys())[Math.floor(Math.random() * nearby.size / 10)] || 0;
            onChatMessage({
                firstName: 'Foo',
                lastName: 'Bar ' + from,
                message: 'I am a teapot short and stout.',
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
    await common.initSettingsForm('form', {settingsKey});
}
