import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as locale from '../../shared/sauce/locale.mjs';

const H = locale.human;
const smallSpace = '\u0020';
let sport = 'cycling';
let magicZonesClippyHackCounter = 0;


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


let _powerZoneColors;
export function getPowerFieldPieces(data, powerZones, ftp) {
    const pieces = [];
    let curZone;
    let start = 0;
    const colors = _powerZoneColors = (_powerZoneColors || common.getPowerZoneColors(powerZones));
    for (let i = 0; i < data.length; i++) {
        const xPct = data[i][1] / ftp;
        let zone;
        for (let j = 0; j < powerZones.length; j++) {
            const z = powerZones[j];
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
    if (curZone && start < data.length - 1) {
        pieces.push({
            start,
            end: data.length - 1,
            color: Color.fromHex(colors[curZone.zone]),
            zone: curZone,
        });
    }
    return pieces;
}


export function magicZonesAfterRender({hackId, chart, ftp, zones, seriesId, zLevel}) {
    if (chart._magicZonesActive) {
        return;
    }
    const graphic = calcMagicPowerZonesGraphics(chart, zones, seriesId, ftp,
                                                {zLevel, sig: chart._magicZonesLastSig});
    if (!graphic) {
        return;
    }
    chart._magicZonesActive = true;
    chart._magicZonesLastSig = graphic.sig;
    // Echarts gets mad if we call setOption from setOption
    queueMicrotask(() => {
        try {
            setMagicZonesOptions({chart, graphic, hackId});
        } finally {
            chart._magicZonesActive = false;
        }
    });
}


function setMagicZonesOptions({chart, graphic, hackId}) {
    chart.setOption({graphic}, {replaceMerge: 'graphic', silent: true});
    const chartEl = chart.getDom();
    const pathEl = chartEl && chartEl.querySelector('path[fill="magic-zones"]');
    if (!pathEl) {
        return;
    }
    if (!pathEl.id) {
        pathEl.id = `path-hack-${hackId}`;
        pathEl.style.setProperty('fill', 'transparent');
    }
    if (!chartEl.querySelector(`clipPath#clip-hack-${hackId}`)) {
        const clipEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipEl.id = `clip-hack-${hackId}`;
        const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        useEl.setAttribute('href', `#${pathEl.id}`);
        clipEl.appendChild(useEl);
        chartEl.querySelector('defs').appendChild(clipEl);
    }
    const groupClipEl = chartEl.querySelector('g:not(.hacked):has(> path[stroke="magic-zones-graphics"]');
    if (groupClipEl) {
        groupClipEl.setAttribute('clip-path', `url(#clip-hack-${hackId})`);
        groupClipEl.classList.add('hacked');
    }
}


export function calcMagicPowerZonesGraphics(chart, zones, seriesId, ftp, options={}) {
    const children = [];
    const graphic = [{
        type: 'group',
        silent: true,
        // clipPath is hack to force zRender to give us a <g> tag..
        clipPath: {type: 'polygon'},
        id: 'magic-zones',
        children
    }];
    const series = chart.getModel().getSeries().find(x => x.id === seriesId);
    const visible = !chart._sauceLegend?.hidden.has(seriesId);
    if (!series || !zones || !ftp || !visible) {
        return graphic;
    }
    const xAxisIndex = series.option.xAxisIndex || 0;
    const yAxisIndex = series.option.yAxisIndex || 0;
    const yAxis = chart.getModel().getComponent('yAxis', yAxisIndex);
    const data = [];
    const seriesData = series.getData();
    const len = seriesData.count();
    const step = Math.max(1, (len / (window.devicePixelRatio * window.innerWidth)) | 0);
    if (step > 1) {
        for (let i = 0; i < len; i += step) {
            let ySum = 0;
            for (let j = 0; j < step; j++) {
                ySum += seriesData.get('y', i + j);
            }
            data.push([seriesData.get('x', i), ySum / step]);
        }
    } else {
        for (let i = 0; i < len; i += 1) {
            data.push([seriesData.get('x', i), seriesData.get('y', i)]);
        }
    }
    const pieces = getPowerFieldPieces(data, zones, ftp);
    const [bottomY, topY]= yAxis.axis.getGlobalExtent();
    const height = bottomY - topY;
    const minWidth = 1 / window.devicePixelRatio;
    let startPx;
    let sig = '';
    const stage1 = [];
    for (let i = 0; i < pieces.length; i++) {
        const x = pieces[i];
        if (startPx === undefined) {
            startPx = chart.convertToPixel({xAxisIndex}, data[x.start][0]);
        }
        const widthPx = chart.convertToPixel({xAxisIndex}, data[x.end][0]) - startPx;
        if (widthPx < minWidth) {
            continue;
        }
        sig += `${startPx} ${widthPx} ${x.zone.zone}`;
        stage1.push({startPx, widthPx, x});
        startPx = undefined;
    }
    if (sig === options.sig) {
        // Likely when scrubbing
        return;
    }
    graphic.sig = sig;
    for (let i = 0; i < stage1.length; i++) {
        const {startPx, widthPx, x} = stage1[i];
        const top = x.zone.to ? chart.convertToPixel({yAxisIndex}, x.zone.to * ftp * 0.95) : 0;
        children.push({
            type: 'rect',
            z: options.zLevel,
            shape: {
                x: startPx,
                y: topY,
                width: widthPx,
                height,
            },
            style: {
                stroke: 'magic-zones-graphics',
                fill: {
                    type: 'linear', x: 0, y: 1, x2: 0, y2: 0, colorStops: [
                        {offset: 0, color: x.color.alpha(0.2).toString()},
                        {offset: top ? 1 - (top - topY) / height : 1, color: x.color.alpha(1).toString()},
                    ],
                },
            }
        });
    }
    return graphic;
}


export function getMagicZonesClippyHackId() {
    return magicZonesClippyHackCounter++;
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
