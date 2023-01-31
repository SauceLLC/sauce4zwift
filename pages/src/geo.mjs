import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as map from './map.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);
const gettingWorldList = common.getWorldList();
const settings = common.settingsStore.get();


function vectorDistance(a, b) {
    const xd = b[0] - a[0];
    const yd = b[1] - a[1];
    const zd = b[2] - a[2];
    return Math.sqrt(xd * xd + yd * yd + zd * zd);
}


async function createElevationProfile(renderer) {
    return;
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
    const worldList = await gettingWorldList;
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
            const worldId = worldList.find(x => x.courseId === courseId).worldId;
            roads = await common.getRoads(worldId);
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



export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content);
    const elevationProfile = await createElevationProfile(renderer);
    const zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('.map'),
        worldList: await gettingWorldList,
        zoom: settings.zoom,
    });
    let settingsSaveTimeout;
    zwiftMap.addEventListener('zoom', ev => {
        clearTimeout(settingsSaveTimeout);
        settings.zoom = ev.zoom;
        settingsSaveTimeout = setTimeout(() => common.settingsStore.set(null, settings), 100);
    });
    addEventListener('resize', () => {
        elevationProfile.resize();
        renderer.render({force: true});
    });
    let courseId;
    let watchingHandler = null;
    const preciseMax = 10;
    const preciseSubs = new Set();
    common.subscribe('athlete/self', data => {
        if (data.state.courseId !== courseId) {
            courseId = data.state.courseId;
            zwiftMap.setCourse(courseId);
        }
        if (!!data.watching !== !watchingHandler) {
            if (watchingHandler) {
                console.warn("XXX un sub watching");
                common.unsubscribe('athlete/watching', watchingHandler);
                watchingHandler = null;
            } else {
                console.warn("XXX sub watching");
                watchingHandler = data => {
                    zwiftMap.renderAthleteData([data]);
                    zwiftMap.setHeading(data.state.heading);
                };
                common.subscribe('athlete/watching', watchingHandler);
            }
        }
        zwiftMap.renderAthleteData([data]);
        if (!watchingHandler) {
            zwiftMap.setHeading(data.state.heading);
        }
    });
    function renderSingleAthleteOnMap(data) {
        zwiftMap.renderAthleteData([data]);
    }
    common.subscribe('nearby', nearby => {
        renderer.setData(nearby);
        renderer.render();
        if (nearby && courseId) {
            const byGap = Array.from(nearby).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
            const nearMarks = new Set();
            for (let i = 0; i < Math.min(preciseMax, byGap.length); i++) { 
                const x = byGap[i];
                if (!preciseSubs.has(x.athleteId)) {
                    preciseSubs.add(x.athleteId);
                    common.subscribe(`athlete/${x.athleteId}`, renderSingleAthleteOnMap);
                }
                nearMarks.add(x.athleteId);
            }
            for (const x of preciseSubs) {
                if (!nearMarks.has(x)) {
                    preciseSubs.delete(x);
                    common.unsubscribe(`athlete/${x}`, renderSingleAthleteOnMap);
                }
            }
            zwiftMap.renderAthleteData(nearby.filter(x => !(x.self || self.watching || preciseSubs.has(x.athleteId))));
        }
    });
    renderer.render();
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form');
}
