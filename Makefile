default: run

run: node_modules/.build
	npm start

run-mac: node_modules/.build
	./dist/mac-arm64/Sauce\ for\ Zwift™.app/Contents/MacOS/Sauce\ for\ Zwift™

node_modules/.build: package.json
	npm install
	touch $@

lint:
	./node_modules/.bin/eslint src
	./node_modules/.bin/eslint --ext .mjs --config .eslintrc.modules.json src shared pages

publish:
	npm run publish

pack:
	SKIP_NOTARIZE=1 npm run pack
