const NodeFS = require('node:fs');


const _emptySharedArray = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
    Atomics.wait(_emptySharedArray, 0, 0, ms);
}


function rmSync(path, {maxRetries=10, recursive, ...options}={}) {
    recursive = recursive == null ? !!maxRetries : recursive;
    return NodeFS.rmSync(path, {...options, maxRetries, recursive});
}


function renameSync(oldPath, newPath, {maxRetries=10}={}) {
    const delay = 100;
    let error;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return NodeFS.renameSync(oldPath, newPath);
        } catch(e) {
            if (e.errno === -4048 && e.code === 'EPERM') {
                error = e;
                sleepSync(delay * (2 ** i));
                continue;
            }
            throw e;
        }
    }
    throw error;
}


module.exports = {
    ...NodeFS,
    rmSync,
    renameSync,
    sleepSync,
};
