#!/bin/bash

# Script to check if package version has been updated in this release
# Usage: ./check-version-update.sh <package-directory>

PACKAGE_DIR=$1

if [ -z "$PACKAGE_DIR" ]; then
    echo "Usage: $0 <package-directory>"
    exit 1
fi

cd "$PACKAGE_DIR" || exit 1

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Get previous release tag
PREV_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null)

if [ -z "$PREV_TAG" ]; then
    echo "No previous release found - this is the first release"
    exit 0  # Should publish
fi

echo "Previous release tag: $PREV_TAG"

# Get version from previous release
PREV_VERSION=$(git show "$PREV_TAG:$PACKAGE_DIR/package.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8')).version" 2>/dev/null)

if [ -z "$PREV_VERSION" ]; then
    echo "Could not get previous version - assuming package is new"
    exit 0  # Should publish
fi

echo "Previous version: $PREV_VERSION"

# Compare versions
if [ "$CURRENT_VERSION" != "$PREV_VERSION" ]; then
    echo "Version changed from $PREV_VERSION to $CURRENT_VERSION - should publish"
    exit 0  # Should publish
else
    echo "Version unchanged - should not publish"
    exit 1  # Should not publish
fi
