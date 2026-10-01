#!/bin/zsh
# Double-click to run Harvest. Close this Terminal window when you are done.
cd "$(dirname "$0")/.." || exit 1
# Keystatic saves from the phone land on GitHub, not here. Catch up first, so
# the project list is current and nothing is written on top of an old copy.
# Quietly skipped when offline or when there are unpublished local changes.
git pull -q --ff-only 2>/dev/null
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" exec node tools/harvest.js
