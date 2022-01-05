
import data from './data.mjs';

/* Based on Andy Coggan's power profile. */
const rankConstants = {
    male: {
        high: {
            slopeFactor: 2.82,
            slopePeriod: 2500,
            slopeAdjust: 1.4,
            slopeOffset: 3.6,
            baseOffset: 6.08
        },
        low: {
            slopeFactor: 2,
            slopePeriod: 3000,
            slopeAdjust: 1.3,
            slopeOffset: 1,
            baseOffset: 1.74
        }
    },
    female: {
        high: {
            slopeFactor: 2.65,
            slopePeriod: 2500,
            slopeAdjust: 1,
            slopeOffset: 3.6,
            baseOffset: 5.39
        },
        low: {
            slopeFactor: 2.15,
            slopePeriod: 300,
            slopeAdjust: 6,
            slopeOffset: 1.5,
            baseOffset: 1.4
        }
    }
};

const npMinTime = 300;  // Andy says 20, but we're rebels.
const xpMinTime = 300;

const badgeURN = `/images/ranking`;
const rankLevels = [{
    levelRequirement: 7 / 8,
    label: 'World Class',
    cat: 'world-tour'
}, {
    levelRequirement: 6 / 8,
    label: 'Pro',
    cat: 'pro'
}, {
    levelRequirement: 5 / 8,
    label: 'Cat 1',
    cat: 'cat1'
}, {
    levelRequirement: 4 / 8,
    label: 'Cat 2',
    cat: 'cat2'
}, {
    levelRequirement: 3 / 8,
    label: 'Cat 3',
    cat: 'cat3'
}, {
    levelRequirement: 2 / 8,
    label: 'Cat 4',
    cat: 'cat4'
}, {
    levelRequirement: 1 / 8,
    label: 'Cat 5',
    cat: 'cat5'
}, {
    levelRequirement: -Infinity,
    label: 'Recreational'
}];


function _rankScaler(duration, c) {
    // XXX Might want to cache this since we use it in the perf calcs now.. Benchmark...
    const t = (c.slopePeriod / duration) * c.slopeAdjust;
    const slope = Math.log10(t + c.slopeOffset);
    const wKgDifference = Math.pow(slope, c.slopeFactor);
    // This is an unscientific extrapolation of power loss associated with endurance
    // efforts over 1 hour.  TODO: Find some real studies.  Currently I'm basing this on
    // Mvdp's stunning Strade Bianchi: https://www.strava.com/activities/4901472414
    const enduroFactor = duration > 3600 ? 1 / ((Math.log(duration / 3600) * 0.1) + 1) : 1;
    return (wKgDifference + c.baseOffset) * enduroFactor;
}


function rankRequirements(duration, gender) {
    const high = _rankScaler(duration, rankConstants[gender].high);
    const low = _rankScaler(duration, rankConstants[gender].low);
    return {high, low};
}


function rankWeightedRatio(duration) {
    const intro = 1200;
    const outro = 3600;
    return Math.min(1, Math.max(0, (duration - intro) / (outro - intro)));
}


function rankLevel(duration, p, wp, weight, gender) {
    const high = _rankScaler(duration, rankConstants[gender].high);
    const low = _rankScaler(duration, rankConstants[gender].low);
    const weightedRatio = (!wp || wp < p) ? 0 : rankWeightedRatio(duration);
    const weightedPower = (weightedRatio * (wp || 0)) + ((1 - weightedRatio) * p);
    const wKg = weightedPower / weight;
    return {
        level: (wKg - low) / (high - low),
        weightedRatio,
        weightedPower,
        wKg,
    };
}


function rankBadge({level, weightedRatio, weightedPower, wKg}) {
    const suffix = (document.documentElement.classList.contains('sauce-theme-dark')) ?
        '-darkbg.png' : '.png';
    let lastRankLevel = 1;
    for (const x of rankLevels) {
        if (level >= x.levelRequirement) {
            const catLevel = (level - x.levelRequirement) / (lastRankLevel - x.levelRequirement);
            const tooltip = [
                `World Ranking: ${Math.round(level * 100).toLocaleString()}%\n`,
                `${x.label} Ranking: ${Math.round(catLevel * 100).toLocaleString()}%\n`,
                weightedRatio ? 'Weighted ' : '',
                `Power: ${wKg.toFixed(1)}w/kg | ${Math.round(weightedPower).toLocaleString()}w\n`,
            ].join('');
            return {
                level,
                catLevel,
                badge: x.cat && `${badgeURN}/${x.cat}${suffix}`,
                weightedPower,
                weightedRatio,
                wKg,
                tooltip,
                ...x
            };
        }
        lastRankLevel = x.levelRequirement;
    }
}


