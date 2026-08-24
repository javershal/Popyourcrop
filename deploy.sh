#!/usr/bin/env bash
#
# Publish dist/index.html to GitHub Pages as a single orphan commit.
#
#   ./deploy.sh                     # deploy whatever is in dist/
#   ./deploy.sh photos/beach.jpg    # pack that photo for today, then deploy
#
# History is deliberately NOT accumulated. Each run builds a fresh throwaway
# repo containing only index.html and force-pushes it to gh-pages, so the
# published branch holds exactly one commit and exactly one photo -- rather
# than a growing public archive of every personal photo ever used. The source
# branch (main) never receives a photo at all: dist/ is gitignored.
#
set -euo pipefail

REPO="${REPO:-git@github.com:javershal/Popyourcrop.git}"
BRANCH="${BRANCH:-gh-pages}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"

if [ $# -ge 1 ]; then
  echo "packing $1 ..."
  python3 "$ROOT/tools/pack.py" "$@"
fi

if [ ! -f "$DIST/index.html" ]; then
  echo "no dist/index.html -- run: python3 tools/pack.py photos/your.jpg" >&2
  exit 1
fi

# Refuse to publish a build that still carries the placeholder day, which would
# put a broken date in front of testers.
if grep -q "id: '0000-00-00'" "$DIST/index.html"; then
  echo "dist/index.html was never packed (still the 2x2 fallback image)" >&2
  exit 1
fi

DAY="$(grep -o "id: '[0-9-]\{10\}'" "$DIST/index.html" | head -1 | grep -o '[0-9-]\{10\}')"
SIZE="$(du -h "$DIST/index.html" | cut -f1)"
echo "deploying day $DAY  ($SIZE)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$DIST/index.html" "$TMP/index.html"
# The share spike needs a secure context to produce a valid result (§7.3), and
# Pages is the only HTTPS origin we have -- so it ships alongside the app.
[ -f "$ROOT/spike/spike.html" ] && cp "$ROOT/spike/spike.html" "$TMP/spike.html"
# Pages otherwise runs the tree through Jekyll, which is pure latency here.
: > "$TMP/.nojekyll"

cd "$TMP"
git init -q
git symbolic-ref HEAD "refs/heads/$BRANCH"
git add -A
git -c user.name=javershal -c user.email=jza22092@gmail.com \
    commit -q -m "Daily Crop — $DAY"
git push -q -f "$REPO" "$BRANCH"

echo "pushed to $BRANCH"
echo "live at https://javershal.github.io/Popyourcrop/  (allow a minute on first deploy)"
