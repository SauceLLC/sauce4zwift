const fonts = [
    '/pages/fonts/MaterialSymbolsRounded.woff2?v=2',
    '/pages/fonts/Saira.woff2?v=1',
];

document.head.append(...fonts.map(x => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = x;
    link.as = 'font';
    link.type = 'font/woff2';
    if (!window.isElectron) {
        link.crossOrigin = 'anonymous';
    }
    return link;
}));
