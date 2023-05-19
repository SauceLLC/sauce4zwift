import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as fields from './fields.mjs';

common.enableSentry();

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

common.settingsStore.setDefault({
    leftFields: 2,
    rightFields: 2,
    lockedFields: false,
    autoHideWindows: false,
    centerGapSize: 0,
});


const _events = new Map();
function getEventSubgroup(id) {
    if (!_events.has(id)) {
        _events.set(id, null);
        common.rpc.getEventSubgroup(id).then(x => {
            if (x) {
                _events.set(id, x);
            } else {
                // leave it null but allow retry later
                setTimeout(() => _events.delete(id), 30000);
            }
        });
    }
    return _events.get(id);
}


export function main() {
    common.initInteractionListeners();
    let autoHidden;
    let lastData;
    let autoHideTimeout;
    doc.style.setProperty('--center-gap-size', common.settingsStore.get('centerGapSize') + 'px');
    let renderer = buildLayout();
    common.settingsStore.addEventListener('changed', ev => {
        for (const [k, v] of ev.data.changed.entries()) {
            if (k === '/imperialUnits') {
                imperial = v;
                L.setImperial(imperial);
                renderer.render();
                return;
            } else if (k === 'autoHideWindows') {
                location.reload();  // Avoid state machine complications.
                return;
            } else if (k === 'centerGapSize') {
                console.log("set gap", v);
                doc.style.setProperty('--center-gap-size', `${v}px`);
                renderer.render({force: true});
                return;
            }
        }
        if (renderer) {
            renderer.stop();
            renderer = null;
        }
        renderer = buildLayout();
        renderer.setData(lastData || {});
        renderer.render();
    });
    document.querySelector('.button.show').addEventListener('click', () => {
        doc.classList.remove('hidden');
        if (window.isElectron) {
            doc.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc.showAllWindows();
        }
    });
    document.querySelector('.button.hide').addEventListener('click', () => {
        doc.classList.add('hidden');
        if (window.isElectron) {
            doc.classList.remove('auto-hidden');
            autoHidden = false;
            common.rpc.hideAllWindows();
        }
    });
    if (window.isElectron) {
        document.querySelector('.button.quit').addEventListener('click', () => common.rpc.quit());
    }

    function autoHide() {
        autoHidden = true;
        doc.classList.add('auto-hidden', 'hidden');
        console.debug("Auto hidding windows");
        common.rpc.hideAllWindows({autoHide: true});
    }

    function autoShow() {
        autoHidden = false;
        doc.classList.remove('auto-hidden', 'hidden');
        console.debug("Auto showing windows");
        common.rpc.showAllWindows({autoHide: true});
    }

    const autoHideWait = 4000;
    if (window.isElectron && common.settingsStore.get('autoHideWindows')) {
        autoHideTimeout = setTimeout(autoHide, autoHideWait);
    }
    let lastUpdate = 0;
    common.subscribe('athlete/watching', watching => {
        if (window.isElectron && common.settingsStore.get('autoHideWindows') &&
            (watching.state.speed || watching.state.cadence || watching.state.power)) {
            clearTimeout(autoHideTimeout);
            if (autoHidden) {
                autoShow();
            }
            autoHideTimeout = setTimeout(autoHide, autoHideWait);
        }
        lastData = watching;
        if (watching.state.eventSubgroupId) {
            watching.eventSubgroup = getEventSubgroup(watching.state.eventSubgroupId);
        }
        renderer.setData(watching);
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            renderer.render();
        }
    }, {persistent: true});  // Prevent autohide when offscreen
    renderer.setData({});
    renderer.render();
}


