export const mimeTypes = {
    'application/gzip': ['gz'],
    'application/javascript': ['js', 'mjs'],
    'application/json': ['json', 'map'],
    'application/pdf': ['pdf'],
    'application/postscript': ['ps', 'eps', 'ai'],
    'application/zip': ['zip'],
    'audio/mp3': ['mp3'],
    'audio/mp4': ['m4a', 'mp4a'],
    'audio/mpeg': ['mpga', 'mp2a', 'm2a'],
    'audio/ogg': ['ogg', 'oga', 'spx', 'opus'],
    'font/woff': ['woff'],
    'font/woff2': ['woff2'],
    'image/apng': ['apng'],
    'image/avif': ['avif'],
    'image/bmp': ['bmp'],
    'image/gif': ['gif'],
    'image/heic': ['heic'],
    'image/heif': ['heif'],
    'image/jp2': ['jp2', 'jpg2'],
    'image/jpeg': ['jpg', 'jpeg', 'jpe'],
    'image/png': ['png'],
    'image/svg+xml': ['svg'],
    'image/tiff': ['tif', 'tiff'],
    'image/webp': ['webp'],
    'image/wmf': ['wmf'],
    'text/css': ['css'],
    'text/csv': ['csv'],
    'text/html': ['html', 'htm'],
    'text/markdown': ['md', 'markdown'],
    'text/plain': ['txt', 'text', 'conf', 'log', 'ini'],
    'text/x-scss': ['scss'],
    'text/xml': ['xml'],
    'text/yaml': ['yaml', 'yml'],
    'video/mp4': ['mp4', 'mp4v'],
    'video/mpeg': ['mpeg', 'mpg', 'mpe', 'm2v', 'm1v'],
    'video/ogg': ['ogv'],
    'video/quicktime': ['qt', 'mov'],
    'video/vnd.mpegurl': ['mxu', 'm4u'],
    'video/webm': ['webm'],
    'video/x-matroska': ['mkv'],
};

export const mimeTypesByExt = new Map();
for (const [mime, exts] of Object.entries(mimeTypes)) {
    for (const x of exts) {
        mimeTypesByExt.set(x, mime);
    }
}
