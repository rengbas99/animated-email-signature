#!/usr/bin/env node
/**
 * generate_gif.js — Puppeteer photo-animation recorder.
 *
 * Opens the styled CSS-animated signature page in headless Chrome, switches to
 * the requested photo style (para | strips | circle), screenshots the
 * `.sig-photo` container frame-by-frame, and encodes the frames into a looping
 * animated GIF via gifshot. The result is a flattened, email-safe GIF of the
 * otherwise CSS-only photo animation.
 *
 * Usage:
 *   node src/generator/generate_gif.js [para|strips|circle]
 *
 * Requires: npm install puppeteer
 * Output:   output/signature_photo_<mode>_animated.gif
 */

const fs = require('fs');

// Patch fs.readFileSync to handle EPERM errors when walking up directories
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, options) {
  try {
    return originalReadFileSync.apply(this, arguments);
  } catch (err) {
    if (err.code === 'EPERM') {
      const fakeError = new Error('ENOENT: no such file or directory, open ' + path);
      fakeError.code = 'ENOENT';
      throw fakeError;
    }
    throw err;
  }
};

const path = require('path');

// Project root is two levels up from src/generator/
const ROOT = path.resolve(__dirname, '..', '..');
// The styled, CSS-animated signature page that exposes setMode()/replay().
const SIGNATURE_HTML = path.join(
  ROOT,
  'src',
  'templates',
  'signature_template.html'
);
const OUTPUT_DIR = path.join(ROOT, 'output');

// Check dependencies
try {
  require('puppeteer');
} catch (e) {
  console.error('\x1b[31m%s\x1b[0m', 'Error: Puppeteer is not installed.');
  console.log('Please run the following command in your terminal first:');
  console.log('  \x1b[36mnpm install puppeteer\x1b[0m\n');
  process.exit(1);
}

const puppeteer = require('puppeteer');

// Get mode and slugName from command line arguments (default: circle)
const animationMode = process.argv[2] || 'circle';
const slugName = process.argv[3] || '';

let modesToCapture = [];
if (animationMode === 'all') {
  modesToCapture = ['para', 'strips', 'circle'];
} else if (['para', 'strips', 'circle'].includes(animationMode)) {
  modesToCapture = [animationMode];
} else {
  console.error(`Invalid mode "${animationMode}". Supported modes are: all, para, strips, circle`);
  process.exit(1);
}

