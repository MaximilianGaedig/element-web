#!/usr/bin/env bash

# Echoes a version based on the git hashes of the element-web & js-sdk checkouts, for the case where
# these dependencies are git checkouts.

set -e

SCRIPT_DIR=$(dirname "$0")

# layered.sh clones matrix-js-sdk directly into <root>/matrix-js-sdk.
if [ -d "$SCRIPT_DIR/../matrix-js-sdk" ]; then
    JSSDK_SHA=$(git -C "$SCRIPT_DIR/../matrix-js-sdk" rev-parse --short=12 HEAD)
else
    # Fork: the Docker build uses the js-sdk pinned in pnpm-lock.yaml instead of a checkout
    # (see docker-link-repos.sh), so take the pinned commit from the lockfile.
    JSSDK_SHA=$(grep -oE "matrix-js-sdk/tar\.gz/[0-9a-f]{40}" "$SCRIPT_DIR/../pnpm-lock.yaml" | head -1 | grep -oE "[0-9a-f]{40}" | cut -c1-12)
    JSSDK_SHA=${JSSDK_SHA:-unknown}
fi
VECTOR_SHA=$(git rev-parse --short=12 HEAD) # use the ACTUAL SHA rather than assume develop
echo "$VECTOR_SHA-js-$JSSDK_SHA"
