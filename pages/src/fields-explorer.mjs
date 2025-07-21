import * as common from './common.mjs';
import * as fields from './fields.mjs';

common.settingsStore.setDefault({
});

const settings = common.settingsStore.get();


function fGet(obj, ...args) {
    return typeof obj === 'function' ? `() => ${obj(...args)}` : obj;
}


export async function main() {
    common.initInteractionListeners();
    common.setBackground(settings);
    const fieldsEl = document.querySelector('#content .fields');
    const fieldRenderer = new common.Renderer(fieldsEl, {fps: Infinity});
    const mapping = [];
    let group;
    await new Promise(r => setTimeout(r, 100));
    for (const x of fields.fields) {
        if (x.group !== group) {
            fieldsEl.insertAdjacentHTML('beforeend', `
                <div class="group">
                    <h4>${fields.fieldGroupNames[x.group] ?? x.group} -
                        <code><small>\`${x.group}\`</small></code></h4>
                    <div class="fields-wrap">
                    </div>
                </div>
            `);
            group = x.group;
        }
        fieldsEl.querySelector('.group:last-child .fields-wrap').insertAdjacentHTML('beforeend', `
            <div class="field" data-field="f-${x.id}">
                <div class="def d-id">id: ${x.id}</div>
                <div class="def d-longname">longName: ${fGet(x.longName)}</div>
                <div class="def d-shortname">shortName: ${fGet(x.shortName)}</div>
                <div class="def d-label">label: ${fGet(x.label)}</div>
                <div class="def d-tooltip"
                     title="${common.sanitizeAttr(fGet(x.tooltip))}">tooltip: ${fGet(x.tooltip)}</div>
                <div class="rendered">
                    <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                </div>
            </div>
        `);
        mapping.push({id: 'f-' + x.id, default: x.id});
    }
    fieldRenderer.addRotatingFields({mapping, fields: fields.fields});
    fieldRenderer.setData({});
    fieldRenderer.render();
    /*common.subscribe('nearby', async nearby => {
        for (const x of nearby) {
            fieldRenderer.setData(x);
            fieldRenderer.render();
            await common.sleep(1000 / nearby.length);
        }
    });*/
    common.subscribe('athlete/watching', ad => {
        fieldRenderer.setData(ad);
        fieldRenderer.render();
    });
}
