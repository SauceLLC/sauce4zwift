import test from 'node:test';
import assert from 'node:assert';
import {LRUCache} from '../shared/sauce/index.mjs';


function assertCacheKeys(cache, keys) {
    assert.deepStrictEqual(new Set(cache.keys()), new Set(keys));
}


test('lru replace', () => {
    const c = new LRUCache(10);
    c.set('A', 111);
    assert.strictEqual(c.get('A'), 111);
    c.set('A', 222);
    assert.strictEqual(c.get('A'), 222);
});

test('lru fill exact', () => {
    const size = 4;
    const c = new LRUCache(size);
    for (let i = 0; i < size; i++) {
        c.set(i, i * 10);
    }
    for (let i = 0; i < size; i++) {
        assert.strictEqual(c.get(i), i * 10);
    }
});

test('lru fill overflow 1', () => {
    const size = 4;
    const c = new LRUCache(size);
    for (let i = 0; i < size + 1; i++) {
        c.set(i, i * 10);
    }
    assert.strictEqual(c.get(0), undefined);
    for (let i = 1; i < size + 1; i++) {
        assert.strictEqual(c.get(i), i * 10);
    }
});

test('lru fill overflow 1, reordered', () => {
    const size = 4;
    const c = new LRUCache(size);
    for (let i = 0; i < size; i++) {
        c.set(i, i * 10);
    }
    c.get(0);
    c.set(size, size * 10);
    assert.strictEqual(c.get(0), 0);
    assert.strictEqual(c.get(1), undefined);
    assert.strictEqual(c.get(2), 20);
    assert.strictEqual(c.get(3), 30);
    assert.strictEqual(c.get(4), 40);
});

test('lru cache consistency', () => {
    const c = new LRUCache(3);
    c.set(1, true);
    c.set(2, true);
    c.set(3, true);
    c.set(4, true); // bump 1
    c.get(2); // 2 4 3
    assertCacheKeys(c, [2, 4, 3]);
    c.get(4); // 4 2 3
    assertCacheKeys(c, [4, 2, 3]);
    c.set(5, true); // 5 4 2
    assertCacheKeys(c, [5, 4, 2]);
    c.set(6, true); // 6 5 4
    assertCacheKeys(c, [6, 5, 4]);
});

test('lru fuzz', () => {
    for (let _case = 0; _case < 50; _case++) {
        const ref = new Map();
        const size = 1 + Math.random() * 100 | 0;
        const iterations = Math.random() * 1000 | 0;
        const cache = new LRUCache(size);
        const setPropensity = Math.abs(Math.sin(_case + 1));
        for (let i = 0; i < iterations; i++) {
            const key = Math.random() * 1500 | 0;
            if (Math.random() < setPropensity) {
                cache.set(key, true);
                if (!ref.has(key) && ref.size === size) {
                    const byAge = Array.from(ref.entries()).sort((a, b) => a[1] - b[1]);
                    ref.delete(byAge[0][0]);
                }
                ref.set(key, i);
            } else {
                cache.get(key);
                if (ref.has(key)) {
                    ref.set(key, i);
                }
            }
            assertCacheKeys(cache, ref.keys());
        }
    }
});
