#!/usr/bin/env node
/**
 * clipboard_exporter.js
 *
 * Reads output/signature_raw.html and config.json, then writes
 * output/signature_final.html — a self-contained preview page with:
 *   - Live signature preview (in a mock email chrome)
 *   - "Copy for Gmail" button  (ClipboardItem text/html)
 *   - "Copy Raw HTML" button   (plaintext fallback)
 *   - Installation guide for Gmail, Outlook, Apple Mail
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_SIG_PATH = path.join(ROOT, 'output', 'signature_raw.html');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const OUTPUT_PATH = path.join(ROOT, 'output', 'signature_final.html');

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`  ❌ File not found: ${filePath}`);
    console.error('     Run signature_builder.py first.');
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

const rawSignature = readFile(RAW_SIG_PATH);
const config = JSON.parse(readFile(CONFIG_PATH));

// Escape the signature HTML for embedding in a JS template literal
const escapedSig = rawSignature
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const { primary_color, accent_color, font_family } = config.brand;
const { name, company } = config.person;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name} — Email Signature</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --primary: ${primary_color};
    --accent: ${accent_color};
    --bg: #f5f5f0;
    --surface: #ffffff;
    --text: #1a1a2e;
    --muted: #6b7280;
    --border: #e5e7eb;
    --radius: 10px;
    --font: ${font_family};
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    min-height: 100vh;
    padding: 32px 16px;
    color: var(--text);
  }

  .page {
    max-width: 680px;
    margin: 0 auto;
  }

  header {
    text-align: center;
    margin-bottom: 32px;
  }

  header h1 {
    font-size: 22px;
    font-weight: 700;
    color: var(--primary);
    margin-bottom: 6px;
  }

  header p {
    font-size: 13px;
    color: var(--muted);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 20px;
  }

  .card h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 16px;
  }

  /* Mock email chrome */
  .email-chrome {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .email-chrome-header {
    background: #f9fafb;
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .email-chrome-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
  }

  .email-chrome-dot:nth-child(1) { background: #ff5f57; }
  .email-chrome-dot:nth-child(2) { background: #febc2e; }
  .email-chrome-dot:nth-child(3) { background: #28c840; }

  .email-chrome-body {
    padding: 20px;
    background: #fff;
  }

  .email-divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 16px 0;
  }

  /* Buttons */
  .btn-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 6px;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, transform 0.1s;
    text-decoration: none;
  }

  .btn:active { transform: scale(0.98); }

  .btn-primary {
    background: var(--accent);
    color: var(--primary);
  }

  .btn-secondary {
    background: var(--primary);
    color: #fff;
  }

  .btn-outline {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .copy-status {
    font-size: 12px;
    color: #16a34a;
    margin-top: 10px;
    min-height: 18px;
    font-weight: 500;
  }

  .copy-status.error { color: #dc2626; }

  /* Instructions */
  .instructions ol {
    padding-left: 20px;
  }

  .instructions li {
    font-size: 13px;
    line-height: 1.7;
    color: var(--text);
    margin-bottom: 4px;
  }

  .tab-row {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    background: none;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-family: var(--font);
    transition: color 0.15s;
  }

  .tab.active {
    color: var(--primary);
    border-bottom-color: var(--accent);
  }

  .tab-content { display: none; }
  .tab-content.active { display: block; }

  kbd {
    display: inline-block;
    padding: 1px 6px;
    font-size: 11px;
    font-family: monospace;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    color: var(--text);
  }

  .raw-html {
    font-size: 10px;
    font-family: monospace;
    background: #f9fafb;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    max-height: 120px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--muted);
    line-height: 1.5;
    margin-top: 12px;
  }
</style>
</head>
<body>

<div class="page">

  <header>
    <h1>${company} — Email Signature Builder</h1>
    <p>Preview your animated signature and copy it directly into your email client.</p>
  </header>

  <!-- Preview card -->
  <div class="card">
    <h2>Preview</h2>
    <div class="email-chrome">
      <div class="email-chrome-header">
        <div class="email-chrome-dot"></div>
        <div class="email-chrome-dot"></div>
        <div class="email-chrome-dot"></div>
      </div>
      <div class="email-chrome-body">
        <p style="font-size:13px;color:#6b7280;margin-bottom:4px;">
          <strong style="color:#1a1a2e;">Best regards,</strong>
        </p>
        <hr class="email-divider">
        <div id="sig-preview">${rawSignature}</div>
      </div>
    </div>
  </div>

  <!-- Copy card -->
  <div class="card">
    <h2>Copy to clipboard</h2>
    <div class="btn-row">
      <button class="btn btn-primary" id="btn-gmail" onclick="copyForGmail()">
        Copy for Gmail / Outlook
      </button>
      <button class="btn btn-outline" id="btn-raw" onclick="copyRawHtml()">
        Copy raw HTML
      </button>
    </div>
    <div class="copy-status" id="copy-status"></div>
    <div class="raw-html" id="raw-html-display">${rawSignature.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>

  <!-- Instructions card -->
  <div class="card instructions">
    <h2>Installation guide</h2>
    <div class="tab-row">
      <button class="tab active" onclick="showTab('gmail', this)">Gmail</button>
      <button class="tab" onclick="showTab('outlook', this)">Outlook</button>
      <button class="tab" onclick="showTab('apple', this)">Apple Mail</button>
      <button class="tab" onclick="showTab('yahoo', this)">Yahoo</button>
    </div>

    <div id="tab-gmail" class="tab-content active">
      <ol>
        <li>Click <strong>Copy for Gmail / Outlook</strong> above.</li>
        <li>Open Gmail → top right gear icon → <strong>See all settings</strong>.</li>
        <li>Scroll to the <strong>Signature</strong> section → click <strong>Create new</strong>.</li>
        <li>Click inside the signature text box and press <kbd>Ctrl+V</kbd> / <kbd>⌘V</kbd>.</li>
        <li>Click <strong>Save Changes</strong> at the bottom of the page.</li>
        <li>Compose a new email to see your animated signature.</li>
      </ol>
    </div>

    <div id="tab-outlook" class="tab-content">
      <ol>
        <li>Click <strong>Copy for Gmail / Outlook</strong> above.</li>
        <li>Open Outlook → <strong>Settings</strong> → <strong>Mail</strong> → <strong>Compose and reply</strong>.</li>
        <li>Click <strong>New signature</strong> and give it a name.</li>
        <li>Right-click the edit area → <strong>Paste</strong> (choose <em>Keep Source Formatting</em> if prompted).</li>
        <li>On Mac: press <kbd>⌘V</kbd> → click the clipboard icon → select <strong>Keep Source Formatting</strong>.</li>
        <li>Click <strong>Save</strong>.</li>
      </ol>
    </div>

    <div id="tab-apple" class="tab-content">
      <ol>
        <li>Click <strong>Copy for Gmail / Outlook</strong> above.</li>
        <li>Open Mail → <strong>Mail menu</strong> → <strong>Settings</strong> → <strong>Signatures</strong>.</li>
        <li>Select your account and click <strong>+</strong> to add a new signature.</li>
        <li>Uncheck <em>"Always match my default message font"</em>.</li>
        <li>Press <kbd>⌘V</kbd> to paste into the signature field.</li>
        <li>The preview may look broken — compose a new email to see the real result.</li>
      </ol>
    </div>

    <div id="tab-yahoo" class="tab-content">
      <ol>
        <li>Click <strong>Copy for Gmail / Outlook</strong> above.</li>
        <li>Open Yahoo Mail → <strong>Settings gear</strong> → <strong>More Settings</strong>.</li>
        <li>Click <strong>Writing email</strong> → enable <strong>Signature</strong> for your account.</li>
        <li>Press <kbd>Ctrl+V</kbd> / <kbd>⌘V</kbd> to paste into the signature text area.</li>
        <li>Click <strong>Save</strong>.</li>
      </ol>
    </div>
  </div>

</div>

<script>
const SIGNATURE_HTML = \`${escapedSig}\`;

async function copyForGmail() {
  const btn = document.getElementById('btn-gmail');
  const status = document.getElementById('copy-status');
  btn.disabled = true;

  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      const blob = new Blob([SIGNATURE_HTML], { type: 'text/html' });
      const item = new ClipboardItem({ 'text/html': blob });
      await navigator.clipboard.write([item]);
      status.textContent = '✓ Copied as rich text — paste directly into Gmail or Outlook settings.';
      status.className = 'copy-status';
    } else {
      // Fallback: use execCommand with a hidden div
      const el = document.createElement('div');
      el.innerHTML = SIGNATURE_HTML;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
      document.body.removeChild(el);
      status.textContent = '✓ Copied (legacy fallback) — paste into your email signature settings.';
      status.className = 'copy-status';
    }
  } catch (err) {
    status.textContent = '✗ Copy failed: ' + err.message + ' — try the Copy Raw HTML button.';
    status.className = 'copy-status error';
  }

  btn.disabled = false;
  setTimeout(() => { status.textContent = ''; }, 6000);
}

async function copyRawHtml() {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(SIGNATURE_HTML);
    status.textContent = '✓ Raw HTML copied — paste into an email client that accepts HTML input.';
    status.className = 'copy-status';
  } catch {
    status.textContent = '✗ Could not copy. Select the HTML in the box above and copy manually.';
    status.className = 'copy-status error';
  }
  setTimeout(() => { status.textContent = ''; }, 5000);
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
}
</script>

</body>
</html>`;

fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
const sizeKb = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
console.log(`  ✅ Exporter page saved: ${OUTPUT_PATH} (${sizeKb} KB)`);
