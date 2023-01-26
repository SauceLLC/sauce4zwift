import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
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
            smooth: 1,
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
                label: {
                    position: 'start',
                    distance: 10,
                    formatter: x => H.elevation(x.value, {suffix: true}),
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
    let worldMeta;
    let markAnimationDuration;
    const worldList = await (await fetch('/shared/deps/data/worldlist.json')).json();
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
            worldMeta = worldList.find(x => x.courseId === courseId);
        }
        if (!road || watching.state.roadId !== road.id || reverse !== watching.state.reverse) {
            road = roads[watching.state.roadId];
            reverse = watching.state.reverse;
            chart.setOption({xAxis: {inverse: reverse}});
            markAnimationDuration = 20; // reset to render is not uber-slow
            chart.setOption({series: [{
                data: road.coords.map((x, i) => [road.distances[i], road.elevations[i], road.grades[i]]),
            }]});
        }
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
    let worldMeta;
    // XXX...
    let worldId = 1;
    imgTest.src = 'https://cdn.zwift.com/static/images/maps/MiniMap_Watopia.png';
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
    }
    // /XXX

    let reset;
    const dots = new Map();
    renderer.addCallback(async nearby => {
        if (!nearby || !nearby.length) {
            return;
        }
        const watching = nearby.find(x => x.watching);
        if (watching.state.courseId !== courseId) {
            courseId = watching.state.courseId;
            // XXX
            //worldMeta = worldList.find(x => x.courseId === courseId);
            //const worldId = common.courseToWorldIds[courseId];
            dotsEl.dataset.worldId = worldId;
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
            const vertDir = worldMeta.flippedHack ? -1 : 1;
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
            if (worldId === 1) {
                //document.querySelector('.map-canvas').style.transform = 'transform: rotate(90deg) translate(-933px, 3716px);';
            }


            /* Save because has magical innsbrook numbers... :( XXX
             *           watopia magic: -933px, 3716px;
            reset = () => {
                ctx.restore();
                ctx.clearRect(0, 0, width, height);
                ctx.save();
                ctx.scale(1, -1);
                ctx.drawImage(img, 0, -height);
                ctx.restore();
                ctx.save();
                ctx.translate(1415, 1006);
            };
            */
        }
        //reset();
        for (const x of nearby) {
            if (!dots.has(x.athleteId)) {
                const dot = document.createElement('div');
                dot.classList.add('dot');
                dot.classList.toggle('watching', !!x.watching);
                dot.dataset.athleteId = x.athleteId;
                dotsEl.append(dot);
                dots.set(x.athleteId, dot);
            }
            const dot = dots.get(x.athleteId);
            dot.lastSeen = Date.now();
            dot.style.setProperty('--x', `${(x.state.x / worldMeta.tileScale) * tileSize}px`);
            dot.style.setProperty('--y', `${(x.state.y / worldMeta.tileScale) * tileSize}px`);
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