function rank(duration, p, wp, weight, gender) {
    return rankBadge(rankLevel(duration, p, wp, weight, gender));
}


class RollingPower extends data.RollingAverage {
    constructor(period, options={}) {
        super(period, options);
        if (options.inlineNP) {
            const sampleRate = 1 / this.idealGap;
            const rollSize = Math.round(30 * sampleRate);
            this._inlineNP = {
                saved: [],
                rollSize,
                slot: 0,
                roll: new Array(rollSize),
                rollSum: 0,
                total: 0,
                gapPadCount: 0,
            };
        }
        if (options.inlineXP) {
            const samplesPerWindow = 25 / this.idealGap;
            this._inlineXP = {
                saved: [],
                samplesPerWindow,
                attenuation: samplesPerWindow / (samplesPerWindow + this.idealGap),
                sampleWeight: this.idealGap / (samplesPerWindow + this.idealGap),
                prevTime: 0,
                weighted: 0,
                breakPadding: 0,
                count: 0,
                total: 0,
            };
        }
    }

    processAdd(i) {
        const value = this._values[i];
        if (this._inlineNP) {
            const state = this._inlineNP;
            const saved = {};
            const slot = i % state.rollSize;
            if (value instanceof data.Zero) {
                // Drain the rolling buffer but don't increment the counter.
                state.rollSum -= state.roll[slot] || 0;
                state.roll[slot] = 0;
                state.gapPadCount++;
            } else {
                state.rollSum += value;
                state.rollSum -= state.roll[slot] || 0;
                state.roll[slot] = value;
                const npa = state.rollSum / Math.min(state.rollSize, i + 1 - this._offt);
                const qnpa = npa * npa * npa * npa;  // unrolled for perf
                state.total += qnpa;
                saved.value = qnpa;
            }
            state.saved.push(saved);
        }
        if (this._inlineXP) {
            const state = this._inlineXP;
            const saved = {};
            if (value instanceof data.Zero) {
                if (value instanceof data.Break) {
                    state.breakPadding += value.pad;
                    saved.breakPadding = value.pad;
                }
            } else {
                const epsilon = 0.1;
                const negligible = 0.1;
                const time = (i * this.idealGap) + state.breakPadding;
                let count = 0;
                while ((state.weighted > negligible) &&
                       time > state.prevTime + this.idealGap + epsilon) {
                    state.weighted *= state.attenuation;
                    state.prevTime += this.idealGap;
                    const w = state.weighted;
                    state.total += w * w * w * w;  // unroll for perf
                    count++;
                }
                state.weighted *= state.attenuation;
                state.weighted += state.sampleWeight * value;
                state.prevTime = time;
                const w = state.weighted;
                const qw = w * w * w * w;  // unrolled for perf
                state.total += qw;
                count++;
                state.count += count;
                saved.value = qw;
                saved.count = count;
            }
            state.saved.push(saved);
        }
        super.processAdd(i);
    }

    processShift(i) {
        super.processShift(i);
        if (this._inlineNP) {
            const state = this._inlineNP;
            const saved = state.saved[i];
            state.total -= saved.value || 0;
            if (this._values[i] instanceof data.Zero) {
                state.gapPadCount--;
            }
        }
        if (this._inlineXP) {
            const state = this._inlineXP;
            const saved = state.saved[i];
            state.total -= saved.value || 0;
            state.count -= saved.count || 0;
            state.breakPadding -= saved.breakPadding || 0;
        }
    }

    processPop(i) {
        if (this._inlineNP || this._inlineXP) {
            throw new Error("Unsupported");
        }
        super.processPop(i);
    }

