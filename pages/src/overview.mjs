import * as Common from './common.mjs';
import * as Fields from './fields.mjs';
import {human as H} from '/shared/sauce/locale.mjs';

Common.enableSentry();

const doc = document.documentElement;

Common.settingsStore.setDefault({
    leftFields: 2,
    rightFields: 2,
    lockedFields: false,
    autoHideWindows: false,
    centerGapSize: 0,
});

const settings = Common.settingsStore.get();

const autoHideWait = 4000;
const modSafeIds = new Map();

let windowsHidden = false;  // hidden superstate
let windowsAutoHidden;  // hidden by watchdog


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


function toggleWindowsVisibilityState(visible) {
    windowsHidden = !visible;
    if (visible) {
        windowsAutoHidden = false;
    }
    doc.classList.toggle('windows-hidden', windowsHidden);
    doc.classList.toggle('windows-auto-hidden', windowsAutoHidden);
}


function autoHideWindows() {
    if (windowsHidden) {
        console.warn("Skip auto hide: hidden already");
        return;
    }
    console.debug("Auto hiding windows");
    windowsAutoHidden = true;
    toggleWindowsVisibilityState(false);
    Common.rpc.hideOverlayWindows();
}


export function main() {
    Common.initInteractionListeners();
    Common.setBackground(settings);
    updateButtonVis();
    let lastData;
    let autoHideTimeout;
    doc.style.setProperty('--center-gap-size', Common.settingsStore.get('centerGapSize') + 'px');
    let renderer = buildLayout();
    Common.settingsStore.addEventListener('set', ev => {
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
            Common.setBackground(settings);
            if (renderer) {
                renderer.stop();
                renderer = null;
            }
            renderer = buildLayout();
            renderer.setData(lastData || {});
            renderer.render();
        }
    });
    if (window.isElectron) {
        document.querySelector('.button.show').addEventListener('click', () => {
            toggleWindowsVisibilityState(true);
            Common.rpc.showOverlayWindows();
        });
        document.querySelector('.button.hide').addEventListener('click', () => {
            toggleWindowsVisibilityState(false);
            Common.rpc.hideOverlayWindows();
        });
        document.querySelector('.button.quit').addEventListener('click', () => Common.rpc.quitAfterDelay(4));
        if (Common.settingsStore.get('autoHideWindows')) {
            autoHideTimeout = setTimeout(autoHideWindows, autoHideWait);
        }
    }
    Common.rpc.getOverlayWindowsVisibilityState().then(state => {
        // Only relevant if we reload after startup, but presume to have auto-hide authority..
        windowsAutoHidden = state !== 'visible';
        toggleWindowsVisibilityState(state === 'visible');
    });
    Common.subscribe('overlay-windows-visibility', state => {
        toggleWindowsVisibilityState(state === 'visible');
    }, {source: 'windows'});
    Common.subscribe('athlete/watching', watching => {
        lastData = watching;
        if (window.isElectron && Common.settingsStore.get('autoHideWindows')) {
            const active = !!(watching.state.speed || watching.state.cadence || watching.state.power);
            if (active) {
                if (windowsAutoHidden) {
                    toggleWindowsVisibilityState(true);
                    Common.rpc.showOverlayWindows();
                }
                // restart/tickle inactivity watchdog...
                clearTimeout(autoHideTimeout);
                autoHideTimeout = setTimeout(autoHideWindows, autoHideWait);
            }
        }
        renderer.setData(watching);
        renderer.render();
    }, {persistent: true});  // Prevent autohide when offscreen
    renderer.setData({});
    renderer.render();
}


function buildLayout() {
    const content = document.querySelector('#content');
    const renderer = new Common.Renderer(content, {
        locked: Common.settingsStore.get('lockedFields'),
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
        for (let i = 0; i < Common.settingsStore.get(`${side}Fields`); i++) {
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
            fields: Fields.fields
        });
    }
    return renderer;
}


