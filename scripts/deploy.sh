#!/usr/bin/env bash
# Build the game and publish dist/ to the gh-pages branch (GitHub Pages).
# Adds a new commit on top of gh-pages each time, so no force-push is needed.
set -euo pipefail

cd "$(dirname "$0")/.."
REMOTE_URL="$(git remote get-url origin)"
AUTHOR_NAME="$(git config user.name)"
AUTHOR_EMAIL="$(git config user.email)"
SOURCE_SHA="$(git rev-parse --short HEAD)"

npm run typecheck
npm run check:levels
npm run build

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git clone --quiet --branch gh-pages --depth 1 "$REMOTE_URL" "$WORK/site"
else
  git init --quiet -b gh-pages "$WORK/site"
  git -C "$WORK/site" remote add origin "$REMOTE_URL"
fi

# Replace the site contents with the fresh build.
find "$WORK/site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. "$WORK/site/"
# Without this, Pages runs Jekyll, which drops files starting with "_".
touch "$WORK/site/.nojekyll"

cd "$WORK/site"
git add -A
if git diff --cached --quiet; then
  echo "Nothing changed; site is already up to date."
  exit 0
fi
git -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit --quiet -m "Deploy ${SOURCE_SHA}"
git push --quiet origin gh-pages
echo "Deployed ${SOURCE_SHA} to gh-pages."
