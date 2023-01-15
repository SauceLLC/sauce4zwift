import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as ec from '../deps/src/echarts.mjs';
window.echarts = Object.fromEntries(Object.entries(ec));
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);


async function createElevationProfile() {
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
            type: 'value',
            min: x => Math.max(0, x.min - 20),
            max: x => Math.max(x.max, x.min + 200),
            axisLabel: {
                formatter: x => H.elevation(x, {suffix: true})
            },
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
            }
        }]
    });
    return chart;
}


async function createMapCanvas() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = document.createElement('img');
    const world = (await (await fetch('/shared/deps/data/worldlist.json')).json()).find(x => x.courseId === 9);
    const imgLoad = new Promise(resolve => img.addEventListener('load', resolve));
    img.src = '/pages/images/maps/world-5.png';
    await imgLoad;
    const width = canvas.width = img.width;
    const height = canvas.height = img.height;
    ctx.drawImage(img, 0, 0, width, height);
    document.querySelector('#content .map-canvas').append(canvas);
    return {
        doSomething: () => null,
    };
}


async function createMapChart() {
    const chart = ec.init(document.querySelector('#content .map-chart'));
    chart.setOption({
        //grid: {top: 0, left: 0, right: 0, bottom: 0},
        legend: {show: true},
        animation: false,
        tooltip: {},
        graphic: [{
            type: 'image',
            id: 'background',
            left: chart.getWidth() * 0.115,
            top: chart.getWidth() * 0.1,
            z: -10,
            bounding: 'raw',
            style: {
                image: '/pages/images/maps/world-5.png',
                width: chart.getWidth() * 0.8,
                height: chart.getHeight() * 0.8,
            }
        }],
        xAxis: {
            //show: false,
            min: -450000,
            max: 750000,
        },
        yAxis: {
            //show: false,
            min: -450000,
            max: 750000
        },
        series: [{
            type: 'scatter',
            coordinateSystem: 'cartesian2d',
            symbolSize: 6,
            nolabel: {
                position: 'right',
                fontSize: 16,
                show: true,
                color: '#fff',
                formatter: ({data}) => {
                    const x = data.obj;
                    const a = x.athlete;
                    if (x.watching) {
                        return `${a && a.initials}: ${Math.round(x.state.roadCompletion / 1000000 * 100)}%`;
                    } else {
                        return `${a && a.initials}: ${H.timer(Math.abs(x.gap))} ${Math.round(x.state.roadCompletion / 1000000 * 100)}%`;
                    }
                }
            },
            itemStyle: {
                color: ({data}) => {
                    const x = data.obj;
                    const a = x.athlete;
                    if (x.watching) {
                        return '#33c';
                    } else if (a && a.type === 'PACER_BOT') {
                        return '#3c3';
                    }
                    return '#fffc';
                }
            },
        }],
    });
    return chart;
}


export async function main() {
    common.initInteractionListeners();
    const worldList = await (await fetch('/shared/deps/data/worldlist.json')).json();
    const elevationProfile = await createElevationProfile();
    //const mapChart = await createMapChart();
    //const mapCanvas = await createMapCanvas();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content);
    let courseId;
    let roads;
    let road;
    let reverse;
    let distances;
    let gaps;
    let grades;
    let worldMeta;
    let nodes;
    let markAnimationDuration;
    renderer.addCallback(async nearby => {
        if (!nearby) {
            return;
        }
        /*mapChart.setOption({series: [{
            data: nearby.map(x => ({value: [x.state.x, x.state.y], obj: x}))
        }]});*/
        nearby.sort((a, b) => a.athleted - b.athleteId);
        nearby.sort((a, b) => a.watching ? 1 : b.watching ? -1 : 0);
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
            nodes = Array.from(road.nodes).map(({pos}) => [
                pos[0] / 100, // meters
                pos[1] / 100, // meters
                (pos[2] + worldMeta.waterPlaneLevel) / 100 * worldMeta.physicsSlopeScale + 
                    worldMeta.altitudeHackOffset
            ]);
            if (reverse) {
                nodes.reverse();
            }
            gaps = nodes.map((x, i) => i ? common.coordDistance(x, nodes[i - 1]) : 0);
            distances = [];
            gaps.forEach((x, i) => distances[i] = i ? distances[i - 1] + gaps[i] : 0);
            grades = nodes.map(([x, y, z], i) => i ? (z - nodes[i - 1][2]) / gaps[i] : 0);
            console.info({gaps, grades}, gaps.reduce((agg, x) => agg + x, 0));
            markAnimationDuration = 400;
            elevationProfile.setOption({series: [{
                data: nodes.map((x, i) => [distances[i], x[2]]),
            }]});
        }
        elevationProfile.setOption({series: [{
            markPoint: {
                itemStyle: {borderColor: '#000'},
                animationDurationUpdate: markAnimationDuration,
                animationEasingUpdate: 'linear',
                data: nearby.filter(x => x.state.roadId === road.id && x.state.reverse === reverse).map(x => {
                    const fracIdx = distances.length * (x.state.roadCompletion / 1000000);
                    const nextGap = gaps[fracIdx | 0 + 1] || 0;
                    const distance = distances[fracIdx | 0] + nextGap * (fracIdx % 1);
                    const yPos = Math.max(
                        x.state.altitude,
                        nodes[fracIdx | 0][2],
                        nextGap ? nodes[fracIdx | 0 + 1][2] : -Infinity
                    ) + 2;
                    return {
                        name: x.athleteId,
                        coord: [distance, yPos],
                        symbolSize: x.watching ? 40 : 20,
                        itemStyle: {
                            color: x.watching ? '#f54e' : '#fff6',
                            borderWidth: x.watching ? 2 : 0,
                        },
                    };
                }),
            },
        }]});
        markAnimationDuration = Math.min(2000, markAnimationDuration * 1.2);
    });
    addEventListener('resize', () => {
        elevationProfile.resize();
        /*mapChart.resize();
        mapChart.setOption({
            graphic: [{
                type: 'image',
                id: 'background',
                left: mapChart.getWidth() * 0.8,
                top: mapChart.getWidth() * 0.8,
                z: -10,
                bounding: 'raw',
                style: {
                    image: '/pages/images/maps/world-5.png',
                    width: mapChart.getWidth() * 0.5,
                    height: mapChart.getHeight() * 0.5,
                }
            }],
        });
        */
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
