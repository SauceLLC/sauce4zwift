

function createSVGElement(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}


export class Sparkline {
    constructor({el, data, yMin, yMax, xMin, xMax, padding, onTooltip}={}) {
        this.yMin = yMin;
        this.yMax = yMax;
        this.xMin = xMin;
        this.xMax = xMax;
        this.padding = padding || [4, 4, 4, 4];
        this.onTooltip = onTooltip;
        this.aspectRatio = 1;
        this.onPointeroverForTooltips = this._onPointeroverForTooltips.bind(this);
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
        const dpr = devicePixelRatio || 1;
        this.aspectRatio = ar;
        // SVG viewbox is a virtual coord system but using very small or large values
        // does impact gpu mem and visual quality, so try to make good choices...
        if (ar > 1) {
            this._boxWidth = Math.round(rect.width * dpr);
            this._boxHeight = Math.round(this._boxWidth / ar);
        } else {
            this._boxHeight = Math.round(rect.height * dpr);
            this._boxWidth = Math.round(this._boxHeight * ar);
        }
        const hPad = (this.padding[1] + this.padding[3]) * dpr;
        const vPad = (this.padding[0] + this.padding[2]) * dpr;
        this._plotWidth = this._boxWidth - hPad;
        this._plotHeight = this._boxHeight - vPad;
        this._svgEl.setAttribute('viewBox', `0 0 ${this._boxWidth} ${this._boxHeight}`);
        const fo = this._svgEl.querySelector('foreignObject.css-background');
        fo.setAttribute('width', this._plotWidth);
        fo.setAttribute('height', this._plotHeight);
        if (forceRender) {
            this.render();
        }
    }

