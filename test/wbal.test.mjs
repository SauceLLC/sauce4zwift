import * as sauce from '../shared/sauce/index.mjs';
//import console from 'node:console'; // Don't use jest's overly verbose console


test('wbal sample rate accuracy', () => {
    const cp = 300;
    const wp = 20000;
    const incCalcNom = new sauce.power.makeIncWPrimeBalDifferential(cp, wp);
    const incCalcHalf = new sauce.power.makeIncWPrimeBalDifferential(cp, wp);
    const incCalcDbl = new sauce.power.makeIncWPrimeBalDifferential(cp, wp);
    const incCalcRnd = new sauce.power.makeIncWPrimeBalDifferential(cp, wp);
    let lastRnd = 0;
    const wbals = {};
    for (let i = 0; i < 10000; i++) {
        const v = Math.sin(i / 1000) * (cp / 2) + cp;
        wbals.fine = incCalcHalf(v, 0.5);
        if (i % 2 === 0) {
            wbals.nom = incCalcNom(v, 1);
        }
        if (i % 4 === 0) {
            wbals.dbl = incCalcDbl(v, 2);
        }
        if (Math.random() < 0.8) {
            const t = i ? i - lastRnd : 1;
            lastRnd = i;
            wbals.rnd = incCalcRnd(v, t / 2);
        }
        if (i && (i % 10 === 0)) {
            expect(Math.abs(wbals.fine - wbals.nom)).toBeLessThan(1000);
            expect(Math.abs(wbals.fine - wbals.dbl)).toBeLessThan(1000);
            expect(Math.abs(wbals.fine - wbals.rnd)).toBeLessThan(1000);
        }
    }
});