    np(options={}) {
        if (this._inlineNP && !options.external) {
            if (this.active() < npMinTime && !options.force) {
                return;
            }
            const state = this._inlineNP;
            return (state.total / (this.size() - state.gapPadCount)) ** 0.25;
        } else {
            return calcNP(this.values(), 1 / this.idealGap, options);
        }
    }

    xp(options={}) {
        if (this._inlineXP && !options.external) {
            if (this.active() < xpMinTime && !options.force) {
                return;
            }
            const state = this._inlineXP;
            return (state.total / state.count) ** 0.25;
        } else {
            return calcXP(this.values(), 1 / this.idealGap, options);
        }
    }

    joules() {
        return this._valuesAcc;
    }

    clone(...args) {
        const instance = super.clone(...args);
        instance._joules = this._joules;
        if (this._inlineNP) {
            this._copyInlineState('_inlineNP', instance);
        }
        if (this._inlineXP) {
            this._copyInlineState('_inlineXP', instance);
        }
        return instance;
    }

    _copyInlineState(key, target) {
        const saved = this[key].saved;
        target[key] = {...this[key]};
        const offt = saved.length - target._length;
        target[key].saved = saved.slice(offt);
    }
}


function correctedRollingPower(timeStream, period, options={}) {
    if (timeStream.length < 2 || timeStream[timeStream.length - 1] < period) {
        return;
    }
    if (options.idealGap == null || options.maxGap == null) {
        const gaps = data.recommendedTimeGaps(timeStream);
        if (options.idealGap == null) {
            options.idealGap = gaps.ideal;
        }
        if (options.maxGap == null) {
            options.maxGap = gaps.max;
        }
    }
    return new RollingPower(period, options);
}


function peakPower(period, timeStream, wattsStream, options) {
    const roll = correctedRollingPower(timeStream, period, options);
    if (!roll) {
        return;
    }
    return roll.importReduce(timeStream, wattsStream, (cur, lead) => cur.avg() >= lead.avg());
}


function peakNP(period, timeStream, wattsStream, options) {
    const roll = correctedRollingPower(timeStream, period,
        {inlineNP: true, active: true, ...options});
    if (!roll) {
        return;
    }
    return roll.importReduce(timeStream, wattsStream, (cur, lead) => cur.np() >= lead.np());
}


function peakXP(period, timeStream, wattsStream, options) {
    const roll = correctedRollingPower(timeStream, period,
        {inlineXP: true, active: true, ...options});
    if (!roll) {
        return;
    }
    return roll.importReduce(timeStream, wattsStream, (cur, lead) => cur.xp() >= lead.xp());
}


function correctedPower(timeStream, wattsStream, options) {
    const roll = correctedRollingPower(timeStream, null, options);
    if (!roll) {
        return;
    }
    roll.importData(timeStream, wattsStream);
    return roll;
}


function calcNP(stream, sampleRate, options={}) {
    /* Coggan doesn't recommend NP for less than 20 mins, but we're outlaws
     * and we go as low as 5 mins now! (10-08-2020) */
    sampleRate = sampleRate || 1;
    if (!options.force) {
        const elapsed = stream.length / sampleRate;
        if (!stream || elapsed < npMinTime) {
            return;
        }
    }
    const rollingSize = Math.round(30 * sampleRate);
    if (rollingSize < 2) {
        // Sample rate is too low for meaningful data.
        return;
    }
    const rolling = new Array(rollingSize);
    let total = 0;
    let count = 0;
    let breakPadding = 0;
    for (let i = 0, sum = 0, len = stream.length; i < len; i++) {
        const index = i % rollingSize;
        const watts = stream[i];
        // Drain the rolling buffer but don't increment the counter for gaps...
        if (watts instanceof data.Break) {
            for (let j = 0; j < Math.min(rollingSize, watts.pad); j++) {
                const rollIndex = (index + j) % rollingSize;
                sum -= rolling[rollIndex] || 0;
                rolling[rollIndex] = 0;
            }
            breakPadding += watts.pad;
            continue;
        } else if (watts instanceof data.Zero) {
            sum -= rolling[index] || 0;
            rolling[index] = 0;
            continue;
        }
        sum += watts;
        sum -= rolling[index] || 0;
        rolling[index] = watts;
        const avg = sum / Math.min(rollingSize, i + 1 + breakPadding);
        total += avg * avg * avg * avg;  // About 100 x faster than Math.pow and **
        count++;
    }
    return (total / count) ** 0.25;
}


