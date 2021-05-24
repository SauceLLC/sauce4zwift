
async function main() {
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'nearby') {
            return;
        }
        document.querySelector('#content').innerHTML = JSON.stringify(ev.data.data, null, 2);
    });
}

addEventListener('DOMContentLoaded', () => main());