async function renderProfiles({profiles}={}) {
    profiles = profiles || await Common.rpc.getProfiles();
    profiles.sort((a, b) => (b.active ? Infinity : b.ts || 0) -
                            (a.active ? Infinity : a.ts || 0));
    const el = document.querySelector('#windows');
    el.querySelector('.profiles > table > tbody').innerHTML = profiles.map(x => {
        const lastUsed = !x.active ?
            H.relTime(x.ts, {short: true, html: true, maxParts: 1, minPeriod: 60}) :
            '<i>now</i>';
        return `
            <tr data-id="${x.id}" class="profile ${x.active ? 'active' : 'closed'}">
                <td class="name">${Common.stripHTML(x.name)} <a class="link edit profile-edit-name"
                    title="Edit name"><ms>edit</ms></a></td>
                <td class="windows">${H.number(Object.keys(x.windows).length)}</td>
                <td class="ts" title="Last used">${lastUsed.replace(/ ago/i, '')}</td>
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
    const mods = await Common.rpc.getAvailableMods();
    const el = document.querySelector('#mods-container');
    if (!mods || !mods.length) {
        el.innerHTML = `<b><i>No Mods detected</i></b>`;
        return;
    }
    const html = [];
    for (const {manifest, id, enabled, packed, restartRequired, path, status} of mods) {
        if (!manifest) {
            continue;
        }
        const safeId = Common.sanitizeAttr(id);
        modSafeIds.set(safeId, id);
        const optRemove = !restartRequired ?
            packed ?
                `<div class="button std danger" data-mod-action="remove">Remove</div>` :
                `<div class="badge" style="--sat: 0"
                      title="Mod is manually installed in the SauceMods folder">Unpacked</div>` :
            '';
        const optEnOption = status !== 'removing' ?
            `Enabled <input name="enabled" type="checkbox" ${enabled ? 'checked' : ''}/>` :
            `<div class="badge" style="--sat: 20; --hue: 0;">Removed</div>`;
        html.push(`
            <div class="mod ${restartRequired ? 'restart-required' : ''} status-${status}"
                 data-id="${safeId}">
                <header>
                    <div class="mod-name">${Common.stripHTML(manifest.name)}</div>
                    <div class="mod-version thick-subtle">v${manifest.version}</div>
                    <div class="spacer"></div>
                    ${optRemove}
                    <label class="mod-enabled ${restartRequired ? 'edited' : ''}">
                        ${optEnOption}
                        <span class="restart-required"></span>
                    </label>
                </header>`);
        if (!packed && path) {
            html.push(`<div class="mod-path thick-subtle">${Common.stripHTML(path)}</div>`);
        }
        html.push(`<div class="mod-info">${Common.stripHTML(manifest.description)}</div>`);
        if (manifest.author || manifest.website_url) {
            html.push('<footer>');
            html.push('<div class="mod-credit">');
            if (manifest.author) {
                html.push(`<div class="mod-author">Author: ${Common.stripHTML(manifest.author)}</div>`);
            }
            if (manifest.website_url) {
                const url = Common.sanitizeAttr(Common.stripHTML(manifest.website_url));
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


async function renderWindows({profiles, force}={}) {
    profiles = profiles || await Common.rpc.getProfiles();
    const settings = profiles.find(x => x.active).settings;
    const windows = (await Common.rpc.getWidgetWindowSpecs()).filter(x => !x.private);
    const manifests = await Common.rpc.getWidgetWindowManifests();
    for (const x of windows) {
        x.manifest = manifests.find(xx => xx.type === x.type);
    }
    const el = document.querySelector('#windows');
    windows.sort((a, b) => !!a.closed - !!b.closed);
    windows.sort((a, b) => !!b.manifest - !!a.manifest);
    Common.softInnerHTML(el.querySelector('.active-windows > table > tbody'), windows.map(x => {
        // NOTE: manifest based prettyName is preferred over spec.prettyName.  Spec based prettyName is
        // prettyName at time of window creation, not necessarily current.
        if (!x.manifest) {
            console.warn("Missing window manifest type:", x.type, x.id, x);
            return `
                <tr data-id="${x.id}" class="window missing" title="MISSING: ${Common.sanitizeAttr(x.type)}">
                    <td class="name">${Common.stripHTML(x.customName || x.prettyName)}` +
                        ` <a class="link edit win-edit-name" title="Edit name"><ms>edit</ms></a></td>
                    <td class="state">Missing</td>
                    <td class="btn"></td>
                    <td class="btn" title="Delete this window and its settings">` +
                        `<a class="link danger win-delete"><ms>delete_forever</ms></a></td>
                </tr>
            `;
        } else {
            return `
                <tr data-id="${x.id}" class="window ${x.closed ? 'closed' : 'open'}"
                    title="${Common.sanitizeAttr(x.manifest.prettyDesc)}\n\n` +
                           `Double click/tap to ${x.closed ? 'reopen' : 'focus'}">
                    <td class="name">${Common.stripHTML(x.customName || x.manifest.prettyName)}` +
                        ` <a class="link edit win-edit-name" title="Edit name"><ms>edit</ms></a></td>
                    <td class="state">${x.closed ? 'Closed' : 'Open'}</td>
                    <td class="btn">
                        <a title="Close window" class="link win-close"><ms>indeterminate_check_box</ms></a>
                        <a title="Open window" class="link win-open"><ms>add_box</ms></a>
                    </td>
                    <td class="btn" title="Delete this window and its settings">` +
                        `<a class="link danger win-delete"><ms>delete_forever</ms></a></td>
                </tr>
            `;
        }
    }).join('\n'), {force});
    const mGroups = new Map();
    for (const m of manifests.filter(x => !x.private)) {
        if (!mGroups.has(m.groupTitle)) {
            mGroups.set(m.groupTitle, []);
        }
        mGroups.get(m.groupTitle).push(m);
    }
    Common.softInnerHTML(
        el.querySelector('.add-new-window select'),
        Array.from(mGroups.entries()).map(([title, ms]) =>
            `<optgroup label="${Common.sanitizeAttr(Common.stripHTML(title || 'Main'))}">${ms.map(x =>
                `<option title="${Common.sanitizeAttr(Common.stripHTML(x.prettyDesc))}"
                     value="${x.type}">${Common.stripHTML(x.prettyName)}</option>`)}</optgroup>`).join(''));
    el.querySelector('[name="lockWindowPositions"]').checked = !!settings.lockWindowPositions;
    el.classList.toggle('lock-window-positions', !!settings.lockWindowPositions);
}


