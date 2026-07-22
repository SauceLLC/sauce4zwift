#!/bin/sh -xe
electron-builder install-app-deps
(
    cd node_modules/better-sqlite3
    npm run clean
    npm run build-release
)
