/* global */


function athleteHue(id) {
    return id % 360;
}


const relTime = new Intl.RelativeTimeFormat();

function makeTimestamp() {
    const el = document.createElement('div');
    el.classList.add('timestamp', 'entry');
    el.innerText = relTime.format(-0, 'minute');
    el.dataset.ts = Date.now();
    return el;
}


async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}


async function monitorTimestamps(content) {
    while (true) {
        const now = Date.now();
        for (const x of content.querySelectorAll('.timestamp[data-ts]')) {
            x.innerText = relTime.format(Math.round((Number(x.dataset.ts) - now) / 60000), 'minute');
        }
        await sleep(15000);
    }
}


async function main() {
    const content = document.querySelector('#content');
    let lastTimestamp = 0;
    monitorTimestamps(content);  // bg okay

    function addContentEntry(el) {
        content.appendChild(el);
        void el.offsetLeft; // force layout/reflow so we can trigger animation.
        el.addEventListener('transitionend', () => el.remove());
        el.classList.add('fadeout');
    }

    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'chat') {
            return;
        }
        const chat = ev.data.data;
        const now = Date.now();
        if (now - lastTimestamp > 60000) {
            addContentEntry(makeTimestamp());
        }
        lastTimestamp = now;
        if (content.lastChild && Number(content.lastChild.dataset.from) === chat.from) {
            content.lastChild.classList.remove('fadeout');
            const msg = content.lastChild.querySelector('.message');
            msg.textContent += '\n' + chat.message;
            void content.lastChild.offsetLeft;  // force reflow
            content.lastChild.classList.add('fadeout');
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
            <div class="avatar"><img src="${chat.avatar || 'images/blankavatar.png'}"/></div>
            <div class="content">
                <div class="name"></div>
                <div class="message"></div>
            </div>
        `;
        entry.querySelector('.name').textContent =
            [chat.firstName, chat.lastName].filter(x => x).join(' ');
        entry.querySelector('.message').textContent = chat.message;
        addContentEntry(entry);
    });
    ///*
    const testing = new Event('message');
    testing.data = {
        event: 'chat',
        source: 'sauce4zwift',
        data: {
            firstName: 'Text',
            lastName: 'Guy',
            message: 'Testing 1 2 3',
            from: 11111,
            to: 0,
            avatar: 'https://i1.sndcdn.com/artworks-000218997483-xdgm10-t500x500.jpg',
        }
    };
    dispatchEvent(testing);
    for (let i = 0; i < 2000; i++) {
        const testing2 = new Event('message');
        testing.data = {
            event: 'chat',
            source: 'sauce4zwift',
            data: {
                firstName: 'Foo',
                lastName: 'Bar',
                message: 1000000 * i,
                from: 1213121 + (Math.random() < 0.1 ? Math.round(360 * Math.random()) : 0),
                to: 0,
                avatar: 'https://i1.sndcdn.com/artworks-000218997483-xdgm10-t500x500.jpg',
            }
        };
        dispatchEvent(testing);
        await sleep(100 * i);
    }//*/
}

addEventListener('DOMContentLoaded', () => main());
