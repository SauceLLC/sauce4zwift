global.electron = require('electron');

(async () => {
    await import('./main.mjs');
})();