function calcXP(stream, sampleRate, options={}) {
    /* See: https://perfprostudio.com/BETA/Studio/scr/BikeScore.htm
     * xPower is more accurate version of NP that better correlates to how
     * humans recover from oxygen debt. */
    sampleRate = sampleRate || 1;
    if (!options.force) {
        const elapsed = stream.length / sampleRate;
        if (!stream || elapsed < xpMinTime) {
            return;
        }
    }
    const epsilon = 0.1;
    const negligible = 0.1;
    const sampleInterval = 1 / sampleRate;
    const samplesPerWindow = 25 / sampleInterval;
    const attenuation = samplesPerWindow / (samplesPerWindow + sampleInterval);
    const sampleWeight = sampleInterval / (samplesPerWindow + sampleInterval);
    let prevTime = 0;
    let weighted = 0;
    let total = 0;
    let count = 0;
    let breakPadding = 0;
    for (let i = 0, len = stream.length; i < len; i++) {
        const watts = stream[i];
        if (watts instanceof data.Zero) {
            if (watts instanceof data.Break) {
                breakPadding += watts.pad;
            }
            continue; // Skip Zero pads so after the inner while loop can attenuate on its terms.
        }
        const time = (i * sampleInterval) + breakPadding;
        while ((weighted > negligible) && time > prevTime + sampleInterval + epsilon) {
            weighted *= attenuation;
            prevTime += sampleInterval;
            total += weighted * weighted * weighted * weighted;  // unrolled for perf
            count++;
        }
        weighted *= attenuation;
        weighted += sampleWeight * watts;
        prevTime = time;
        total += weighted * weighted * weighted * weighted;  // unrolled for perf
        count++;
    }
    return count ? (total / count) ** 0.25 : 0;
}


function calcTSS(power, duration, ftp) {
    const joules = power * duration;
    const ftpHourJoules = ftp * 3600;
    const intensity = power / ftp;
    return ((joules * intensity) / ftpHourJoules) * 100;
}


function seaLevelPower(power, el) {
    // Based on research from Bassett, D.R. Jr., C.R. Kyle, L. Passfield, J.P. Broker, and E.R. Burke.
    // 31:1665-76, 1999.
    // Note we assume the athlete is acclimatized for simplicity.
    // acclimated:
    //   vo2maxPct = -1.1219 * km ** 2 - 1.8991 * km + 99.921
    //   R^2 = 0.9729
    // unacclimated:
    //   v02maxPct = 0.1781 * km ** 3 - 1.434 * km ** 2 - 4.0726 ** km + 100.35
    //   R^2 = 0.9739
    const elKm = el / 1000;
    const vo2maxAdjust = (-1.1219 * (elKm * elKm) - 1.8991 * elKm + 99.921) / 100;  // unroll exp for perf
    return power * (1 / vo2maxAdjust);
}


function gravityForce(slope, weight) {
    const g = 9.80655;
    return g * Math.sin(Math.atan(slope)) * weight;
}


function rollingResistanceForce(slope, weight, crr) {
    const g = 9.80655;
    return g * Math.cos(Math.atan(slope)) * weight * crr;
}


function aeroDragForce(cda, p, v, w) {
    const netVelocity = v + w;
    const invert = netVelocity < 0 ? -1 : 1;
    return (0.5 * cda * p * (netVelocity * netVelocity)) * invert;
}


function airDensity(el) {
    const p0 = 1.225;
    const g = 9.80655;
    const M0 = 0.0289644;
    const R = 8.3144598;
    const T0 = 288.15;
    return p0 * Math.exp((-g * M0 * el) / (R * T0));
}


function cyclingPowerEstimate({velocity, slope, weight, crr, cda, el=0, wind=0, loss=0.035}) {
    const invert = velocity < 0 ? -1 : 1;
    const Fg = gravityForce(slope, weight);
    const Fr = rollingResistanceForce(slope, weight, crr) * invert;
    const Fa = aeroDragForce(cda, airDensity(el), velocity, wind);
    const vFactor = velocity / (1 - loss);  // velocity with mech loss integrated
    return {
        gForce: Fg,
        rForce: Fr,
        aForce: Fa,
        force: Fg + Fr + Fa,
        gWatts: Fg * vFactor * invert,
        rWatts: Fr * vFactor * invert,
        aWatts: Fa * vFactor * invert,
        watts: (Fg + Fr + Fa) * vFactor * invert
    };
}


