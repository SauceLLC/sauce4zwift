
FLAGS_SRCS = $(wildcard ../../node_modules/world_countries_lists/data/flags/64x64/*.png)
FLAGS_OBJS = $(patsubst ../../node_modules/world_countries_lists/data/flags/64x64/%,flags/%,$(FLAGS_SRCS))

EC_SRC := ../../node_modules/echarts/dist/echarts.esm.min.js
EC_OBJ := src/echarts.mjs

default: $(FLAGS_OBJS) $(EC_OBJ)


$(FLAGS_OBJS): $(FLAGS_SRCS) Makefile
	mkdir -p $(@D)
	cp $(patsubst flags/%,../../node_modules/world_countries_lists/data/flags/64x64/%,$@) $@


$(EC_OBJ): $(EC_SRC) Makefile
	mkdir -p $(@D)
	cp $< $@


clean:
	rm -rf src flags
