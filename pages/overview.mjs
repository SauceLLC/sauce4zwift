/* global sauce */

import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;


function shortDuration(x) {
    return H.duration(x, {short: true});
}


async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {fps: 1});
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
            value: x => H.number(x.rideons),
            key: () => 'Ride Ons',
        }, {
            value: x => H.number(x.kj),
            key: () => 'Energy',
            unit: () => 'kJ',
        }, {
            value: x => H.number(x.speed), // XXX need backend support
            key: () => 'Speed <small>(avg)</small>',
            unit: () => 'kph',
        }, {
            value: x => H.number(x.stats.powerMax),
            key: () => 'Power <small>(max)</small>',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.powerAvg),
            key: () => 'Power <small>(avg)</small>',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.powerNP),
            key: () => 'NP',
        }, {
            value: x => H.number(x.stats.power5s),
            key: () => `Power <small>(${shortDuration(5)})</small>`,
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power30s),
            key: () => `Power <small>(${shortDuration(30)})</small>`,
            unit: () => 'w',
        }],
    });

    content.querySelector('.button.show').addEventListener('click', () => {
        common.electronTrigger('showAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.hide').addEventListener('click', () => {
        common.electronTrigger('hideAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.quit').addEventListener('click', () => {
        common.electronTrigger('quit');
    });
 
    let lastUpdate = 0;
    common.subscribe('watching', watching => {
        renderer.setData(watching);
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            renderer.render();
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
