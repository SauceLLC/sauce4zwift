
export class Color {
    static fromRGB(r, g, b, a) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const d = maxC - minC;
        let h = 0;
        if (!d) {
            h = 0;
        } else if (maxC === r) {
            h = ((g - b) / d) % 6;
        } else if (maxC === g) {
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

    static fromHex(hex) {
        if (hex.length >= 7) {
            const r = parseInt(hex.substr(1, 2), 16) / 0xff;
            const g = parseInt(hex.substr(3, 2), 16) / 0xff;
            const b = parseInt(hex.substr(5, 2), 16) / 0xff;
            const a = (hex.length === 9) ? parseInt(hex.substr(7, 2), 16)  / 0xff : undefined;
            return this.fromRGB(r, g, b, a);
        } else if (hex.length >= 4) {
            const r = parseInt(''.padStart(2, hex.substr(1, 1)), 16) / 0xff;
            const g = parseInt(''.padStart(2, hex.substr(2, 1)), 16) / 0xff;
            const b = parseInt(''.padStart(2, hex.substr(3, 1)), 16) / 0xff;
            const a = (hex.length === 5) ? parseInt(''.padStart(2, hex.substr(4, 1)), 16) / 0xff : undefined;
            return this.fromRGB(r, g, b, a);
        } else {
            throw new Error('Invalid hex color');
        }
    }

    constructor(h, s, l, a) {
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

    lighten(ld) {
        const c = this.clone();
        c.l += ld;
        return c;
    }

    saturate(sd) {
        const c = this.clone();
        c.s += sd;
        return c;
    }

    hue(h) {
        const c = this.clone();
        c.h = h;
        return c;
    }

    toString(options={}) {
        const h = Math.round(this.h * 360);
        const s = Math.round(this.s * 100);
        const l = Math.round(this.l * 100);
        if (options.legacy) {
            if (this.a !== undefined) {
                return `hsla(${h}deg, ${s}%, ${l}%, ${Number(this.a.toFixed(4))})`;
            } else {
                return `hsl(${h}deg, ${s}%, ${l}%)`;
            }
        } else {
            const a = this.a !== undefined ? ` / ${Math.round(this.a * 100)}%` : '';
            return `hsl(${h}deg ${s}% ${l}%${a})`;
        }
    }
}


export function parse(s) {
    if (s && (typeof s) === 'string' && s.startsWith('#')) {
        return Color.fromHex(s);
    } else {
        throw new TypeError('Unsupported color format');
    }
}
