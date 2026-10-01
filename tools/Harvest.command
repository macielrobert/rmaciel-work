#!/bin/zsh
# Double-click to run Harvest. Asks for a project folder, then opens the page.
# Close this Terminal window when you are done.
cd "$(dirname "$0")/.." || exit 1
folder=$(osascript -e 'POSIX path of (choose folder with prompt "Pick a project folder to harvest")') || exit 0
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" exec node tools/harvest.js "$folder"
