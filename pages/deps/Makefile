
NODE := ../../node_modules

default: flags echarts saucecharts


flags:
	mkdir -p flags
	cp $(NODE)/world_countries_lists/data/flags/64x64/*.png flags/

echarts:
	mkdir -p src
	cp $(NODE)/echarts/dist/echarts.esm.min.js src/echarts.mjs

saucecharts:
	mkdir -p css/saucecharts src/saucecharts
	cp -r $(NODE)/saucecharts/src/* src/saucecharts/
	cp -r $(NODE)/saucecharts/css/* css/saucecharts/

dev:
	rm -rf src/saucecharts
	mkdir src/saucecharts
	for x in ~/project/saucecharts/src/*; do \
		ln $$x src/saucecharts/ ; \
	done
	rm -rf css/saucecharts
	mkdir css/saucecharts
	for x in ~/project/saucecharts/css/*; do \
		ln $$x css/saucecharts/ ; \
	done


clean:
	rm -rf flags src css


.PHONY: flags echarts saucecharts
