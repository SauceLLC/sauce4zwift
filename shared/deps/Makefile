
ifeq ($(OS),Windows_NT)
  WINBLOWS := true
endif

rwildcard=$(foreach d,$(wildcard $(1:=/*)),$(call rwildcard,$d,$2) $(filter $(subst *,%,$2),$d))

ZU_SRCS = $(call rwildcard,../../node_modules/zwift-utils/dist,*.json)
ZU_OBJS = $(patsubst ../../node_modules/zwift-utils/dist/%,data/%,$(ZU_SRCS))

WORLD_SRC = ../../node_modules/world_countries_lists/data/countries/_combined/world.json
WORLD_OBJ = data/countries.json

default: $(ZU_OBJS) $(WORLD_OBJ)


$(ZU_OBJS): $(ZU_SRCS)
ifndef WINBLOWS
	mkdir -p $(@D)
else
	mkdir -f $(@D) > $$null
endif
	node ../../tools/bin/jsonminify $(patsubst data/%,../../node_modules/zwift-utils/dist/%,$@) $@


$(WORLD_OBJ): $(WORLD_SRC)
ifndef WINBLOWS
	mkdir -p $(@D)
else
	mkdir -f $(@D) > $$null
endif
	cp $? $@


clean:
ifndef WINBLOWS
	rm -rf data
else
	-rm -r -fo -ErrorAction SilentlyContinue data
endif
