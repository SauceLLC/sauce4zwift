
import {RollingBase} from './data.mjs';


export class RollingPace extends RollingBase {
    distance(options) {
        options = options || {};
        const offt = (options.offt || 0) + this._offt;
        const start = this._values[offt];
        const end = this._values[this._length - 1];
        if (start != null && end != null) {
            return end - start;
        }
    }

    avg() {
        const dist = this.distance();
        const elapsed = this.elapsed();
        if (!dist || !elapsed) {
            return;
        }
        return elapsed / dist;
    }

    full(options) {
        options = options || {};
        const offt = options.offt;
        return this.distance({offt}) >= this.period;
    }
}


export function bestPace(distance, timeStream, distStream) {
    if (timeStream.length < 2 || distance[distance.length - 1] < distance) {
        return;
    }
    const roll = new RollingPace(distance);
    return roll.importReduce(timeStream, distStream, (cur, lead) => cur.avg() <= lead.avg());
}


export function work(weight, dist, isWalking) {
    const cost = isWalking ? 2 : 4.35;  // Hand tuned by intuition
    const j = cost / ((1 / weight) * (1 / dist));
    const humanMechFactor = 0.24;  // Human mechanical efficiency percentage
    const kj = j * humanMechFactor / 1000;
    return kj;
}
