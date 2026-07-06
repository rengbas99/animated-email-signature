# Animated Company Email Signature — Claude Code Project

## Project Mission
Build a self-contained tool that generates a **custom animated HTML email signature**.
The output is a deployable HTML file that works in Gmail, Outlook, Apple Mail, and Yahoo Mail.
The signature uses **looping GIF animations** (never CSS animations) and deploys via the **ClipboardItem text/html trick**.

---

## Theming

v1 ships **one fixed theme** — the orange/navy accent pack in `src/assets/theme-default/`
(pre-baked social-icon GIFs) plus the hardcoded colors in `src/templates/signature_template.html`
(marked with a `THEME CONSTANTS` comment block). Users customize **identity**, not color:
profile photo (3 animation modes), their own logo, and all text/link fields. No color pickers,
no dynamic theming in v1.

Roadmap: themes are asset packs — a theme engine that swaps `theme-default/` for another
pack (different accent color + matching social-icon GIFs) is future work, not v1 scope.

---

## Architecture Overview

The real pipeline is server-driven, not a static Pillow batch script:

```
Browser (src/ui/builder.html)
        │  HTTP POST /api/signature (base64 photo + form fields)
        ▼
Node.js Server (src/server.js) — localhost:3000
        │
        ├─ Stage photo      → src/assets/staging/<slug>/profile.png
        ├─ Update config.json (name, title, mode, slug)
        ├─ node src/generator/generate_gif.js <mode> <slug>
        │     Puppeteer opens src/templates/signature_template.html,
        │     screenshots the CSS-animated photo column frame-by-frame,
        │     encodes with gifski (falls back to gifshot + gifsicle)
        ├─ python src/generator/cloudinary_upload.py <slug>
        │     unsigned upload to Cloudinary, timestamped public IDs
        └─ python src/generator/signature_builder.py
              renders src/templates/signature.html.jinja from config.json
              → output/signature_raw.html, returned in the API response
```

Full step-by-step detail: see `PRODUCT_FLOW.md` (the source of truth for this flow).

```
animated-email-signature/
├── CLAUDE.md                       ← You are here (project brain)
├── PRODUCT_FLOW.md                 ← Step-by-step pipeline detail
├── src/
│   ├── server.js                   ← Express entry point (POST /api/signature)
│   ├── ui/
│   │   └── builder.html            ← Web UI (photo upload, live preview, copy buttons)
│   ├── generator/
│   │   ├── generate_gif.js         ← Puppeteer capture + gifski/gifshot encode
│   │   ├── gifshot.min.js          ← Vendored fallback encoder
│   │   ├── cloudinary_upload.py    ← Cloudinary uploader (timestamped public IDs)
│   │   ├── signature_builder.py    ← Jinja2 → HTML table compiler
│   │   └── clipboard_exporter.js   ← Optional standalone export-page builder
│   ├── templates/
│   │   ├── signature_template.html ← CSS-animated page Puppeteer screenshots
│   │   └── signature.html.jinja    ← Email-safe HTML table template
│   └── assets/
│       ├── staging/                ← Per-run staged photos (gitignored)
│       └── theme-default/          ← Pre-baked social-icon GIFs (v1's one theme)
├── scripts/
│   ├── build.sh                    ← Manual/offline build (no browser upload flow)
│   └── preview.sh                  ← Opens output/signature_final.html in browser
├── tests/                          ← pytest suite (pipeline + PII/CDN-host assertions)
├── config.json                     ← ALL user-editable settings — placeholders only, never commit real data
├── output/                         ← Generated build artifacts (gitignored)
├── requirements.txt                ← Python deps
├── package.json                    ← Node deps
└── .env                            ← Cloudinary secrets (gitignored, never commit)
```

---

## config.json Schema (source of truth for all user data)

Claude Code must read `config.json` before generating anything.
Never hardcode names, colours, or URLs. Always source from config.

