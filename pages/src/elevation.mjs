import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const H = locale.human;


function getSubgroupLazy(id) {
    const sg = common.getEventSubgroup(id);
    if (!sg || sg instanceof Promise) {
        return null;
    }
    return sg;
}


export class SauceElevationProfile {

    leadinColor = '#37f';
    weldColor = '#fa0';

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
                    let segmentHtml = '';
                    const segmentSeries = series.find(x => x.seriesId.startsWith('segment-'));
                    if (segmentSeries) {
                        const segment = segmentSeries.data[2];
                        segmentHtml = `<br/>${segment.name}: ` +
                            H.distance(segment.distance, {suffix: true, html: true});
                    }
                    let sectorHtml = '';
                    const sectorSeries = series.find(x => x.seriesId.startsWith('sector-'));
                    if (sectorSeries) {
                        const sector = sectorSeries.data[2];
                        sectorHtml = `<br/>${sector.name}: ` +
                            H.distance(sector.distance, {suffix: true, html: true});
                    }
                    const dist = (this.reverse && this._distances) ?
                        this._distances.at(-1) - value[0] : value[0];
                    return `Dist: ${H.distance(dist, {suffix: true})}, ` +
                        `<ms large>landscape</ms>${H.elevation(value[1], {suffix: true})} ` +
                        `<small>(${H.number(value[2] * 100, {suffix: '%'})})</small>` +
                        segmentHtml +
                        sectorHtml;
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
        this.marks = new Map();
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

    _resetPath() {
        this.curvePath = null;
        this._distances = null;
        this._elevations = null;
        this._grades = null;
        this.road = null;
        this.reverse = null;
        this.route = null;
        this.routeId = null;
        this.routePrelude = null;
        this.eventSubgroupId = null;
        this.lapStartIndex = null;
        this.routeLaps = null;
    }

    clear() {
        this._resetPath();
        this.setData([], [], []);
    }

    setRoad(id, reverse=false) {
        this._resetPath();
        this.road = this.roads ? this.roads.find(x => x.id === id) : null;
        if (!this.road) {
            console.warn("Road not found:", id);
            return;
        }
        this.reverse = reverse;
        this.curvePath = this.road.curvePath;
        this.setData(this.road.distances, this.road.elevations, this.road.grades, {reverse});
    }

