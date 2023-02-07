import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import {Color} from './color.mjs';
import * as ec from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';

ec.registerTheme('sauce', theme.getTheme('dynamic'));

const H = locale.human;
locale.setImperial(!!common.storage.get('/imperialUnits'));


function vectorDistance(a, b) {
    const xd = b[0] - a[0];
    const yd = b[1] - a[1];
    const zd = b[2] - a[2];
    return Math.sqrt(xd * xd + yd * yd + zd * zd);
}


export class SauceElevationProfile {
    constructor({el, worldList, refresh=1000}) {
        this.el = el;
        this.worldList = worldList;
        this.refresh = refresh;
        this._lastRender = 0;
        this._refreshTimeout = null;
        el.classList.add('sauce-elevation-profile-container');
        this.chart = ec.init(el, 'sauce', {renderer: 'svg'});
        this.chart.setOption({
            animation: false, // We'll use css transitions instead.
            tooltip: {
                trigger: 'axis',
                formatter: ([{value}]) => value ?
                    `${H.elevation(value[1], {suffix: true})}\n${H.number(value[2] * 100, {suffix: '%'})}` : '',
                axisPointer: {z: -1},
            },
            xAxis: {
                type: 'value',
                boundaryGap: false,
                show: false,
                min: 'dataMin',
                max: 'dataMax',
            },
            dataZoom: [{type: 'inside'}],
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
                    lineStyle: {},
                    data: [{
                        type: 'min',
                    }, {
                        type: 'max',
                    }]
                }
            }]
        });
        this.courseId = null;
        this.athleteId = null;
        this.watchingId = null;
        this.selfId = null;
        this.roads = null;
        this.road = null;
        this.reverse = null;
        this.markAnimationDuration = null;
        this.marks = new Map();
        this._statesQueue = [];
        this._busy = false;
        addEventListener('resize', () => {
            this.chart.resize();
        });
    }

    async setCourse(id) {
        this.courseId = id;
        this.road = null;
        this.marks.clear();
        const worldId = this.worldList.find(x => x.courseId === id).worldId;
        this._busy = true;
        try {
            this.roads = await common.getRoads(worldId);
        } finally {
            this._busy = false;
        }
    }

    setAthleteId(id) {
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
        if (this.watchingId != null && this.marks.has(this.watchingId)) {
            this.marks.get(this.watchingId).watching = false;
        }
        this.watchingId = id;
        if (id != null && id !== this.athleteId && this.marks.has(id)) {
            this.marks.get(id).watching = true;
        }
    }

    setRoad(id, reverse=false) {
        this.road = this.roads[id];
        this.reverse = reverse;
        this.chart.setOption({xAxis: {inverse: reverse}});
        // XXX 200 when done validating
        this.markAnimationDuration = 300; // reset so render is not uber-slow
        const distance = this.road.distances[this.road.distances.length - 1];
        this.chart.setOption({series: [{
            areaStyle: {
                color:  {
                    type: 'linear',
                    x: reverse ? 1 : 0,
                    y: 0,
                    x2: reverse ? 0 : 1,
                    y2: 0,
                    colorStops: this.road.distances.map((x, i) => ({
                        offset: x / distance,
                        color: Color.fromRGB(Math.abs(this.road.grades[i] / 0.10), 0, 0.15, 0.95).toString(),
                        //color: new Color(0.33 - Math.min(1, Math.abs(this.road.grades[i] / 0.10)) *
                        //120 / 360), 0.5, 0.5, 0.95).toString(),
                    })),
                },
            },
            data: this.road.distances.map((x, i) =>
                [x, this.road.elevations[i], this.road.grades[i] * (reverse ? -1 : 1)]),
        }]});
    }

    async renderAthleteStates(states) {
        if (this.watchingId == null || this._busy) {
            console.warn("Deferring states proc:", this.watchingId, this._busy);
            return;
        }
        const watching = states.find(x => x.athleteId === this.watchingId);
        if (!watching && this.courseId == null) {
            console.warn("Deferring states proc ALT:", watching, this.courseId);
            return;
        } else if (watching) {
            if (watching.courseId !== this.courseId) {
                console.debug("Setting new course from states render:", watching.courseId);
                await this.setCourse(watching.courseId);
            }
            if (!this.road || this.road.id !== watching.roadId || this.reverse !== watching.reverse) {
                console.debug("Setting new road from states render:", watching.roadId, watching.reverse);
                this.setRoad(watching.roadId, watching.reverse);
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
        /*clearTimeout(this._refreshTimeout);
        if (now - this._lastRender < this.refresh) {
            console.debug("defer render");
            this._refreshTimeout = setTimeout(() => this.renderAthleteStates([]),
                this.refresh - (now - this._lastRender));
            return;
        }*/
            console.debug("doit render");
        this._lastRender = now;
        const marks = Array.from(this.marks.values()).filter(x =>
            x.state.roadId === this.road.id && x.state.reverse === this.reverse);
        this.chart.setOption({series: [{
            markPoint: {
                itemStyle: {borderColor: '#000'},
                animationDurationUpdate: this.markAnimationDuration,
                animationEasingUpdate: 'linear',
                data: marks.map(({state}) => {
                    // XXX
                    const distances = this.road.nodes.map(c => vectorDistance(c.pos, [state.x, state.y, state.z]));
                    const nearest = distances.indexOf(Math.min(...distances));
                    const distance = this.road.distances[nearest];
                    const watching = state.athleteId === this.watchingId;
                    return {
                        name: state.athleteId,
                        coord: [distance, state.altitude + 2],
                        symbolSize: watching ? 40 : 20,
                        itemStyle: {
                            color: watching ? '#f54e' : '#fff6',
                            borderWidth: watching ? 2 : 0,
                        },
                        emphasis: {
                            label: {
                                show: true,
                                fontSize: '0.6em',
                                position: 'top',
                                formatter: this.onMarkEmphasisLabel.bind(this),
                            }
                        }
                    };
                }),
            },
        }]});
        //this.markAnimationDuration = Math.min(1200, this.markAnimationDuration * 1.3);
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
        const data = this.marks.get(params.data.name);
        if (!data) {
            return;
        }
        const items = [
            data.athlete && data.athlete.fLast,
            data.state.power != null ? H.power(data.state.power, {suffix: true}) : null,
            data.state.heartrate ? H.number(data.state.heartrate, {suffix: 'bpm'}) : null,
        ];
        return items.filter(x => x != null).join(', ');
    }
}
