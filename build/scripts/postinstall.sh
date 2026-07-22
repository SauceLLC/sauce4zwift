set -ex
(
    cd node_modules/better-sqlite3
    npm run clean
    npm run build-release
)
electron-builder install-app-deps
