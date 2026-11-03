#!/usr/bin/env bash
# Renders the Play listing graphics with headless Firefox.
#   store/play/render.sh            feature graphic only
#   Screenshots: put phone captures in store/play/raw/ named 01.png, 02.png, ...
#   and one caption per line in store/play/raw/captions.txt (line 1 → 01.png).
set -euo pipefail
cd "$(dirname "$0")"
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
shot() { firefox --headless --no-remote -profile "$profile" --window-size="$1" --screenshot "$PWD/$2" "file://$PWD/$3" >/dev/null 2>&1; }

shot 1024,500 feature-graphic.png src/feature.html

[ -f raw/captions.txt ] || exit 0
mkdir -p screenshots
i=0
while IFS= read -r caption || [ -n "$caption" ]; do
  i=$((i + 1)); n=$(printf %02d "$i")
  [ -f "raw/$n.png" ] || { echo "missing raw/$n.png"; continue; }
  head=${caption%%|*}; sub=${caption#*|}; [ "$sub" = "$caption" ] && sub=""
  sed -e "s|{{IMG}}|../raw/$n.png|" -e "s|{{HEAD}}|$head|" -e "s|{{SUB}}|$sub|" src/screen.html > "src/screen-$n.html"
  shot 1080,1920 "screenshots/$n.png" "src/screen-$n.html"
  rm "src/screen-$n.html"
  echo "screenshots/$n.png"
done < raw/captions.txt
