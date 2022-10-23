import * as common from './common.mjs';


export class SauceLegend {
    constructor({el, chart, hiddenStorageKey}) {
        this.el = el;
        this.chart = chart;
        this.hiddenStorageKey = hiddenStorageKey;
        this.hidden = new Set(hiddenStorageKey && common.storage.get(hiddenStorageKey) || []);
        this.render();
        el.addEventListener('click', ev => this.onLegendClick(ev));
    }

    render() {
        const {series, color} = this.chart.getOption();
        this.el.innerHTML = series.map((x, i) => {
            const hidden = this.hidden.has(x.id);
            if (hidden) {
                this.chart.dispatchAction({type: 'legendUnSelect', name: x.name});
            }
            return `
                <div class="s-legend-item ${hidden ? 'hidden' : ''}" data-id="${x.id}" data-name="${x.name}">
                    <div class="color" style="background-color: ${color[i]};"></div>
                    <div class="label">${x.name}</div>
                </div>
            `;
        }).join('\n');
    }

    onLegendClick(ev) {
        const item = ev.target.closest('.s-legend-item[data-id]');
        if (!item) {
            return;
        }
        this.chart.dispatchAction({type: 'legendToggleSelect', name: item.dataset.name});
        item.classList.toggle('hidden');
        const id = item.dataset.id;
        if (this.hidden.has(id)) {
            this.hidden.delete(id);
        } else {
            this.hidden.add(id);
        }
        if (this.hiddenStorageKey) {
            common.storage.set(this.hiddenStorageKey, Array.from(this.hidden));
        }
    }
}
