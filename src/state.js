const path = require('path');
const fs = require('fs/promises');
const {app} = require('electron');


async function stateFile(id) {
    await app.whenReady();
    return path.join(app.getPath('userData'), `state-${id}.json`);
}


async function loadState(id, defaultFile) {
    let f;
    try {
        f = await fs.open(await stateFile(id));
    } catch(e) {
        if (e.code !== 'ENOENT') {
            throw e;
        } else if (defaultFile) {
            f = await fs.open(path.join(__dirname, defaultFile));
        } else {
            return;
        }
    }
    try {
        return JSON.parse(await f.readFile());
    } finally {
        await f.close();
    }
}


async function saveState(id, data) {
    const file = await stateFile(id);
    const tmpFile = file + '.tmp';
    const serialized = JSON.stringify(data);
    const f = await fs.open(tmpFile, 'w');
    try {
        await f.writeFile(serialized);
    } finally {
        await f.close();
    }
    await fs.rename(tmpFile, file);
}


module.exports = {
    load: loadState,
    save: saveState,
};
