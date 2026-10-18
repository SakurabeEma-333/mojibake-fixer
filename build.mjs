import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const html = read('src/app.template.html')
  .replace('/*__ENGINE__*/', () => read('src/engine.js'))
  .replace('/*__ZIP__*/', () => read('src/zip.js'))
  .replace('/*__APP__*/', () => read('src/app.js'));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const target = path.join(ROOT, 'dist', 'mojibake-fixer.html');
fs.writeFileSync(target, html);
console.log('built dist/mojibake-fixer.html', html.length, 'chars');
