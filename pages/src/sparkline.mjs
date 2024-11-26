
export class Sparkline {
    constructor({el, data, yMin, yMax, xMin, xMax, padding, onTooltip}={}) {
        this.yMin = yMin;
        this.yMax = yMax;
        this.xMin = xMin;
        this.xMax = xMax;
        this.padding = padding || [4, 4, 4, 4];
        this.onTooltip = onTooltip;
        this.aspectRatio = 1;
        this._resizeObserver = new ResizeObserver(this._adjustAspectRatio.bind(this));
        if (data) {
            this.setData(el);
        }
        if (el) {
            this.setElement(el);
        }
    }

    _adjustAspectRatio() {
        const rect = this.el.getBoundingClientRect();
        const ar = rect.width / rect.height;
        const forceRender = ar / this.aspectRatio > 0.01;
        this.aspectRatio = ar;
        // SVG viewbox is a virtual coord system but using very small or large values
        // does impact gpu mem and visual quality, so try to make good choices...
        if (ar > 1) {
            this._boxWidth = Math.round(rect.width * 2);
            this._boxHeight = Math.round(this._boxWidth / ar);
        } else {
            this._boxHeight = Math.round(rect.height * 2);
            this._boxWidth = Math.round(this._boxHeight * ar);
        }
        this._svg.setAttribute('viewBox', `0 0 ${this._boxWidth} ${this._boxHeight}`);
        if (forceRender) {
            this.render();
        }
    }

    setElement(el) {
        this._resizeObserver.disconnect();
        this._resizeObserver.observe(el);
        this.el = el;
        this.el.innerHTML = `
            <svg class="sauce-sparkline"
                 preserveAspectRatio="none"
                 version="1.1"
                 xmlns="http://www.w3.org/2000/svg">
                <g class="line" transform="translate(${this.padding[3]} ${this.padding[0]})">
                    <path class="data"/>
                    <g class="points"></g>
                </g>
            </svg>
        `;
        this._svg = this.el.querySelector('svg');
        this._points = this.el.querySelector('g.points');
        this._path = this.el.querySelector('path.data');
        this._adjustAspectRatio();
    }

    setData(data) {
        this.data = data;
        if (this.el) {
            this.render();
        }
    }

    normalizeData(data) {
        let norm;
        if (!data.length) {
            norm = [];
        } else if (Array.isArray(data[0])) {
            // [[x, y], [x1, y1], ...]
            norm = data.map(([x, y]) => ({x: x || 0, y: y || 0}));
        } else if (typeof data[0] === 'object') {
            // [{x, y, ...}, {x, y, ...}, ...]
            norm = data.map(o => ({...o, x: o.x || 0, y: o.y || 0}));
        } else {
            // [y, y1, ...]
            norm = data.map((y, x) => ({x, y: y || 0}));
        }
        norm.sort((a, b) => a.x - b.x);
        return norm;
    }

    render() {
        if (!this.data || !this.data.length) {
            this._path.style.removeProperty('d');
            this._points.innerHTML = '';
            return;
        }
        const nd = this.normalizeData(this.data);
        const yMin = this.yMin != null ? this.yMin : Math.min(...nd.map(o => o.y));
        const yMax = this.yMax != null ? this.yMax : Math.max(...nd.map(o => o.y));
        const yRange = (yMax - yMin) || 1;
        const xMin = this.xMin != null ? this.xMin : nd[0].x;
        const xMax = this.xMax != null ? this.xMax : nd[nd.length - 1].x;
        const xRange = (xMax - xMin) || 1;
        const vPad = this.padding[0] + this.padding[2];
        const hPad = this.padding[1] + this.padding[3];
        const d = [];
        const points = [];
        for (let i = 0; i < nd.length; i++) {
            const o = nd[i];
            const x = ((o.x - xMin) / xRange * (this._boxWidth - hPad));
            const y = (this._boxHeight - vPad) - ((o.y - yMin) / yRange * (this._boxHeight - vPad));
            d.push([x, y]);
            const title = o.tooltip ? o.tooltip(o) : this.onTooltip ? this.onTooltip(o) : y.toLocaleString();
            points.push({x, y, title});
        }
        if (this._prevPathD) {
            // We can use CSS to animate the transition but we have to use a little hack because it only
            // animates when the path has the same number of points.
            if (this._prevPathD.length !== d.length) {
                const prev = Array.from(this._prevPathD);
                while (prev.length > d.length) {
                    prev.shift(); // XXX assumption that data is going to move right
                }
                while (prev.length < d.length) {
                    prev.push(prev[prev.length - 1]);
                }
                this._path.style.setProperty('d', `path('M${prev.map((o, i) => o.join()).join(' ')}')`);
                this._path.clientWidth;
            }
        }
        this._path.style.setProperty('d', `path('M${d.map((o, i) => o.join()).join(' ')}')`);
        this._prevPathD = d;
        let i;
        while (this._points.children.length > i) {
            this._points.children[0].remove();
        }
        for (i = 0; i < points.length; i++) {
            const o = points[i];
            let circle = this._points.children[i];
            if (!circle) {
                circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.innerHTML = '<title></title>';
                this._points.append(circle);
            }
            const sig = JSON.stringify(o);
            if (circle._sig !== sig) {
                circle.setAttribute('cx', o.x);
                circle.setAttribute('cy', o.y);
                circle.querySelector('title').innerHTML = o.title;
                circle._sig = sig;
            }
        }
    }
}
