#!/bin/bash
# build.sh — Manual/offline build pipeline (no browser upload flow).
# Captures the photo animation from config.json's assets.profile_photo via
# Puppeteer, then compiles the HTML signature. For the normal interactive
# flow (photo upload, live preview), run `node src/server.js` instead.
# Usage: bash scripts/build.sh
# Run from project root.

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Animated Email Signature — Build"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 0. Resolve Python interpreter — prefer the project venv if present
if [ -x ".venv/bin/python3" ]; then
  PY=".venv/bin/python3"
  echo "🐍 Using project virtualenv: .venv"
else
  PY="python3"
  echo "🐍 Using system python3 (no .venv found)"
fi

# 1. Check Python deps
echo "📦 Checking Python dependencies..."
if "$PY" -m pip install -q -r requirements.txt 2>/dev/null; then
  echo "  ✅ Python deps ready"
else
  echo "  ⚠️  Could not auto-install deps (externally-managed environment?)."
  echo "     Verifying required packages are importable instead..."
  "$PY" -c "import jinja2" || {
    echo "  ❌ Missing Jinja2. Create a venv and install requirements:"
    echo "       python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
  }
  echo "  ✅ Required packages present"
fi

# 2. Create output dir
mkdir -p output

# 3. Capture photo animations with Puppeteer (all 3 modes)
echo ""
echo "🎬 Capturing photo animations with Puppeteer..."
node src/generator/generate_gif.js all

# 4. Build HTML signature
echo ""
echo "🏗  Building HTML signature table..."
"$PY" src/generator/signature_builder.py

# 5. Build exporter page
echo ""
echo "📋 Building clipboard exporter page..."
node src/generator/clipboard_exporter.js

# 6. Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build complete!"
echo ""
echo "  Output files:"
ls -lh output/ 2>/dev/null | awk 'NR>1 {printf "    %s  %s\n", $5, $9}'
echo ""
echo "  Open output/signature_final.html in your browser"
echo "  to preview and copy your signature."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
