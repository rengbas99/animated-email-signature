# Animated Email Signature — Product Flow

## Overview

A self-hosted Node.js server that takes a profile photo, records it inside a CSS-animated signature template using headless Chrome (Puppeteer), encodes the animation as a high-quality GIF using gifski, uploads it to Cloudinary, and outputs a Gmail-ready HTML signature.

---

## System Architecture

```
Browser (src/ui/builder.html)
        │
        │ HTTP POST /api/signature (base64 photo + form data)
        ▼
Node.js Server (src/server.js) — localhost:3000
        │
        ├─[STEP 1] Stage photo → src/assets/staging/<slug>/profile.png
        ├─[STEP 2] Update config.json (name, title, mode, slug)
        ├─[STEP 3] node src/generator/generate_gif.js <mode> <slug>
        ├─[STEP 4] .venv/bin/python3 src/generator/cloudinary_upload.py <slug>
        └─[STEP 5] .venv/bin/python3 src/generator/signature_builder.py
```

---

## Step-by-Step Product Flow

### STEP 1 — User Uploads Photo (Browser)

**File:** `src/ui/builder.html`

1. User opens `http://localhost:3000` in browser
2. Fills in: Full Name, Job Title, animation mode (`para` | `strips` | `circle`)
3. Uploads profile photo (PNG/JPG) via the "Upload profile photo" button
   - Photo is stored as a base64 data URL in the browser's `photoURL` variable
   - **Not sent to server yet** — only held in browser memory
4. User clicks **⚡ Generate via Server**
5. Browser sends HTTP POST to `/api/signature` with:
   - `profileImage` — base64 encoded photo
   - `employeeName`, `title`, `animationMode`, plus contact/social fields

---

### STEP 2 — Server Stages the Photo

**File:** `src/server.js`

```
src/assets/staging/<slug>/profile.png
```

- Server receives the base64 image string
- Decodes and writes it as `profile.png` to the employee's staging folder
- This is the file `generate_gif.js` reads for injection into the GIF

---

### STEP 3 — Puppeteer Records the Animated GIF

**File:** `src/generator/generate_gif.js`

```
node src/generator/generate_gif.js <mode> <slug>
```

#### What happens inside:

1. **Launch headless Chrome** (Puppeteer) using the cached Chrome for Testing binary
2. **Open** `src/templates/signature_template.html`
3. **Inject profile photo** from `src/assets/staging/<slug>/profile.png` as base64 into the page:
   ```js
   uploadedPhoto = url;
   applyPhoto(url);  // sets background-image on all photo elements
   ```
4. **Switch to requested mode** by calling `setMode(btn)` in the page JS
5. **Force exact dimensions** on `.sig-photo` container from `config.json`
6. **Seek & capture 50 frames** (5 seconds at 10fps) using `seekAnimations(t)`:
   - Pauses all CSS animations
   - Manually sets `animation-delay` to scrub to exact time `t`
   - Screenshots the `.sig-photo` element as PNG
7. **Encode with gifski** (primary):
   - Writes 50 PNG frames to a temp folder
   - Runs: `gifski --fps 10 --quality 95 --width W --height H -o output.gif frame-*.png`
   - Cleans up temp PNGs
   - Falls back to gifshot (in-browser) if gifski not installed
8. **Output GIF** saved to: `output/<slug>/avatar_<mode>_animated.gif`

#### Animation modes:

| Mode | Shape | Animation |
|------|-------|-----------|
| `para` | Parallelogram clip | Slides in from right, shimmer sweep |
| `strips` | 4 diagonal strips | Seamless sine drift (±6px, odd↔even alternate directions, 5s loop) |
| `circle` | Circle with ring pulse | Scales in, ring expands outward |

---

### STEP 4 — Upload to Cloudinary

**File:** `src/generator/cloudinary_upload.py`

```
.venv/bin/python3 src/generator/cloudinary_upload.py <slug>
```

#### What happens:

1. Reads `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` from `.env` (project root)
2. Looks for GIFs in `output/<slug>/`:
   - `avatar_circle_animated.gif`
   - `avatar_para_animated.gif`
   - `avatar_strips_animated.gif`
3. Uploads each using **unsigned upload** with a **timestamped public ID**:
   ```
   email-signatures/<slug>_avatar_<type>_<timestamp>.gif
   ```
   - Timestamp ensures a **fresh URL every time** — no stale CDN cache
   - No `overwrite` permission required (unsigned preset compatible)
4. Records the returned Cloudinary URLs in `uploaded_manifest`
5. Writes all URLs back to `config.json` under `assets.<slug>_urls`

#### Why timestamped public IDs?
Cloudinary's CDN caches assets by URL. Unsigned presets cannot use `overwrite=True`. By appending `int(time.time())` to the public ID, every upload creates a new unique URL — the signature always gets the freshly generated GIF.

---

### STEP 5 — Compile the Email Signature HTML

**File:** `src/generator/signature_builder.py`

