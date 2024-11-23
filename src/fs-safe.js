const node = require('node:fs');



const _emptySharedArray = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) {
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
            console.error("EERRR!!!!!!", e.errno, e.code, e);
            if (e.errno === -4048 && e.code === 'EPERM') {
                sleep(delay * (2 ** i));
                continue;
            }
        }
    }
}


module.exports = {
    ...node,
    rmSync,
    renameSync,
};
