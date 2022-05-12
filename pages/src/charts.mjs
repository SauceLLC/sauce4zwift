import * as common from './common.mjs';


export class SauceLegend {
    constructor({el, chart, hiddenStorageKey}) {
        this.el = el;
        this.chart = chart;
        this.hiddenStorageKey = hiddenStorageKey;
        this.hidden = new Set(hiddenStorageKey && common.storage.get(hiddenStorageKey) || []);
        const {series, color} = chart.getOption();
        el.innerHTML = series.map((x, i) => {
            const hidden = this.hidden.has(x.name);
            if (hidden) {
                chart.dispatchAction({type: 'legendUnSelect', name: x.name});
            }
            return `
                <div class="s-legend-item ${hidden ? 'hidden' : ''}" data-name="${x.name}">
                    <div class="color" style="background-color: ${color[i]};"></div>
                    <div class="label">${x.name}</div>
                </div>
            `;
        }).join('\n');
        el.addEventListener('click', ev => this.onLegendClick(ev));
    }

    onLegendClick(ev) {
        const item = ev.target.closest('.s-legend-item[data-name]');
        if (!item) {
            return;
        }
        const name = item.dataset.name;
        this.chart.dispatchAction({type: 'legendToggleSelect', name});
        item.classList.toggle('hidden');
        if (this.hidden.has(name)) {
            this.hidden.delete(name);
        } else {
            this.hidden.add(name);
        }
        if (this.hiddenStorageKey) {
            common.storage.set(this.hiddenStorageKey, Array.from(this.hidden));
        }
    }
}
