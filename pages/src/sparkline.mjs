
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
        this._svgEl.setAttribute('viewBox', `0 0 ${this._boxWidth} ${this._boxHeight}`);
        if (forceRender) {
            this.render();
        }
    }

    setElement(el) {
        const old = this.el;
        if (old) {
            this._resizeObserver.unobserve(old);
            old.removeEventListener('hover', this.onHoverForTooltips);
        }
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
        this._svgEl = this.el.querySelector('svg');
        this._pointsEl = this.el.querySelector('g.points');
        this._pathEl = this.el.querySelector('path.data');
        this._pointsMap = new Map();
        this._adjustAspectRatio();
        this.el.addEventListener('hover', this.onHoverForTooltips);
        this._resizeObserver.observe(el);
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

    onHoverForTooltips(ev) {
        const point = ev.target.closest('circle.data-point');
        if (!point) {
            return;
        }
    }

    async render() {
        if (!this.data || !this.data.length) {
            this._pathEl.style.removeProperty('d');
            this._pointsEl.innerHTML = '';
            this._pointsMap.clear();
            return;
        }
        const {coords, normalized} = this._renderData();
        const {pointUpdates} = this._renderStageUpdates(coords, normalized);
        this._renderFinal(coords, pointUpdates);
        this._prevCoords = coords;
    }

    _renderData() {
        // Step 1: data processing
        const normalized = this.normalizeData(this.data);
        let yND;
        const yMin = this.yMin != null ? this.yMin : Math.min(...(yND = normalized.map(o => o.y)));
        const yMax = this.yMax != null ? this.yMax : Math.max(...(yND || normalized.map(o => o.y)));
        const yRange = (yMax - yMin) || 1;
        const xMin = this.xMin != null ? this.xMin : normalized[0].x;
        const xMax = this.xMax != null ? this.xMax : normalized[normalized.length - 1].x;
        const xRange = (xMax - xMin) || 1;
        const vPad = this.padding[0] + this.padding[2];
        const hPad = this.padding[1] + this.padding[3];
        const coords = normalized.map(o => [
            (o.x - xMin) / xRange * (this._boxWidth - hPad),
            (this._boxHeight - vPad) - ((o.y - yMin) / yRange * (this._boxHeight - vPad))
        ]);
        return {coords, normalized};
    }

    _renderStageUpdates(coords, normalized) {
        let needForceLayout;
        if (this._prevCoords) {
            // We can use CSS to animate the transition but we have to use a little hack because it only
            // animates when the path has the same number of points.
            if (this._prevCoords.length !== coords.length) {
                const prev = Array.from(this._prevCoords);
                while (prev.length > coords.length) {
                    prev.shift(); // XXX assumption that data is going to move right
                }
                while (prev.length < coords.length) {
                    prev.push(prev[prev.length - 1]);
                }
                this._pathEl.style.setProperty('d', `path('M${prev.map((o, i) => o.join()).join(' ')}')`);
                needForceLayout = true;
            }
        }
        let i;
        const remPoints = new Set(this._pointsMap.values());
        const newPoints = [];
        const pointUpdates = [];
        for (i = 0; i < coords.length; i++) {
            const coord = coords[i];
            const dataRef = this.data[i];
            let point = this._pointsMap.get(dataRef);
            if (!point) {
                const ndRef = normalized[i];
                point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                point._dataRef = dataRef;
                point.classList.add('data-point');
                point._tooltipFormat = ndRef.tooltip ?
                    ndRef.tooltip :
                    this.onTooltip ?
                        this.onTooltip :
                        () => ndRef.y.toLocaleString();
                this._pointsMap.set(dataRef, point);
                console.warn("adding", point, i, '/', coords.length);
                if (i && i === coords.length - 1 && this._prevCoords) {
                    // animate it in...
                    const p = this._prevCoords[this._prevCoords.length - 1];
                    point.setAttribute('cx', p[0]);
                    point.setAttribute('cy', p[1]);
                    this._pointsEl.append(point);
                    point.clientWidth; // force layout
                } else {
                    newPoints.push(point);
                }
            } else {
                remPoints.delete(point);
            }
            const sig = coord.join();
            if (point._sig !== sig) {
                pointUpdates.push([point, coord]);
                point._sig = sig;
            }
        }
        for (const x of remPoints) {
            this._pointsMap.delete(x._dataRef);
            x.remove();
        }
        this._pointsEl.append(...newPoints);
        if (needForceLayout) {
            this._pathEl.clientWidth;
        }
        return {pointUpdates};
    }

    _renderFinal(coords, pointUpdates) {
        this._pathEl.style.setProperty('d', `path('M${coords.map((o, i) => o.join()).join(' ')}')`);
        for (let i = 0; i < pointUpdates.length; i++) {
            const [point, coord] = pointUpdates[i];
            point.setAttribute('cx', coord[0]);
            point.setAttribute('cy', coord[1]);
        }
    }
}
