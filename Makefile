default: build

PACKAGES := node_modules/.build
BUILD := .build

MODS := $(CURDIR)/node_modules
NPATH := $(MODS)/.bin
TOOLPATH := $(CURDIR)/tools/bin
PAGES_SRC := $(shell find pages type f 2>/dev/null)

$(PACKAGES): package.json
	npm install
	touch $@ || type nul > $@

$(BUILD): $(PAGES_SRC) $(PACKAGES) sass Makefile .git/index
	touch $@ || type nul > $@

run: $(BUILD)
	npm start

run-debug: $(BUILD)
	npm run start-debug

run-debug-brk: $(BUILD)
	npm run start-debug-brk

lint:
	$(NPATH)/eslint src pages/src
	$(NPATH)/eslint --ext .mjs --config .eslintrc.modules.json src shared pages/src

publish: $(BUILD)
	npm run publish

pack: $(BUILD)
	SKIP_NOTARIZE=1 npm run pack

build: $(BUILD)
	SKIP_NOTARIZE=1 npm run build

sass:
	$(NPATH)/sass pages/scss:pages/css

sass-watch:
	$(NPATH)/sass pages/scss:pages/css --watch

lint-watch:
	$(TOOLPATH)/lintwatch

.PHONY: build pack publish lint sass
