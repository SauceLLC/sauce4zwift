import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const H = locale.human;


export class SauceElevationProfile {
    constructor({el, worldList, preferRoute, showMaxLine, disableAthletePoints, refresh=1000}) {
        this.el = el;
        this.worldList = worldList;
        this.preferRoute = preferRoute;
        this.showMaxLine = showMaxLine;
        this.disableAthletePoints = disableAthletePoints;
        this.refresh = refresh;
        this._lastRender = 0;
        this._refreshTimeout = null;
        el.classList.add('sauce-elevation-profile-container');
        this.chart = ec.init(el, 'sauce', {renderer: 'svg'});
        this.chart.setOption({
            animation: false,
            tooltip: {
                transitionDuration: 0,
                trigger: 'axis',
                formatter: series => {
                    if (!series[0] || !series[0].value) {
                        return '';
                    }
                    const value = series[0].value;
                    let segmentInfo = '';
                    const segmentSeries = series.find(x => x.seriesId.startsWith('segment-'));
                    if (segmentSeries) {
                        const segment = segmentSeries.data[2];
                        segmentInfo = `<br/>${segment.name}, ` +
                            H.distance(segment.distance, {suffix: true, html: true});
                    }
                    const dist = (this.reverse && this._distances) ?
                        this._distances.at(-1) - value[0] : value[0];
                    return `Dist: ${H.distance(dist, {suffix: true})}, ` +
                        `<ms large>landscape</ms>${H.elevation(value[1], {suffix: true})} ` +
                        `<small>(${H.number(value[2] * 100, {suffix: '%'})})</small>${segmentInfo}`;
                },
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
            // Must stub out some basic series data to handle early onResize (pre-data)
            series: [{
                id: 'elevation',
                type: 'line'
            }, {
                id: 'mark-points',
                type: 'custom',
                renderItem: () => {}
            }],
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
        const tooltipSize = 0.5;
        const topMargin = this.disableAthletePoints ? 0.1 : 1;
        this.chart.setOption({
            grid: {top: this.em(topMargin), right: 0, bottom: 0, left: 0},
            series: [{
                id: 'elevation',
                markLine: {
                    label: {
                        fontSize: this.em(0.4),
                        distance: this.em(0.18 * 0.4)
                    }
                }
            },{
                id: 'mark-points',
                data: [], // Only known way to get custom series to resize things
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
                padding: [this.em(0.1 * tooltipSize), this.em(0.5 * tooltipSize)],
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

    clear() {
        this.route = null;
        this.routeId = null;
        this._eventSubgroupId = null;
        this._routeLeadinDistance = 0;
        this.road = undefined;
        this.reverse = undefined;
        this.curvePath = undefined;
        this.setData([], [], []);
    }

    setRoad(id, reverse=false) {
        this.route = null;
        this.routeId = null;
        this._eventSubgroupId = null;
        this._routeLeadinDistance = 0;
        this.road = this.roads ? this.roads.find(x => x.id === id) : undefined;
        if (this.road) {
            this.reverse = reverse;
            this.curvePath = this.road.curvePath;
            this.setData(this.road.distances, this.road.elevations, this.road.grades, {reverse});
        } else {
            this.reverse = undefined;
            this.curvePath = undefined;
        }
    }

    setRoute = common.asyncSerialize(async function(id, {laps=1, distance, eventSubgroupId, hideLaps}={}) {
        this.road = null;
        this.reverse = null;
        this.routeId = id;
        this._eventSubgroupId = eventSubgroupId;
        this.curvePath = null;
        this.route = await common.getRoute(id);
        const segments = [];
        for (const [i, m] of this.route.manifest.entries()) {
            if (!m.segments) {
                continue;
            }
            for (const segment of m.segments) {
                const road = this.route.roadSegments[i];
                const i1 = Math.round(road.roadPercentToOffset(segment.roadStart));
                const i2 = Math.round(road.roadPercentToOffset(segment.roadFinish));
                const offt = this.route.curvePath.nodes.findIndex(x => x.index === i);
                let start, end;
                if (segment.reverse) {
                    start = offt + (road.nodes.length - 1 - i1);
                    end = offt + (road.nodes.length - 1 - i2);
                } else {
                    start = offt + i1;
                    end = offt + i2;
                }
                segments.push({start, end, segment});
            }
        }
        this.curvePath = this.route.curvePath.slice();
        const distances = Array.from(this.route.distances);
        const elevations = Array.from(this.route.elevations);
        const grades = Array.from(this.route.grades);
        const lapOffsets = [];
        const notLeadin = this.route.manifest.findIndex(x => !x.leadin);
        const lapStartIdx = notLeadin === -1 ? 0 : this.curvePath.nodes.findIndex(x => x.index === notLeadin);
        if (lapStartIdx) {
            if (!hideLaps) {
                lapOffsets.push(distances[lapStartIdx]);
            }
            this._routeLeadinDistance = distances[lapStartIdx];
        } else {
            this._routeLeadinDistance = 0;
        }
        const lapDistance = distances.at(-1) - distances[lapStartIdx];
        if (distance) {
            laps = this.route.supportedLaps ? Infinity : 1;
        }
        for (let lap = 1; lap < laps; lap++) {
            this.curvePath.extend(this.route.curvePath.slice(lapStartIdx));
            for (let i = lapStartIdx; i < this.route.distances.length; i++) {
                distances.push(distances.at(-1) +
                    (this.route.distances[i] - (this.route.distances[i - 1] || 0)));
                elevations.push(this.route.elevations[i]);
                grades.push(this.route.grades[i]);
            }
            if (!hideLaps) {
                lapOffsets.push(this._routeLeadinDistance + lapDistance * lap);
            }
            if (distance && distances[distances.length - 1] >= distance) {
                break;
            }
        }
        if (distance) {
            while (distances[distances.length - 1] > distance) {
                distances.pop();
                elevations.pop();
                grades.pop();
            }
        }
        this.setData(distances, elevations, grades, {lapOffsets, segments});
        return this.route;
    });

    setData(distances, elevations, grades, options={}) {
        this._distances = distances;
        this._elevations = elevations;
        this._grades = grades;
        this._yMax = Math.max(...elevations);
        this._yMin = Math.min(...elevations);
        const minEl = Math.max(this._yMin + 200, this._yMax);
        const vRange = minEl - this._yMin;
        // Echarts bug requires floor/ceil to avoid missing markLines
        this._yAxisMin = Math.floor(this._yMin - (vRange * 0.10));
        this._yAxisMax = Math.ceil(minEl + (vRange * 0.10));
        const commonSeriesOptions = {
            type: 'line',
            symbol: 'none',
            sampling: 'lttb', // TESTING: Hopefully low/no impact except for IRL routes that are 10k+ points
        };
        const markLineData = [];
        if (options.lapOffsets) {
            for (const [i, distance] of options.lapOffsets.entries()) {
                markLineData.push([{
                    xAxis: distance,
                    yAxis: this._yAxisMin,
                    symbol: 'none',
                    lineStyle: {
                        width: this.em(0.12),
                        type: 'solid',
                        color: '#dd9c',
                        cap: 'butt',
                    },
                    name: `LAP ${i + 1}`,
                    label: {
                        show: false,
                    },
                    emphasis: {
                        lineStyle: {color: '#dd9'},
                        label: {
                            show: true,
                            fontSize: '0.4em',
                            offset: [0, -4],
                            position: 'end',
                            rotate: 0,
                        }
                    },
                }, {
                    symbol: 'none',
                    xAxis: distance,
                    yAxis: elevations[common.binarySearchClosest(distances, distance)],
                    emphasis: {
                        lineStyle: {width: 5},
                        label: {fontSize: '0.5em'}
                    },
                }]);
            }
        }
        if (this.showMaxLine) {
            const distance = distances[elevations.indexOf(this._yMax)];
            const relOffset = distance / distances.at(-1);
            markLineData.push([{
                xAxis: distance,
                yAxis: this._yMax,
                emphasis: {disabled: true},
                lineStyle: {
                    width: this.em(0.05),
                    color: '#fff6',
                },
                label: {
                    opacity: 0.8,
                    offset: [(relOffset> 0.5 ? -1 : 1) * this.em(0.05), this.em(-0.08)],
                    fontSize: '0.45em',
                    formatter: x => H.elevation(this._yMax, {suffix: true}),
                    position: 'insideEndTop',
                },
            }, {
                xAxis: relOffset > 0.5 ? distances.at(-1) : 0,
                yAxis: this._yMax,
            }]);
        }
        if (options.markLines) {
            markLineData.push(...options.markLines);
        }
        const seriesExtra = [];
        if (options.segments) {
            for (const {start, end, segment} of options.segments) {
                seriesExtra.push({
                    ...commonSeriesOptions,
                    zlevel: seriesExtra.length + 2,
                    id: `segment-${segment.id}-${seriesExtra.length}`,
                    name: segment.name,
                    lineStyle: {width: 0},
                    emphasis: {
                        areaStyle: {
                            opacity: 0.5,
                        },
                    },
                    areaStyle: {
                        color: 'gold',
                        opacity: 0.4,
                        origin: 'start',
                    },
                    data: distances.slice(start, end + 1).map((x, i) =>
                        [x, elevations.at(i + start), segment]),
                    markLine: {
                        emphasis: {
                            lineStyle: {
                                color: '#fff', // required to avoid being hidden
                            },
                        },
                        lineStyle: {
                            type: 'solid',
                            color: '#ddd',
                            width: this.em(0.05),
                        },
                        data: [
                            [{
                                symbol: 'none',
                                xAxis: distances[end],
                                yAxis: this._yAxisMin,
                            }, {
                                symbol: 'circle',
                                symbolSize: this.em(0.2),
                                xAxis: distances[end],
                                yAxis: Math.min(this._yAxisMax, elevations[end] + (vRange * 0.18)),
                            }]
                        ]
                    }
                });
            }
        }
        this.chart.setOption({
            dataZoom: {type: 'inside'},
            xAxis: {inverse: options.reverse},
            yAxis: {
                min: this._yAxisMin,
                max: this._yAxisMax,
            },
            series: [{
                ...commonSeriesOptions,
                name: 'Elevation',
                id: 'elevation',
                emphasis: {disabled: true},
                encode: {
                    x: 0,
                    y: 1,
                    tooltip: [0, 1, 2]
                },
                areaStyle: {
                    origin: 'start',
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
                                offset: x / (distances[distances.length - 1] - distances[0]),
                                color: color.toString(),
                            };
                        }),
                    },
                },
                markLine: {
                    symbol: 'none',
                    emphasis: {disabled: false},
                    data: markLineData,
                },
                data: distances.map((x, i) => [x, elevations[i], grades[i] * (options.reverse ? -1 : 1)]),
            }, {
                id: 'mark-points',
                type: 'custom',
                z: 5,
                renderItem: (param, api) => {
                    const [distance, elevation, visualGrade, isWatching, deemphasize, ghost] =
                        [api.value(0), api.value(1), api.value(2), api.value(3), api.value(4), api.value(5)];
                    const size = this.em(isWatching ? 0.9 : deemphasize ? 0.28 : 0.4);
                    return {
                        type: 'path',
                        shape: {
                            pathData: 'M87.084,192 c-0.456-5.272-0.688-10.6-0.688-16' +
                                'C86.404,78.8,162.34,0,256.004,0 s169.6,78.8,169.6,176' +
                                'c0,5.392-0.232,10.728-0.688,16 h0.688 c0,96.184-169.6,320-169.6,320' +
                                's-169.6-223.288-169.6-320 H87.084z' +
                                'M256.004,224 c36.392,1.024,66.744-27.608,67.84-64' +
                                'c-1.096-36.392-31.448-65.024-67.84-64' +
                                'c-36.392-1.024-66.744,27.608-67.84,64' +
                                'C189.26,196.392,219.612,225.024,256.004,224z',
                            x: -size / 2,
                            y: -size,
                            width: size,
                            height: size
                        },
                        rotation: Math.atan(visualGrade),
                        position: api.coord([distance, elevation]),
                        style: {
                            opacity: ghost ? 0.6 : 1,
                            stroke: deemphasize ? '#0007' : '#000b',
                            lineWidth: isWatching ? 1 : 0.5,
                            fill: isWatching ? {
                                type: 'linear',
                                x: 0,
                                y: 1,
                                x2: 0,
                                y2: 0,
                                colorStops: [{
                                    offset: 0,
                                    color: '#ff0',
                                }, {
                                    offset: 0.5,
                                    color: '#e03c',
                                }],
                            } : deemphasize ? '#9995' : '#fffb',
                        }
                    };
                },
                tooltip: {
                    trigger: 'item',
                    formatter: params => {
                        const mark = this.marks.get(+params.name);
                        if (!mark) {
                            return;
                        }
                        const ad = common.getAthleteDataCacheEntry(mark.athleteId);
                        const name = ad?.athlete?.fLast || `ID: ${mark.athleteId}`;
                        return `${name}, ${H.power(mark.state.power, {suffix: true})}`;
                    }
                },
                data: [],
            }, ...seriesExtra]
        }, {replaceMerge: 'series'});
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
                            await this.setRoute(sg.routeId, {
                                laps: sg.laps,
                                distance: sg.distanceInMeters,
                                eventSubgroupId: sg.id
                            });
                        } else if (this.routeId !== watching.routeId) {
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
                    smoothGrade: common.expWeightedAvg(10, state.grade),
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
        const x1 = this.chart.convertToPixel({xAxisIndex: 0}, 0);
        const x2 = this.chart.convertToPixel({xAxisIndex: 0}, 1);
        const y1 = this.chart.convertToPixel({yAxisIndex: 0}, 0);
        const y2 = this.chart.convertToPixel({yAxisIndex: 0}, -1);
        const chartAspectRatio = (y2 - y1) / (x2 - x1);
        const marks = Array.from(this.marks.values());
        marks.sort((a, b) => a.athleteId === this.watchingId ? 1 : b.athleteId === this.watchingId ? -1 : 0);
        const data = marks.map(mark => {
            let state = mark.state;
            let xIdx = this.findMarkPosition(state);
            let ghost;
            if (xIdx === undefined && mark.lastVisualState && now - mark.lastVisualTS < 5000) {
                xIdx = this.findMarkPosition(mark.lastVisualState);
                state = mark.lastVisualState;
                ghost = true;
            }
            if (xIdx === undefined) {
                return;
            }
            let xCoord;
            let yCoord;
            if (xIdx % 1) {
                // TBD: Use closest node instead of always next (which might be unavailable too)
                const i = xIdx | 0;
                if (i === this._distances.length - 1) {
                    debugger; // FIXME
                }
                const dDelta = this._distances[i + 1] - this._distances[i];
                const eDelta = this._elevations[i + 1] - this._elevations[i];
                xCoord = this._distances[i] + dDelta * (xIdx % 1);
                yCoord = this._elevations[i] + eDelta * (xIdx % 1);
            } else {
                xCoord = this._distances[xIdx];
                yCoord = this._elevations[xIdx];
            }
            const maxExaggeration = 30;
            const visualGrade = Math.min(chartAspectRatio, maxExaggeration) *
                mark.smoothGrade(state.grade) * 0.5;
            const isWatching = state.athleteId === this.watchingId;
            const deemphasize = this.routeId != null && (
                state.routeId !== this.routeId ||
                (this._eventSubgroupId != null && state.eventSubgroupId !== this._eventSubgroupId));
            if (state !== mark.lastVisualState) {
                mark.lastVisualState = state;
                mark.lastVisualTS = now;
            }
            return {
                name: state.athleteId,
                value: [xCoord, yCoord, visualGrade, isWatching, deemphasize, ghost]
            };
        }).filter(x => x);
        // echarts merge algo is quite broken.. must reset data.
        this.chart.setOption({series: {id: 'mark-points', data: []}});
        this.chart.setOption({series: {id: 'mark-points', data}});
        for (const [athleteId, mark] of this.marks.entries()) {
            if (now - mark.lastSeen > 15000) {
                this.marks.delete(athleteId);
            }
        }
    }

    findMarkPosition(state) {
        let roadSeg;
        let nodeRoadOfft;
        const nodes = this.curvePath.nodes;
        if (this.routeId != null) {
            if (state.routeId === this.routeId) {
                let distance;
                if (this._eventSubgroupId != null) {
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
                // NOTE: This technique does not work for bots or people who joined a bot.
                // I don't know why but progress and eventDistance are completely wrong.
                roadSearch:
                for (let offt = 0; offt < 12; offt++) {
                    for (const dir of [1, -1]) {
                        const segIdx = nearRoadSegIdx + (offt * dir);
                        const s = this.route.roadSegments[segIdx];
                        if (s && s.roadId === state.roadId && !!s.reverse === !!state.reverse &&
                            s.includesRoadTime(state.roadTime)) {
                            roadSeg = s;
                            // We found the road segment but need to find the exact node offset
                            // to support multi-lap configurations...
                            for (let i = nearIdx; i >= 0 && i < nodes.length; i += dir) {
                                if (nodes[i].index === segIdx) {
                                    // Rewind to first node of this segment.
                                    while (i > 0 && nodes[i - 1].index === segIdx) {
                                        i--;
                                    }
                                    nodeRoadOfft = i;
                                    break;
                                }
                            }
                            break roadSearch;
                        }
                    }
                }
            }
            if (!roadSeg) {
                // Not on our route but might be nearby..
                const i = this.route.roadSegments.findIndex(x =>
                    x.roadId === state.roadId &&
                    !!x.reverse === !!state.reverse &&
                    x.includesRoadTime(state.roadTime));
                if (i === -1) {
                    return;
                }
                roadSeg = this.route.roadSegments[i];
                nodeRoadOfft = nodes.findIndex(x => x.index === i);
            }
        } else if (this.road && this.road.id === state.roadId && !!this.reverse === !!state.reverse) {
            roadSeg = this.road.curvePath;
            nodeRoadOfft = 0;
        }
        if (!roadSeg) {
            return;
        }
        const bounds = roadSeg.boundsAtRoadTime(state.roadTime);
        const nodeOfft = roadSeg.reverse ?
            roadSeg.nodes.length - 1 - (bounds.index + bounds.percent) :
            bounds.index + bounds.percent;
        const xIdx = nodeRoadOfft + nodeOfft;
        if (xIdx < 0 || xIdx > this._distances.length - 1) {
            console.error("route index offset bad!", {xIdx});
            return;
        }
        return xIdx;
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
