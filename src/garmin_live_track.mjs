import EventEmitter from 'node:events';
import fetch from 'node-fetch';
import sauce from '../shared/sauce/index.mjs';


async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}


class RollingPeaks {
    constructor(Klass, firstTS, periods, options={}) {
        const defOptions = {idealGap: 1, maxGap: 60, active: true};
        this._firstTS = firstTS;
        this.roll = new Klass(null, {...defOptions, ...options});
        this.periodized = new Map(periods.map(period => [period, {
            roll: this.roll.clone({period}),
            peak: null,
        }]));
        this.max = 0;
    }

    add(ts, value) {
        // XXX Perhaps we should have a aggregation buffer here so
        // we don't accumulate a bunch of repetitive data.
        const time = (ts - this._firstTS) / 1000;
        this.roll.add(time, value);
        if (value > this.max) {
            this.max = value;
        }
        for (const x of this.periodized.values()) {
            x.roll.resize();
            if (x.roll.full()) {
                const avg = x.roll.avg();
                if (x.peak === null || avg >= x.peak.avg()) {
                    x.peak = x.roll.clone();
                    x.peak.ts = ts;
                }
            }
        }
    }

    getStats(extra) {
        const peaks = {};
        const smooth = {};
        for (const [p, {roll, peak}] of this.periodized.entries()) {
            peaks[p] = {avg: peak ? peak.avg() : null, ts: peak ? peak.ts: null};
            smooth[p] = roll.avg();
        }
        return {
            avg: this.roll.avg(),
            max: this.max,
            peaks,
            smooth,
            ...extra,
        };
    }
}


export class Sauce4ZwiftMonitor extends EventEmitter {
    static async factory(session) {
        return new this('127.0.0.1', session);
    }

    constructor(ip, session) {
        super();
        this.ip = ip;
        this.session = session;
        this.setMaxListeners(50);
        this._rolls = new Map();
        this.athleteId = null;
        this.watching = -1;
        this.monitorGarminLiveTrack();
    }

    async monitorGarminLiveTrack() {
        let from = 0;
        while (true) {
            const r = await fetch(`https://livetrack.garmin.com/services/session/${this.session}/trackpoints?from=${from}`);
            if (!r.ok) {
                throw new Error('http error: ' + r.status);
            }
            const data = await r.json();
            for (const x of data.trackPoints) {
                from = +(new Date(x.dateTime));
                this.processPoint(x);
            }
            await sleep(1000);
        }
    }

    processPoint(p) {
        const fitData = p.fitnessPointData;
        const state = {};
        state.athleteId = -1;
        state.ts = +(new Date(p.dateTime));
        state.kj = 0;
        state.speed = p.speed * 3600 / 1000;
        state.cadence = fitData.cadenceCyclesPerMin;
        state.heartrate = fitData.heartRateBeatsPerMin;
        state.power = fitData.powerWatts;
        state.draft = 0;
        this.states.set(state.athleteId, state);
        if (!this._rolls.has(state.athleteId)) {
            const periods = [5, 30, 60, 300, 1200];
            const ts = state.ts;
            this._rolls.set(state.athleteId, {
                power: new RollingPeaks(sauce.power.RollingPower, ts, periods),
                speed: new RollingPeaks(sauce.data.RollingAverage, ts, periods, {ignoreZeros: true}),
                hr: new RollingPeaks(sauce.data.RollingAverage, ts, periods, {ignoreZeros: true}),
                cadence: new RollingPeaks(sauce.data.RollingAverage, ts, [], {ignoreZeros: true}),
                draft: new RollingPeaks(sauce.data.RollingAverage, ts, []),
            });
        }
        const rolls = this._rolls.get(state.athleteId);
        if (state.power != null) {
            rolls.power.add(state.ts, state.power);
        }
        if (state.speed != null) {
            rolls.speed.add(state.ts, state.speed);
        }
        if (state.heartrate != null) {
            rolls.hr.add(state.ts, state.heartrate);
        }
        if (state.draft != null) {
            rolls.draft.add(state.ts, state.draft);
        }
        if (state.cadence != null) {
            rolls.cadence.add(state.ts, state.cadence);
        }
        state.stats = {
            power: rolls.power.getStats({np: rolls.power.roll.np({force: true})}),
            speed: rolls.speed.getStats(),
            hr: rolls.hr.getStats(),
            draft: rolls.draft.getStats(),
            cadence: rolls.cadence.getStats(),
        };
        if (this.watching === state.athleteId) {
            this.emit('watching', this.cleanState(state));
        }
    }

    async start() {
        this._active = true;
        this.states = new Map();
    }

    async stop() {
        this._active = false;
        super.stop();
    }

    cleanState(raw) {
        return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
    }
}
