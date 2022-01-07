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
        nearby.sort((a, b) => a.watching ? -1 : 0);
        const num = H.number;
        tbody.innerHTML = nearby.map(x => [
            x.athleteId, x.power, num(x.stats.power.smooth['5']), num(x.stats.power.smooth['30']),
            num(x.stats.power.avg), num(x.stats.power.np), x.stats.power.max,
            num(x.stats.power.peaks[5].avg),
            num(x.stats.power.peaks[30].avg),
            num(x.speed), num(x.stats.speed.avg), num(x.stats.speed.smooth[30]), num(x.stats.speed.peaks[30].avg),
            num(x.heartrate), num(x.stats.hr.avg), num(x.stats.hr.smooth[30]), num(x.stats.hr.peaks[30].avg),
        ].map(x => `<td>${x}</td>`).join('')).map(x => `<tr>${x}</tr>`).join('');
    });
}

addEventListener('DOMContentLoaded', () => main());
