include .env
export

prepare:
	npm install

dev: prepare
	npm run dev
devFirefox: prepare
	npm run prepare:extension
	npx extension dev --browser=firefox
devChromium: prepare
	npm run prepare:extension
	npx extension dev --browser=chromium
devChrome: prepare
	npm run prepare:extension
	npx extension dev --browser=chrome

devAndroidFirefox:
	cd build/firefox && npx web-ext run -t firefox-android --adb-device "${ADB_DEVICE_TO_DEBUG}" --firefox-apk org.mozilla.fenix

clean:
	rm -rf ./build ./dist

# Build section
build: clean prepare buildThirdparty buildAll packAll lintBuilds

buildThirdparty:
	mkdir -p ./thirdparty/bergamot/build && chmod 777 ./thirdparty/bergamot/build
	${DOCKER_COMPOSE} run --rm bergamot make build

buildAll:
	mkdir -p ./build
	chmod 777 ./build
	${DOCKER_COMPOSE} run --rm linguist make buildFirefox buildFirefoxStandalone buildChromium buildChrome

buildFirefox:
	npm run build:variant -- firefox
buildFirefoxStandalone:
	npm run build:variant -- firefox-standalone
buildChromium:
	npm run build:variant -- chromium
buildChrome:
	npm run build:variant -- chrome

packAll:
	cd build && ../scripts/zipAll.sh

lintBuilds:
	node scripts/validateExtensionBuilds.mjs
	cd build && ../scripts/testBuildArchives.sh