async function renderHotkeys({force}={}) {
    const [manifest, hotkeys] = await Promise.all([
        Common.rpc.getHotkeyManifest(),
        Common.rpc.getHotkeys(),
    ]);
    const actionNames = new Map(manifest.actions.map(x => [x.id, x.name]));
    const modifierNames = new Map(manifest.supportedModifiers.map(x => [x.id, x.label]));
    const el = document.querySelector('#hotkeys');
    if (hotkeys.length) {
        Common.softInnerHTML(el.querySelector('.hotkeys > table > tbody'), hotkeys.map(x => {
            const prettyKeys = x.keys.slice(0, -1).map(x => modifierNames.get(x)).concat(x.keys.at(-1));
            return `
                <tr data-id="${x.id}" class="${x.invalid ? 'invalid' : ''}">
                    <td class="key">${Common.stripHTML(prettyKeys.join('+'))}</td>
                    <td class="action">${Common.stripHTML(actionNames.get(x.action) || x.action)}</td>
                    <td title="Global hotkeys work everywhere, regardless of application focus"
                        class="global btn">${x.global ? '<ms large>check</ms>' : ''}</td>
                    <td class="btn" title="Delete this hotkey">` +
                        `<a class="link danger" data-hotkey-action="delete"><ms>delete_forever</ms></a></td>
                </tr>
            `;
        }).join('\n'), {force});
    } else {
        Common.softInnerHTML(el.querySelector('.hotkeys > table > tbody'),
                             `<tr><td colspan="4">No hotkeys configured</td></tr>`);
    }
    el.querySelector('[name="modifier1"]').innerHTML = manifest.supportedModifiers
        .filter(x => !x.secondaryOnly)
        .map(x => `<option value="${x.id}">${Common.stripHTML(x.label)}</option>`)
        .join('');
    el.querySelector('[name="modifier2"]').innerHTML = [`<option value="">-</option>`]
        .concat(manifest.supportedModifiers
            .map(x => `<option value="${x.id}">${Common.stripHTML(x.label)}</option>`))
        .join('');
    el.querySelector('#specialkeys').innerHTML = '<b>Special Keys</b><hr/>' + manifest.specialKeys
        .map(x => `<a href="#">${x.id}</a>${x.help ? ` (${x.help})` : ''}`)
        .join(', ');
    el.querySelector('[name="action"]').innerHTML = manifest.actions
        .map(x => `<option value="${x.id}">${Common.stripHTML(x.name)}</option>`)
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
    await Common.sleep(12000);
    words.textContent = 'Let us celebrate this joyous occasion with my favorite song!';
    await Common.sleep(19000);
    words.textContent = 'Now we Disco!';
    await Common.sleep(2800);
    let discos = 1;
    while (active) {
        words.textContent = '';
        await Common.sleep(60);
        if (discos++ > 10) {
            discos = 1;
        }
        for (let i = 0; i < discos; i++) {
            words.textContent += ' DISCO! ';
        }
        await Common.sleep(400);
    }
}