function buildLayout() {
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {
        locked: common.settingsStore.get('lockedFields'),
        id: 'normal',
    });
    const defaults = {
        'left-0': 'rideons',
        'left-1': 'energy',
        'right-0': 'pwr-np',
        'right-1': 'wbal',
    };
    for (const side of ['left', 'right']) {
        const fieldsEl = document.querySelector(`.fields.${side}`);
        const mapping = [];
        fieldsEl.innerHTML = '';
        for (let i = 0; i < common.settingsStore.get(`${side}Fields`); i++) {
            const id = `${side}-${i}`;
            fieldsEl.insertAdjacentHTML('beforeend', `
                <div class="field" data-field="${id}">
                    <div class="key"></div><div class="value"></div><abbr class="unit"></abbr>
                </div>
            `);
            mapping.push({id, default: defaults[id] || 'time-elapsed'});
        }
        renderer.addRotatingFields({
            mapping,
            fields: fields.fields
        });
    }
    return renderer;
}


async function renderProfiles() {
    const profiles = await common.rpc.getProfiles();
    const el = document.querySelector('#windows');
    el.querySelector('table.profiles tbody').innerHTML = profiles.map(x => {
        return `
            <tr data-id="${x.id}" class="profile ${x.active ? 'active' : 'closed'}">
                <td class="name">${common.stripHTML(x.name)}<a class="link profile-edit-name"
                    title="Edit name"><ms>edit</ms></a></td>
                <td class="windows">${H.number(Object.keys(x.windows).length)}</td>
                <td class="btn">${x.active ? 'Current' : '<a class="link profile-select">Activate</a>'}</td>
                <td class="btn" title="Export this profile to a file"
                    ><a class="link profile-export"><ms>download</ms></a></td>
                <td class="btn" title="Duplicate this profile"
                    ><a class="link profile-clone"><ms>file_copy</ms></a></td>
                <td class="btn" title="Delete this profile"
                    ><a class="link danger profile-delete"><ms>delete_forever</ms></a></td>
            </tr>
        `;
    }).join('\n');
}


async function renderAvailableMods() {
    document.querySelector('.mods-path.button').addEventListener('click', common.rpc.showModsRootFolder);
    const mods = await common.rpc.getAvailableMods();
    const el = document.querySelector('#mods-container');
    if (!mods || !mods.length) {
        el.innerHTML = `<b><i>No mods detected</i></b>`;
        return;
    }
    const html = [];
    const ids = {};
    for (const {manifest, id, enabled} of mods) {
        if (!manifest) {
            continue;
        }
        const safeId = common.sanitizeAttr(id);
        ids[safeId] = id;
        html.push(`
            <div class="mod" data-id="${safeId}">
                <div class="title">
                    <div>
                        <span class="name">${common.stripHTML(manifest.name)}</span>
                        <span class="version">(v${manifest.version})</span>
                    </div>
                    <label class="enabled">
                        Enabled
                        <input type="checkbox" ${enabled ? 'checked' : ''}/>
                        <span class="restart-required">Restart Required</span>
                    </label>
                </div>
                <div class="info">${common.stripHTML(manifest.description)}</div>
        `);
        if (manifest.author || manifest.website_url) {
            html.push('<div class="pb">');
            if (manifest.author) {
                html.push(`<div class="author">Author: ${common.stripHTML(manifest.author)}</div>`);
            }
            if (manifest.website_url) {
                const url = common.sanitizeAttr(common.stripHTML(manifest.website_url));
                html.push(`<div class="website"><a href="${url}"
                    target="_blank" external>Website <ms>open_in_new</ms></a></div>`);
            }
            html.push('</div>');
        }
        html.push(`</div>`);
    }
    el.innerHTML = html.join('');
    el.addEventListener('click', async ev => {
        const label = ev.target.closest('label.enabled');
        if (!label) {
            return;
        }
        const enabled = label.querySelector('input').checked;
        const id = ids[ev.target.closest('.mod[data-id]').dataset.id];
        await common.rpc.setModEnabled(id, enabled);
        label.querySelector('.restart-required').style.display = 'initial';
    });
}


