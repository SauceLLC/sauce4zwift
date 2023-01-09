default: build

PACKAGES := node_modules/.build
BUILD := .build

ifeq ($(OS),Windows_NT)
  WINBLOWS := true
  SHELL := powershell.exe
  .SHELLFLAGS := -C
else
  T := $(shell uname -s)
  ifeq ($(T),Linux)
    LINUX := true
  endif
  ifeq ($(UNAME_S),Darwin)
    MAC := true
  endif
endif

MODS := $(CURDIR)/node_modules
NPATH := $(MODS)/.bin
TOOLPATH := $(CURDIR)/tools/bin
ifndef WINBLOWS
  PAGES_SRC := $(shell find pages -type f)
endif

$(PACKAGES): package.json
	npm install
	echo "" > $@

$(BUILD): $(PAGES_SRC) $(PACKAGES) sass deps Makefile .git/index
	echo "" > $@

build: $(BUILD)

run: $(BUILD)
	npm start

run-debug: $(BUILD)
	npm run start-debug

run-debug-brk: $(BUILD)
	npm run start-debug-brk

lint:
	$(NPATH)/eslint --ext .mjs --config .eslintrc.modules.json src shared pages/src
	$(NPATH)/eslint src

unpacked: $(BUILD)
ifndef WINBLOWS
	SKIP_NOTARIZE=1 npm run unpacked
else
	npm run unpacked
endif

packed: $(BUILD)
ifndef WINBLOWS
	SKIP_NOTARIZE=1 npm run build
else
	npm run build
endif

publish: $(BUILD)
ifndef WINBLOWS
	@echo
	@echo Double check this git status is acceptable...
	@echo
	git status
	@echo
	@sleep 5
	GH_TOKEN="$${GH_TOKEN_SAUCE4ZWIFT_RELEASE}" npm run publish
else
	npm run publish
endif

deps:
ifndef WINBLOWS
	mkdir -p pages/deps/flags
	mkdir -p shared/deps/data
else
	mkdir -f pages/deps/flags
	mkdir -f shared/deps/data
endif
	cp node_modules/echarts/dist/echarts.esm.min.js pages/deps/src/echarts.mjs
	cp -r node_modules/world_countries_lists/data/flags/64x64/*.png pages/deps/flags/
	cp node_modules/world_countries_lists/data/countries/_combined/world.json shared/deps/data/countries.json
	cp node_modules/zwift-data/lib/esm/routes.js shared/deps/routes.mjs
	cp node_modules/zwift-data/lib/esm/segments.js shared/deps/segments.mjs
	-cp node_modules/zwift-utils/dist/*.json shared/deps/data/

sass:
	$(NPATH)/sass pages/scss:pages/css

sass-watch:
	$(NPATH)/sass pages/scss:pages/css --watch

lint-watch:
ifndef WINBLOWS
  ifdef LINUX
	tools/bin/lintwatch
  else
	while true ; do \
		$(MAKE) lint; \
		sleep 5; \
	done
  endif
else
	@echo Unsupported on winblows
endif

clean:
ifndef WINBLOWS
	rm -rf pages/deps/src/*
	rm -rf pages/deps/flags
	rm -rf shared/deps/*
	rm -f $(BUILD)
else
	-rm -r -fo -ErrorAction SilentlyContinue pages/deps/src/*
	-rm -r -fo -ErrorAction SilentlyContinue pages/deps/flags
	-rm -r -fo -ErrorAction SilentlyContinue shared/deps/*
	-rm -fo -ErrorAction SilentlyContinue $(BUILD)
endif

.PHONY: build pack publish lint sass deps clean