```json
{
  "person": {
    "name": "Your Name",
    "title": "Your Job Title",
    "company": "Your Company Ltd",
    "email": "you@yourcompany.com",
    "phone": "+44 20 0000 0000",
    "website": "https://yourcompany.com",
    "address": "",
    "slug": "your_name"
  },
  "brand": {
    "primary_color": "#1B1464",
    "accent_color": "#F7931E",
    "...": "theme colors — see 'Theming' above, not user-editable in v1"
  },
  "social": {
    "linkedin": "https://linkedin.com/company/yourcompany",
    "twitter": "",
    "github": "",
    "website": "https://yourcompany.com"
  },
  "assets": {
    "profile_photo": "",
    "logo_url": "",
    "cdn_base_url": "https://res.cloudinary.com/YOUR_CLOUD/image/upload/..."
  },
  "output": {
    "avatar_size": 170,
    "logo_height": 36,
    "gif_fps": 12
  },
  "photo_style": "para",
  "copy_text": {
    "cta_label": "Book a call",
    "cta_url": "https://yourcompany.com/contact",
    "tagline": "Your tagline here"
  }
}
```

`config.json` is mutated at runtime by `src/server.js` on every `/api/signature` request
(name/title/photo/slug get overwritten with the submitted form data) — the committed version
should always be reset to placeholders before commit (see Phase 4 pre-commit checklist below).

---

## Component 1: Photo Animation (`src/generator/generate_gif.js` + `src/templates/signature_template.html`)

Puppeteer opens `signature_template.html`, injects the uploaded photo via `applyPhoto()`,
switches to the requested mode via `setMode()`, then scrubs the CSS animation frame-by-frame
(`seekAnimations(t)`) and screenshots the `.sig-photo` element. Frames are encoded with
`gifski` (primary — near-photo quality) or `gifshot` + `gifsicle` (fallback, no gifski install
required). See `PRODUCT_FLOW.md` for the full frame-capture walkthrough.

### Critical GIF constraints
- `disposal=2` / clean frame boundaries — no ghosting
- Target < 200KB per GIF — gifski's `--quality` flag controls this
- Three modes only: `para` (parallelogram), `strips` (4 diagonal strips), `circle` (ring pulse)

---

## Component 2: Signature Builder (`src/generator/signature_builder.py`)

### What it must produce
A pure HTML string using **only HTML tables** — no flexbox, no grid, no CSS classes (only inline styles).

### Required table structure
```
[outer-table 548px]
  [td: social icon sidebar]  [td: name/title/contact info]  [td: animated photo GIF]
```

### Inline style rules (non-negotiable for email clients)
- `font-family` must be specified on EVERY text td
- Never use `em` or `rem` — only `px`
- Never use `border-radius` on image cells (Outlook ignores it)
- All images: `display:block; border:0; outline:0;`
- All links: `text-decoration:none; color: <explicit hex>`
- Table: `border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;`

### Jinja2 template variables
Renders `src/templates/signature.html.jinja` with values from `config.json`. Photo/social-icon
URLs resolve to either Cloudinary (post-upload) or `cdn_base_url` fallback — see
`resolve_photo_style()` in `signature_builder.py`.

---

## Component 3: Clipboard Exporter (`src/generator/clipboard_exporter.js`, optional)

Builds a standalone `output/signature_final.html` (live preview + copy buttons + install
instructions for Gmail/Outlook/Apple Mail/Yahoo) from `output/signature_raw.html` + `config.json`.
This is a manual/offline packaging step, separate from the interactive server flow — the
`src/ui/builder.html` copy buttons use the live `/api/signature` response directly, not this file.

```javascript
const blob = new Blob([signatureHTML], { type: 'text/html' });
const item = new ClipboardItem({ 'text/html': blob });
await navigator.clipboard.write([item]);
```

---

## Python Dependencies (`requirements.txt`)
```
Jinja2>=3.1.0
pytest>=7.0.0
cloudinary>=1.36.0
python-dotenv>=1.0.0
```

