/* global setImmediate */
import {test} from 'node:test';
import assert from 'node:assert';
import {worldTimer} from '../src/zwift.mjs';
import {StatsProcessor, enableTestTimerMode, ADV2QueryReductionEmitter} from '../src/stats.mjs';


const realSetImmediate = setImmediate;
const realSetTimeout = setTimeout;
const networkLatency = 200;

enableTestTimerMode();

const app = {
    _settings: new Map(),
    buildEnd: {},
    getSetting: (x, def) => app._settings.has(x) ? app._settings.get(x) : def,
};

let segmentResults;  // set in test func.


let worldTimerTicks = 0;
worldTimer.serverNow = () => {
    return worldTimerTicks;
};

function worldTimerReset() {
    worldTimerTicks = 0;
}


function worldTimerTick(ms=1) {
    worldTimerTicks += ms;
}


function isTimeReal() {
    return realSetTimeout === setTimeout;
}


function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}


const normalSegmentResults = [];
for (const segmentId of [111, 222, 333]) {
    const athletes = 20;
    for (let i = 0; i < 1000; i++) {
        const ts = i * 3600_000 / 100;
        const athleteId = i % athletes;
        normalSegmentResults.push(Object.freeze({
            segmentId,
            athleteId,
            id: -i,
            ts,
            elapsed: Math.random() * 1000 | 0,
        }));
        // now a dup ts entry.
        normalSegmentResults.push(Object.freeze({
            segmentId,
            athleteId: athleteId + athletes,
            id: -i - 0.5,
            ts,
            elapsed: Math.random() * 1000 | 0,
        }));
    }
}
Object.freeze(normalSegmentResults);


const zwiftAPI = {
    getLiveSegmentLeadersCnt: 0,
    getLiveSegmentLeaders: async () => {
        zwiftAPI.getLiveSegmentLeadersCnt++;
        await (isTimeReal() ? null : sleep(networkLatency));
        return [];
    },
    getLiveSegmentLeaderboardCnt: 0,
    getLiveSegmentLeaderboard: async id => {
        zwiftAPI.getLiveSegmentLeaderboardCnt++;
        await (isTimeReal() ? null : sleep(networkLatency));
        return segmentResults.filter(x => x.segmentId === id);
    },
    getSegmentResultsCnt: 0,
    getSegmentResults: async (id, {from, to, athleteId}={}) => {
        zwiftAPI.getSegmentResultsCnt++;
        await (isTimeReal() ? null : sleep(networkLatency));
        return segmentResults.filter(x => x.segmentId === id && x.ts >= from &&
                                          (to == null || x.ts <= to) &&
                                          (athleteId == null || x.athleteId === athleteId));
    }
};


function getAthleteDataMock({resources, stats}) {
    const statsTypes = ['stats', 'lap', 'lastLap'];
    const bucketTypes = ['laps', 'segments', 'events'];
    const data = {};
    const mockStats = type => ({}); // FILL OUT IF NEEDED
    for (const res of resources) {
        if (statsTypes.includes(res)) {
            data[res] = mockStats(res);
        } else if (bucketTypes.includes(res)) {
            data[res] = [{}];
            if (stats) {
                for (const entry of data[res]) {
                    entry.stats = mockStats(res);
                }
            }
        } else {
            data[res] = {};
        }
    }
    return data;
}


