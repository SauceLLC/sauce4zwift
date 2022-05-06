/* global bb */
import * as common from './common.mjs';


export class MultiScalePlugin {
	constructor(scales) {
		this.$$ = undefined;
        this.scalesConfig = scales;
        this.scales = new Map();
	}

	$beforeInit() {
        const updateScales = this.$$.updateScales;
        this.$$.updateScales = this.updateScales.bind(this, updateScales);
        const getYScaleById = this.$$.getYScaleById;
        this.$$.getYScaleById = this.getYScaleById.bind(this, getYScaleById);
    }

	$init() { }

	$afterInit() { }

    setDomain(id, domain) {
        this.scales.get(id).domain(domain);
    }

    updateScales(superFn, ...args) {
        superFn.call(this.$$, ...args);
        this.scales.clear();
        for (const x of this.scalesConfig) {
            const originScale = this.$$.scale[x.origin];
            const scale = originScale.copy();
            if (x.domain) {
                scale.domain(x.domain);
            }
            this.scales.set(x.id, scale);
        }
    }

    getYScaleById(superFn, id, isSub) {
        if (this.scales.has(id)) {
            return this.scales.get(id);
        } else {
            return superFn.call(this.$$, id, isSub);
        }
    }

	$redraw(context, transitionDuration) { }

	$willDestroy() {
        for (const key of Object.keys(this)) {
			delete this[key];
		}
	}
}


const lamb = bb.generate({
    render: {lazy: true, observe: false},
    interaction: {enabled: false},
    data: {rows: []},
    bindto: document.createElement('div'),
});
const BillboardChart = lamb.constructor;


export class Chart extends BillboardChart {
    constructor(options) {
        let _this;
        let scalePlugin;
        if (options.scales) {
            options.plugins = options.plugins || [];
            scalePlugin = new MultiScalePlugin(options.scales);
            options.plugins.push(scalePlugin);
        }
        const hidden = new Set(options.hiddenStorageKey &&
            common.storage.get(options.hiddenStorageKey) || []);
        if (options.htmlLegendEl) {
            options.legend = {show: false, hide: true};
            options.htmlLegendEl.innerHTML = Object.entries(options.names).map(([id, name]) => `
                <div class="s-legend-item ${hidden.has(id) ? 'hidden' : ''}" data-id="${id}">
                    <div class="color" style="background-color: ${options.colors[id]};"></div>
                    <div class="label">${name}</div>
                </div>
            `).join('\n');
            options.htmlLegendEl.addEventListener('click', ev => _this.onLegendClick(ev));
        }
        options.data.hide = Array.from(hidden);
        options.data.names = options.names;
        options.data.colors = options.colors;
        super(options);
        _this = this;
        this.scalePlugin = scalePlugin;
        this.names = options.names;
        this.colors = options.colors;
        this.hidden = hidden;
        this.hiddenStorageKey = options.hiddenStorageKey;
        this.colors = options.colors;
    }

    onLegendClick(ev) {
        const item = ev.target.closest('.s-legend-item[data-id]');
        if (!item) {
            return;
        }
        const id = item.dataset.id;
        this.toggle(id);
        item.classList.toggle('hidden');
        if (this.hidden.has(id)) {
            this.hidden.delete(id);
        } else {
            this.hidden.add(id);
        }
        if (this.hiddenStorageKey) {
            common.storage.set(this.hiddenStorageKey, Array.from(this.hidden));
        }
    }

    setScaleDomain(name, domain) {
        this.scalePlugin.setDomain(name, domain);
    }
}
