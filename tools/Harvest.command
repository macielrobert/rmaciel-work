#!/bin/zsh
# Double-click to run Harvest. Close this Terminal window when you are done.
cd "$(dirname "$0")/.." || exit 1
# (harvest.js catches up with GitHub itself before it reads anything.)
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" exec node tools/harvest.js
