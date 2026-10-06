const fs = require('fs');
const base = 'c:/Users/manue/Desktop/spiro/pos/node_modules/vite-plugin-pwa/dist/';
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const f of entries) {
    const p = dir + f.name;
    if (f.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(f.name)) {
      const c = fs.readFileSync(p, 'utf8');
      for (const needle of ['register-dev-sw', 'pwa-entry-point-loaded']) {
        const i = c.indexOf(needle);
        if (i >= 0) {
          console.log('== ' + p.replace(base, '') + ' [' + needle + '] @ ' + i + ' ==');
          console.log(c.slice(Math.max(0, i - 600), i + 800));
          console.log('---');
        }
      }
    }
  }
}
walk(base);
