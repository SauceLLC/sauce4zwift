default: run

run: node_modules/.build
	npm start

run-debug: node_modules/.build
	npm run start-debug

run-debug-brk: node_modules/.build
	npm run start-debug-brk

run-mac: node_modules/.build
	./dist/mac-arm64/Sauce\ for\ Zwift™.app/Contents/MacOS/Sauce\ for\ Zwift™

node_modules/.build: package.json
	npm install
	touch $@

lint:
	./node_modules/.bin/eslint src
	./node_modules/.bin/eslint --ext .mjs --config .eslintrc.modules.json src shared pages

publish:
	SKIP_NOTARIZE=1 npm run publish

pack:
	SKIP_NOTARIZE=1 npm run pack

build:
	SKIP_NOTARIZE=1 npm run build

.PHONY: build pack publish lint
