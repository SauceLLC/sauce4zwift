all: node_modules/.build
	npm start
	

node_modules/.build: package.json
	npm install
	touch $@


lint:
	./node_modules/.bin/eslint src pages/*.js
