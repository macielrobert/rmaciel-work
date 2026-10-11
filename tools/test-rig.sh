#!/bin/bash
# AN ISOLATED COPY OF THE SITE, for testing Harvest end to end — Save AND
# Publish — without touching GitHub, Netlify, Robert's working copy or his
# running Harvest. Built for UX-6; UX-3 and UX-5 each rebuilt one by hand.
#
#   tools/test-rig.sh <empty folder>
#
# Makes, inside that folder:
#   github.git   a bare repository standing in for GitHub, main = this HEAD
#   site/        a clone of it on main — the copy Harvest edits and publishes
#   home/        a scratch HOME, so Harvest's state.json is a fresh one
#   bin/gh       a stand-in for gh: opens and merges "pull requests" in
#                github.git, then builds merged main into live/ (the deploy)
#   live/        what the stand-in Netlify serves (bin/live.js)
#   gh-mode      empty, or one word that makes bin/gh fail on purpose:
#                no-pr (pull request refused), no-merge (merge refused),
#                no-deploy (merged, but live/ never changes)
#
# It prints the two commands that run it. Start each in the background and
# stop each by the PID it printed — never pkill: Robert's Harvest runs the
# same command line (AGENTS.md, Harvest). Delete the folder to throw it away.
set -euo pipefail
R=${1:?usage: tools/test-rig.sh <empty folder>}
REPO=$(cd "$(dirname "$0")/.." && pwd)
MODULES=$(cd "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)/node_modules
[ -d "$MODULES" ] || { echo "no node_modules at $MODULES — run npm install there" >&2; exit 1; }
mkdir -p "$R" && R=$(cd "$R" && pwd)
[ -z "$(ls -A "$R")" ] || { echo "$R is not empty" >&2; exit 1; }

git init -q --bare "$R/github.git"
git -C "$REPO" push -q "$R/github.git" HEAD:refs/heads/main
git -C "$R/github.git" symbolic-ref HEAD refs/heads/main
git clone -q "$R/github.git" "$R/site"
ln -s "$MODULES" "$R/site/node_modules"
# Harvest commits there under the scratch HOME, which has no ~/.gitconfig
git -C "$R/site" config user.name "$(git -C "$REPO" config user.name || echo rig)"
git -C "$R/site" config user.email "$(git -C "$REPO" config user.email || echo rig@localhost)"
mkdir -p "$R/home" "$R/bin" "$R/prs" "$R/live"
: > "$R/gh-mode"

# the deploy: build main as GitHub now has it into live/
cat > "$R/bin/deploy" <<EOF
#!/bin/bash
set -euo pipefail
t=\$(mktemp -d); trap 'rm -rf "\$t"' EXIT
git clone -q "$R/github.git" "\$t/s"; ln -s "$MODULES" "\$t/s/node_modules"
node "\$t/s/build.js" >/dev/null
rm -rf "$R/live"; cp -R "\$t/s/dist" "$R/live"
EOF

cat > "$R/bin/gh" <<EOF
#!/bin/bash
# Stand-in for gh: only the four calls tools/harvest.js makes.
set -euo pipefail
mode=\$(cat "$R/gh-mode")
case "\$1 \$2" in
  "pr create")
    while [ \$# -gt 0 ]; do [ "\$1" = --head ] && head=\$2; shift; done
    [ "\$mode" = no-pr ] && { echo "GraphQL: the stand-in refused to open it (no-pr)" >&2; exit 1; }
    n=\$(( \$(ls "$R/prs" | wc -l) + 1 ))
    echo "\$head \$(git -C "$R/github.git" rev-parse "refs/heads/\$head")" > "$R/prs/\$n"
    echo "https://github.com/stand-in/site/pull/\$n" ;;
  "pr merge")
    n=\${3##*/}; read head sha < "$R/prs/\$n"
    [ "\$mode" = no-merge ] && { echo "Pull request is not mergeable: the stand-in refused (no-merge)" >&2; exit 1; }
    t=\$(mktemp -d); trap 'rm -rf "\$t"' EXIT
    git clone -q "$R/github.git" "\$t/m"
    git -C "\$t/m" -c user.name=rig -c user.email=rig@localhost merge -q --no-ff "\$sha" -m "Merge pull request #\$n from \$head"
    git -C "\$t/m" push -q origin main
    [ "\$mode" = no-deploy ] || "$R/bin/deploy" ;;
  "pr view") read head sha < "$R/prs/\$3"; echo "\$sha" ;;
  "api "*) echo '{"statuses":[{"context":"netlify/stand-in/deploy-preview","state":"failure","description":"Deploy failed (stand-in)"}]}' ;;
  *) echo "the stand-in gh does not know: \$*" >&2; exit 1 ;;
esac
EOF

cat > "$R/bin/live.js" <<EOF
// the stand-in Netlify: serves live/ on the port given. With its types: an
// SVG icon sent without image/svg+xml does not draw, and the menu falls back.
const http = require('http'), fs = require('fs'), path = require('path');
const root = '$R/live';
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer((q, s) => {
  let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { s.writeHead(e ? 404 : 200, { 'cache-control': 'no-store', 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); s.end(e ? 'not found' : d); });
}).listen(+process.argv[2], '127.0.0.1');
EOF
chmod +x "$R/bin/deploy" "$R/bin/gh"
"$R/bin/deploy"

cat <<EOF
Rig ready at $R. Run, each in the background, and note each PID:
  node "$R/bin/live.js" 4399
  HOME="$R/home" HARVEST_NO_OPEN=1 HARVEST_PORT=0 HARVEST_GH="$R/bin/gh" HARVEST_LIVE=http://127.0.0.1:4399/ node "$R/site/tools/harvest.js"
EOF
