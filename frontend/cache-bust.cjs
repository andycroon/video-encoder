const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'dist', 'index.html');
const v = Date.now();
let h = fs.readFileSync(p, 'utf8');
h = h.replace(/(assets\/[^"']+\.(js|css))/g, `$1?v=${v}`);
fs.writeFileSync(p, h);
console.log(`Cache-bust applied: v=${v}`);