test.suite('stats', () => {

    const throttleFor = 400; // match internal impl of getSegmentResults
    const cacheValidFor = 2000; // match internal impl of getSegmentResults
    let curMock;


    async function advanceEventLoop(ticks, {sync}={}) {
        // Unaffected by mock.timers.enable()..
        // I don't like the idea of filtering out setImmediate from mock.timers
        // as it might still be desirable for control flow of deeply nested calls.
        // But from the outer test code, it's often useful to forcibly wait for
        // an event loop execution.
        if (!ticks || sync) {
            if (ticks) {
                curMock.timers.tick(ticks);
                worldTimerTick(ticks);
            }
            await new Promise(realSetImmediate);
        } else {
            for (let i = 0; i < ticks; i++) {
                curMock.timers.tick(1);
                worldTimerTick(1);
                await new Promise(realSetImmediate);
            }
        }
    }


    test.beforeEach(({mock}) => {
        curMock = mock;
        segmentResults = normalSegmentResults;
        worldTimerReset();
        mock.timers.enable();
        mock.timers.tick(3600_000);
        worldTimerTick(3600_000);
    });

    test('stats StatsProcessor instantiate', () => {
        assert.ok(new StatsProcessor({app, zwiftAPI}));
    });

    test('stats getSegmentResults', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        assert.ok(await sp.getSegmentResults());
    });

    test('stats getSegmentResults(id, {live})', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        assert.ok(await sp.getSegmentResults(1, {live: true}));
    });

    test('stats getSegmentResults(id, {live}) - cache', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        assert.ok(await sp.getSegmentResults(1, {live: true}));
        assert.ok(await sp.getSegmentResults(1, {live: true}));
        assert.ok(await sp.getSegmentResults(1, {live: true}));
    });

    test('stats getSegmentResults(id, {live}) - cache concurrent', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        const cachemiss = sp.getSegmentResults(1, {live: true});
        const cachehit = sp.getSegmentResults(1, {live: true});
        const cachehit2 = sp.getSegmentResults(1, {live: true});
        await advanceEventLoop(networkLatency);
        assert.ok(await cachemiss);
        assert.ok(await cachehit);
        assert.ok(await cachehit2);
    });

    test('stats getSegmentResults(id, {live}) - cache stale concurrent', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        const cachemiss = sp.getSegmentResults(1, {live: true});
        await advanceEventLoop(networkLatency);
        assert.ok(await cachemiss);
        await advanceEventLoop(cacheValidFor - networkLatency + 10); // Still some pending time remains...
        const cacheMissInit = zwiftAPI.getLiveSegmentLeaderboardCnt;
        const cachemiss2 = sp.getSegmentResults(1, {live: true});
        const cachehit = sp.getSegmentResults(1, {live: true});
        const cachehit2 = sp.getSegmentResults(1, {live: true});
        await advanceEventLoop(networkLatency);
        assert.strictEqual(zwiftAPI.getLiveSegmentLeaderboardCnt - cacheMissInit, 1);
        assert.ok(await cachemiss2);
        assert.ok(await cachehit);
        assert.ok(await cachehit2);
    });

    test('stats getSegmentResults(id, {live}) - cache stale concurrent misses', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        const cachemiss = sp.getSegmentResults(1, {live: true});
        await advanceEventLoop(networkLatency);
        assert.ok(await cachemiss);
        await advanceEventLoop(cacheValidFor - networkLatency + 10); // Still some pending time remains...
        let done = 0;
        const cachemiss2 = sp.getSegmentResults(2, {live: true}).then(() => done++);
        const cachehit = sp.getSegmentResults(3, {live: true}).then(() => done++);
        const cachehit2 = sp.getSegmentResults(4, {live: true}).then(() => done++);
        await advanceEventLoop(networkLatency - 1);
        assert.strictEqual(done, 0);
        await advanceEventLoop(1);
        assert.strictEqual(done, 1);
        await advanceEventLoop(throttleFor - 1);
        assert.strictEqual(done, 1);
        await advanceEventLoop(1);
        assert.strictEqual(done, 2);
        await advanceEventLoop(throttleFor - 1);
        assert.strictEqual(done, 2);
        await advanceEventLoop(1);
        assert.strictEqual(done, 3);
        await cachemiss2;
        await cachehit;
        await cachehit2;
    });

    test('stats getSegmentResults(id)', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222);
        assert.strictEqual(results.length, 202);
        assert.ok(results.every(x => x.segmentId === 222));
        results.sort((a, b) => a.ts - b.ts);
        assert.strictEqual(results.at(0).ts, 0);
        assert.strictEqual(results.at(-1).ts, 3600_000);
    });

    test('stats getSegmentResults(id, {athlete})', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222, {athleteId: 3});
        assert.strictEqual(results.length, 5);
        assert.ok(results.every(x => x.segmentId === 222));
        assert.ok(results.every(x => x.athleteId === 3));
    });

    test('stats getSegmentResults(id, {best})', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222, {best: true});
        assert.strictEqual(results.length, 40);
        const athletes = new Set();
        for (const x of results) {
            assert.ok(!athletes.has(x.athleteId));
            athletes.add(x.athleteId);
        }
        assert.ok(results.every(x => x.segmentId === 222));
    });

    test('stats getSegmentResults(id, {athleteId, best})', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222, {athleteId: 6, best: true});
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].athleteId, 6);
        assert.strictEqual(results[0].segmentId, 222);
    });

    test('stats getSegmentResults(id, {to}) - cached', async ({mock}) => {
        mock.timers.reset();
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        for (let i = 0; i < 2; i++) {
            const results = await sp.getSegmentResults(222, {from: 0, to: 720_000});
            assert.strictEqual(results.length, 42);
            assert.ok(results.every(x => x.segmentId === 222));
            results.sort((a, b) => a.ts - b.ts);
            assert.strictEqual(results.at(0).ts, 0);
            assert.strictEqual(results.at(-1).ts, 720_000);
            sp.zwiftAPI = {...sp.zwiftAPI, getSegmentResults: () => {throw new Error("NO");}};
        }
    });

    test('stats getSegmentResults(id, {to}) - uncached deferral', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const p1 = sp.getSegmentResults(222, {from: 0, to: 720_000});
        await advanceEventLoop(networkLatency);
        assert.ok(await p1);
        const p2 = sp.getSegmentResults(222, {from: 900_000, to: 2000_000});
        let done;
        p2.then(() => done = true);
        assert.ok(!done);
        await advanceEventLoop(throttleFor - 1);
        assert.ok(!done);
        await advanceEventLoop(1);
        assert.ok(done);
    });

    test('stats getSegmentResults(id, {to}) - seperate cache ranges', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const r1p = sp.getSegmentResults(222, {from: 0, to: 720_000});
        await advanceEventLoop(networkLatency);
        const r1 = await r1p;
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        const r2p = sp.getSegmentResults(222, {from: 900_000, to: 1620_000});
        await advanceEventLoop(throttleFor);
        const r2 = await r2p;
        const ranges2 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        assert.strictEqual(r1.length, 42);
        assert.strictEqual(r2.length, 42);
        assert.strictEqual(ranges1.length, 1);
        assert.strictEqual(ranges2.length, 2);
        assert.deepStrictEqual(ranges2[0], ranges1[0]);
    });

    test('stats getSegmentResults(id, {to}) - merged cache ranges', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const r1p = sp.getSegmentResults(222, {from: 0, to: 899_000});
        await advanceEventLoop(networkLatency);
        const r1 = await r1p;
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        await advanceEventLoop(throttleFor);
        const r2p = sp.getSegmentResults(222, {from: 900_000, to: 1800_000});
        await advanceEventLoop(networkLatency);
        const r2 = await r2p;
        const ranges2 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        await advanceEventLoop(throttleFor);
        const r3p = sp.getSegmentResults(222, {from: 0, to: 1800_000});
        await advanceEventLoop(networkLatency);
        const r3 = await r3p;
        const ranges3 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        assert.strictEqual(r1.length, 50);
        assert.strictEqual(r2.length, 52);
        assert.strictEqual(r3.length, 102);
        assert.strictEqual(ranges1.length, 1);
        assert.strictEqual(ranges2.length, 2);
        assert.strictEqual(ranges3.length, 1);
        assert.strictEqual(ranges3[0].from, ranges1[0].from);
        assert.strictEqual(ranges3[0].to, ranges2[1].to);
    });

    test('stats getSegmentResults(id, {to}) - merged cache ranges (overlap = 0)', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const r1p = sp.getSegmentResults(222, {from: 0, to: 900_000});
        await advanceEventLoop(networkLatency);
        const r1 = await r1p;
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        const r2p = sp.getSegmentResults(222, {from: 900_000, to: 1800_000});
        await advanceEventLoop(throttleFor);
        const r2 = await r2p;
        const ranges2 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        assert.strictEqual(r1.length, 52);
        assert.strictEqual(r2.length, 52);
        assert.strictEqual(ranges1.length, 1);
        assert.strictEqual(ranges2.length, 1);
        assert.strictEqual(ranges2[0].from, ranges1[0].from);
        assert.strictEqual(ranges2[0].to, ranges2[0].to);
    });

    test('stats ADV2QueryReductionEmitter - single event - object', () => {
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.emit('foo', q => (qs.push(q), {state: {}, athlete: {}}));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 1);
        assert.ok(evs[0].state);
        assert.ok(evs[0].athlete);
    });

    test('stats ADV2QueryReductionEmitter - single event - array', () => {
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.emit('foo', q => (qs.push(q), [{state: {}, athlete: {}}]));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 1);
        assert.ok(evs[0][0].state);
        assert.ok(evs[0][0].athlete);
    });

    test('stats ADV2QueryReductionEmitter - shared event - object', () => {
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.emit('foo', q => (qs.push(q), {state: {}, athlete: {}}));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0].state);
        assert.ok(evs[0].athlete);
        assert.ok(evs[1].state);
        assert.ok(evs[1].athlete);
    });

    test('stats ADV2QueryReductionEmitter - shared event - array', () => {
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.emit('foo', q => (qs.push(q), [{state: {}, athlete: {}}]));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0][0].state);
        assert.ok(evs[0][0].athlete);
        assert.ok(evs[1][0].state);
        assert.ok(evs[1][0].athlete);
    });

    test('stats ADV2QueryReductionEmitter - shared event with res prune - object', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete']});
        qem.emit('foo', q => (qs.push(q), {state: {}, athlete: {}}));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0].state);
        assert.ok(evs[0].athlete);
        assert.ok(evs[1].state);
        assert.ok(evs[1].athlete);
    });

    test('stats ADV2QueryReductionEmitter - shared event with res prune - array', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'athlete']});
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete']});
        qem.emit('foo', q => (qs.push(q), [{state: {}, athlete: {}}]));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0][0].state);
        assert.ok(evs[0][0].athlete);
        assert.ok(!evs[1][0].state);
        assert.ok(evs[1][0].athlete);
    });

    test('stats ADV2QueryReductionEmitter - shared event with stats mask - object', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['state'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['state'], stats: false});
        qem.emit('foo', q => (qs.push(q), {state: {}}));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0].state);
        assert.ok(evs[1].state);
    });

    test('stats ADV2QueryReductionEmitter - shared event with stats mask - array', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['laps'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['laps'], stats: false});
        qem.emit('foo', q => (qs.push(q), [{laps: [{stats: {}}]}]));
        assert.strictEqual(qs.length, 1);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0][0].laps);
        assert.ok(evs[0][0].laps[0].stats);
        assert.ok(evs[1][0].laps);
        assert.ok(!evs[1][0].laps[0].stats);
    });

    test('stats ADV2QueryReductionEmitter - not-shared event - object', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete', 'segments'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'laps']});
        qem.emit('foo', q => (qs.push(q), {state: {}, athlete: {}, laps: [{}], segments: [{}]}));
        assert.strictEqual(qs.length, 2);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0].athlete);
        assert.ok(evs[0].segments);
        assert.ok(!evs[0].state);
        assert.ok(!evs[0].laps);
        assert.ok(evs[1].state);
        assert.ok(evs[1].laps);
        assert.ok(!evs[1].athlete);
        assert.ok(!evs[1].segments);
    });

    test('stats ADV2QueryReductionEmitter - not-shared event - array', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete', 'segments'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'laps']});
        qem.emit('foo', q => (qs.push(q), [getAthleteDataMock(q)]));
        assert.strictEqual(qs.length, 2);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0][0].athlete);
        assert.ok(evs[0][0].segments);
        assert.ok(!evs[0][0].state);
        assert.ok(!evs[0][0].laps);
        assert.ok(evs[1][0].state);
        assert.ok(evs[1][0].laps);
        assert.ok(!evs[1][0].athlete);
        assert.ok(!evs[1][0].segments);
    });

    test('stats ADV2QueryReductionEmitter - not-shared event - respect listener order 2', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete', 'segments'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'laps']});
        qem.emit('foo', q => (qs.push(q), [getAthleteDataMock(q)]));
        assert.strictEqual(qs.length, 2);
        assert.strictEqual(evs.length, 2);
        assert.ok(evs[0][0].athlete);
        assert.ok(evs[0][0].segments);
        assert.ok(evs[1][0].state);
        assert.ok(evs[1][0].laps);
    });

    test('stats ADV2QueryReductionEmitter - not-shared event - respect listener order 3', () => {
        // TODO: this is coupled with the strategy cost algo.  If that changes it could break
        // this test.  If that happens, improve test to eval cost, or control cost function for
        // proper determinism.
        const qem = new ADV2QueryReductionEmitter();
        const evs = [];
        const qs = [];
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete', 'segments'], stats: true});
        qem.on('foo', ev => evs.push(ev), {resources: ['state', 'laps']});
        qem.on('foo', ev => evs.push(ev), {resources: ['athlete', 'segments'], stats: true});
        qem.emit('foo', q => (qs.push(q), [getAthleteDataMock(q)]));
        assert.strictEqual(qs.length, 2);
        assert.strictEqual(evs.length, 3);
        assert.ok(evs[0][0].athlete);
        assert.ok(evs[0][0].segments);
        assert.ok(evs[1][0].state);
        assert.ok(evs[1][0].laps);
        assert.ok(evs[2][0].athlete);
        assert.ok(evs[2][0].segments);
    });
});
