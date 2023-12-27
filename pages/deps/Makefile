
ifeq ($(OS),Windows_NT)
  WINBLOWS := true
endif

FLAGS_SRCS = $(wildcard ../../node_modules/world_countries_lists/data/flags/64x64/*.png)
FLAGS_OBJS = $(patsubst ../../node_modules/world_countries_lists/data/flags/64x64/%,flags/%,$(FLAGS_SRCS))

EC_SRC := ../../node_modules/echarts/dist/echarts.esm.js
EC_OBJ := src/echarts.mjs

default: $(FLAGS_OBJS) $(EC_OBJ)


$(FLAGS_OBJS): $(FLAGS_SRCS)
ifndef WINBLOWS
	mkdir -p $(@D)
else
	mkdir -f $(@D) > $$null
endif
	cp $(patsubst flags/%,../../node_modules/world_countries_lists/data/flags/64x64/%,$@) $@


$(EC_OBJ): $(EC_SRC)
ifndef WINBLOWS
	mkdir -p $(@D)
else
	mkdir -f $(@D) > $$null
endif
	cp $? $@


clean:
ifndef WINBLOWS
	rm -rf src flags
else
	-rm -r -fo -ErrorAction SilentlyContinue src
	-rm -r -fo -ErrorAction SilentlyContinue flags
endif
