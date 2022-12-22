
export class Color {
    static fromRGB(r, g, b, a=1) {
        // Credit: https://www.30secondsofcode.org/js/s/rgb-to-hsl
        r = r < 1 ? r : r / 255;
        g = g < 1 ? g : g / 255;
        b = b < 1 ? b : b / 255;
        const l = Math.max(r, g, b);
        const s = l - Math.min(r, g, b);
        const h = s ?
            l === r ?
                (g - b) / s :
                l === g ?
                    2 + (b - r) / s :
                    4 + (r - g) / s :
                0;
        return new this(60 * h < 0 ? 60 * h + 360 : 60 * h,
            100 * (s ? (l <= 0.5 ? s / (2 * l - s) : s / (2 - (2 * l - s))) : 0),
            (100 * (2 * l - s)) / 2, a);
    }

    constructor(h, s, l, a=1) {
        this.h = h;
        this.s = s;
        this.l = l;
        this.a = a;
    }

    toString() {
        return `hsla(${Math.round(this.h)}deg, ${Math.round(this.s)}%, ${Math.round(this.l)}%, ${this.a})`;
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
