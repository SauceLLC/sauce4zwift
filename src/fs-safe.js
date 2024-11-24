const node = require('node:fs');


const _emptySharedArray = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
    Atomics.wait(_emptySharedArray, 0, 0, ms);
}


function rmSync(path, {maxRetries=10, recursive, ...options}={}) {
    recursive = recursive == null ? !!maxRetries : recursive;
    return node.rmSync(path, {...options, maxRetries, recursive});
}


function renameSync(oldPath, newPath, {maxRetries=10}={}) {
    const delay = 100;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return node.renameSync(oldPath, newPath);
        } catch(e) {
            if (e.errno === -4048 && e.code === 'EPERM') {
                sleepSync(delay * (2 ** i));
                continue;
            }
            throw e;
        }
    }
}


module.exports = {
    ...node,
    rmSync,
    renameSync,
    sleepSync,
};
