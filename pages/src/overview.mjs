import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';
import * as fields from './fields.mjs';

common.enableSentry();

const doc = document.documentElement;
const L = locale;
const H = L.human;

common.settingsStore.setDefault({
    leftFields: 2,
    rightFields: 2,
    lockedFields: false,
    autoHideWindows: false,
    centerGapSize: 0,
});

const settings = common.settingsStore.get();

const modSafeIds = new Map();


function updateButtonVis() {
    for (const x of ['Analysis', 'Athletes', 'Events']) {
        const btn = document.querySelector(`.controls .button[data-settings-key="${x}"]`);
        if (!btn) {
            console.error('Invalid button:', x);
            continue;
        }
        btn.classList.toggle('hidden', settings[`hide${x}Button`] === true);
    }
}


export function main() {
    common.initInteractionListeners();
    common.setBackground(settings);
    updateButtonVis();
    let autoHidden;
    let lastData;
    let autoHideTimeout;
    doc.style.setProperty('--center-gap-size', common.settingsStore.get('centerGapSize') + 'px');
    let renderer = buildLayout();
    common.settingsStore.addEventListener('set', ev => {
        const {key, value} = ev.data;
        if (key === '/imperialUnits') {
            renderer.render();
        } else if (key === 'autoHideWindows') {
            window.location.reload();  // Avoid state machine complications.
        } else if (key === 'centerGapSize') {
            doc.style.setProperty('--center-gap-size', `${value}px`);
            renderer.render({force: true});
        } else if (key.match(/hide.+Button/)) {
            updateButtonVis();
        } else {
            common.setBackground(settings);
            if (renderer) {
                renderer.stop();
                renderer = null;
            }
            renderer = buildLayout();
            renderer.setData(lastData || {});
            renderer.render();
        }
    });
    document.querySelector('.button.show').addEventListener('click', () => {
        doc.classList.remove('windows-hidden');
        if (window.isElectron) {
            doc.classList.remove('windows-auto-hidden');
            console.debug("User requested show windows");
            autoHidden = false;
            common.rpc.showAllWindows();
        }
    });
    document.querySelector('.button.hide').addEventListener('click', () => {
        doc.classList.add('windows-hidden');
        if (window.isElectron) {
            doc.classList.remove('windows-auto-hidden');
            console.debug("User requested hide windows");
            autoHidden = false;
            common.rpc.hideAllWindows();
        }
    });
    if (window.isElectron) {
        document.querySelector('.button.quit').addEventListener('click', () => common.rpc.quitAfterDelay(4));
    }

    function autoHide() {
        if (doc.classList.contains('windows-hidden')) {
            console.debug("Skip auto hide: hidden already");
            return;
        }
        autoHidden = true;
        doc.classList.add('windows-auto-hidden', 'windows-hidden');
        console.debug("Auto hiding windows");
        common.rpc.hideAllWindows({autoHide: true});
    }

    function autoShow() {
        autoHidden = false;
        doc.classList.remove('windows-auto-hidden', 'windows-hidden');
        console.debug("Auto showing windows");
        common.rpc.showAllWindows({autoHide: true});
    }

    const autoHideWait = 4000;
    if (window.isElectron && common.settingsStore.get('autoHideWindows')) {
        autoHideTimeout = setTimeout(autoHide, autoHideWait);
    }
    common.subscribe('athlete/watching', watching => {
        if (window.isElectron && common.settingsStore.get('autoHideWindows')) {
            if (watching.state.speed || watching.state.cadence || watching.state.power) {
                clearTimeout(autoHideTimeout);
                if (autoHidden) {
                    autoShow();
                }
                autoHideTimeout = setTimeout(autoHide, autoHideWait);
            }
        }
        lastData = watching;
        renderer.setData(watching);
        renderer.render();
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
    el.querySelector('.profiles > table > tbody').innerHTML = profiles.map(x => {
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
    const mods = await common.rpc.getAvailableMods();
    const el = document.querySelector('#mods-container');
    if (!mods || !mods.length) {
        el.innerHTML = `<b><i>No Mods detected</i></b>`;
        return;
    }
    const html = [];
    for (const {manifest, id, enabled, packed, restartRequired, path} of mods) {
        if (!manifest) {
            continue;
        }
        const safeId = common.sanitizeAttr(id);
        modSafeIds.set(safeId, id);
        const optRemove = !restartRequired ?
            packed ?
                `<div class="button std danger" data-mod-action="remove">Remove</div>` :
                `<div class="badge" style="--sat: 0"
                      title="Mod is manually installed in the SauceMods folder">Unpacked</div>` :
            '';
        const enBox = !restartRequired ?
            `Enabled <input type="checkbox" ${enabled ? 'checked' : ''}/>` :
            '';
        html.push(`
            <div class="mod ${restartRequired ? 'restart-required' : ''}" data-id="${safeId}">
                <header>
                    <div class="mod-name">${common.stripHTML(manifest.name)}</div>
                    <div class="mod-version thick-subtle">v${manifest.version}</div>
                    <div class="spacer"></div>
                    ${optRemove}
                    <label data-mod-action="enable-toggle"
                           class="mod-enabled ${restartRequired ? 'edited' : ''}">
                        ${enBox} <span class="restart-required"></span>
                    </label>
                </header>`);
        if (!packed && path) {
            html.push(`<div class="mod-path thick-subtle">${common.stripHTML(path)}</div>`);
        }
        html.push(`<div class="mod-info">${common.stripHTML(manifest.description)}</div>`);
        if (manifest.author || manifest.website_url) {
            html.push('<footer>');
            html.push('<div class="mod-credit">');
            if (manifest.author) {
                html.push(`<div class="mod-author">Author: ${common.stripHTML(manifest.author)}</div>`);
            }
            if (manifest.website_url) {
                const url = common.sanitizeAttr(common.stripHTML(manifest.website_url));
                html.push(`<div class="mod-website"><a href="${url}"
                    target="_blank" external>Website <ms>open_in_new</ms></a></div>`);
            }
            html.push('</div>');
            html.push('</footer>');
        }
        html.push(`</div>`);
    }
    el.innerHTML = html.join('');
}


async function renderWindows({force}={}) {
    const windows = (await common.rpc.getWidgetWindowSpecs()).filter(x => !x.private);
    const manifests = await common.rpc.getWidgetWindowManifests();
    const el = document.querySelector('#windows');
    const descs = Object.fromEntries(manifests.map(x => [x.type, x]));
    windows.sort((a, b) => !!a.closed - !!b.closed);
    common.softInnerHTML(el.querySelector('.active-windows > table > tbody'), windows.map(x => {
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
    }).join('\n'), {force});
    const mGroups = new Map();
    for (const m of manifests.filter(x => !x.private)) {
        if (!mGroups.has(m.groupTitle)) {
            mGroups.set(m.groupTitle, []);
        }
        mGroups.get(m.groupTitle).push(m);
    }
    common.softInnerHTML(
        el.querySelector('.add-new-window select'),
        Array.from(mGroups.entries()).map(([title, ms]) =>
            `<optgroup label="${common.sanitizeAttr(common.stripHTML(title || 'Main'))}">${ms.map(x =>
                `<option title="${common.sanitizeAttr(common.stripHTML(x.prettyDesc))}"
                     value="${x.type}">${common.stripHTML(x.prettyName)}</option>`)}</optgroup>`).join(''));
}


async function renderHotkeys({force}={}) {
    const [manifest, hotkeys] = await Promise.all([
        common.rpc.getHotkeyManifest(),
        common.rpc.getHotkeys(),
    ]);
    const actionNames = new Map(manifest.actions.map(x => [x.id, x.name]));
    const modifierNames = new Map(manifest.supportedModifiers.map(x => [x.id, x.label]));
    const el = document.querySelector('#hotkeys');
    if (hotkeys.length) {
        common.softInnerHTML(el.querySelector('.hotkeys > table > tbody'), hotkeys.map(x => {
            const prettyKeys = x.keys.slice(0, -1).map(x => modifierNames.get(x)).concat(x.keys.at(-1));
            return `
                <tr data-id="${x.id}" class="${x.invalid ? 'invalid' : ''}">
                    <td class="key">${common.stripHTML(prettyKeys.join('+'))}</td>
                    <td class="action">${common.stripHTML(actionNames.get(x.action) || x.action)}</td>
                    <td title="Global hotkeys work everywhere, regardless of application focus"
                        class="global btn">${x.global ? '<ms large>check</ms>' : ''}</td>
                    <td class="btn" title="Delete this hotkey">` +
                        `<a class="link danger" data-hotkey-action="delete"><ms>delete_forever</ms></a></td>
                </tr>
            `;
        }).join('\n'), {force});
    } else {
        common.softInnerHTML(el.querySelector('.hotkeys > table > tbody'),
                             `<tr><td colspan="4">No hotkeys configured</td></tr>`);
    }
    el.querySelector('[name="modifier1"]').innerHTML = manifest.supportedModifiers
        .filter(x => !x.secondaryOnly)
        .map(x => `<option value="${x.id}">${common.stripHTML(x.label)}</option>`)
        .join('');
    el.querySelector('[name="modifier2"]').innerHTML = [`<option value="">-</option>`]
        .concat(manifest.supportedModifiers
            .map(x => `<option value="${x.id}">${common.stripHTML(x.label)}</option>`))
        .join('');
    el.querySelector('#specialkeys').innerHTML = '<b>Special Keys</b><hr/>' + manifest.specialKeys
        .map(x => `<a href="#">${x.id}</a>${x.help ? ` (${x.help})` : ''}`)
        .join(', ');
    el.querySelector('[name="action"]').innerHTML = manifest.actions
        .map(x => `<option value="${x.id}">${common.stripHTML(x.name)}</option>`)
        .join('');
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
    await common.sleep(12000);
    words.textContent = 'Let us celebrate this joyous occasion with my favorite song!';
    await common.sleep(19000);
    words.textContent = 'Now we Disco!';
    await common.sleep(2800);
    let discos = 1;
    while (active) {
        words.textContent = '';
        await common.sleep(60);
        if (discos++ > 10) {
            discos = 1;
        }
        for (let i = 0; i < discos; i++) {
            words.textContent += ' DISCO! ';
        }
        await common.sleep(400);
    }
}


function initPanels() {
    document.querySelector('#settings').addEventListener('tab', ev => {
        if (ev.data.id === 'windows') {
            renderProfiles();
            renderWindows();
        } else if (ev.data.id === 'hotkeys') {
            renderHotkeys();
        } else if (ev.data.id === 'mods') {
            renderAvailableMods();
        }
    });
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
            if (window.confirm('Delete this window and its settings?')) {
                await common.rpc.removeWidgetWindow(id);
            }
        } else if (link.classList.contains('profile-delete')) {
            if (window.confirm('Delete this profile and all its windows?')) {
                await common.rpc.removeProfile(id).catch(e =>
                    window.alert(`Remove Error...\n\n${e.message}`));
                await renderProfiles();
            }
        } else if (link.classList.contains('profile-clone')) {
            await common.rpc.cloneProfile(id).catch(e =>
                window.alert(`Clone Error...\n\n${e.message}`));
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
                await common.rpc.updateWidgetWindowSpec(id, {customName});
                await renderWindows({force: true});
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
                    renderWindows({force: true});
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
    winsEl.querySelector('.active-windows > table > tbody').addEventListener('dblclick', async ev => {
        const row = ev.target.closest('tr[data-id]');
        if (!row || ev.target.closest('a.link.delete') || ev.target.closest('input')) {
            return;
        }
        const id = row.dataset.id;
        if (row.classList.contains('closed')) {
            await common.rpc.openWidgetWindow(id);
        } else {
            await common.rpc.highlightWidgetWindow(id);
        }
    });
    winsEl.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-win-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.winAction === 'window-add') {
            const type = ev.currentTarget.querySelector('.add-new-window select[name="type"]').value;
            const {id} = await common.rpc.createWidgetWindow({type});
            await common.rpc.openWidgetWindow(id);
        } else if (btn.dataset.winAction === 'profile-create') {
            await common.rpc.createProfile();
            await renderProfiles();
        } else if (btn.dataset.winAction === 'profile-import') {
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
                    window.alert(`Successfully Imported: \n\n${data.profile.name}`);
                } catch(e) {
                    window.alert(`Import Error\n\n${e.message}`);
                    throw e;
                }
            });
            document.body.append(fileEl);
            fileEl.click();
        }
    });
    const hotkeysEl = document.querySelector('#hotkeys');
    function toggleHotkeyAddBtn() {
        hotkeysEl.querySelector('[data-hotkey-action="add"]')
            .classList.toggle('disabled', !hotkeysEl.elements.key.value);
    }
    hotkeysEl.addEventListener('input', toggleHotkeyAddBtn);
    hotkeysEl.addEventListener('click', async ev => {
        const actor = ev.target.closest('[data-hotkey-action]');
        if (!actor) {
            return;
        }
        if (actor.dataset.hotkeyAction === 'add') {
            const {elements: fields} = hotkeysEl;
            try {
                await common.rpc.createHotkey({
                    action: fields.action.value,
                    keys: [
                        fields.modifier1.value,
                        fields.modifier2.value,
                        fields.key.value
                    ].filter(x => x),
                    global: fields.global.checked,
                });
                hotkeysEl.reset();
                await renderHotkeys();
            } catch(e) {
                window.alert(e.message);
            }
        } else if (actor.dataset.hotkeyAction === 'delete') {
            const id = ev.target.closest('[data-id]').dataset.id;
            if (window.confirm('Delete this hotkey?')) {
                await common.rpc.removeHotkey(id);
                await renderHotkeys();
            }
        } else if (actor.dataset.hotkeyAction === 'toggle-specialkeys') {
            hotkeysEl.querySelector('#specialkeys').classList.toggle('hidden');
        }
    });
    hotkeysEl.querySelector('#specialkeys').addEventListener('click', ev => {
        const a = ev.target.closest('a');
        if (!a) {
            return;
        }
        const keyInput = hotkeysEl.querySelector('input[name="key"]');
        keyInput.value = a.textContent;
        keyInput.focus();
        toggleHotkeyAddBtn();
    });
    document.querySelector('#mods-container').addEventListener('click', async ev => {
        const actionEl = ev.target.closest('[data-mod-action]');
        if (actionEl.dataset.modAction === 'enable-toggle') {
            const label = ev.target.closest('label.mod-enabled');
            const enabled = label.querySelector('input').checked;
            const id = modSafeIds.get(ev.target.closest('.mod[data-id]').dataset.id);
            label.classList.add('edited');
            await common.rpc.setModEnabled(id, enabled);
        } else if (actionEl.dataset.modAction === 'remove') {
            const id = modSafeIds.get(ev.target.closest('.mod[data-id]').dataset.id);
            await common.rpc.removePackedMod(id);
        }
    });
    document.querySelector('.mods-path.button').addEventListener('click', common.rpc.showModsRootFolder);
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
    const athleteRefreshPromise = common.rpc.getAthlete('self', {refresh: true});
    common.initInteractionListeners();
    const appSettingsUpdaters = Array.from(document.querySelectorAll('form.app-settings'))
        .map(common.initAppSettingsForm);
    const appSettingsUpdate = (...args) => Promise.all(appSettingsUpdaters.map(x => x(...args)));
    const extraData = {
        version: await common.rpc.getVersion(),
    };
    const zConnStatusEl = document.querySelector('[name="zwiftConnectionStatus"]');
    const zReconnectBtn = document.querySelector('[data-action="reconnect-zwift"]');
    const updateZwiftConnectionStatus = async () => {
        const {status, active} = await common.rpc.getZwiftConnectionInfo();
        const connected = status === 'connected';
        const extStatus = connected && !active ? 'idle' : status;
        zReconnectBtn.classList.toggle('disabled', !connected);
        common.softInnerHTML(zConnStatusEl, extStatus);
    };
    updateZwiftConnectionStatus().then(() => {
        zReconnectBtn.classList.remove('hidden');
    });
    setInterval(updateZwiftConnectionStatus, 1500);
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
        } else if (btn.dataset.action === 'reconnect-zwift') {
            btn.classList.add('active', 'disabled');  // disabled is removed by update status loop
            try {
                await common.rpc.reconnectZwift();
            } finally {
                await common.sleep(2000);
                btn.classList.remove('active');
            }
        }
    });
    common.subscribe('save-widget-window-specs', renderWindows, {source: 'windows'});
    common.subscribe('available-mods-changed', renderAvailableMods, {source: 'mods'});
    extraData.webServerURL = await common.rpc.getWebServerURL();
    const athlete = await common.rpc.getAthlete('self');
    extraData.profileDesc = athlete && athlete.sanitizedFullname;
    if (athlete) {
        document.querySelector('img.avatar').src = athlete.avatar || 'images/blankavatar.png';
    }
    document.addEventListener('app-setting-set', ev => {
        if (ev.data.key === 'autoLapMetric') {
            extraData.autoLapIntervalUnits = ev.data.value === 'time' ? 'mins' : 'km';
            appSettingsUpdate(extraData);
        } else if (ev.data.key === 'emulateFullscreenZwift') {
            if (ev.data.value) {
                common.rpc.activateFullscreenZwiftEmulation();
            } else {
                common.rpc.deactivateFullscreenZwiftEmulation();
            }
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
    if (window.isElectron) {
        extraData.gpuEnabled = await common.rpc.getLoaderSetting('gpuEnabled');
    }
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
    initPanels();
    athleteRefreshPromise.then(x => {
        if (!x) {
            return;
        }
        if (x.avatar && (!athlete || athlete.avatar !== x.avatar)) {
            document.querySelector('img.avatar').src = x.avatar;
        }
        if (extraData.profileDesc !== x.sanitizedFullname) {
            extraData.profileDesc = x.sanitizedFullname;
            appSettingsUpdate(extraData);
        }
    });
}

const q = new URL(import.meta.url).searchParams;
if (q.has('main')) {
    main();
} else if (q.has('settings')) {
    settingsMain();
}
