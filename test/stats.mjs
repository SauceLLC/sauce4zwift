/* global setImmediate */
import * as timers from 'node:timers';
import {test} from 'node:test';
import assert from 'node:assert';
import {worldTimer} from '../src/zwift.mjs';
import {StatsProcessor} from '../src/stats.mjs';

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


const _realSetImmediate = setImmediate;
function eventLoop() {
    // Unaffected by mock.timers.enable()..
    // I don't like the idea of filtering out setImmedate from mock.timers
    // as it might still be desirable for control flow of deeply nested calls.
    // But from the outer test code, it's often useful to forcibly wait for
    // an event loop execution.
    return new Promise(_realSetImmediate);
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
    getLiveSegmentLeaders: async () => {
        return await [];
    },
    getLiveSegmentLeaderboard: async id => {
        return await [];
    },
    getSegmentResults: async (id, {from, to, athleteId}={}) => {
        return await segmentResults.filter(x => x.segmentId === id &&
                                                x.ts >= from &&
                                                (to == null || x.ts <= to) &&
                                                (athleteId == null || x.athleteId === athleteId));
    }
};

test.suite('stats', () => {
    test.beforeEach(({mock}) => {
        segmentResults = normalSegmentResults;
        mock.timers.enable();
        worldTimerReset();
        worldTimerTick(3600_000);
    });

    test('stats StatsProcessor instantiate', () => {
        assert.ok(new StatsProcessor({app, zwiftAPI}));
    });

    test('stats getSegmentResults', async () => {
        const sp = new StatsProcessor({app, zwiftAPI});
        assert.ok(await sp.getSegmentResults());
    });

    test('stats getSegmentResults(id, {live})', async () => {
        const sp = new StatsProcessor({app, zwiftAPI});
        assert.ok(await sp.getSegmentResults(1, {live: true}));
    });

    test('stats getSegmentResults(id)', async () => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222);
        assert.strictEqual(results.length, 202);
        assert.ok(results.every(x => x.segmentId === 222));
        results.sort((a, b) => a.ts - b.ts);
        assert.strictEqual(results.at(0).ts, 0);
        assert.strictEqual(results.at(-1).ts, 3600_000);
    });

    test('stats getSegmentResults(id, {athlete})', async () => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222, {athleteId: 3});
        assert.strictEqual(results.length, 5);
        assert.ok(results.every(x => x.segmentId === 222));
        assert.ok(results.every(x => x.athleteId === 3));
    });

    test('stats getSegmentResults(id, {best})', async () => {
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

    test('stats getSegmentResults(id, {athleteId, best})', async () => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const results = await sp.getSegmentResults(222, {athleteId: 6, best: true});
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].athleteId, 6);
        assert.strictEqual(results[0].segmentId, 222);
    });

    test('stats getSegmentResults(id, {to}) - cached', async () => {
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
        await sp.getSegmentResults(222, {from: 0, to: 720_000});
        const p = sp.getSegmentResults(222, {from: 900_000, to: 2000_000});
        let done;
        p.then(() => done = true);
        await eventLoop();
        assert.ok(!done);
        mock.timers.tick(900);
        await eventLoop();
        assert.ok(!done);
        mock.timers.tick(200);
        await eventLoop();
        assert.ok(done);
    });

    test('stats getSegmentResults(id, {to}) - seperate cache ranges', async ({mock}) => {
        const sp = new StatsProcessor({app, zwiftAPI});
        segmentResults = normalSegmentResults;
        const r1 = await sp.getSegmentResults(222, {from: 0, to: 720_000});
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        mock.timers.tick(1100);
        const r2 = await sp.getSegmentResults(222, {from: 900_000, to: 1620_000});
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
        const r1 = await sp.getSegmentResults(222, {from: 0, to: 899_000});
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        mock.timers.tick(1100);
        const r2 = await sp.getSegmentResults(222, {from: 900_000, to: 1800_000});
        const ranges2 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        mock.timers.tick(1100);
        const r3 = await sp.getSegmentResults(222, {from: 0, to: 1800_000});
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
        const r1 = await sp.getSegmentResults(222, {from: 0, to: 900_000});
        const ranges1 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        mock.timers.tick(1100);
        const r2 = await sp.getSegmentResults(222, {from: 900_000, to: 1800_000});
        const ranges2 = Array.from(sp._segmentResultsBuckets.full.cache.get('222-*').acquiredRanges);
        mock.timers.tick(1100);
        assert.strictEqual(r1.length, 52);
        assert.strictEqual(r2.length, 52);
        assert.strictEqual(ranges1.length, 1);
        assert.strictEqual(ranges2.length, 1);
        assert.strictEqual(ranges2[0].from, ranges1[0].from);
        assert.strictEqual(ranges2[0].to, ranges2[0].to);
    });
});
