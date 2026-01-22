#!/usr/bin/env bash

set -ex

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

DIR=$(dirname "$0")

# If the branch comes out as HEAD then we're probably checked out to a tag, so if the thing is *not*
# coming out as HEAD then we're on a branch. When we're on a branch, we want to resolve ourselves to
# a few SHAs rather than a version.
if [[ $BRANCH != HEAD && ! $BRANCH =~ heads/v.+ && $BRANCH != "unknown" ]]
then
    DIST_VERSION=$("$DIR"/get-version-from-git.sh)
elif [[ $BRANCH == "unknown" ]]
then
    DIST_VERSION="unknown"
else
    DIST_VERSION=$(git describe --abbrev=0 --tags 2>/dev/null || echo "unknown")
fi

DIST_VERSION=$("$DIR"/normalize-version.sh "$DIST_VERSION")

NODE_OPTIONS="--max-old-space-size=4096" VERSION=$DIST_VERSION yarn build