    setRoute = common.asyncSerialize(async function(id, {laps=1, distance, eventSubgroupId,
                                                         hideLaps, prelude='leadin'}={}) {
        this._resetPath();
        let eventSubgroup;
        if (eventSubgroupId) {
            eventSubgroup = await common.getEventSubgroup(eventSubgroupId);
            if (!eventSubgroup) {
                console.warn('Event subgroup not found:', eventSubgroupId);
                return;
            }
            this.eventSubgroupId = eventSubgroupId;
            this.routeId = eventSubgroup.routeId;
            laps = eventSubgroup.laps;
            distance = eventSubgroup.distanceInMeters;
        } else {
            this.routeId = id;
        }
        this.route = await common.getRoute(this.routeId, {prelude});
        if (!this.route) {
            console.warn("Route not found:", this.routeId);
            this.routeId = null;
            return;
        }
        this.routePrelude = prelude;
        this.curvePath = this.route.curvePath.slice();
        if (distance) {
            laps = this.route.supportedLaps ? 1e4 : 1;
        }
        const distances = Array.from(this.route.distances);
        const elevations = Array.from(this.route.elevations);
        const grades = Array.from(this.route.grades);
        const routeSegments = [];
        const lapSegments = [];
        const sectors = [];
        const lapOffsets = [];
        let preludeDist = 0;
        for (const [i, m] of this.route.manifest.entries()) {
            if (this.lapStartIndex == null && !m.leadin) {
                this.lapStartIndex = this.curvePath.nodes.findIndex(x => x.index === i);
            }
            if (!m.segments) {
                continue;
            }
            for (const segment of m.segments) {
                const rcp = this.route.sections[i].roadCurvePath;
                const i1 = Math.round(rcp.roadPercentToOffset(segment.roadStart));
                const i2 = Math.round(rcp.roadPercentToOffset(segment.roadFinish));
                const offt = this.route.curvePath.nodes.findIndex(x => x.index === i);
                let start, end;
                if (segment.reverse) {
                    start = offt + (rcp.nodes.length - 1 - i1);
                    end = offt + (rcp.nodes.length - 1 - i2);
                } else {
                    start = offt + i1;
                    end = offt + i2;
                }
                routeSegments.push({start, end, segment});
            }
        }
        if (this.lapStartIndex) {
            preludeDist = distances[this.lapStartIndex];
            if (!hideLaps) {
                lapOffsets.push(preludeDist);
            }
            sectors.push({
                name: prelude === 'leadin' ? 'Leadin' : 'Interlude',
                color: prelude === 'leadin' ? this.leadinColor : this.weldColor,
                start: 0,
                end: this.lapStartIndex - 1,
                distance: preludeDist,
            });
        }
        this.routeLaps = [{
            lap: 0,
            index: 0,
            offsetDistance: 0,
            distance: distances.at(-1),
        }];
        if (laps > 1) {
            const lapSlice = this.route.curvePath.slice(this.lapStartIndex);
            const lapDistances = this.route.distances.slice(this.lapStartIndex).map(x => x - preludeDist);
            const lapElevations = this.route.elevations.slice(this.lapStartIndex);
            const lapGrades = this.route.grades.slice(this.lapStartIndex);
            for (let lap = 1; lap < laps; lap++) {
                const lapEntry = {
                    lap,
                    index: distances.length,
                    offsetDistance: distances.at(-1),
                };
                this.routeLaps.push(lapEntry);
                if (!hideLaps) {
                    lapOffsets.push(distances.at(-1));
                }
                if (this.route.lapWeldPath) {
                    const dOfft = distances.at(-1);
                    const weld = this.route.lapWeldData;
                    sectors.push({
                        name: 'Interlude',
                        color: this.weldColor,
                        start: distances.length,
                        end: distances.length + weld.distances.length - 1,
                        distance: weld.distances.at(-1),
                    });
                    for (let i = 0; i < weld.distances.length; i++) {
                        distances.push(dOfft + weld.distances[i]);
                        elevations.push(weld.elevations[i]);
                        grades.push(weld.grades[i]);
                    }
                    this.curvePath.extend(this.route.lapWeldPath);  // NOTE: has no nodes[].index values
                }
                for (const x of routeSegments) {
                    lapSegments.push({
                        start: distances.length + x.start - this.lapStartIndex,
                        end: distances.length + x.end - this.lapStartIndex,
                        segment: x.segment
                    });
                }
                this.curvePath.extend(lapSlice);
                const dOfft = distances.at(-1);
                for (let i = 0; i < lapDistances.length; i++) {
                    distances.push(dOfft + lapDistances[i]);
                    elevations.push(lapElevations[i]);
                    grades.push(lapGrades[i]);
                }
                lapEntry.distance = distances.at(-1) - lapEntry.offsetDistance;
                if (distance && distances.at(-1) >= distance) {
                    break;
                }
            }
        }
        const segments = routeSegments.concat(lapSegments);
        if (distance) {
            while (distances[distances.length - 1] > distance) {
                distances.pop();
                elevations.pop();
                grades.pop();
            }
            while (segments.length && segments.at(-1).end >= distances.length) {
                segments.pop();
            }
            const lapEntry = this.routeLaps.at(-1);
            lapEntry.distance = distances.at(-1) - lapEntry.offsetDistance;
            this.curvePath = this.curvePath.slice(0, distances.length);
        }
        const len = distances.length;
        if (this.curvePath.nodes.length !== len || elevations.length !== len || grades.length !== len) {
            console.error('Internal Alignment Error');
        }
        this.setData(distances, elevations, grades, {lapOffsets, segments, sectors});
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
        if (options.sectors) {
            for (const sector of options.sectors) {
                seriesExtra.push({
                    ...commonSeriesOptions,
                    zlevel: seriesExtra.length + 2,
                    id: `sector-${sector.name}-${seriesExtra.length}`,
                    name: sector.name,
                    lineStyle: {width: 0},
                    emphasis: {
                        areaStyle: {
                            opacity: sector.opacity != null ? sector.opacity + 0.1 : 0.5,
                        },
                    },
                    areaStyle: {
                        color: sector.color,
                        opacity: sector.opacity ?? 0.4,
                        origin: 'start',
                    },
                    data: distances.slice(sector.start, sector.end + 1)
                        .map((x, i) => [x, elevations.at(i + sector.start), sector]),
                });
            }
        }
        if (options.segments) {
            for (const segment of options.segments) {
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
                        color: '#0f0',
                        opacity: 0.4,
                        origin: 'start',
                    },
                    data: distances.slice(segment.start, segment.end + 1).map((x, i) =>
                        [x, elevations.at(i + segment.start), segment.segment]),
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
                                xAxis: distances[segment.end],
                                yAxis: this._yAxisMin,
                            }, {
                                symbol: 'circle',
                                symbolSize: this.em(0.2),
                                xAxis: distances[segment.end],
                                yAxis: Math.min(this._yAxisMax, elevations[segment.end] + (vRange * 0.18)),
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
                    const distance = api.value(0);
                    const elevation = api.value(1);
                    const visualGrade = api.value(2);
                    const isWatching = api.value(3);
                    const deemphasize = api.value(4);
                    const ghost = api.value(5);
                    const category = api.value(6);
                    const size = this.em(isWatching ? 0.9 : deemphasize ? 0.26 : 0.38);
                    const catColor = category && {
                        'A': '#d93826',
                        'B': '#44d926',
                        'C': '#19e5e6',
                        'D': '#e5e619',
                        'E': '#7f19e6',
                    }[category];
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
                            } : catColor ? {
                                type: 'radial',
                                x: 0.5,
                                y: 0.3,
                                r: 1.68,
                                colorStops: [{
                                    offset: 0,
                                    color: deemphasize ? '#fff5' : '#fffa',
                                }, {
                                    offset: 0.22,
                                    color: deemphasize ? '#eee7' : '#eeed',
                                }, {
                                    offset: 0.26,
                                    color: Color.fromHex(catColor).alpha(deemphasize ? 0.7 : 0.9).toString(),
                                }],
                            } : '#eeeb',
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
                        const ad = common.getAthleteDataCacheEntry(mark.athleteId, {maxAge: 1e9});
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
                if (watching.eventSubgroupId) {
                    if (this.eventSubgroupId !== watching.eventSubgroupId) {
                        await this.setRoute(null, {eventSubgroupId: watching.eventSubgroupId});
                    }
                } else if (watching.routeId) {
                    const prelude = (watching.laps ||
                        (watching.routeDistance &&
                         watching.routeDistance / watching.routeEnd > 0.5)) ? 'weld' : 'leadin';
                    if (this.routeId !== watching.routeId ||
                        this.eventSubgroupId ||
                        this.routePrelude !== prelude) {
                        await this.setRoute(watching.routeId, {prelude});
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
                    smoothGrade: common.expWeightedAvg(10),
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
        if (!this._distances || this._distances.length < 2) {
            return;
        }
        const x1 = this.chart.convertToPixel({xAxisIndex: 0}, 0);
        const x2 = this.chart.convertToPixel({xAxisIndex: 0}, 1);
        const y1 = this.chart.convertToPixel({yAxisIndex: 0}, 0);
        const y2 = this.chart.convertToPixel({yAxisIndex: 0}, -1);
        const chartAspectRatio = (y2 - y1) / (x2 - x1);
        const marks = Array.from(this.marks.values());
        marks.sort((a, b) => a.athleteId === this.watchingId ? 1 : b.athleteId === this.watchingId ? -1 : 0);
        const data = marks.map(mark => {
            let state = mark.state;
            let xIdxFloat = this.findMarkPosition(state);
            let ghost;
            if (xIdxFloat == null && mark.lastVisualState && now - mark.lastVisualTS < 5000) {
                xIdxFloat = this.findMarkPosition(mark.lastVisualState);
                state = mark.lastVisualState;
                ghost = true;
            }
            if (xIdxFloat == null || isNaN(xIdxFloat)) {
                return;
            }
            const xIdx = xIdxFloat | 0;
            const xRem = xIdxFloat % 1;
            let xCoord;
            let yCoord;
            let grade;
            if (xRem) {
                const dDelta = this._distances[xIdx + 1] - this._distances[xIdx];
                const eDelta = this._elevations[xIdx + 1] - this._elevations[xIdx];
                xCoord = this._distances[xIdx] + dDelta * xRem;
                yCoord = this._elevations[xIdx] + eDelta * xRem;
                grade = eDelta / dDelta;
            } else {
                xCoord = this._distances[xIdx];
                yCoord = this._elevations[xIdx];
                const lowerIdx = (xIdx < this._elevations.length - 1) ? xIdx : this._elevations.length - 2;
                grade = (this._elevations[lowerIdx + 1] - this._elevations[lowerIdx]) /
                        (this._distances[lowerIdx + 1] - this._distances[lowerIdx]);
            }
            if (isNaN(grade) || grade < -1 || grade > 1) {
                grade = state.grade;
            }
            const smoothGrade = mark.smoothGrade(grade);
            const maxExaggeration = 30;
            const visualGrade = Math.min(chartAspectRatio, maxExaggeration) * smoothGrade * 0.5;
            const isWatching = state.athleteId === this.watchingId;
            let category;
            let deemphasize;
            if (this.eventSubgroupId) {
                deemphasize = this.eventSubgroupId !== state.eventSubgroupId;
                if (state.eventSubgroupId) {
                    const sg = getSubgroupLazy(state.eventSubgroupId);
                    category = sg?.subgroupLabel;
                }
            } else if (this.routeId != null) {
                deemphasize = this.routeId !== state.routeId;
            }
            if (state !== mark.lastVisualState) {
                mark.lastVisualState = state;
                mark.lastVisualTS = now;
            }
            if (isWatching) {
                this._lastWatchingMeta = {
                    state,
                    ts: now,
                    xIdxFloat,
                };
            }
            return {
                name: state.athleteId,
                value: [xCoord, yCoord, visualGrade, isWatching, deemphasize, ghost, category]
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
        if (this.routeId != null) {
            let profileDistance;
            if (state.routeId !== this.routeId) {
                // Not on our route but perhaps nearby..
                if (!this._lastWatchingMeta) {
                    return;
                }
                const ourIdx = this._lastWatchingMeta.xIdxFloat | 0;
                const startSectionIdx = this.route.curvePath.nodes[ourIdx]?.index;
                if (startSectionIdx == null) {
                    return;
                }
                const lws = this._lastWatchingMeta.state;
                let sectionMatch;
                // middle out search for matching road section...
                for (let i = 0; i <= this.route.sections.length / 2; i++) {
                    let leftIdx = startSectionIdx - i;
                    if (leftIdx < 0) {
                        leftIdx = this.route.sections.length + leftIdx;
                    }
                    const s = this.route.sections[leftIdx];
                    if (s.roadId === state.roadId && !s.reverse === !state.reverse &&
                        (!s.leadin || this.routePrelude === 'leadin') &&
                        (!s.weld || this.routePrelude === 'weld') &&
                        s.roadCurvePath.includesRoadTime(state.roadTime)) {
                        sectionMatch = s;
                        break;
                    }
                    if (i) {
                        const rightIdx = (startSectionIdx + i) % this.route.sections.length;
                        const s = this.route.sections[rightIdx];
                        if (s.roadId === state.roadId && !s.reverse === !state.reverse &&
                            (!s.leadin || this.routePrelude === 'leadin') &&
                            (!s.weld || this.routePrelude === 'weld') &&
                            s.roadCurvePath.includesRoadTime(state.roadTime)) {
                            sectionMatch = s;
                            break;
                        }
                    }
                }
                if (sectionMatch) {
                    const lapEntry = this.routeLaps[lws.laps] || this.routeLaps.at(-1);
                    const preludeDist = this.routePrelude === 'leadin' && lapEntry.index === 0 ?
                        this.route.meta.leadinDistance :
                        this.route.meta.weldDistance;
                    profileDistance = lapEntry.offsetDistance +
                        ((!sectionMatch.leadin && !sectionMatch.weld) ? preludeDist : 0) +
                        sectionMatch.blockOffsetDistance +
                        sectionMatch.roadCurvePath.distanceAtRoadTime(state.roadTime, 1/20) / 100;
                }
            } else if (state.routeDistance != null) {
                // Adjust state.routeDistance prelude to match our visual prelude..
                // Easiest way to think of this is we calculate the distance remaining
                // in the lap and subtract that from our visual depection because the
                // lap finish line never changes but the start line can.
                const lapEntry = this.routeLaps[state.laps] || this.routeLaps.at(-1);
                const adjDist = lapEntry.distance - (state.routeEnd - state.routeDistance);
                profileDistance = lapEntry.offsetDistance + adjDist;
            }
            if (profileDistance == null || Number.isNaN(profileDistance)) {
                return;
            }
            const nearIdx = common.binarySearchClosest(this._distances, profileDistance);
            if (nearIdx === -1 || nearIdx == null) {
                return;
            }
            const diff = profileDistance - this._distances[nearIdx];
            let left;
            if (diff >= 0) {
                left = nearIdx;
            } else {
                left = nearIdx - 1;
            }
            return left + (profileDistance - this._distances[left]) /
                           (this._distances[left + 1] - this._distances[left]);
        } else if (this.road && this.road.id === state.roadId && !!this.reverse === !!state.reverse) {
            return this.road.curvePath.roadTimeToOffset(state.roadTime);
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
