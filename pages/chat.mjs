
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
        void el.offsetLeft; // force layout/reflow so we can trigger animation.
        el.addEventListener('transitionend', () => el.remove());
        el.classList.add('fadeout', 'slideout');
    }


    function onChatMessage(chat) {
        const lastEntry = getLastEntry();
        if (lastEntry && Number(lastEntry.dataset.from) === chat.from) {
            lastEntry.classList.remove('fadeout');
            const msg = lastEntry.querySelector('.message');
            msg.textContent += '\n' + chat.message;
            void lastEntry.offsetLeft;  // force reflow
            lastEntry.classList.add('fadeout');
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
                <div class="message"></div>
            </div>
        `;
        const name = [chat.firstName, chat.lastName].filter(x => x).join(' ');
        entry.querySelector('.name').textContent = name;  // sanitize
        entry.querySelector('.message').textContent = chat.message;
        addContentEntry(entry);
    }

    common.subscribe('nearby', data => {
        for (const x of data) {
            nearby.set(x.athleteId, x);
        }
    });
    common.subscribe('chat', onChatMessage);

    // TESTING
    for (let i = 0; i < 0; i++) {
        onChatMessage({
            firstName: 'Foo',
            lastName: 'Bar',
            message: 1000000 * i,
            from: Array.from(nearby.keys())[Math.floor(Math.random() * nearby.size / 10)] || 0,
            to: 0,
            avatar: 'images/blankavatar.png',
        });
        await sauce.sleep(1000 * i);
    }
}

addEventListener('DOMContentLoaded', () => main());
