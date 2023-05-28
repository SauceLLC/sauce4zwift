import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as curves from './curves.mjs';

locale.setImperial(!!common.storage.get('/imperialUnits'));
ec.registerTheme('sauce', theme.getTheme('dynamic'));

const H = locale.human;


let _i = 0;
function vectorDistance(a, b) {
    const xd = b[0] - a[0];
    const yd = b[1] - a[1];
    const zd = b[2] - a[2];
    const B = Math.sqrt(xd * xd + yd * yd + zd * zd);
    const A = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (_i++ % 2 === 0) {
        return B;
    } else {
        return A;
    }
}


export class SauceElevationProfile {
    constructor({el, worldList, preferRoute, refresh=1000}) {
        this.el = el;
        this.worldList = worldList;
        this.preferRoute = preferRoute;
        this.refresh = refresh;
        this._lastRender = 0;
        this._refreshTimeout = null;
        el.classList.add('sauce-elevation-profile-container');
        this.chart = ec.init(el, 'sauce', {renderer: 'svg'});
        this.chart.setOption({
            animation: false,
            tooltip: {
                trigger: 'axis',
                formatter: ([{value}]) => value ?
                    `${H.distance(value[0], {suffix: true})}, ` +
                    `${H.elevation(value[1], {suffix: true})}, ` +
                    `${H.number(value[2] * 100, {suffix: '%'})}` : '',
                axisPointer: {z: -1},
            },
            xAxis: {
                type: 'value',
                boundaryGap: false,
                show: false,
                min: 'dataMin',
                max: 'dataMax',
            },
            yAxis: {
                show: false,
                type: 'value',
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
                    lineStyle: {},
                }
            }]
        });
        this.courseId = null;
        this.athleteId = null;
        this.watchingId = null;
        this.selfId = null;
        this.roads = null;
        this.road = null;
        this.route = null;
        this.reverse = null;
        this.marks = new Map();
        this._distances = null;
        this._elevations = null;
        this._grades = null;
        this._roadSigs = null;
        this._statesQueue = [];
        this._busy = false;
        this.onResize();
        this._resizeObserver = new ResizeObserver(() => this.onResize());
        this._resizeObserver.observe(this.el);
        this._resizeObserver.observe(document.documentElement);
    }

    destroy() {
        this._resizeObserver.disconnect();
        this.chart.dispose();
        this.el.remove();
    }

    _updateFontSizes() {
        this._docFontSize = Number(getComputedStyle(document.documentElement).fontSize.slice(0, -2));
        this._elFontSize = Number(getComputedStyle(this.el).fontSize.slice(0, -2));
    }

    em(scale) {
        return this._elFontSize * scale;
    }

    rem(scale) {
        return this._docFontSize * scale;
    }

    onResize() {
        this._updateFontSizes();
        this.chart.resize();
        const axisPad = this.em(0.2);
        const tooltipSize = 0.4;
        this.chart.setOption({
            grid: {top: this.em(1), right: 0, bottom: 0, left: 0},
            series: [{
                markLine: {
                    label: {
                        fontSize: this.em(0.5),
                        distance: this.em(0.18 * 0.5)
                    }
                }
            }],
            tooltip: {
                position: ([x, y], params, dom, rect, size) => {
                    if (x > size.viewSize[0] / 2) {
                        return [x - size.contentSize[0] - axisPad, axisPad];
                    } else {
                        return [x + axisPad, axisPad];
                    }
                },
                textStyle: {
                    fontSize: this.em(tooltipSize),
                    lineHeight: this.em(tooltipSize * 1.15),
                },
                padding: [this.em(0.1 * tooltipSize), this.em(0.3 * tooltipSize)],
            },
        });
        this.renderAthleteStates([], /*force*/ true);
    }

    async setCourse(id) {
        console.debug("Setting new course:", id);
        if (id === this.courseId) {
            return;
        }
        const worldId = this.worldList.find(x => x.courseId === id).worldId;
        this.roads = await common.getRoads(worldId);
        this.courseId = id;
        this.road = null;
        this.route = null;
        this.marks.clear();
    }

    setAthlete(id) {
        console.debug("Setting self-athlete:", id);
        if (id === this.athleteId) {
            return;
        }
        if (this.athleteId != null && this.marks.has(this.athleteId)) {
            this.marks.get(this.athleteId).self = false;
        }
        this.athleteId = id;
        if (id != null && this.marks.has(id)) {
            const mark = this.marks.get(id);
            mark.watching = false;
            mark.self = true;
        }
    }

    setWatching(id) {
        console.debug("Setting watching-athlete:", id);
        if (id === this.watchingId) {
            return;
        }
        if (this.watchingId != null && this.marks.has(this.watchingId)) {
            this.marks.get(this.watchingId).watching = false;
        }
        this.watchingId = id;
        if (id != null && id !== this.athleteId && this.marks.has(id)) {
            this.marks.get(id).watching = true;
        }
    }

    setRoad(id, reverse=false) {
        this.route = null;
        this.road = this.roads[id];
        this.reverse = reverse;
        this._roadSigs = new Set([`${id}-${!!reverse}`]);
        this.setData(this.road.distances, this.road.elevations, this.road.grades, {reverse});
    }

    async setRoute(id, laps=1) {
        this.road = null;
        this.reverse = null;
        this._roadSigs = new Set();
        this.route = await common.rpc.getRoute(id, {detailed: true});
        const path = curves.uniformCatmullRomPath(this.route.checkpoints);
        const len = curves.pathLength(path);
        debugger;
        for (const x of this.route.checkpoints) {
            if (x[3]) {
                const {roadId, reverse} = x[3];
                if (roadId) {
                    this._roadSigs.add(`${roadId}-${!!reverse}`);
                }
            }
        }
        const distances = Array.from(this.route.distances);
        const elevations = Array.from(this.route.elevations);
        const grades = Array.from(this.route.grades);
        const distance = distances.at(-1);
        const markLines = [];
        for (let lap = 1; lap < laps; lap++) {
            // NOTE: we assume no route isn't going to blow up the stack (~120k entries)
            distances.push(...this.route.distances.map(x => x + lap * distance));
            elevations.push(...this.route.elevations);
            grades.push(...this.route.grades);
            markLines.push({
                xAxis: distance * lap,
                lineStyle: {width: 2, type: 'solid'},
                label: {
                    position: 'insideStartTop',
                    formatter: `LAP ${lap + 1}`
                }
            });
        }
        this.setData(distances, elevations, grades, {markLines});
    }


    setData(distances, elevations, grades, options={}) {
        this._distances = distances;
        this._elevations = elevations;
        this._grades = grades;
        const distance = distances[distances.length - 1] - distances[0];
        this._yMax = Math.max(...elevations);
        this._yMin = Math.min(...elevations);
        // Echarts bug requires floor/ceil to avoid missing markLines
        this._yAxisMin = Math.floor(this._yMin > 0 ? Math.max(0, this._yMin - 20) : this._yMin);
        this._yAxisMax = Math.ceil(Math.max(this._yMax, this._yMin + 200));
        this.chart.setOption({
            xAxis: {inverse: options.reverse},
            yAxis: {
                min: this._yAxisMin,
                max: this._yAxisMax,
            },
            series: [{
                areaStyle: {
                    color:  {
                        type: 'linear',
                        x: options.reverse ? 1 : 0,
                        y: 0,
                        x2: options.reverse ? 0 : 1,
                        y2: 0,
                        colorStops: distances.map((x, i) => {
                            const steepness = Math.abs(grades[i] / 0.12);
                            const color = Color.fromRGB(steepness, 0.4, 0.5 * steepness)
                                .lighten(-0.25)
                                .saturate(steepness - 0.33);
                            return {
                                offset: x / distance,
                                color: color.toString(),
                            };
                        }),
                    },
                },
                markLine: {
                    data: [{
                        type: 'min',
                        label: {
                            formatter: x => H.elevation(x.value, {suffix: true}),
                            position: this.reverse ? 'insideEndTop' : 'insideStartTop'
                        },
                    }, {
                        type: 'max',
                        label: {
                            formatter: x => H.elevation(x.value, {suffix: true}),
                            position: this.reverse ? 'insideStartTop' : 'insideEndTop'
                        },
                    }, ...(options.markLines || [])]
                },
                markAreas: {
                    data: options.markAreas
                },
                data: distances.map((x, i) => [x, elevations[i], grades[i] * (options.reverse ? -1 : 1)]),
            }]
        });
    }

    renderAthleteStates(states, force) {
        if (this.watchingId == null || this._busy) {
            return;
        }
        this._busy = true;
        try {
            return this._renderAthleteStates(states, force);
        } finally {
            this._busy = false;
        }
    }

    async _renderAthleteStates(states, force) {
        const watching = states.find(x => x.athleteId === this.watchingId);
        if (!watching && (this.courseId == null || (!this.road && !this.route))) {
            return;
        } else if (watching) {
            if (watching.courseId !== this.courseId) {
                await this.setCourse(watching.courseId);
            }
            if (this.preferRoute) {
                if (watching.routeId) {
                    if (!this.route || this.route.id !== watching.routeId) {
                        let sg;
                        if (watching.eventSubgroupId) {
                            sg = await common.rpc.getEventSubgroup(watching.eventSubgroupId);
                        }
                        // Note sg.routeId is sometimes out of sync with state.routeId; avoid thrash
                        if (sg && sg.routeId === watching.routeId) {
                            await this.setRoute(sg.routeId, sg.laps);
                        } else {
                            await this.setRoute(watching.routeId, 2); // XXX
                        }
                    }
                } else {
                    this.route = null;
                }
            }
            if (!this.route) {
                if (!this.road || this.road.id !== watching.roadId || this.reverse !== watching.reverse) {
                    this.setRoad(watching.roadId, watching.reverse);
                }
            }
        }
        const now = Date.now();
        for (const state of states) {
            if (!this.marks.has(state.athleteId)) {
                this.marks.set(state.athleteId, {
                    athleteId: state.athleteId,
                    state,
                });
            }
            const mark = this.marks.get(state.athleteId);
            mark.state = state;
            mark.lastSeen = now;
        }
        common.idle().then(() => this._updateAthleteDetails(states.map(x => x.athleteId)));
        if (!force && now - this._lastRender < this.refresh) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = setTimeout(
                () => this.renderAthleteStates([]),
                this.refresh - (now - this._lastRender));
            return;
        }
        if (!force && !common.isVisible()) {
            cancelAnimationFrame(this._visAnimFrame);
            this._visAnimFrame = requestAnimationFrame(() => this.renderAthleteStates([]));
            return;
        }
        this._lastRender = now;
        const marks = Array.from(this.marks.values()).filter(x => {
            const sig = `${x.state.roadId}-${!!x.state.reverse}`;
            return this._roadSigs.has(sig);
        });
        const markPointLabelSize = 0.4;
        const deltaY = this._yAxisMax - this._yAxisMin;
        const path = this.route?.checkpoints || this.road?.path;
        this.chart.setOption({series: [{
            markPoint: {
                itemStyle: {borderColor: '#222b'},
                animation: false,
                data: marks.map(({state}, i) => {
                    const distances = path.map(pos =>
                        vectorDistance(pos, [state.x, state.y, state.z]));
                    const nearest = distances.indexOf(Math.min(...distances));
                    const distance = this._distances[nearest];
                    const isWatching = state.athleteId === this.watchingId;
                    return {
                        name: state.athleteId,
                        coord: [distance, state.altitude + 2],
                        symbolSize: isWatching ? this.em(1.1) : this.em(0.55),
                        itemStyle: {
                            color: isWatching ? '#f43e' : '#fff6',
                            borderWidth: this.em(isWatching ? 0.04 : 0.02),
                        },
                        emphasis: {
                            label: {
                                fontSize: this.em(markPointLabelSize),
                                fontWeight: 400,
                                lineHeight: this.em(1.15 * markPointLabelSize),
                                position: (state.altitude - this._yAxisMin) / deltaY > 0.4 ? 'bottom' : 'top',
                                backgroundColor: '#222e',
                                borderRadius: this.em(0.22 * markPointLabelSize),
                                borderWidth: 1,
                                borderColor: '#fff9',
                                align: (nearest > distances.length / 2) ^ this.reverse ? 'right' : 'left',
                                padding: [
                                    this.em(0.2 * markPointLabelSize),
                                    this.em(0.3 * markPointLabelSize)
                                ],
                                formatter: this.onMarkEmphasisLabel.bind(this),
                            }
                        },
                    };
                }),
            },
        }]});
        for (const [athleteId, mark] of this.marks.entries()) {
            if (now - mark.lastSeen > 15000) {
                this.marks.delete(athleteId);
            }
        }
    }

    onMarkEmphasisLabel(params) {
        if (!params || !params.data || !params.data.name) {
            return;
        }
        const mark = this.marks.get(params.data.name);
        if (!mark) {
            return;
        }
        const ad = common.getAthleteDataCacheEntry(mark.athleteId);
        const name = ad?.athlete?.fLast || `ID: ${mark.athleteId}`;
        return `${name}, ${H.power(mark.state.power, {suffix: true})}`;
    }

    async _updateAthleteDetails(ids) {
        await common.getAthletesDataCached(ids);
    }
}