async function renderTab(id) {
    if (id === 'windows') {
        const profiles = await Common.rpc.getProfiles();
        await Promise.all([renderProfiles({profiles}), renderWindows({profiles})]);
    } else if (id === 'hotkeys') {
        await renderHotkeys();
    } else if (id === 'mods') {
        await renderAvailableMods();
    }
}


async function replaceSelf() {
    const bounds = await Common.rpc.getSenderWindowBounds();
    await Common.rpc.openSettingsWindow({bounds, hash: window.location.hash});
    window.close();
}


async function initPanels() {
    const winsEl = document.querySelector('#windows');
    winsEl.addEventListener('submit', ev => ev.preventDefault());
    winsEl.addEventListener('click', async ev => {
        const link = ev.target.closest('table a.link');
        if (!link) {
            return;
        }
        const id = ev.target.closest('[data-id]').dataset.id;
        if (link.classList.contains('win-open')) {
            await Common.rpc.openWidgetWindow(id);
        } else if (link.classList.contains('win-close')) {
            await Common.rpc.closeWidgetWindow(id);
        } else if (link.classList.contains('profile-select')) {
            await Common.rpc.activateProfile(id);
            if (window.isElectron) {
                await replaceSelf();
            } else {
                const profiles = await Common.rpc.getProfiles();
                await Promise.all([renderProfiles({profiles}), renderWindows({profiles})]);
            }
        } else if (link.classList.contains('win-delete')) {
            if (window.confirm('Delete this window and its settings?')) {
                await Common.rpc.removeWidgetWindow(id);
            }
        } else if (link.classList.contains('profile-delete')) {
            if (window.confirm('Delete this profile and all its windows?')) {
                await Common.rpc.removeProfile(id).catch(e =>
                    window.alert(`Remove Error...\n\n${e.message}`));
                // If removing the active profile on electron, we're already closed now
                const profiles = await Common.rpc.getProfiles();
                await Promise.all([renderProfiles({profiles}), renderWindows({profiles})]);
            }
        } else if (link.classList.contains('profile-clone')) {
            await Common.rpc.cloneProfile(id).catch(e =>
                window.alert(`Clone Error...\n\n${e.message}`));
            await renderProfiles();
        } else if (link.classList.contains('profile-export')) {
            const data = await Common.rpc.exportProfile(id);
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
                const customName = Common.sanitize(input.value);
                await Common.rpc.updateWidgetWindowSpec(id, {customName});
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
                    renderWindows({force: true});  // bg okay
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
                const name = Common.sanitize(input.value);
                await Common.rpc.renameProfile(id, name);
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
            await Common.rpc.openWidgetWindow(id);
        } else if (!row.classList.contains('missing')) {
            await Common.rpc.highlightWidgetWindow(id);
        }
    });
    winsEl.addEventListener('click', async ev => {
        const btn = ev.target.closest('.button[data-win-action]');
        if (!btn) {
            return;
        }
        if (btn.dataset.winAction === 'window-add') {
            const type = ev.currentTarget.querySelector('.add-new-window select[name="type"]').value;
            const {id} = await Common.rpc.createWidgetWindow({type});
            await Common.rpc.openWidgetWindow(id);
        } else if (btn.dataset.winAction === 'profile-create') {
            await Common.rpc.createProfile();
            await renderProfiles();
        } else if (btn.dataset.winAction === 'profile-import') {
            const fileEl = document.createElement('input');
            fileEl.type = 'file';
            fileEl.accept='.json';
            fileEl.style.display = 'none';
            fileEl.addEventListener('change', async () => {
                fileEl.remove();
                const f = fileEl.files[0];
                if (!f) {
                    return;
                }
                let profile;
                try {
                    const data = JSON.parse(await f.text());
                    profile = await Common.rpc.importProfile(data);
                } catch(e) {
                    console.error("Import error", e);
                    window.alert(`Import Error\n\n${e.message}`);
                    return;
                }
                await renderProfiles();
                window.alert(`Successfully Imported: \n\n${profile.name}`);
            });
            document.body.append(fileEl);
            fileEl.click();
        } else if (btn.dataset.winAction === 'save-window-positions') {
            btn.classList.add('disabled');
            try {
                await Common.rpc.saveWidgetWindowPositions();
            } finally {
                btn.classList.remove('disabled');
            }
        } else if (btn.dataset.winAction === 'restore-window-positions') {
            btn.classList.add('disabled');
            try {
                await Common.rpc.restoreWidgetWindowPositions();
            } finally {
                btn.classList.remove('disabled');
            }
        }
    });
    winsEl.querySelector('[name="lockWindowPositions"]').addEventListener('input', async ev => {
        const locked = ev.currentTarget.checked;
        winsEl.classList.toggle('lock-window-positions', locked);
        await Common.rpc.setProfileSetting(null, 'lockWindowPositions', locked);
        if (locked) {
            await Common.rpc.saveWidgetWindowPositions();
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
                await Common.rpc.createHotkey({
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
                await Common.rpc.removeHotkey(id);
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
        if (!actionEl) {
            return;
        }
        if (actionEl.dataset.modAction === 'remove') {
            const id = modSafeIds.get(ev.target.closest('.mod[data-id]').dataset.id);
            await Common.rpc.removePackedMod(id);
        }
    });
    document.querySelector('#mods-container').addEventListener('input', async ev => {
        if (ev.target.name === 'enabled') {
            const label = ev.target.closest('label.mod-enabled');
            const enabled = ev.target.checked;
            const id = modSafeIds.get(ev.target.closest('.mod[data-id]').dataset.id);
            label.classList.add('edited');
            await Common.rpc.setModEnabled(id, enabled);
        }
    });
    document.querySelector('.mods-path.button').addEventListener('click', Common.rpc.showModsRootFolder);
    document.querySelector('#settings').addEventListener('tab', ev => renderTab(ev.data.id));
    const activeTab = document.querySelector('#settings header.tabs > .tab.active');
    await renderTab(activeTab.dataset.id);
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
    const athleteRefreshPromise = Common.rpc.getAthlete('self', {refresh: true});
    Common.initInteractionListeners();
    const appSettingsUpdaters = Array.from(document.querySelectorAll('form.app-settings'))
        .map(Common.initAppSettingsForm);
    const appSettingsUpdate = (...args) => Promise.all(appSettingsUpdaters.map(x => x(...args)));
    const extraData = {
        version: await Common.rpc.getVersion(),
    };
    const zConnStatusEl = document.querySelector('[name="zwiftConnectionStatus"]');
    const zReconnectBtn = document.querySelector('[data-action="reconnect-zwift"]');
    const updateZwiftConnectionStatus = async () => {
        const {status, active} = await Common.rpc.getZwiftConnectionInfo();
        const connected = status === 'connected';
        const extStatus = connected && !active ? 'idle' : status;
        zReconnectBtn.classList.toggle('disabled', !connected);
        Common.softInnerHTML(zConnStatusEl, extStatus);
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
            await Common.rpc.resetStorageState();
        } else if (btn.dataset.action === 'reset-athletes-db') {
            await Common.rpc.resetAthletesDB();
        } else if (btn.dataset.action === 'restart') {
            await Common.rpc.restart();
        } else if (btn.dataset.action === 'logout-zwift') {
            const id = btn.dataset.id;
            await Common.rpc.zwiftLogout(id);
            extraData[`${id}ZwiftLogin`] = '<LOGGED OUT>';
            btn.closest('label').classList.add('edited');
            btn.remove();
            await appSettingsUpdate(extraData);
        } else if (btn.dataset.action === 'reconnect-zwift') {
            btn.classList.add('active', 'disabled');  // disabled is removed by update status loop
            try {
                await Common.rpc.reconnectZwift();
            } finally {
                await Common.sleep(2000);
                btn.classList.remove('active');
            }
        }
    });
    Common.subscribe('widget-windows-updated', () => renderWindows(), {source: 'windows'});
    Common.subscribe('profiles-updated', () => renderProfiles(), {source: 'windows'});
    Common.subscribe('available-mods-changed', () => renderAvailableMods(), {source: 'mods'});
    extraData.webServerURL = await Common.rpc.getWebServerURL();
    const athlete = await Common.rpc.getAthlete('self');
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
                Common.rpc.activateFullscreenZwiftEmulation();
            } else {
                Common.rpc.deactivateFullscreenZwiftEmulation();
            }
        }
    });
    extraData.autoLapIntervalUnits = await Common.rpc.getSetting('autoLapMetric') === 'time' ?
        'mins' : 'km';
    const gcs = await Common.rpc.getGameConnectionStatus();
    if (gcs) {
        extraData.gameConnectionStatus = gcs.state;
        Common.subscribe('status', async status => {
            extraData.gameConnectionStatus = status.state;
            await appSettingsUpdate(extraData);
        }, {source: 'gameConnection'});
    }
    Object.assign(extraData, await Common.rpc.getLoaderSettings());
    const forms = document.querySelectorAll('form');
    forms.forEach(x => x.addEventListener('input', async ev => {
        const el = ev.target.closest('[data-store="loader"]');
        if (!el) {
            return;
        }
        ev.stopPropagation();
        el.closest('label').classList.add('edited');
        if (el.type === 'checkbox') {
            await Common.rpc.setLoaderSetting(el.name, el.checked);
        } else {
            throw new TypeError("Unsupported");
        }
    }, {capture: true}));
    const loginInfo = await Common.rpc.getZwiftLoginInfo();
    extraData.mainZwiftLogin = loginInfo?.main?.username;
    extraData.monitorZwiftLogin = loginInfo?.monitor?.username;
    await appSettingsUpdate(extraData);
    await Common.initSettingsForm('form.settings')();
    await initPanels();
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
