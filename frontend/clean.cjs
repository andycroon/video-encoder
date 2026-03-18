const fs = require('fs');
const path = require('path');
const viteCache = path.join(__dirname, 'node_modules', '.vite');
try { fs.rmSync(viteCache, { recursive: true, force: true }); } catch (e) {}
console.log('Vite cache cleared.');
