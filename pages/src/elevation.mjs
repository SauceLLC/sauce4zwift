import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

locale.setImperial(!!common.storage.get('/imperialUnits'));
ec.registerTheme('sauce', theme.getTheme('dynamic'));

const H = locale.human;


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
            dataZoom: [{
                type: 'inside',
            }],
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
                areaStyle: {
                    origin: 'start',
                },
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
        this.roads = null;
        this.road = null;
        this.route = null;
        this.routeId = null;
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
                        fontSize: this.em(0.4),
                        distance: this.em(0.18 * 0.4)
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

    setCourse = common.asyncSerialize(async function(id) {
        if (id === this.courseId) {
            return;
        }
        this.courseId = id;
        this.road = null;
        this.route = null;
        this.routeId = null;
        this.marks.clear();
        this.roads = (await common.getRoads(id)).concat(await common.getRoads('portal'));
    });

    setAthlete(id) {
        if (id === this.athleteId) {
            return;
        }
        console.debug("Setting self-athlete:", id);
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
        if (id === this.watchingId) {
            return;
        }
        console.debug("Setting watching-athlete:", id);
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
        this.routeId = null;
        this._eventSubgroupId = null;
        this._roadSigs = new Set();
        this._routeLeadinDistance = 0;
        this.road = this.roads ? this.roads.find(x => x.id === id) : undefined;
        if (this.road) {
            this.reverse = reverse;
            this.curvePath = this.road.curvePath;
            this._roadSigs.add(`${id}-${!!reverse}`);
            this.setData(this.road.distances, this.road.elevations, this.road.grades, {reverse});
        } else {
            this.reverse = undefined;
            this.curvePath = undefined;
        }
    }

    setRoute = common.asyncSerialize(async function(id, {laps=1, eventSubgroupId}={}) {
        this.road = null;
        this.reverse = null;
        this.routeId = id;
        this._eventSubgroupId = eventSubgroupId;
        this._roadSigs = new Set();
        this.curvePath = null;
        this.route = await common.getRoute(id);
        console.warn('route', this.route);
        for (const {roadId, reverse} of this.route.checkpoints) {
            this._roadSigs.add(`${roadId}-${!!reverse}`);
        }
        this.curvePath = this.route.curvePath.slice();
        const distances = Array.from(this.route.distances);
        const elevations = Array.from(this.route.elevations);
        const grades = Array.from(this.route.grades);
        const markLines = [];
        const notLeadin = this.route.manifest.findIndex(x => !x.leadin);
        const lapStartIdx = notLeadin === -1 ? 0 : this.curvePath.nodes.findIndex(x => x.index === notLeadin);
        if (lapStartIdx) {
            markLines.push({
                xAxis: distances[lapStartIdx],
                lineStyle: {width: 6, type: 'solid'},
                label: {
                    distance: 7,
                    position: 'insideMiddleBottom',
                    formatter: `LAP 1`
                }
            });
            this._routeLeadinDistance = distances[lapStartIdx];
        } else {
            this._routeLeadinDistance = 0;
        }
        const lapDistance = distances.at(-1) - distances[lapStartIdx];
        for (let lap = 1; lap < laps; lap++) {
            this.curvePath.extend(this.route.curvePath.slice(lapStartIdx));
            for (let i = lapStartIdx; i < this.route.distances.length; i++) {
                distances.push(distances.at(-1) +
                    (this.route.distances[i] - (this.route.distances[i - 1] || 0)));
                elevations.push(this.route.elevations[i]);
                grades.push(this.route.grades[i]);
            }
            markLines.push({
                xAxis: this._routeLeadinDistance + lapDistance * lap,
                lineStyle: {width: 5, type: 'solid'},
                label: {
                    distance: 7,
                    position: 'insideMiddleBottom',
                    formatter: `LAP ${lap + 1}`,
                }
            });
        }
        this.setData(distances, elevations, grades, {markLines});
        return this.route;
    });

    setData(distances, elevations, grades, options={}) {
        this._distances = distances;
        this._elevations = elevations;
        this._grades = grades;
        const distance = distances[distances.length - 1] - distances[0];
        this._yMax = Math.max(...elevations);
        this._yMin = Math.min(...elevations);
        // Echarts bug requires floor/ceil to avoid missing markLines
        this._yAxisMin = Math.floor(this._yMin > 0 ? Math.max(0, this._yMin - 20) : this._yMin) - 10;
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

    async renderAthleteStates(states, force) {
        if (this.watchingId == null || this._busy) {
            return;
        }
        this._busy = true;
        try {
            return await this._renderAthleteStates(states, force);
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
                    if (this.routeId !== watching.routeId ||
                        (this._eventSubgroupId || null) !== (watching.eventSubgroupId || null)) {
                        let sg;
                        if (watching.eventSubgroupId) {
                            sg = await common.rpc.getEventSubgroup(watching.eventSubgroupId);
                        }
                        // Note sg.routeId is sometimes out of sync with state.routeId; avoid thrash
                        if (sg && sg.routeId === watching.routeId) {
                            await this.setRoute(sg.routeId, {laps: sg.laps, eventSubgroupId: sg.id});
                        } else {
                            await this.setRoute(watching.routeId);
                        }
                    }
                } else {
                    this.route = null;
                    this.routeId = null;
                }
            }
            if (!this.routeId) {
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
        const nodes = this.curvePath.nodes;
        this.chart.setOption({series: [{
            markPoint: {
                itemStyle: {borderColor: '#222b'},
                animation: false,
                data: marks.map(({state}) => {
                    let roadSeg;
                    let nodeRoadOfft;
                    let deemphasize;
                    if (this.routeId != null) {
                        if (state.routeId === this.routeId) {
                            let distance;
                            if (this._eventSubgroupId != null) {
                                deemphasize = state.eventSubgroupId !== this._eventSubgroupId;
                                distance = state.eventDistance;
                            } else {
                                // Outside of events state.progress represents the progress of single lap.
                                // However, if the lap counter is > 0 then the progress % does not include
                                // leadin.
                                const floor = state.laps ? this._routeLeadinDistance : 0;
                                const totDist = this._distances[this._distances.length - 1];
                                distance = state.progress * (totDist - floor) + floor;
                            }
                            const nearIdx = common.binarySearchClosest(this._distances, distance);
                            const nearRoadSegIdx = nodes[nearIdx].index;
                            if (state.athleteId === this.watchingId) {
                                console.log("near", {distance, nearIdx, nearRoadSegIdx});
                            }
                            roadSearch:
                            for (let offt = 0; offt < 10; offt++) {
                                for (const dir of [1, -1]) {
                                    const segIdx = nearRoadSegIdx + (offt * dir);
                                    const s = this.route.roadSegments[segIdx];
                                    if (s && s.roadId === state.roadId && !!s.reverse === !!state.reverse) {
                                        roadSeg = s;
                                        // We found the road segment but need to find the exact node offset
                                        // to support multi-lap configurations...
                                        for (let i = nearIdx; i >= 0 && i < nodes.length; i += dir) {
                                            if (nodes[i].index === segIdx) {
                                                // Rewind to first node of this segment.
                                                while (i > 0 && nodes[i].index === segIdx) {
                                                    i--;
                                                }
                                                nodeRoadOfft = i;
                                                break;
                                            }
                                        }
                                        if (nodeRoadOfft == null) {
                                            debugger;
                                        }
                                        if (offt > 0) {
                                            if (offt > 2) {
                                                console.error("really off");
                                                if (offt > 3) {
                                                    console.error("super off");
                                                    debugger;
                                                }
                                            }
                                            console.log({offt, road: s.roadId, rev: s.reverse},
                                                        'hopefully 0 or consistenl big jumps == problem');
                                        }
                                        break roadSearch;
                                    }
                                }
                            }
                            if (!roadSeg) {
                                console.error("road search failed", nearRoadSegIdx, state.roadId);
                                return null;
                            }
                        } else {
                            // Not on our route but is nearby..
                            const i = this.route.roadSegments.findIndex(x =>
                                x.roadId === state.roadId &&
                                !!x.reverse === !!state.reverse &&
                                x.includesRoadTime(state.roadTime));
                            if (i === -1) {
                                return null;
                            }
                            roadSeg = this.route.roadSegments[i];
                            nodeRoadOfft = nodes.findIndex(x => x.index === i);
                            deemphasize = true;
                        }
                    } else if (this.road && this.road.id === state.roadId) {
                        roadSeg = this.road.curvePath;
                        nodeRoadOfft = 0;
                    } else {
                        console.warn("why now?");
                    }
                    if (!roadSeg) {
                        return null;
                    }
                    const bounds = roadSeg.boundsAtRoadTime(state.roadTime);
                    const nodeOfft = state.reverse ?
                        roadSeg.nodes.length - 1 - (bounds.index + bounds.percent) :
                        bounds.index + bounds.percent;
                    const xIdx = nodeRoadOfft + nodeOfft;
                    if (xIdx < 0 || xIdx > this._distances.length - 1) {
                        console.error("route index offset bad!", {xIdx});
                        debugger;
                        return null;
                    }
                    let xCoord;
                    let yCoord;
                    if (xIdx % 1) {
                        const i = xIdx | 0;
                        const dDelta = this._distances[i + 1] - this._distances[i];
                        const eDelta = this._elevations[i + 1] - this._elevations[i];
                        xCoord = this._distances[i] + dDelta * (xIdx % 1);
                        yCoord = this._elevations[i] + eDelta * (xIdx % 1);
                    } else {
                        xCoord = this._distances[xIdx];
                        yCoord = this._elevations[xIdx];
                    }
                    if (isNaN(xCoord) || xCoord == null) {
                        console.log('xCoord is NaN');
                        debugger;
                    }
                    const isWatching = state.athleteId === this.watchingId;
                    if (isWatching) {
                        // XXX
                        console.log("got it", xCoord, xIdx, state.roadId, state.reverse, state.roadTime,
                                    {nodeRoadOfft, nodeOfft, reverse: state.reverse});
                    }
                    return {
                        name: state.athleteId,
                        coord: [xCoord, yCoord],
                        symbolSize: isWatching ? this.em(1.1) : deemphasize ? this.em(0.35) : this.em(0.55),
                        itemStyle: {
                            color: isWatching ? '#f43e' : deemphasize ? '#0002' : '#fff7',
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
                                align: (xIdx > this._distances.length / 2) ^ this.reverse ? 'right' : 'left',
                                padding: [
                                    this.em(0.2 * markPointLabelSize),
                                    this.em(0.3 * markPointLabelSize)
                                ],
                                formatter: this.onMarkEmphasisLabel.bind(this),
                            }
                        },
                    };
                }).filter(x => x),
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
