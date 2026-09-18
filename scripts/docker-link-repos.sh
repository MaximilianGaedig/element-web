#!/usr/bin/env bash

set -ex

# Fork: always build with the js-sdk pinned in pnpm-lock.yaml. Upstream links the
# latest js-sdk develop when building its own develop branch, but this fork's
# develop lags upstream, so a moving js-sdk breaks the build (e.g. removed
# src/oidc/authorize). Pass USE_CUSTOM_SDKS=true explicitly to opt in.

if [[ $USE_CUSTOM_SDKS == false ]]
then
    echo "skipping js-sdk install: USE_CUSTOM_SDKS is false"
    exit 0
fi

echo "Linking js-sdk"
git clone --depth 1 --branch $JS_SDK_BRANCH "$JS_SDK_REPO" js-sdk
cd js-sdk
pnpm install
cd ../

echo "Setting up element-web with js-sdk package"
pnpm link ./js-sdk