function cyclingDraftDragReduction(riders, position) {
    /* Based on the wonderful work of:
     *    van Druenen, T., Blocken, B.
     *    Aerodynamic analysis of uphill drafting in cycling.
     *    Sports Eng 24, 10 (2021).
     *    https://doi.org/10.1007/s12283-021-00345-2
     *
     * The values from this paper have been curve fitted to an exponential func
     * so we can infer average CdA adaption with dynamic pack positions.
     */
    if (riders == null || position == null) {
        throw new TypeError("riders and position are required arguments");
    }
    if (riders < 2) {
        return 1;
    }
    if (position > riders) {
        throw new TypeError("position must be <= riders");
    }
    if (position < 1) {
        throw new TypeError("position must be >= 1");
    }
    const coefficients = {
        2: {y0: 6.228152, v0: 14.30192, k: 2.501857},
        3: {y0: 3.862857, v0: 6.374476, k: 1.860752},
        4: {y0: 3.167014, v0: 4.37368, k: 1.581374},
        5: {y0: 2.83803, v0: 3.561276, k: 1.452583},
        6: {y0: 2.598001, v0: 2.963105, k: 1.329827},
        7: {y0: 2.556656, v0: 2.86052, k: 1.305172},
        8: {y0: 2.506765, v0: 2.735303, k: 1.272144},
    };
    if (riders > 8) {
        position = Math.max(1, 8 / riders * position);
        riders = 8;
    }
    const c = coefficients[riders];
    return c.y0 - ((c.v0 / c.k) * (1 - Math.exp(-c.k * position)));
}


function cyclingPowerVelocitySearchMultiPosition(riders, positions, args) {
    const reductions = positions.map(x => cyclingDraftDragReduction(riders, x.position));
    const avgCda = data.sum(reductions.map((x, i) => x * positions[i].pct)) * args.cda;
    const seedEst = cyclingPowerFastestVelocitySearch({...args, cda: avgCda});
    if (!seedEst) {
        return;
    }
    const velocity = seedEst.velocity;
    const estimates = reductions.map((x, i) => cyclingPowerEstimate({
        ...args,
        weight: positions[i].weight || args.weight,
        cda: x * args.cda,
        velocity,
    }));
    const estAvg = field => data.sum(positions.map((x, i) => x.pct * estimates[i][field]));
    if (Math.abs(estAvg('watts') - args.power) > 0.01) {
        throw new Error('velocity from perf search seed is invalid');
    }
    return {
        gForce: estAvg('gForce'),
        rForce: estAvg('rForce'),
        aForce: estAvg('aForce'),
        force: estAvg('force'),
        gWatts: estAvg('gWatts'),
        rWatts: estAvg('rWatts'),
        aWatts: estAvg('aWatts'),
        watts: estAvg('watts'),
        estimates,
        velocity,
    };
}


