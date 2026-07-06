# Animated Email Signature Generator

Generate a custom **animated HTML email signature** — a looping GIF photo
(no CSS animation, so it survives Gmail/Outlook/Apple Mail/Yahoo stripping
`<style>`/`<script>`) alongside real, clickable HTML for your name, title,
contact details, and social links.

Upload a photo, pick an animation style, and get a signature you can paste
straight into your email client's signature settings.

---

## How it works

```
Browser (src/ui/builder.html)
        │  upload photo + logo + fill in your details
        ▼
Node.js Server (src/server.js)
        │
        ├─ Puppeteer + gifski   → records the photo animation as a GIF
        ├─ Cloudinary           → hosts the GIF at a stable HTTPS URL
        └─ Jinja2               → compiles the final table-based HTML
        ▼
Copy for Gmail / Copy Raw HTML  → paste into your email client
```

Full step-by-step detail (including the frame-capture mechanics and GIF
encoder fallback chain) lives in `PRODUCT_FLOW.md`.

---

## Setup

```bash
# 1. Node dependencies
npm install

# 2. Python dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. GIF encoder (falls back to a slower in-browser encoder if skipped)
brew install gifski

# 4. Cloudinary credentials
cp .env.example .env
# edit .env with your CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET

# 5. Run it
node src/server.js
# → open http://localhost:3000
```

Without Cloudinary credentials configured, the pipeline still runs end to
end — it just skips the upload step and falls back to `config.json`'s
`cdn_base_url` for image hosting.

---

## Customizing

- **Photo** — upload your own headshot; choose from 3 animation modes
  (parallelogram, strips, circle ring-pulse).
- **Logo** — upload your own company logo, or paste a hosted logo URL
  directly.
- **Identity fields** — name, title, company, email, phone, website,
  LinkedIn, address, CTA button, tagline — all editable in the builder UI,
  all sourced from `config.json`, never hardcoded.
- **Theme** — v1 ships one fixed color theme (the orange/navy accent pack
  in `src/assets/theme-default/` plus the hardcoded colors in
  `src/templates/signature_template.html`, marked with a `THEME CONSTANTS`
  comment block). No color pickers in v1 — see Roadmap.

---

## Testing

```bash
.venv/bin/python3 -m pytest tests/ -v
```

Covers: no `<style>`/`<script>` in the compiled signature, table-rooted
output, config values present in output, all images resolve to a single
CDN host, and repo-hygiene checks (no leftover PII or per-run upload
caches committed in `config.json`).

---

## Roadmap

- **Theme engine** — swap `theme-default/` for other color/asset packs
  instead of v1's single fixed theme.
- **In-browser encoder** — a dependency-free fallback GIF encoder that
  doesn't need Puppeteer/gifski, for lighter deployments.
- **SVG line-draw feeder** — an alternate animation source (animated SVG
  stroke-draw) feeding the same Puppeteer capture → GIF pipeline.

---

## Deployment

This needs a **persistent Node process**, a **Python venv**, and the
**gifski binary** — it won't run on typical serverless/static hosting
(Vercel, Netlify static). Deploy to a VPS or any host that can run a
long-lived `node src/server.js` process. The standalone exporter page
(`output/signature_final.html`, built via `scripts/build.sh` or
`npm run build:exporter`) has no server dependency once built and can be
hosted separately as a static file.