async function captureMode(browser, mode) {
  console.log(`[${mode}] Opening concurrent page to record "${mode}" animation...`);
  const page = await browser.newPage();

  // Forward browser console and error logs to Node console
  page.on('console', msg => console.log(`[${mode} browser console]`, msg.text()));
  page.on('pageerror', err => console.error(`[${mode} browser error]`, err.toString()));

  // Set viewport matching the signature dimensions (double density for crisp display)
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });

  await page.goto('file://' + SIGNATURE_HTML);

  // Inject local gifshot script to prevent offline or CORS loading issues
  await page.addScriptTag({ path: path.join(__dirname, 'gifshot.min.js') });

  // Inject the actual profile photo from staging or config.json
  try {
    let photoPath = '';
    if (slugName) {
      photoPath = path.join(ROOT, 'src', 'assets', 'staging', slugName, 'profile.png');
    }
    if (!photoPath || !fs.existsSync(photoPath)) {
      const configPath = path.join(ROOT, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        photoPath = path.join(ROOT, config.assets.profile_photo);
      }
    }

    if (photoPath && fs.existsSync(photoPath)) {
      const photoBuffer = fs.readFileSync(photoPath);
      const ext = path.extname(photoPath).substring(1);
      const photoBase64 = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + photoBuffer.toString('base64');
      
      await page.evaluate((url) => {
        uploadedPhoto = url;
        window.uploadedPhoto = url;
        if (typeof applyPhoto === 'function') {
          applyPhoto(url);
        }
      }, photoBase64);
    }
  } catch (err) {
    console.error(`[${mode}] Error injecting profile photo:`, err.message);
  }

  // Switch to the requested mode and set CSS wrapper active state
  await page.evaluate((mode) => {
    document.querySelectorAll('.strips-wrap').forEach(w => w.classList.remove('active'));
    const wrap = document.getElementById('wrap-' + mode);
    if (wrap) {
      wrap.classList.add('active');
    }
    const btn = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (btn && typeof setMode === 'function') {
      setMode(btn);
    }
  }, mode);

  // Small wait for initial rendering and state application
  await new Promise(r => setTimeout(r, 500));

  // We target the .sig-photo container
  const element = await page.$('.sig-photo');
  if (!element) {
    throw new Error(`Could not find .sig-photo preview container in HTML for mode: ${mode}`);
  }

  // Read dynamic photo dimensions from config.json
  let photoWidth = '200px';
  let photoHeight = '160px';
  try {
    const configPath = path.join(ROOT, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.output) {
        if (config.output.photo_width) photoWidth = config.output.photo_width + 'px';
        if (config.output.photo_height) photoHeight = config.output.photo_height + 'px';
      }
    }
  } catch (err) {
    console.error(`[${mode}] Error reading config dimensions:`, err.message);
  }

  // Force fixed dimensions exactly around the #sig-photo dimension matrix based on mode
  await page.evaluate((m, customW, customH) => {
    const el = document.querySelector('.sig-photo');
    if (el) {
      const w = m === 'circle' ? '170px' : customW;
      const h = m === 'circle' ? '170px' : customH;
      el.style.width = w;
      el.style.minWidth = w;
      el.style.maxWidth = w;
      el.style.height = h;
      el.style.minHeight = h;
      el.style.maxHeight = h;
    }
  }, mode, photoWidth, photoHeight);

  console.log(`[${mode}] Triggering animation and capturing frames...`);

  // Replay animation to capture starting from frame 0
  await page.evaluate(() => { if (typeof replay === 'function') replay(); });

  // Inject getBaseDelays and seekAnimations helpers into the page context
  await page.evaluate(() => {
    window.getBaseDelays = function(container) {
      const elements = [container, ...container.querySelectorAll('*')];
      const delays = [];
      elements.forEach((el) => {
        let baseDelay = el.dataset.baseDelay;
        if (baseDelay === undefined) {
          const style = window.getComputedStyle(el);
          const delayStr = style.animationDelay || '0s';
          const match = delayStr.match(/(-?[\d.]+)(m?s)/);
          if (match) {
            let val = parseFloat(match[1]);
            if (match[2] === 'ms') val /= 1000;
            baseDelay = val;
          } else {
            baseDelay = 0;
          }
          el.dataset.baseDelay = baseDelay;
        }
        delays.push({ el, baseDelay: parseFloat(baseDelay) });
      });
      window.activeDelays = delays;
    };

    window.seekAnimations = function(tSec) {
      if (!window.activeDelays) return;
      window.activeDelays.forEach(({ el, baseDelay }) => {
        el.style.animationPlayState = 'paused';
        el.style.animationDelay = `${baseDelay - tSec}s`;
      });
    };
  });

  // Initialize delays on the target container
  await page.evaluate(() => {
    const container = document.querySelector('.sig-photo');
    if (container) {
      window.getBaseDelays(container);
    }
  });

  const computedBgPos = await page.evaluate(() => {
    const el = document.querySelector('.strip-1');
    if (el) {
      const style = window.getComputedStyle(el);
      return {
        backgroundPosition: style.backgroundPosition,
        backgroundSize: style.backgroundSize,
        height: style.height,
        width: style.width,
        clipPath: style.clipPath
      };
    }
    return null;
  });
  console.log(`[${mode}] Computed style for .strip-1:`, computedBgPos);

  const frames = [];
  const duration = 5000; // Capture 5.0 seconds so the final frame stays static
  const fps = 10;        // 10 fps (100ms delay) is standard for email client compatibility
  const totalFrames = (duration / 1000) * fps;

  for (let i = 0; i < totalFrames; i++) {
    // Seek to exact animation frame time
    const tSec = (i / totalFrames) * (duration / 1000);
    await page.evaluate((t) => window.seekAnimations(t), tSec);
    
    // Let browser render the state
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await new Promise(r => setTimeout(r, 20)); // slight debounce

    const screenshotBuffer = await element.screenshot({ type: 'png' });
    frames.push(Buffer.from(screenshotBuffer).toString('base64'));
  }

  console.log(`[${mode}] Captured ${frames.length} frames. Encoding into animated GIF...`);

  // Save last frame as diagnostic PNG
  if (frames.length > 0) {
    const diagnosticPath = path.join(ROOT, 'output', 'diagnostic_frame.png');
    fs.writeFileSync(diagnosticPath, Buffer.from(frames[frames.length - 1], 'base64'));
    console.log(`[Diagnostic] Saved last frame to: ${diagnosticPath}`);
  }

  // Viewport at scale factor 2 makes element screenshot exactly double size
  const wInt = mode === 'circle' ? 170 : parseInt(photoWidth);
  const hInt = mode === 'circle' ? 170 : parseInt(photoHeight);
  const gifWidth = wInt * 2;
  const gifHeight = hInt * 2;

  const outputDir = slugName ? path.join(__dirname, '../../output', slugName) : OUTPUT_DIR;
  if (slugName) fs.mkdirSync(outputDir, { recursive: true });
  const outputFilename = slugName ? `avatar_${mode}_animated.gif` : `signature_photo_${mode}_animated.gif`;
  const outputPath = path.join(outputDir, outputFilename);

  // ── Primary encoder: gifski ────────────────────────────────────────────
  // gifski uses SSIM-based optimisation (not limited to 256 colours) and
  // produces near-photo quality GIFs. Falls back to gifshot if not installed.
  // Install: brew install gifski
  let gifskiSucceeded = false;
  const tempDir = path.join(OUTPUT_DIR, `.frames_${mode}_${Date.now()}`);

  try {
    const { execSync } = require('child_process');
    // Check gifski is available before writing frames to disk
    execSync('gifski --version', { stdio: 'pipe' });

    // Write captured frames as temporary PNG files
    fs.mkdirSync(tempDir, { recursive: true });
    const framePaths = [];
    for (let i = 0; i < frames.length; i++) {
      const p = path.join(tempDir, `frame-${String(i).padStart(4, '0')}.png`);
      fs.writeFileSync(p, Buffer.from(frames[i], 'base64'));
      framePaths.push(`"${p}"`);
    }

    // Encode with gifski at high quality
    execSync(
      `gifski --fps ${fps} --quality 95 --width ${gifWidth} --height ${gifHeight} -o "${outputPath}" ${framePaths.join(' ')}`,
      { stdio: 'pipe' }
    );
    gifskiSucceeded = true;
    console.log(`[${mode}] ✔ gifski high-quality encoding complete.`);
  } catch (_gifskiErr) {
    if (!_gifskiErr.message.includes('gifski --version')) {
      console.warn(`[${mode}] ⚠ gifski encode failed (${_gifskiErr.message}), falling back to gifshot.`);
    } else {
      console.warn(`[${mode}] ⚠ gifski not found — falling back to gifshot. Install with: brew install gifski`);
    }
  } finally {
    // Always clean up temp frames
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
  // ──────────────────────────────────────────────────────────────────────

  // ── Fallback encoder: gifshot (in-browser) ────────────────────────────
  if (!gifskiSucceeded) {
    try {
      const gifBase64 = await page.evaluate(async (images, fps, width, height) => {
        return new Promise((resolve, reject) => {
          if (typeof gifshot === 'undefined') {
            reject(new Error('gifshot library not loaded in browser context'));
            return;
          }
          gifshot.createGIF({
            images: images.map(img => 'data:image/png;base64,' + img),
            gifWidth: width,
            gifHeight: height,
            interval: 1 / fps,
            numWorkers: 2,
            sampleInterval: 1,
          }, (obj) => {
            if (obj.error) reject(new Error(obj.error));
            else resolve(obj.image);
          });
        });
      }, frames, fps, gifWidth, gifHeight);

      const buffer = Buffer.from(gifBase64.replace(/^data:image\/gif;base64,/, ''), 'base64');
      fs.writeFileSync(outputPath, buffer);

      // Gifsicle optimisation pass (no dithering — dithering adds visible noise dots)
      try {
        const { execSync } = require('child_process');
        execSync(`gifsicle -O3 --colors 256 "${outputPath}" -o "${outputPath}"`, { stdio: 'pipe' });
        console.log(`[${mode}] ✔ gifsicle optimisation pass complete.`);
      } catch (_) {
        console.warn(`[${mode}] ⚠ gifsicle not found — skipping optimisation pass. Run: brew install gifsicle`);
      }
    } catch (err) {
      console.error(`[${mode}] Error generating GIF:`, err.message);
      throw err;
    }
  }
  // ──────────────────────────────────────────────────────────────────────

  try { await page.close(); } catch (_) {}
  console.log(`\x1b[32m✔ Success for ${mode}!\x1b[0m Animated GIF saved to: ${path.relative(ROOT, outputPath)}`);
}