async function renderWindows(wins) {
    console.log(wins);
    const windows = (await common.rpc.getWidgetWindowSpecs()).filter(x => !x.private);
    const manifests = await common.rpc.getWidgetWindowManifests();
    const el = document.querySelector('#windows');
    const descs = Object.fromEntries(manifests.map(x => [x.type, x]));
    windows.sort((a, b) => !!a.closed - !!b.closed);
    el.querySelector('table.active-windows tbody').innerHTML = windows.map(x => {
        const desc = descs[x.type] || {
            prettyName: `Unknown window: ${x.type}`,
            prettyDesc: common.sanitizeAttr(JSON.stringify(x, null, 4)),
        };
        return `
            <tr data-id="${x.id}" class="window ${x.closed ? 'closed' : 'open'}"
                title="${common.sanitizeAttr(desc.prettyDesc)}\n\n` +
                       `Double click/tap to ${x.closed ? 'reopen' : 'focus'}">
                <td class="name">${common.stripHTML(x.customName || desc.prettyName)}` +
                    `<a class="link win-edit-name" title="Edit name"><ms>edit</ms></a></td>
                <td class="state">${x.closed ? 'Closed' : 'Open'}</td>
                <td class="btn"><a title="Reopen this window" class="link win-restore">` +
                    `<ms>add_box</ms></a></td>
                <td class="btn" title="Delete this window and its settings">` +
                    `<a class="link danger win-delete"><ms>delete_forever</ms></a></td>
            </tr>
        `;
    }).join('\n');
    const mGroups = new Map();
    for (const m of manifests.filter(x => !x.private)) {
        if (!mGroups.has(m.groupTitle)) {
            mGroups.set(m.groupTitle, []);
        }
        mGroups.get(m.groupTitle).push(m);
    }
    el.querySelector('.add-new select').innerHTML = Array.from(mGroups.entries()).map(([title, ms]) =>
        `<optgroup label="${common.sanitizeAttr(common.stripHTML(title || 'Main'))}">${ms.map(x =>
            `<option title="${common.sanitizeAttr(common.stripHTML(x.prettyDesc))}"
                     value="${x.type}">${common.stripHTML(x.prettyName)}</option>`)}</optgroup>`
    ).join('');
}


async function frank() {
    const bubble = document.createElement('div');
    const img = document.createElement('img');
    img.src = 'images/great_and_powerful.webp';
    img.classList.add('great-and-powerful');
    img.addEventListener('load', () => {
        img.classList.add('approves');
        bubble.classList.add('approves');
    });
    bubble.classList.add('great-and-powerful-bubble');
    const words = document.createElement('div');
    words.classList.add('words');
    bubble.append(words);
    words.textContent = 'The great and powerful Frank approves of your life choices!!!';
    const aud = document.createElement('audio');
    aud.innerHTML = `<source src="sounds/great_and_powerful.ogg" type="audio/ogg"/>`;
    aud.autoplay = true;
    document.body.append(img);
    document.body.append(bubble);
    document.body.append(aud);
    let active = true;
    setTimeout(() => {
        active = false;
        img.remove();
        bubble.remove();
        aud.remove();
    }, 110 * 1000);
    await sauce.sleep(12000);
    words.textContent = 'Let us celebrate this joyous occasion with my favorite song!';
    await sauce.sleep(19000);
    words.textContent = 'Now we Disco!';
    await sauce.sleep(2800);
    let discos = 1;
    while (active) {
        words.textContent = '';
        await sauce.sleep(60);
        if (discos++ > 10) {
            discos = 1;
        }
        for (let i = 0; i < discos; i++) {
            words.textContent += ' DISCO! ';
        }
        await sauce.sleep(400);
    }
}


