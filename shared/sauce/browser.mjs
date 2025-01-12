

export function throttledAnimationFrame() {
    let nextFrame;
    return function(callback) {
        if (nextFrame) {
            cancelAnimationFrame(nextFrame);
        }
        nextFrame = requestAnimationFrame(() => {
            nextFrame = null;
            callback();
        });
    };
}


export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    try {
        downloadURL(url, name || blob.name);
    } finally {
        URL.revokeObjectURL(url);
    }
}


export function downloadURL(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
    }
}


const _fetchCache = new Map();
const _fetching = new Map();
export async function cachedFetch(url, options={}) {
    if (!_fetchCache.has(url)) {
        if (!_fetching.has(url)) {
            _fetching.set(url, fetch(url).then(async resp => {
                if (!resp.ok) {
                    if (resp.status === 404) {
                        console.warn("Not found:", url);
                        _fetchCache.set(url, undefined);
                        return;
                    }
                    throw new Error('Fetch HTTP failure: ' + resp.status);
                }
                let data;
                if (options.mode === 'json') {
                    data = await resp.json();
                } else if (options.mode === 'blob') {
                    data = await resp.blob();
                } else if (options.mode === 'arrayBuffer') {
                    data = await resp.arrayBuffer();
                } else {
                    data = await resp.text();
                }
                _fetchCache.set(url, data);
            }).finally(() => _fetching.delete(url)));
        }
        await _fetching.get(url);
    }
    return _fetchCache.get(url);
}
