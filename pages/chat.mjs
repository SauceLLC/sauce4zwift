
import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

const nearby = new Map();


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
        state.stats.power30s != null ? Math.round(state.stats.power30s).toLocaleString() + 'w' : null,
        state.heartrate ? state.heartrate.toLocaleString() + 'bpm' : null,
    ];
    const gap = state.gap;
    if (gap != null) {
        items.push(humanDuration(Math.abs(gap)) + (gap > 0 ? ' behind' : ' ahead'));
    }
    return items.filter(x => x != null).join(', ');
}


async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    liveDataTask(content);  // bg okay


    function getLastEntry() {
        const entries = content.querySelectorAll(':scope > .entry');
        return entries[entries.length - 1];
    }


    function addContentEntry(el) {
        content.appendChild(el);
        const fadeoutTime = 5;
        const cleanupTime = 1200000;
        el.style.setProperty('--fadeout-time', `${fadeoutTime}s`);
        el.style.setProperty('--cleanup-time', `${cleanupTime}s`);
        void el.offsetLeft; // force layout/reflow so we can trigger animation.
        el.classList.add('fadeout', 'slidein');
        let to;
        el._resetCleanup = () => {
            clearTimeout(to);
            to = setTimeout(() => el.remove(), (fadeoutTime + cleanupTime) * 1000);
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
            lastEntry._resetCleanup();
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

    // TESTING
    for (let i = 1; i < 100; i++) {
        //const from = Array.from(nearby.keys())[0] || 0; // [Math.floor(Math.random() * nearby.size / 2)] || 0;
        const from = Array.from(nearby.keys())[Math.floor(Math.random() * nearby.size / 10)] || 0;
        onChatMessage({
            firstName: 'Foo',
            lastName: 'Bar ' + from,
            message: Array.from(Array(i)).map(() => 'I am a teapot short and stout.').join('\n'),
            from,
            to: 0,
            avatar: 'images/blankavatar.png',
        });
        await sauce.sleep(1000 * i);
        //await sauce.sleep(200);
    }
}

addEventListener('DOMContentLoaded', () => main());
