import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);


function vectorDistance(a, b) {
    const xd = b[0] - a[0];
    const yd = b[1] - a[1];
    const zd = b[2] - a[2];
    return Math.sqrt(xd * xd + yd * yd + zd * zd);
}


async function createElevationProfile(renderer) {
    const chart = ec.init(document.querySelector('#content .elevation-profile'), 'sauce',
        {renderer: 'svg'});
    chart.setOption({
        tooltip: {
            trigger: 'axis',
            formatter: ([{value}]) => value ?
                `${H.elevation(value[1], {suffix: true})}\n${H.number(value[2] * 100, {suffix: '%'})}` : '',
            axisPointer: {
                z: -1,
            },
        },
        xAxis: {
            type: 'value',
            boundaryGap: false,
            show: false,
            min: 'dataMin',
            max: 'dataMax',
        },
        dataZoom: [{
            type: 'inside',
        }],
        yAxis: {
            show: false,
            type: 'value',
            min: x => Math.max(0, x.min - 20),
            max: x => Math.max(x.max, x.min + 200),
        },
        series: [{
            name: 'Elevation',
            smooth: 0.5,
            type: 'line',
            symbol: 'none',
            areaStyle: {},
            encode: {
                x: 0,
                y: 1,
                tooltip: [0, 1, 2]
            },
            markLine: {
                symbol: 'none',
                silent: true,
                label: {
                    position: 'start',
                    distance: 10,
                    formatter: x => H.elevation(x.value, {suffix: true}),
                    fontSize: '0.5em',
                },
                lineStyle: {
                },
                data: [{
                    type: 'min',
                }, {
                    type: 'max',
                }]
            }
        }]
    });
    let courseId;
    let roads;
    let road;
    let reverse;
    let markAnimationDuration;
    renderer.addCallback(async _nearby => {
        if (!_nearby || !_nearby.length) {
            return;
        }
        const nearby = Array.from(_nearby);
        nearby.sort((a, b) => a.athleteId - b.athleteId);  // stablize by athlete not gap.
        nearby.sort((a, b) => a.watching ? 1 : b.watching ? -1 : 0); // put Watching mark on top
        const watching = nearby.find(x => x.watching);
        if (watching.state.courseId !== courseId) {
            courseId = watching.state.courseId;
            road = null;
            const worldId = common.courseToWorldIds[courseId];
            roads = (await (await fetch(`/shared/deps/data/worlds/${worldId}/roads.json`)).json());
        }
        if (!road || watching.state.roadId !== road.id || reverse !== watching.state.reverse) {
            road = roads[watching.state.roadId];
            reverse = watching.state.reverse;
            chart.setOption({xAxis: {inverse: reverse}});
            // XXX 200 when done validating
            markAnimationDuration = 20; // reset so render is not uber-slow
            const distance = road.distances[road.distances.length - 1];
            chart.setOption({series: [{
                areaStyle: {
                    color:  {
                        type: 'linear',
                        x: reverse ? 1 : 0,
                        y: 0,
                        x2: reverse ? 0 : 1,
                        y2: 0,
                        colorStops: road.distances.map((x, i) => ({
                            offset: x / distance,
                            color: Color.fromRGB(Math.abs(road.grades[i] / 0.10), 0, 0.15, 0.95).toString(),
                            //color: new Color(0.33 - Math.min(1, Math.abs(road.grades[i] / 0.10)) * (120 / 360), 0.5, 0.5, 0.95).toString(),
                        })),
                    },
                },
                data: road.distances.map((x, i) =>
                    [x, road.elevations[i], road.grades[i] * (reverse ? -1 : 1)]),
            }]});
        }
        const markEmphasisLabel = params => {
            if (!params || !params.data || !params.data.name) {
                return;
            }
            const data = nearby.find(x => x.athleteId === params.data.name);
            if (!data) {
                return;
            }
            const items = [
                data.athlete && data.athlete.fLast,
                data.stats.power.smooth[5] != null ? H.power(data.stats.power.smooth[5], {suffix: true}) : null,
                data.state.heartrate ? H.number(data.state.heartrate, {suffix: 'bpm'}) : null,
                data.gap ? H.duration(data.gap, {short: true, seperator: ' '}) : null,
            ];
            return items.filter(x => x != null).join(', ');
        };
        chart.setOption({series: [{
            markPoint: {
                itemStyle: {borderColor: '#000'},
                animationDurationUpdate: markAnimationDuration,
                animationEasingUpdate: 'linear',
                data: nearby.filter(x => x.state.roadId === road.id && x.state.reverse === reverse).map(x => {
                    // XXX
                    const distances = road.coords.map(c => vectorDistance(c, [x.state.x, x.state.y, x.state.z]));
                    const nearest = distances.indexOf(Math.min(...distances));
                    const distance = road.distances[nearest];
                    if (x.watching) {
                        //console.log(nearest, distance, distances);
                    }
                    return {
                        name: x.athleteId,
                        coord: [distance, x.state.altitude + 2],
                        symbolSize: x.watching ? 40 : 20,
                        itemStyle: {
                            color: x.watching ? '#f54e' : '#fff6',
                            borderWidth: x.watching ? 2 : 0,
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: '0.6em',
                                position: 'top',
                                formatter: markEmphasisLabel,
                            }
                        }
                    };
                }),
            },
        }]});
        //markAnimationDuration = Math.min(1200, markAnimationDuration * 1.3);
    });
    return chart;
}


