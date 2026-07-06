#!/bin/bash
# preview.sh — Open the built signature in the default browser
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/output/signature_final.html"

if [ ! -f "$FILE" ]; then
  echo "❌ Output file not found. Run: bash scripts/build.sh"
  exit 1
fi

echo "🌐 Opening $FILE"
# macOS
if command -v open &>/dev/null; then open "$FILE"; exit 0; fi
# Linux
if command -v xdg-open &>/dev/null; then xdg-open "$FILE"; exit 0; fi
# Windows (Git Bash)
if command -v start &>/dev/null; then start "$FILE"; exit 0; fi

echo "Open manually: $FILE"
