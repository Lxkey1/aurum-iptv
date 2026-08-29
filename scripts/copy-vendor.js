/**
 * Copies the playback engines out of node_modules into src/renderer/vendor so the
 * renderer can load them with a plain <script> tag (no bundler, no node integration).
 * Runs automatically on `npm install`.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'renderer', 'vendor');

/** Each entry lists candidate source files, first one that exists wins. */
const targets = [
  {
    name: 'hls.js',
    out: 'hls.js',
    candidates: [
      'node_modules/hls.js/dist/hls.min.js',
      'node_modules/hls.js/dist/hls.js'
    ]
  },
  {
    name: 'mpegts.js',
    out: 'mpegts.js',
    candidates: [
      'node_modules/mpegts.js/dist/mpegts.min.js',
      'node_modules/mpegts.js/dist/mpegts.js'
    ]
  }
];

fs.mkdirSync(outDir, { recursive: true });

let missing = 0;
for (const target of targets) {
  const found = target.candidates
    .map((rel) => path.join(root, rel))
    .find((abs) => fs.existsSync(abs));

  if (!found) {
    missing += 1;
    console.warn(`[vendor] ${target.name} not found — run "npm install" first.`);
    continue;
  }

  fs.copyFileSync(found, path.join(outDir, target.out));
  const kb = (fs.statSync(found).size / 1024).toFixed(0);
  console.log(`[vendor] ${target.out}  (${kb} KB)`);
}

if (missing) process.exitCode = 0; // never fail the install, the app degrades gracefully
