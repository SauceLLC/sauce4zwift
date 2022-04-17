const fs = require('fs/promises');

exports.default = async function cleanSqlite() {
    if (process.platform === 'darwin') {
        try {
            await fs.rmdir('node_modules/sqlite3/lib/binding', {recursive: true});
        } catch(e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }
        await fs.mkdir('node_modules/sqlite3/lib/binding');
    }
};