async function createMapCanvas(renderer) {
    const tileSize = 4096;
    const mapEl = document.querySelector('.map-canvas');
    const dotsEl = mapEl.querySelector('.dots');
    const canvas = mapEl.querySelector('canvas');
    const imgTest = mapEl.querySelector('img');
    const ctx = canvas.getContext('2d');
    const worldList = await (await fetch('/shared/deps/data/worldlist.json')).json();
    let courseId;
    // XXX...
    /*let worldId = 1;
    let worldMeta;
    worldMeta = worldList.find(x => x.worldId === worldId);
    const roads = (await (await fetch(`/shared/deps/data/worlds/${worldId}/roads.json`)).json());
    for (const r of Object.values(roads)) {
        for (const [x, y] of r.coords) {
            const dot = document.createElement('div');
            dot.classList.add('dot');
            dotsEl.append(dot);
            dot.style.setProperty('--x', `${(x / worldMeta.tileScale) * tileSize}px`);
            dot.style.setProperty('--y', `${(y / worldMeta.tileScale) * tileSize}px`);
        }
    }*/
    // /XXX
    let worldMeta;
    const dots = new Map();
    renderer.addCallback(async nearby => {
        if (!nearby || !nearby.length) {
            return;
        }
        const watching = nearby.find(x => x.watching);
        mapEl.style.setProperty('--heading', watching.state.heading);
        if (watching.state.courseId !== courseId) {
            courseId = watching.state.courseId;
            worldMeta = worldList.find(x => x.courseId === courseId);
            const worldDesc = common.worldCourseDescs.find(x => x.courseId === courseId);
            const worldId = common.courseToWorldIds[courseId];
            mapEl.dataset.worldId = worldId;
            imgTest.src = `https://cdn.zwift.com/static/images/maps/MiniMap_${worldDesc.minimapKey}.png`;
            let xStart = Infinity, xEnd = -Infinity, yStart = Infinity, yEnd = -Infinity;
            for (const m of worldMeta.minimap) {
                const size = m.scale * tileSize;
                xEnd = Math.max(xEnd, tileSize * m.xOffset + size);
                yEnd = Math.max(yEnd, tileSize * m.yOffset + size);
                xStart = Math.min(xStart, tileSize * m.xOffset);
                yStart = Math.min(yStart, tileSize * m.yOffset);
            }
            const width = canvas.width = xEnd - xStart;
            const height = canvas.height = yEnd - yStart;
            ctx.save();
            ctx.clearRect(0, 0, width, height);
            ctx.imageSmoothingQuality = 'high';
            const img = new Image();
            for (const tile of worldMeta.minimap) {
                img.src = `/shared/deps/data/worlds/${worldId}/${tile.file}`;
                await img.decode();
                ctx.save();
                ctx.drawImage(img,
                    tile.xOffset * tileSize - xStart,
                    tile.yOffset * tileSize - yStart,
                    tileSize * tile.scale,
                    tileSize * tile.scale);
                ctx.restore();
            }
            ctx.restore();
        }
        for (const entry of nearby) {
            if (!dots.has(entry.athleteId)) {
                const dot = document.createElement('div');
                dot.classList.add('dot');
                dot.classList.toggle('watching', !!entry.watching);
                dot.dataset.athleteId = entry.athleteId;
                dotsEl.append(dot);
                dots.set(entry.athleteId, dot);
            }
            const dot = dots.get(entry.athleteId);
            dot.lastSeen = Date.now();
            const x = (entry.state.x / worldMeta.tileScale) * tileSize;
            const y = (entry.state.y / worldMeta.tileScale) * tileSize;
            dot.style.setProperty('--x', `${x}px`);
            dot.style.setProperty('--y', `${y}px`);
            if (entry.watching) {
                mapEl.style.setProperty('--watching-x', `${y}px`);
                mapEl.style.setProperty('--watching-y', `${-x}px`);
            }
        }
    });
}


export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content);
    const elevationProfile = await createElevationProfile(renderer);
    await createMapCanvas(renderer);
    addEventListener('resize', () => {
        elevationProfile.resize();
        renderer.render({force: true});
    });
    common.subscribe('nearby', nearby => {
        renderer.setData(nearby);
        renderer.render();
    });
    renderer.render();
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form');
}
