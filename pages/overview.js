/* global sauce */

const L = sauce.locale;


function shortDuration(x) {
    return L.humanDuration(x, {short: true});
}

async function main() {
    const content = document.querySelector('#content');
    const renderer = new sauce.Renderer(content, {fps: 1});
    renderer.addRotatingFields({
        mapping: [{
            id: 'social',
            default: 0
        }, {
            id: 'energy',
            default: 1
        }, {
            id: 'speed',
            default: 2
        }],
        fields: [{
            value: x => L.humanNumber(x.rideons),
            key: () => 'Ride Ons',
        }, {
            value: x => L.humanNumber(x.kj),
            key: () => 'Energy',
            unit: () => 'kJ',
        }, {
            value: x => L.humanNumber(x.speed), // XXX need backend support
            key: () => 'Speed <small>(avg)</small>',
            unit: () => 'kph',
        }, {
            value: x => L.humanNumber(x.stats.powerMax),
            key: () => 'Power <small>(max)</small>',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerAvg),
            key: () => 'Power <small>(avg)</small>',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerNP),
            key: () => 'NP',
        }, {
            value: x => L.humanNumber(x.stats.power5s),
            key: () => `Power <small>(${shortDuration(5)})</small>`,
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power30s),
            key: () => `Power <small>(${shortDuration(30)})</small>`,
            unit: () => 'w',
        }],
    });

    content.querySelector('.button.show').addEventListener('click', () => {
        sauce.electronTrigger('showAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.hide').addEventListener('click', () => {
        sauce.electronTrigger('hideAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.quit').addEventListener('click', () => {
        sauce.electronTrigger('quit');
    });
 
    let lastUpdate = 0;
    sauce.subscribe('watching', watching => {
        renderer.setData(watching);
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            renderer.render();
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