async function initWindowsPanel() {
    await Promise.all([
        renderProfiles(),
        renderWindows(),
        renderAvailableMods(),
    ]);
    const winsEl = document.querySelector('#windows');
    winsEl.addEventListener('submit', ev => ev.preventDefault());
    winsEl.addEventListener('click', async ev => {
        const link = ev.target.closest('table a.link');
        if (!link) {
            return;
        }
        const id = ev.target.closest('[data-id]').dataset.id;
        if (link.classList.contains('win-restore')) {
            await common.rpc.openWidgetWindow(id);
        } else if (link.classList.contains('profile-select')) {
            await common.rpc.activateProfile(id);
            await renderProfiles();
            await renderWindows();
        } else if (link.classList.contains('win-delete')) {
            await common.rpc.removeWindow(id);
        } else if (link.classList.contains('profile-delete')) {
            await common.rpc.removeProfile(id).catch(e => alert(`Remove Error\n\n${e.message}`));
            await renderProfiles();
        } else if (link.classList.contains('profile-clone')) {
            await common.rpc.cloneProfile(id).catch(e => alert(`Clone Error\n\n${e.message}`));
            await renderProfiles();
        } else if (link.classList.contains('profile-export')) {
            const data = await common.rpc.exportProfile(id);
            const f = new File(
                [JSON.stringify(data, null, 4)], `${data.profile.name}.json`, {type: 'application/json'});
            const l = document.createElement('a');
            l.download = f.name;
            l.style.display = 'none';
            l.href = URL.createObjectURL(f);
            try {
                document.body.appendChild(l);
                l.click();
            } finally {
                URL.revokeObjectURL(l.href);
                l.remove();
            }
        } else if (link.classList.contains('win-edit-name')) {
            const td = ev.target.closest('td');
            const input = document.createElement('input');
            input.value = td.childNodes[0].textContent;
            input.title = 'Press Enter to save or Escape';
            td.innerHTML = '';
            td.appendChild(input);
            input.focus();
            let actionTaken;
            const save = async () => {
                if (actionTaken) {
                    return;
                }
                actionTaken = true;
                const customName = common.sanitize(input.value);
                await common.rpc.updateWindow(id, {customName});
                await renderWindows();
                if (customName.match(/frank/i)) {
                    frank();
                }
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', keyEv => {
                if (keyEv.code === 'Enter') {
                    save();
                } if (keyEv.code === 'Escape') {
                    actionTaken = true;
                    renderWindows();
                }
            });
        } else if (link.classList.contains('profile-edit-name')) {
            const td = ev.target.closest('td');
            const input = document.createElement('input');
            input.value = td.childNodes[0].textContent;
            input.title = 'Press Enter to save or Escape';
            td.innerHTML = '';
            td.appendChild(input);
            input.focus();
            let actionTaken;
            const save = async () => {
                if (actionTaken) {
                    return;
                }
                actionTaken = true;
                const name = common.sanitize(input.value);
                await common.rpc.renameProfile(id, name);
                await renderProfiles();
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', keyEv => {
                if (keyEv.code === 'Enter') {
                    save();
                } if (keyEv.code === 'Escape') {
                    actionTaken = true;
                    renderProfiles();
                }
            });
        }
    });
    winsEl.querySelector('table.active-windows tbody').addEventListener('dblclick', async ev => {
        const row = ev.target.closest('tr[data-id]');
        if (!row || ev.target.closest('a.link.delete') || ev.target.closest('input')) {
            return;
        }
        const id = row.dataset.id;
        if (row.classList.contains('closed')) {
            await common.rpc.openWidgetWindow(id);
        } else {
            await common.rpc.highlightWindow(id);
        }
    });
    winsEl.querySelector('.add-new input[type="button"]').addEventListener('click', async ev => {
        ev.preventDefault();
        const type = ev.currentTarget.closest('.add-new').querySelector('select').value;
        const id = await common.rpc.createWindow({type});
        await common.rpc.openWidgetWindow(id);
    });
    winsEl.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.action === 'profile-create') {
            await common.rpc.createProfile();
            await renderProfiles();
        } else if (btn.dataset.action === 'profile-import') {
            const fileEl = document.createElement('input');
            fileEl.type = 'file';
            fileEl.accept='.json';
            fileEl.addEventListener('change', async () => {
                fileEl.remove();
                const f = fileEl.files[0];
                if (!f) {
                    return;
                }
                try {
                    const data = JSON.parse(await f.text());
                    await common.rpc.importProfile(data);
                    await renderProfiles();
                    alert(`Successfully Imported: \n\n${data.profile.name}`);
                } catch(e) {
                    alert(`Import Error\n\n${e.message}`);
                    throw e;
                }
            });
            document.body.append(fileEl);
            fileEl.click();
        }
    });
}


