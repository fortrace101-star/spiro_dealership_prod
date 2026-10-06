const fs = require('fs');
const base = 'c:/Users/manue/Desktop/spiro/pos/node_modules/vite-plugin-pwa/dist/';
const candidates = ['index.js', 'index.mjs', 'chunks/index.js'];
let found = false;
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const f of entries) {
    const p = dir + f.name;
    if (f.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(f.name)) {
      const c = fs.readFileSync(p, 'utf8');
      const i = c.indexOf('rel="manifest"');
      if (i >= 0) {
        console.log('== ' + p.replace(base, '') + ' @ ' + i + ' ==');
        console.log(c.slice(Math.max(0, i - 900), i + 400));
        found = true;
      }
    }
  }
}
walk(base);
if (!found) console.log('no rel=manifest injection found in dist');