function cyclingPowerVelocitySearch({power, ...args}) {
    // Do not adjust without running test suite and tuning for 50% tollerance above failure
    const epsilon = 0.000001;
    const sampleSize = 300;
    const filterPct = 0.50;

    function refineRange(start, end) {
        let lastStart;
        let lastEnd;

        function byPowerClosenessOrVelocity(a, b) {
            const deltaA = Math.abs(a[1].watts - power);
            const deltaB = Math.abs(b[1].watts - power);
            if (deltaA < deltaB) {
                return -1;
            } else if (deltaB < deltaA) {
                return 1;
            } else {
                return b[0] - a[0];  // fallback to velocity
            }
        }

        for (let fuse = 0; fuse < 100; fuse++) {
            const results = [];
            const step = Math.max((end - start) / sampleSize, epsilon / sampleSize);
            for (const v of data.range(start, end + step, step)) {
                const est = cyclingPowerEstimate({velocity: v, ...args});
                results.push([v, est]);
            }
            results.sort(byPowerClosenessOrVelocity);
            results.length = Math.min(Math.floor(sampleSize * filterPct), results.length);
            const velocities = results.map(x => x[0]);
            if (velocities.length === 0) {
                throw new Error("Emnty Range");
            }
            start = data.min(velocities);
            end = data.max(velocities);
            if (velocities.length === 1 ||
                (Math.abs(start - lastStart) < epsilon && Math.abs(end - lastEnd) < epsilon)) {
                // When multiple solution are in a single range it's possible to be too course
                // in the steps and then exclude the most optimal solutions that exist outside
                // the filtered range here.  So we scan out as the last step to ensure we are
                // inclusive of all optimal solutions.
                if (step > epsilon) {
                    for (const [iv, dir] of [[start, -1], [end, 1]]) {
                        let bestEst = cyclingPowerEstimate({velocity: iv, ...args});
                        const smallStep = Math.max(step / 100, epsilon) * dir;
                        for (let v = iv + smallStep;; v += smallStep) {
                            const est = cyclingPowerEstimate({velocity: v, ...args});
                            results.push([v, est]);  // Always include the test case.
                            if (Math.abs(est.watts - power) < Math.abs(bestEst.watts - power)) {
                                bestEst = est;
                            } else {
                                break;
                            }
                        }
                    }
                    results.sort(byPowerClosenessOrVelocity);
                    return results.map(x => x[0]);
                }
                return velocities;
            }
            lastStart = start;
            lastEnd = end;
        }
        throw new Error("No result found");
    }

    function findLocalRanges(velocities) {
        // Search for high energy matches based on stddev outliers. Returns an array
        // of ranges with lower and upper bounds that can be further narrowed.
        const stddev = data.stddev(velocities);
        const groups = new Map();
        for (const v of velocities) {
            let added = false;
            for (const [x, values] of groups.entries()) {
                if (Math.abs(v - x) < Math.max(stddev, epsilon * sampleSize * filterPct)) {
                    values.push(v);
                    added = true;
                    break;
                }
            }
            if (!added) {
                groups.set(v, [v]);
            }
        }
        return Array.from(groups.values()).filter(x => x.length > 1).map(x =>
            [data.min(x), data.max(x)]);
    }

    const matches = [];
    function search(velocities) {
        const outerRanges = findLocalRanges(velocities);
        for (const [lower, upper] of outerRanges) {
            const rangeVs = refineRange(lower, upper);
            const innerRanges = rangeVs.length >= 4 && findLocalRanges(rangeVs);
            if (innerRanges && innerRanges.length > 1) {
                for (const [lower, upper] of innerRanges) {
                    search(refineRange(lower, upper));
                }
            } else {
                const est = cyclingPowerEstimate({velocity: rangeVs[0], ...args});
                // If the difference is less than epsilon (1 millionth) or we are within epsilon %.
                // The former is for very small values and the latter is for massive values. Both
                // are needed!
                if (Math.abs(est.watts - power) < epsilon ||
                    Math.abs(1 - ((est.watts || epsilon) / (power || epsilon))) < epsilon) {
                    matches.push({velocity: rangeVs[0], ...est});
                }
            }
        }
    }

    const c = 299792458;  // speed of light
    search(refineRange(-c, c));
    return matches;
}


function cyclingPowerFastestVelocitySearch(options) {
    const velocities = cyclingPowerVelocitySearch(options).filter(x => x.velocity > 0);
    velocities.sort((a, b) => b.velocity - a.velocity);
    return velocities[0];
}


/*
 * The wPrime math is based on exactly 1 second power data.
 */
function _wPrimeCorrectedPower(wattsStream, timeStream) {
    return correctedPower(timeStream, wattsStream, {idealGap: 1});
}

/*
 * The fast impl of the Skiba W` integral algo.
 * See: http://markliversedge.blogspot.nl/2014/10/wbal-optimisation-by-mathematician.html
 */
