const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Support large base64 image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Resolve virtualenv python or default to system python
const ROOT = path.resolve(__dirname, '..');
const pyPath = fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python3'))
  ? '.venv/bin/python3'
  : (fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python')) ? '.venv/bin/python' : 'python3');

// Helper to run shell commands as promises
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    console.log(`[EXEC] Running: ${cmd}`);
    exec(cmd, { cwd: ROOT }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[EXEC ERROR] Command failed: ${cmd}\nMessage: ${error.message}\nStderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      resolve(stdout);
    });
  });
}

// Slugify employee name for folder/file namespace isolation
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')           // Replace spaces with _
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '_');        // Replace multiple - or _ with single _
}

// Serve builder.html as the primary landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'src', 'ui', 'builder.html'));
});

// Serve generated build artifacts (per-run GIFs, compiled signature HTML)
app.use(express.static(path.join(ROOT, 'output')));

// Signature generation endpoint
app.post('/api/signature', async (req, res) => {
  const {
    employeeName,
    animationMode,
    profileImage,
    logoImage,
    logoUrl,
    title,
    company,
    email,
    phone,
    website,
    linkedin,
    address
  } = req.body;

  if (!employeeName) {
    return res.status(400).json({ error: 'Missing required field: employeeName' });
  }

  const slugName = slugify(employeeName);
  const selectedMode = ['circle', 'para', 'strips'].includes(animationMode) ? animationMode : 'circle';

  console.log(`\n--- Processing Signature for: ${employeeName} (slug: ${slugName}, mode: ${selectedMode}) ---`);

  try {
    // 1. Stage the base64 profile photo into isolated staging directory
    const stagingDir = path.join(ROOT, 'src', 'assets', 'staging', slugName);
    fs.mkdirSync(stagingDir, { recursive: true });
    
    const profilePath = path.join(stagingDir, 'profile.png');
    if (profileImage) {
      console.log(`[STEP 1/5] Staging base64 profile image to: ${profilePath}`);
      const matches = profileImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      const buffer = matches && matches.length === 3
        ? Buffer.from(matches[2], 'base64')
        : Buffer.from(profileImage, 'base64');
      fs.writeFileSync(profilePath, buffer);
    } else {
      console.log(`[STEP 1/5] No profile image uploaded. Using fallback.`);
    }

    // 1b. Stage the base64 logo upload (if provided) into the same staging directory
    const logoPath = path.join(stagingDir, 'logo.png');
    if (logoImage) {
      console.log(`[STEP 1/5] Staging base64 logo image to: ${logoPath}`);
      const logoMatches = logoImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      const logoBuffer = logoMatches && logoMatches.length === 3
        ? Buffer.from(logoMatches[2], 'base64')
        : Buffer.from(logoImage, 'base64');
      fs.writeFileSync(logoPath, logoBuffer);
    } else if (fs.existsSync(logoPath)) {
      fs.unlinkSync(logoPath); // no logo this run — don't re-upload a stale one
    }

    // 2. Update config.json temporarily with the employee data
    console.log(`[STEP 2/5] Updating config.json with details for ${slugName}`);
    const configPath = path.join(ROOT, 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // Deep merge/update values
    config.person = config.person || {};
    config.person.name = employeeName;
    config.person.title = title || '';
    config.person.company = company || 'Your Company Ltd';
    config.person.email = email || '';
    config.person.phone = phone || '';
    config.person.website = website || 'www.example.com';
    config.person.address = address || '';
    config.person.slug = slugName;

    config.social = config.social || {};
    config.social.linkedin = linkedin || '';

    config.photo_style = selectedMode;
    config.assets = config.assets || {};
    config.assets.profile_photo = `src/assets/staging/${slugName}/profile.png`;
    // Manual pasted URL wins immediately; an uploaded logo file gets its
    // Cloudinary URL filled in by cloudinary_upload.py in step 4 below.
    config.assets.logo_url = logoImage ? '' : (logoUrl || '');

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    // 3. Run Puppeteer GIF generator for target mode and isolated slug output
    console.log(`[STEP 3/5] Launching Puppeteer capturing avatar in mode: ${selectedMode}`);
    await runCommand(`node src/generator/generate_gif.js ${selectedMode} ${slugName}`);

    // 4. Run Cloudinary Asset Sync engine with employee slug namespace
    console.log(`[STEP 4/5] Syncing and uploading assets to Cloudinary...`);
    await runCommand(`${pyPath} src/generator/cloudinary_upload.py ${slugName}`);

    // 5. Build final HTML signature using the updated config
    console.log(`[STEP 5/5] Re-compiling email-safe HTML signature table...`);
    await runCommand(`${pyPath} src/generator/signature_builder.py`);

    // Read the compiled raw HTML signature
    const signatureHtmlPath = path.join(ROOT, 'output', 'signature_raw.html');
    if (!fs.existsSync(signatureHtmlPath)) {
      throw new Error(`Output signature file not found at ${signatureHtmlPath}`);
    }
    const htmlOutput = fs.readFileSync(signatureHtmlPath, 'utf8');

    console.log(`✅ Flow completed successfully for: ${slugName}\n`);
    res.json({
      success: true,
      slugName,
      html: htmlOutput
    });

  } catch (error) {
    console.error(`❌ Flow failed for employee ${employeeName}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`🚀 Signature Builder Automation Server running on http://localhost:${PORT}`);
});
