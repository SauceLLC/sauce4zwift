default: build

PACKAGES := node_modules/.build
BUILD := build.json

ifeq ($(OS),Windows_NT)
  WINBLOWS := true
  #SHELL := powershell.exe
  #.SHELLFLAGS := -C
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
	npm install --loglevel verbose
	echo "" > $@


$(BUILD): $(PAGES_SRC) $(PACKAGES) sass deps Makefile .git/index
	node tools/bin/buildenv $@

build: $(BUILD)


run: $(BUILD)
	npm start

run-debug: $(BUILD)
	npm run start-debug

run-debug-brk: $(BUILD)
	npm run start-debug-brk


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
	$(MAKE) -j 32 -C pages/deps
	$(MAKE) -j 32 -C shared/deps


sass:
	$(NPATH)/sass pages/scss:pages/css

sass-watch:
	$(NPATH)/sass pages/scss:pages/css --watch


lint:
	$(NPATH)/eslint src shared pages/src

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


realclean: clean
	rm -rf node_modules
	
clean:
	rm -f $(BUILD)
	$(MAKE) -C shared/deps clean
	$(MAKE) -C pages/deps clean


test:
	npm run test


.PHONY: build packed unpacked publish lint sass deps clean realclean test