function calcWPrimeBalIntegralStatic(wattsStream, timeStream, cp, wPrime) {
    let sum = 0;
    const wPrimeBal = [];
    const belowCPAvg = data.avg(wattsStream.filter(x => x != null && x < cp)) || 0;
    const deltaCP = cp - belowCPAvg;
    const tau = 546 * Math.E ** (-0.01 * deltaCP) + 316;
    let prevTime = timeStream[0] - 1; // Somewhat arbitrary.  Alt would be to discard idx 0.
    for (let i = 0; i < timeStream.length; i++) {
        const p = wattsStream[i];
        const t = timeStream[i];
        const sr = 1 / (t - prevTime);  // XXX suspect name, is this actually elapsed time?
        if (sr !== 1) {
            console.warn(t, sr);
        }
        prevTime = t;
        const aboveCP = p > cp ? p - cp : 0;
        const wPrimeExpended = aboveCP * sr;
        sum += wPrimeExpended * Math.E ** (t * sr / tau);
        wPrimeBal.push(wPrime - sum * Math.E ** (-t * sr / tau));
        if (wPrimeBal[wPrimeBal.length - 1] < 0) {
            debugger;
        }
    }
    return wPrimeBal;
}

/*
 * The differential algo for W'bal stream.  Aka Froncioni Skiba and Clarke.
 * See: http://markliversedge.blogspot.nl/2014/10/wbal-optimisation-by-mathematician.html
 */
function calcWPrimeBalDifferential(wattsStream, timeStream, cp, wPrime) {
    const powerRoll = _wPrimeCorrectedPower(wattsStream, timeStream);
    const wPrimeBal = [];
    const epsilon = 0.000001;
    let wBal = wPrime;
    for (const p of powerRoll.values()) {
        if (p instanceof data.Break) {
            // Refill wBal while we have a break.
            for (let j = 0; j < p.pad; j++) {
                wBal += cp * (wPrime - wBal) / wPrime;
                if (wBal >= wPrime - epsilon) {
                    wBal = wPrime;
                    break;
                }
            }
        } else {
            const pNum = p || 0;  // convert null and undefined to 0.
            wBal += pNum < cp ? (cp - pNum) * (wPrime - wBal) / wPrime : cp - pNum;
        }
        if (wBal > wPrime) {
            debugger;  // XXX shouldn't be possible.
        }
        if (!(p instanceof data.Pad)) {
            // Our output stream should align with the input stream, not the corrected
            // one used for calculations, so skip pad based values.
            wPrimeBal.push(Math.round(wBal));
        }
    }
    return wPrimeBal;
}


function calcPwHrDecouplingFromRoll(powerRoll, hrStream) {
    hrStream = hrStream.filter(x => x);  // exclude any null/invalid readings
    const times = powerRoll.times();
    const midPowerTime = times[Math.floor(times.length / 2)];
    const firstHalf = powerRoll.slice(times[0], midPowerTime);
    const secondHalf = powerRoll.slice(midPowerTime, times[times.length - 1]);
    const midHRIndex = Math.floor(hrStream.length / 2);
    const [np1, np2] = [firstHalf.np(), secondHalf.np()];
    if (!np1 || !np2) {
        return;
    }
    const firstHalfRatio = np1 / data.avg(hrStream.slice(0, midHRIndex));
    const secondHalfRatio = np2 / data.avg(hrStream.slice(midHRIndex));
    const r = (firstHalfRatio - secondHalfRatio) / firstHalfRatio;
    if (isNaN(r)) {
        debugger;
    }
    return r;
}


function calcPwHrDecoupling(wattsStream, timeStream, hrStream) {
    const powerRoll = correctedPower(timeStream, wattsStream);
    return calcPwHrDecouplingFromRoll(powerRoll, hrStream);
}


export default {
    peakPower,
    peakNP,
    peakXP,
    correctedPower,
    correctedRollingPower,
    calcNP,
    calcXP,
    calcTSS,
    calcWPrimeBalIntegralStatic,
    calcWPrimeBalDifferential,
    calcPwHrDecouplingFromRoll,
    calcPwHrDecoupling,
    rank,
    rankLevel,
    rankBadge,
    rankRequirements,
    rankWeightedRatio,
    seaLevelPower,
    cyclingPowerEstimate,
    cyclingPowerVelocitySearch,
    cyclingPowerFastestVelocitySearch,
    cyclingPowerVelocitySearchMultiPosition,
    cyclingDraftDragReduction,
    RollingPower,
};