```
.venv/bin/python3 src/generator/signature_builder.py
```

1. Reads `config.json` for:
   - Employee name, title, social links
   - Cloudinary GIF URLs from previous step
2. Renders `src/templates/signature.html.jinja` with those values
3. Writes final outputs:
   - `output/signature_final.html` — standalone preview/export page (built separately, see Step 6)
   - `output/signature_raw.html` — the signature table fragment

The server's `/api/signature` response returns this compiled HTML directly (`res.json({ html })`) — the browser never has to re-read it from disk.

---

### STEP 6 — User Copies Signature to Gmail

**In browser (`src/ui/builder.html`):**

- The server response HTML is stored in `window.serverGeneratedHTML` and dropped into the live preview panel
- User clicks **"Copy for Gmail (Rich Text)"** or **"Copy Raw HTML"**
- Both buttons copy `window.serverGeneratedHTML` straight to the clipboard (`ClipboardItem` / `execCommand` fallback)
- User pastes into Gmail → Settings → Signature

**Optional standalone export:** `src/generator/clipboard_exporter.js` reads `output/signature_raw.html` + `config.json` and writes a self-contained `output/signature_final.html` page (live preview + copy buttons + install instructions for Gmail/Outlook/Apple Mail/Yahoo). This is a separate manual step (`npm run build:exporter` or `scripts/build.sh`) for sharing a shareable static page — it is not part of the interactive server flow.

---

## File Map

```
animated-email-signature/
├── src/
│   ├── server.js                          ← Node.js HTTP server (entry point)
│   ├── ui/
│   │   └── builder.html                   ← Web UI served at localhost:3000
│   ├── generator/
│   │   ├── generate_gif.js                ← Puppeteer frame capture + gifski encoder
│   │   ├── gifshot.min.js                 ← Fallback in-browser GIF encoder
│   │   ├── signature_builder.py           ← Jinja HTML compiler
│   │   ├── cloudinary_upload.py           ← Cloudinary uploader (timestamped public IDs)
│   │   └── clipboard_exporter.js          ← Standalone export-page builder (optional)
│   ├── templates/
│   │   ├── signature_template.html        ← CSS-animated page Puppeteer opens/screenshots
│   │   └── signature.html.jinja           ← Email signature HTML template
│   └── assets/
│       ├── staging/
│       │   └── <slug>/profile.png         ← Staged profile photo (per employee, gitignored)
│       └── theme-default/                 ← Pre-baked orange social-icon GIFs (v1's one theme pack)
├── output/                                 ← Generated build artifacts (gitignored)
│   ├── signature_final.html               ← Standalone export page
│   ├── signature_raw.html                 ← Raw signature fragment
│   └── <slug>/
│       ├── avatar_circle_animated.gif     ← Generated GIF (circle mode)
│       ├── avatar_para_animated.gif       ← Generated GIF (parallelogram mode)
│       └── avatar_strips_animated.gif     ← Generated GIF (strips mode)
├── config.json                            ← Central config (placeholders only — never commit real data)
├── package.json                           ← Node dependencies
├── requirements.txt                       ← Python dependencies
└── .env                                   ← Cloudinary secrets (gitignored, never commit)
```

---

## GIF Quality Pipeline

```
Puppeteer captures 50 PNG frames (deviceScaleFactor: 2 = retina)
        │
        ▼
gifski --fps 10 --quality 95           ← PRIMARY (near-photo quality, SSIM-optimised)
        │   (if not installed)
        ▼
gifshot in-browser                     ← FALLBACK (256-colour median cut)
        │   + gifsicle -O3 --colors 256   (optimisation pass, no dithering)
        ▼
output/<slug>/avatar_<mode>_animated.gif
```

### Why gifski over gifshot?
| | gifshot | gifski |
|---|---|---|
| Colour depth | 256 per frame (median cut) | Thousands (SSIM palette per frame) |
| Dithering | None / basic | Perceptual, noise-free |
| Quality | Visibly pixelated on strips | Near-photo |
| Speed | ~5s | ~20s |
| Dependency | npm (included) | `brew install gifski` |

---

## Environment Setup

```bash
# 1. Node dependencies
npm install

# 2. Python virtual env
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. Quality encoders
brew install gifski    # primary GIF encoder (near-photo quality)
brew install gifsicle  # fallback optimiser

# 4. Cloudinary credentials
cp .env.example .env
# Edit .env with your CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET

# 5. Start server
node src/server.js
# → Open http://localhost:3000
```

---

## Known Behaviour

| Situation | What happens |
|---|---|
| gifski not installed | Silently falls back to gifshot + gifsicle |
| gifsicle not installed | GIF still saved, no optimisation pass |
| No photo uploaded | `generate_gif.js` falls back to `config.json`'s `assets.profile_photo`, if it exists |
| Cloudinary upload fails | Script exits with code 1, server reports error to browser |
| Same slug run twice | New timestamped Cloudinary URL generated, old asset remains (orphaned) |
