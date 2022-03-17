default: build

PACKAGES := node_modules/.build
BUILD := .build

MODS := $(shell pwd)/node_modules
NPATH := $(MODS)/.bin
TOOLPATH := $(shell pwd)/tools/bin
PAGES_SRC := $(shell find pages type f 2>/dev/null)


$(PACKAGES): package.json
	npm install
	touch $@

$(BUILD): $(PAGES_SRC) $(PACKAGES) sass Makefile .git/index
	touch $@

run: $(BUILD)
	npm start

run-debug: $(BUILD)
	npm run start-debug

run-debug-brk: $(BUILD)
	npm run start-debug-brk

lint:
	./node_modules/.bin/eslint src shared pages/src
	./node_modules/.bin/eslint --ext .mjs --config .eslintrc.modules.json src shared pages/src

publish: $(BUILD)
	npm run publish

pack: $(BUILD)
	SKIP_NOTARIZE=1 npm run pack

build: $(BUILD)
	SKIP_NOTARIZE=1 npm run build

sass:
	$(TOOLPATH)/sassrender

sass-watch:
	$(TOOLPATH)/sassrender --watch

lint-watch:
	$(TOOLPATH)/lintwatch

.PHONY: build pack publish lint sass
