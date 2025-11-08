default: build

PACKAGES := node_modules/.build
BUILD := build.json

ifeq ($(OS),Windows_NT)
  WINBLOWS := true
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
NODE := ELECTRON_RUN_AS_NODE=1 $(NPATH)/electron
TOOLPATH := $(CURDIR)/tools/bin
ifndef WINBLOWS
  PAGES_SRC := $(shell find pages -type f)
endif


$(PACKAGES): package.json
	npm install
	echo "" > $@


$(BUILD): $(PAGES_SRC) $(PACKAGES) sass deps Makefile .git/index test
	$(NODE) tools/bin/buildenv $@

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
ifdef LINUX 
  ifneq ($(LINUX_SAFE_PUBLISH),true)
	@echo
	@echo Use publish-docker-linux-native for linux to avoid libc issues
	exit 1
  endif
endif
ifndef WINBLOWS
	GH_TOKEN="$${GH_TOKEN_SAUCE4ZWIFT_RELEASE}" npm run publish
else
	npm run publish
endif

publish-docker-linux-native:
	docker build --build-arg arch=amd64 -t linux-s4z-build -f ./build/linux.Dockerfile .
	docker run -it --rm -v $$HOME/.git-credentials:/root/.git-credentials \
		-e GH_TOKEN_SAUCE4ZWIFT_RELEASE -e LINUX_SAFE_PUBLISH=true \
		-v $(CURDIR)/dist/docker-dist:/sauce4zwift/dist linux-s4z-build make publish

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
	rm -rf pages/css
	$(MAKE) -C shared/deps clean
	$(MAKE) -C pages/deps clean


test:
	$(NODE) --test

test-debug:
	$(NODE) --test --experimental-test-isolation=none --inspect-brk

test-watch:
	$(NODE) --test --watch


.PHONY: build packed unpacked publish lint sass deps clean realclean test