    setElement(el) {
        const old = this.el;
        if (old) {
            this._resizeObserver.unobserve(old);
            old.removeEventListener('pointerover', this.onPointeroverForTooltips);
        }
        const dpr = devicePixelRatio || 1;
        const translate = [
            Math.round(this.padding[3] * dpr),
            Math.round(this.padding[0] * dpr)
        ];
        this.el = el;
        const magic = '' + Math.random() + performance.now();
        const pathId = `path-def-${magic}`;
        this.el.innerHTML = `
            <svg class="sauce-sparkline"
                 preserveAspectRatio="none"
                 version="1.1"
                 xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <clipPath id="${pathId}-clip"><path class="data-def area"/></clipPath>
                </defs>
                <g class="plot-region" transform="translate(${translate.join()})">
                    <foreignObject class="css-background" clip-path="url(#${pathId}-clip)">
                        <div class="visual-data-area"></div>
                    </foreignObject>
                    <path class="data-def line visual-data-line"/>
                    <g class="points"></g>
                </g>
            </svg>
        `;
        this._svgEl = this.el.querySelector('svg');
        this._pointsEl = this.el.querySelector('g.points');
        this._pathLineDefEl = this.el.querySelector('path.data-def.line');
        this._pathAreaDefEl = this.el.querySelector('path.data-def.area');
        this._pointsMap = new Map();
        this._adjustAspectRatio();
        this.el.addEventListener('pointerover', this.onPointeroverForTooltips);
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

    _onPointeroverForTooltips(ev) {
        const point = ev.target.closest('circle.data-point');
        if (!point) {
            return;
        }
        const title = createSVGElement('title');
        title.textContent = point._tooltipFormat();
        point.replaceChildren(title);
    }

    render() {
        if (!this.data || !this.data.length) {
            this._pathLineDefEl.removeAttribute('d');
            this._pathAreaDefEl.removeAttribute('d');
            this._pointsEl.innerHTML = '';
            this._pointsMap.clear();
            return;
        }
        const {coords, normalized} = this._renderData();
        const {pointUpdates} = this._renderStageUpdates(coords, normalized); // XXX no async
        this._renderFinal(coords, pointUpdates);
        this._prevCoords = coords;
        this._prevNormalized = normalized;
    }

    _renderData() {
        // Step 1: data processing
        const normalized = this.normalizeData(this.data);
        let yND;
        const yMin = this.yMin != null ? this.yMin : Math.min(...(yND = normalized.map(o => o.y)));
        const yMax = this.yMax != null ? this.yMax : Math.max(...(yND || normalized.map(o => o.y)));
        this._yRange = (yMax - yMin) || 1;
        this._yScale = this._plotHeight / this._yRange;
        const xMin = this.xMin != null ? this.xMin : normalized[0].x;
        const xMax = this.xMax != null ? this.xMax : normalized[normalized.length - 1].x;
        this._xRange = (xMax - xMin) || 1;
        this._xScale = this._plotWidth / this._xRange;
        const coords = normalized.map(o => [
            (o.x - xMin) * this._xScale,
            this._plotHeight - ((o.y - yMin) * this._yScale)
        ]);
        return {coords, normalized};
    }

    _renderStageUpdates(coords, normalized) {
        let needForceLayout;
        if (this._prevCoords) {
            // We can use CSS to animate the transition but we have to use a little hack
            // because it only animates when the path has the same number of points.
            if (this._prevCoords.length !== coords.length) {
                const prev = Array.from(this._prevCoords);
                while (prev.length > coords.length) {
                    prev.shift();
                }
                while (prev.length < coords.length) {
                    prev.push(prev[prev.length - 1]);
                }
                this._pathLineDefEl.setAttribute('d', this._makePath(prev));
                this._pathAreaDefEl.setAttribute('d', this._makePath(prev, {closed: true}));
                needForceLayout = true;
            }
        }
        const remPoints = new Set(this._pointsMap.values());
        const newPoints = [];
        const pointUpdates = [];
        for (let index = 0; index < coords.length; index++) {
            const coord = coords[index];
            const dataRef = this.data[index];
            let point = this._pointsMap.get(dataRef);
            if (point) {
                remPoints.delete(point);
            } else {
                const nd = normalized[index];
                point = createSVGElement('circle');
                point._dataRef = dataRef;
                point.classList.add('data-point');
                point._tooltipFormat = nd.tooltip ?
                    nd.tooltip.bind(this, nd, point) :
                    this.onTooltip ?
                        this.onTooltip.bind(this, nd, point) :
                        () => nd.y.toLocaleString();
                newPoints.push(point);
                this._pointsMap.set(dataRef, point);
                // Look for some animation opportunities...
                if (this._prevNormalized) {
                    let beginCoord = [coord[0], this._plotHeight];
                    const maxSearch = 10;
                    if (index >= coords.length / 2) {
                        // right-to-left movement...
                        const edge = this._prevNormalized[this._prevNormalized.length - 1];
                        for (let i = 0; i < Math.min(maxSearch, normalized.length); i++) {
                            const n = normalized[normalized.length - 1 - i];
                            if (n.x === edge.x && n.y === edge.y) {
                                beginCoord = this._prevCoords[this._prevCoords.length - 1];
                                break;
                            }
                        }
                    } else {
                        // left-to-right movement...
                        const edge = this._prevNormalized[0];
                        for (let i = 0; i < Math.min(maxSearch, normalized.length); i++) {
                            const n = normalized[i];
                            if (n.x === edge.x && n.y === edge.y) {
                                beginCoord = this._prevCoords[0];
                                break;
                            }
                        }
                    }
                    point.setAttribute('cx', beginCoord[0]);
                    point.setAttribute('cy', beginCoord[1]);
                    needForceLayout = true;
                }
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
            this._svgEl.clientWidth;
        }
        return {pointUpdates};
    }

    _makePath(coords, {closed}={}) {
        if (!coords.length) {
            return '';
        }
        const start = closed ? `M0,${this._plotHeight}L` : 'M';
        const end = closed ? `L${this._plotWidth},${this._plotHeight}Z` : '';
        return start + coords.map(c => `${c[0]},${c[1]}`).join('L') + end;
    }

    _renderFinal(coords, pointUpdates) {
        this._pathLineDefEl.setAttribute('d', this._makePath(coords));
        this._pathAreaDefEl.setAttribute('d', this._makePath(coords, {closed: true}));
        for (let i = 0; i < pointUpdates.length; i++) {
            const [point, coord] = pointUpdates[i];
            point.setAttribute('cx', coord[0]);
            point.setAttribute('cy', coord[1]);
        }
    }
}
