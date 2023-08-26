import {LRUCache} from '../shared/sauce/index.mjs';
//import console from 'node:console'; // Don't use jest's overly verbose console

function expectCacheKeys(cache, keys) {
    expect(new Set(cache.keys())).toEqual(new Set(keys));
}


test('lru replace', () => {
    const c = new LRUCache(10);
    c.set('A', 111);
    expect(c.get('A')).toBe(111);
    c.set('A', 222);
    expect(c.get('A')).toBe(222);
});

test('lru fill exact', () => {
    const size = 4;
    const c = new LRUCache(size);
    for (let i = 0; i < size; i++) {
        c.set(i, i * 10);
    }
    for (let i = 0; i < size; i++) {
        expect(c.get(i)).toBe(i * 10);
    }
});

test('lru fill overflow 1', () => {
    const size = 4;
    const c = new LRUCache(size);
    for (let i = 0; i < size + 1; i++) {
        c.set(i, i * 10);
    }
    expect(c.get(0)).toBe(undefined);
    for (let i = 1; i < size + 1; i++) {
        expect(c.get(i)).toBe(i * 10);
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
    expect(c.get(0)).toBe(0);
    expect(c.get(1)).toBe(undefined);
    expect(c.get(2)).toBe(20);
    expect(c.get(3)).toBe(30);
    expect(c.get(4)).toBe(40);
});

test('lru cache consistency', () => {
    const c = new LRUCache(3);
    c.set(1, true);
    c.set(2, true);
    c.set(3, true);
    c.set(4, true); // bump 1
    c.get(2); // 2 4 3
    expectCacheKeys(c, [2, 4, 3]);
    c.get(4); // 4 2 3
    expectCacheKeys(c, [4, 2, 3]);
    c.set(5, true); // 5 4 2
    expectCacheKeys(c, [5, 4, 2]);
    c.set(6, true); // 6 5 4
    expectCacheKeys(c, [6, 5, 4]);
});

test('lru fuzz', () => {
    for (let _case = 0; _case < 100; _case++) {
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
            expectCacheKeys(cache, ref.keys());
        }
    }
});