export async function settingsMain() {
    fetch('https://www.sauce.llc/supporters-v2.json').then(async r => {
        if (!r.ok) {
            throw new Error("fetch error: " + r.status);
        }
        const supporters = await r.json();
        const sample = supporters[supporters.length * Math.random() | 0];
        const el =  document.querySelector('.about a.sauce-star');
        el.textContent = sample.name;
        if (sample.url) {
            el.href = sample.url;
        }
    }).catch(e => console.error(e));
    common.initInteractionListeners();
    const appSettingsUpdaters = Array.from(document.querySelectorAll('form.app-settings'))
        .map(common.initAppSettingsForm);
    const appSettingsUpdate = (...args) => Promise.all(appSettingsUpdaters.map(x => x(...args)));
    const extraData = {version: await common.rpc.getVersion()};
    document.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.action === 'reset-state') {
            await common.rpc.resetStorageState();
        } else if (btn.dataset.action === 'reset-athletes-db') {
            await common.rpc.resetAthletesDB();
        } else if (btn.dataset.action === 'restart') {
            await common.rpc.restart();
        } else if (btn.dataset.action === 'logout-zwift') {
            const id = btn.dataset.id;
            await common.rpc.zwiftLogout(id);
            extraData[`${id}ZwiftLogin`] = '<LOGGED OUT>';
            btn.closest('label').classList.add('edited');
            btn.remove();
            await appSettingsUpdate(extraData);
        }
    });
    common.subscribe('save-widget-window-specs', renderWindows, {source: 'windows'});
    common.subscribe('set-windows', renderWindows, {source: 'windows'});
    extraData.webServerURL = await common.rpc.getWebServerURL();
    const athlete = await common.rpc.getAthlete('self', {refresh: true, noWait: true});
    extraData.profileDesc = athlete && athlete.sanitizedFullname;
    if (athlete) {
        document.querySelector('img.avatar').src = athlete.avatar || 'images/blankavatar.png';
    }
    document.addEventListener('app-setting-set', ev => {
        if (ev.data.key === 'autoLapMetric') {
            extraData.autoLapIntervalUnits = ev.data.value === 'time' ? 'mins' : 'km';
            appSettingsUpdate(extraData);
        }
    });
    extraData.autoLapIntervalUnits = await common.rpc.getSetting('autoLapMetric') === 'time' ?
        'mins' : 'km';
    const gcs = await common.rpc.getGameConnectionStatus();
    if (gcs) {
        extraData.gameConnectionStatus = gcs.state;
        common.subscribe('status', async status => {
            extraData.gameConnectionStatus = status.state;
            await appSettingsUpdate(extraData);
        }, {source: 'gameConnection'});
    }
    extraData.gpuEnabled = await common.rpc.getLoaderSetting('gpuEnabled');
    const forms = document.querySelectorAll('form');
    forms.forEach(x => x.addEventListener('input', async ev => {
        const el = ev.target.closest('[data-store="loader"]');
        if (!el) {
            return;
        }
        ev.stopPropagation();
        el.closest('label').classList.add('edited');
        if (el.type === 'checkbox') {
            await common.rpc.setLoaderSetting(el.name, el.checked);
        } else {
            throw new TypeError("Unsupported");
        }
    }, {capture: true}));
    const loginInfo = await common.rpc.getZwiftLoginInfo();
    extraData.mainZwiftLogin = loginInfo && loginInfo.main && loginInfo.main.username;
    extraData.monitorZwiftLogin = loginInfo && loginInfo.monitor && loginInfo.monitor.username;
    await appSettingsUpdate(extraData);
    await common.initSettingsForm('form.settings')();
    await initWindowsPanel();
}
