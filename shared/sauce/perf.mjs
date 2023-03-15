
export function calcTRIMP(duration, hrr, gender) {
    const y = hrr * (gender === 'female' ? 1.67 : 1.92);
    return (duration / 60) * hrr * 0.64 * Math.exp(y);
}


/* TRIMP based TSS, more accurate than hrTSS.
 * See: https://fellrnr.com/wiki/TRIMP
 */
export function tTSS(hrStream, timeStream, activeStream, ltHR, minHR, maxHR, gender) {
    let t = 0;
    let lastTime = timeStream[0];
    for (let i = 1; i < timeStream.length; i++) {
        if (!activeStream[i]) {
            lastTime = timeStream[i];
            continue;
        }
        const dur = timeStream[i] - lastTime;
        lastTime = timeStream[i];
        const hrr = (hrStream[i] - minHR) / (maxHR - minHR);
        t += calcTRIMP(dur, hrr, gender);
    }
    const tHourAtLT = calcTRIMP(3600, (ltHR - minHR) / (maxHR - minHR), gender);
    return (t / tHourAtLT) * 100;
}


export function estimateRestingHR(ftp) {
    // Use handwavy assumption that high FTP = low resting HR.
    const baselineW = 300;
    const baselineR = 50;
    const range = 20;
    const delta = ftp - baselineW;
    const diff = range * (delta / baselineW);
    return baselineR - diff;
}


export function estimateMaxHR(zones) {
    // Estimate max from inner zone ranges.
    const avgRange = ((zones.z4 - zones.z3) + (zones.z3 - zones.z2)) / 2;
    return zones.z4 + avgRange;
}


// See:
//  https://www.trainerroad.com/forum/t/tss-spreadsheets-with-atl-ctl-form/7613/10
//  http://www.timetriallingforum.co.uk/index.php?/topic/74961-calculating-ctl-and-atl/#comment-1045764
const chronicTrainingLoadConstant = 42;
const acuteTrainingLoadConstant = 7;

function _makeExpWeightedCalc(size) {
    const c = 1 - Math.exp(-1 / size);
    return function(data, seed=0) {
        let v = seed;
        for (const x of data) {
            v = (v * (1 - c)) + (x * c);
        }
        return v;
    };
}

export const calcCTL = _makeExpWeightedCalc(chronicTrainingLoadConstant);
export const calcATL = _makeExpWeightedCalc(acuteTrainingLoadConstant);

export function expWeightedAvg(size, data, seed) {
    return _makeExpWeightedCalc(size)(data, seed);
}


export function makeExpWeightedAccumulator(fixedSize, seed=0) {
    let v = seed;
    const fixedC = fixedSize ? 1 - Math.exp(-1 / fixedSize) : null;
    return function(x, size) {
        const c = size ? (1 - Math.exp(-1 / size)) : fixedC;
        v = (v * (1 - c)) + (x * c);
        return v;
    };
}
