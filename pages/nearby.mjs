import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;


async function main() {
    common.initInteractionListeners();
    const tbody = document.querySelector('#content table tbody');
    common.subscribe('nearby', nearby => {
        if (!nearby.length) {
            return;
        }
        nearby.sort((a, b) => a.athleteId - b.athleteId);
        const num = H.number;
        tbody.innerHTML = nearby.map(x => [
            x.athleteId, x.power, num(x.stats.power5s), num(x.stats.power30s),
            num(x.stats.powerAvg), num(x.stats.powerNP), x.stats.powerMax,
            num(x.stats.peakPower5s.avg), num(x.stats.peakPower30s.avg)
        ].map(x => `<td>${x}</td>`).join('')).map(x => `<tr>${x}</tr>`).join('');
    });
}

addEventListener('DOMContentLoaded', () => main());
