import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as locale from '../../shared/sauce/locale.mjs';

const H = locale.human;
const smallSpace = '\u0020';
let sport = 'cycling';


export function setSport(s) {
    sport = s;
}


export const streamFields = {
    power: {
        id: 'power',
        name: 'Power',
        color: '#46f',
        domain: [0, 700],
        domainAlpha: [0.4, 1],
        get: x => x.state.power || 0,
        fmt: (x, options) => H.power(x, {separator: smallSpace, suffix: true, ...options}),
    },
    hr: {
        id: 'hr',
        name: 'HR',
        color: '#e22',
        domain: [70, 190],
        domainAlpha: [0.1, 0.7],
        get: x => x.state.heartrate || 0,
        fmt: (x, options) => H.number(x, {separator: smallSpace, suffix: 'bpm', ...options}),
    },
    speed: {
        id: 'speed',
        name: () => sport === 'running' ? 'Pace' : 'Speed',
        color: '#4e3',
        domain: [0, 100],
        domainAlpha: [0.1, 0.8],
        get: x => x.state.speed || 0,
        fmt: (x, options) => H.pace(x, {precision: 1, sport, separator: smallSpace,
                                        suffix: true, ...options}),
    },
    cadence: {
        id: 'cadence',
        name: 'Cadence',
        color: '#ee3',
        domain: [0, 140],
        domainAlpha: [0.1, 0.8],
        get: x => x.state.cadence || 0,
        fmt: (x, options) => H.number(x, {separator: smallSpace,
                                          suffix: sport === 'running' ? 'spm' : 'rpm', ...options}),
    },
    draft: {
        id: 'draft',
        name: 'Draft',
        color: '#e88853',
        domain: [0, 300],
        domainAlpha: [0.1, 0.9],
        get: x => x.state.draft || 0,
        fmt: (x, options) => H.power(x, {separator: smallSpace, suffix: true, ...options}),
    },
    wbal: {
        id: 'wbal',
        name: 'W\'bal',
        color: '#4ee',
        outColor: '#f6a',
        outDomain: [-10000, 22000],
        domain: [0, 22000],
        domainAlpha: [0, 0.6],
        outDomainAlpha: [0.8, 0.1],
        markMin: true,
        get: x => x.wBal || 0,
        fmt: (x, options) => H.number(x / 1000, {precision: 1, fixed: true, separator: smallSpace,
                                                 suffix: 'kJ', ...options}),
    },
};


export function getStreamFieldVisualMaps(fields) {
    return fields.map((f, i) => {
        const o = {
            show: false,
            type: 'continuous',
            hoverLink: false,
            id: f.id,
            seriesIndex: i,
            range: f.domain,
            min: f.outDomain ? Math.min(f.domain[0], f.outDomain[0]) : f.domain[0],
            max: f.outDomain ? Math.max(f.domain[1], f.outDomain[1]) : f.domain[1],
            inRange: {colorAlpha: f.domainAlpha},
        };
        if (f.outColor) {
            o.outOfRange = {color: f.outColor};
            if (f.outDomainAlpha) {
                o.outOfRange.colorAlpha = f.outDomainAlpha;
            }
        }
        return o;
    });
}


export function getPowerFieldZones(powerStream, powerZones, ftp) {
    const pieces = [];
    let curZone;
    let start = 0;
    const colors = common.getPowerZoneColors(powerZones);
    for (let i = 0; i < powerStream.length; i++) {
        const xPct = powerStream[i] / ftp;
        let zone;
        for (const z of powerZones) {
            if (xPct >= z.from && (!z.to || xPct < z.to)) {
                zone = z;
                break;
            }
        }
        if (zone !== curZone) {
            if (curZone) {
                pieces.push({
                    start,
                    end: i,
                    color: Color.fromHex(colors[curZone.zone]),
                    zone: curZone,
                });
            }
            start = i;
            curZone = zone;
        }
    }
    if (curZone && start < powerStream.length - 1) {
        pieces.push({
            start,
            end: powerStream.length,
            color: Color.fromHex(colors[curZone.zone]),
            zone: curZone,
        });
    }
    return pieces;
}


export class SauceLegend {
    constructor({el, chart, hiddenStorageKey}) {
        this.el = el;
        this.chart = chart;
        this.hiddenStorageKey = hiddenStorageKey;
        this.hidden = new Set(hiddenStorageKey && common.storage.get(hiddenStorageKey) || []);
        this.render();
        el.addEventListener('click', ev => this.onLegendClick(ev));
    }

    render() {
        const {series, color} = this.chart.getOption();
        this.el.innerHTML = series.map((x, i) => {
            const hidden = this.hidden.has(x.id);
            if (hidden) {
                this.chart.dispatchAction({type: 'legendUnSelect', name: x.name});
            }
            return `
                <div class="s-legend-item ${hidden ? 'hidden' : ''}" data-id="${x.id}" data-name="${x.name}">
                    <div class="color" style="background-color: ${color[i]};"></div>
                    <div class="label">${x.name}</div>
                </div>
            `;
        }).join('\n');
    }

    onLegendClick(ev) {
        const item = ev.target.closest('.s-legend-item[data-id]');
        if (!item) {
            return;
        }
        this.chart.dispatchAction({type: 'legendToggleSelect', name: item.dataset.name});
        item.classList.toggle('hidden');
        const id = item.dataset.id;
        if (this.hidden.has(id)) {
            this.hidden.delete(id);
        } else {
            this.hidden.add(id);
        }
        if (this.hiddenStorageKey) {
            common.storage.set(this.hiddenStorageKey, Array.from(this.hidden));
        }
    }
}