function getChromeExecutablePath() {
  const baseCacheDir = path.join(process.env.HOME || require('os').homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(baseCacheDir)) {
    const versions = fs.readdirSync(baseCacheDir);
    for (const v of versions) {
      const p = path.join(baseCacheDir, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

(async () => {
  console.log(`Starting headless Chrome browser to record [${modesToCapture.join(', ')}] animation(s) in parallel...`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const execPath = getChromeExecutablePath();
  const userDataDir = path.join(OUTPUT_DIR, '.chrome_user_data_' + Date.now());

  const launchOptions = {
    headless: 'new',
    userDataDir: userDataDir,
    args: ['--disable-web-security', '--allow-file-access-from-files']
  };
  if (execPath) {
    console.log(`Using cached Chrome binary at: ${execPath}`);
    launchOptions.executablePath = execPath;
  }

  const browser = await puppeteer.launch(launchOptions);

  // Open the local signature file to verify it exists
  if (!fs.existsSync(SIGNATURE_HTML)) {
    console.error(`Error: Could not find signature source at ${SIGNATURE_HTML}`);
    await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(1);
  }

  try {
    await Promise.all(modesToCapture.map(mode => captureMode(browser, mode)));
    console.log('\x1b[32m✔ All parallel captures completed successfully.\x1b[0m');
  } catch (err) {
    console.error('Error during parallel captures:', err);
  }

  await browser.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
})();
