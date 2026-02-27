import * as Common from './common.mjs';
import * as Fields from './fields.mjs';

Common.settingsStore.setDefault({
});

const settings = Common.settingsStore.get();


function fGet(obj, ...args) {
    return typeof obj === 'function' ? `() => ${obj(...args)}` : obj;
}


export async function main() {
    Common.initInteractionListeners();
    Common.setBackground(settings);
    const fieldsEl = document.querySelector('#content .fields');
    const fieldRenderer = new Common.Renderer(fieldsEl, {fps: Infinity});
    const mapping = [];
    let group;
    await new Promise(r => setTimeout(r, 100));
    for (const x of Fields.fields) {
        if (x.group !== group) {
            fieldsEl.insertAdjacentHTML('beforeend', `
                <div class="group">
                    <h4>${Fields.fieldGroupNames[x.group] ?? x.group} -
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
                     title="${Common.sanitizeAttr(fGet(x.tooltip))}">tooltip: ${fGet(x.tooltip)}</div>
                <div class="rendered">
                    <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                </div>
            </div>
        `);
        mapping.push({id: 'f-' + x.id, default: x.id});
    }
    fieldRenderer.addRotatingFields({mapping, fields: Fields.fields});
    fieldRenderer.setData({});
    fieldRenderer.render();
    /*Common.subscribe('nearby', async nearby => {
        for (const x of nearby) {
            fieldRenderer.setData(x);
            fieldRenderer.render();
            await Common.sleep(1000 / nearby.length);
        }
    });*/
    Common.subscribe('athlete/watching', ad => {
        fieldRenderer.setData(ad);
        fieldRenderer.render();
    });
    document.querySelector('select[name="style"]').addEventListener('input', ev => {
        const style = ev.currentTarget.value;
        let html;
        if (style === 'key') {
            html = `<div class="key"></div><div class="value"></div><abbr class="unit"></abbr>`;
        } else if (style === 'label') {
            html = `<b class="label"></b>
                <small class="sub-label"></small>
                <div class="value"></div><abbr class="unit"></abbr>`;
        }
        for (const x of document.querySelectorAll('.field .rendered')) {
            x.innerHTML = html;
        }
        fieldRenderer.fields.clear();
        fieldRenderer.addRotatingFields({mapping, fields: Fields.fields});
    });
}