## Node Dependencies (`package.json`)
```json
{
  "dependencies": {
    "express": "^5.2.1",
    "puppeteer": "^24.43.1"
  }
}
```

---

## Coding Standards

### Python
- Type hints on all functions
- Docstrings on every function (Google style)
- No global state — pass config dict explicitly
- Use `pathlib.Path` not `os.path`
- All file paths relative to project root

### JavaScript
- Vanilla JS only — no frameworks, no bundler required
- All clipboard code wrapped in `try/catch` with user-visible error states
- Graceful fallback: if `ClipboardItem` not supported, fall back to `execCommand('copy')`

### HTML (signature output)
- The output HTML must pass: https://www.emailonacid.com mental model
- Comments stripped from final output
- No `<script>` or `<style>` tags in the signature HTML itself (email clients strip them)
- Outlook conditional comments where needed: `<!--[if mso]>...<![endif]-->`

---

## Testing

Run: `pytest tests/`

Tests must cover:
1. Signature builder output contains no `<style>` or `<script>` tags
2. HTML output contains all config values (name, email, phone)
3. All image src URLs use the CDN base URL or `theme-default/` — no other hosts
4. No real PII (test-run names/emails/staging paths) leaks into committed output

---

## Deployment

This pipeline needs a **persistent Node process** (Express server), a **Python venv**, and
the **gifski binary** — none of which run in a typical serverless/static host. Deploy to a
VPS or any host that runs a long-lived `node src/server.js` process (not Vercel/Netlify
static hosting). `output/signature_final.html` (the standalone exporter page, built via
`scripts/build.sh` or `npm run build:exporter`) *can* be deployed as a static file separately,
since it has no server dependency once built.

### GIF hosting (Cloudinary)
GIFs upload automatically per-request via `cloudinary_upload.py` (Step 4 of the pipeline) —
no manual upload step needed once `.env` has valid credentials.

---

## Common Pitfalls — Claude Code Must Avoid

| Pitfall | Reason | Fix |
|---|---|---|
| Using CSS `border-radius` on avatar | Outlook renders square | Use pre-circular GIF |
| Using `font-size: 0` on spacer tds | Breaks in some clients | Use `line-height:0; font-size:0;` together |
| Embedding base64 images | Gmail strips them | Always use absolute HTTPS URLs |
| CSS animations in signature | Blocked by all clients | Only GIF animations |
| `<div>` layout in signature | Breaks in Outlook | Tables only |
| Missing `alt` text on images | Spam filters penalise | Add descriptive alt |
| Multi-line JS strings without escaping | Breaks template literal | Use `JSON.stringify` |
| Hardcoding real company/employee data in code | Breaks whitelabeling | Source everything from `config.json`, reset to placeholders before commit |

---

## Session Start Checklist

When starting a Claude Code session on this project:
1. Read `config.json` — understand the current placeholder person/brand values
2. Confirm `.env` exists locally (copy from `.env.example`) if testing the Cloudinary upload step
3. Run `npm install` and `.venv/bin/pip install -r requirements.txt` if first run
4. Interactive flow: `node src/server.js` → open `http://localhost:3000`
5. Manual/offline flow: `bash scripts/build.sh` (see `scripts/build.sh` header for what it covers)
6. Always open `output/signature_final.html` (or the live preview) to verify visually after a build

---

## What "Done" Looks Like

- [ ] `src/ui/builder.html` — photo upload, 3 animation modes, logo upload, all identity fields
- [ ] `output/<slug>/avatar_<mode>_animated.gif` — Puppeteer-captured, Cloudinary-hosted
- [ ] `output/signature_final.html` — opens in browser, shows live preview
- [ ] "Copy for Gmail" / "Copy Raw HTML" buttons work off the live server response
- [ ] All text sourced from `config.json` / form fields — zero hardcoded company strings
- [ ] `pytest tests/` passes all tests
- [ ] `config.json` committed with placeholders only
