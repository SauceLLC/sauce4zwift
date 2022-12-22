
export class Color {
    static fromRGB(r, g, b, a=1) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const d = maxC - minC;
        let h = 0;
        if (!d) {
            h = 0;
        } else if (maxC == r) {
            h = ((g - b) / d) % 6;
        } else if (maxC == g) {
            h = (b - r) / d + 2;
        } else {
            h = (r - g) / d + 4;
        }
        h = Math.round(h * 60);
        if (h < 0) {
            h += 360;
        }
        h /= 360;
        const l = (maxC + minC) / 2;
        const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
        return new this(h, s, l, a);
    }

    constructor(h, s, l, a=1) {
        this.h = h;
        this.s = s;
        this.l = l;
        this.a = a;
    }

    clone() {
        return new this.constructor(this.h, this.s, this.l, this.a);
    }

    alpha(a) {
        const c = this.clone();
        c.a = a;
        return c;
    }

    light(l) {
        const c = this.clone();
        c.l = l;
        return c;
    }

    saturation(s) {
        const c = this.clone();
        c.s = s;
        return c;
    }

    hue(h) {
        const c = this.clone();
        c.h = h;
        return c;
    }

    toString() {
        const h = Math.round(this.h * 360);
        const s = Math.round(this.s * 100);
        const l = Math.round(this.l * 100);
        const a = Math.round(this.a * 100);
        return `hsla(${h}deg, ${s}%, ${l}%, ${a}%)`;
    }
}


export function parse(s) {
    if (s.startsWith('#')) {
        let r, g, b, a;
        if (s.length >= 7) {
            r = parseInt(s.slice(1, 3), 16) / 0xff;
            g = parseInt(s.slice(3, 5), 16) / 0xff;
            b = parseInt(s.slice(5, 7), 16) / 0xff;
            a = s.length > 7 ? parseInt(s.slice(7), 16) / 0xff : 1;
        } else if (s.length >= 4) {
            r = parseInt(s.slice(1, 2), 16) / 0xf;
            g = parseInt(s.slice(2, 3), 16) / 0xf;
            b = parseInt(s.slice(3, 4), 16) / 0xf;
            a = s.length > 4 ? parseInt(s.slice(4), 16) / 0xf : 1;
        } else {
            throw new TypeError('Invalid color');
        }
        return Color.fromRGB(r, g, b, a);
    } else {
        throw new TypeError('Unsupported color format');
    }
}
