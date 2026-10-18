/**
 * 浏览器端验证①：用 CDP 注入真实的文件拖拽（真实磁盘文件），
 * 确认「拖文件」这条路不会静默失败。
 *
 * 运行：node tests/browser/dnd-file.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchPage, sleep } from './_cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JA = '【ソフト名】サンプルゲーム 体験版\r\n【起動方法】フォルダ内の sample.exe を実行してください。';
const mojibake = new TextDecoder('gbk').decode(new TextEncoder().encode(JA));
const tmpFile = path.join(ROOT, '.tmp-拖拽文件.txt');
fs.writeFileSync(tmpFile, mojibake, 'utf8');

const page = await launchPage('dist/mojibake-fixer.html');
let ok = false;
try {
  const rect = await page.evaluate(`(() => {
    const r = document.getElementById('drop').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);

  const data = { items: [], files: [tmpFile], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await page.send('Input.dispatchDragEvent', { type, x: rect.x, y: rect.y, data });
    await sleep(250);
  }
  await sleep(1500);

  const state = JSON.parse(await page.evaluate(`JSON.stringify({
    rows: document.querySelectorAll('tr.row').length,
    items: window.MojibakeApp.state.items.map(i => i.name + '|' + i.res.status + '|' + (i.res.chain || []).join('>')),
    dropClass: document.getElementById('drop').className,
    toast: document.getElementById('toast').textContent
  })`));

  console.log('浏览器:', page.browser);
  console.log('结果:', state);
  ok = state.rows === 1 && state.items.length === 1 && state.items[0].includes('repairable') && state.dropClass === 'drop';
  if (page.errors.length) { console.log('页面异常:', page.errors); ok = false; }
} finally {
  page.close();
  fs.rmSync(tmpFile, { force: true });
}

console.log(ok ? '✅ 拖入文件：正常识别' : '❌ 拖入文件：失败');
process.exit(ok ? 0 : 1);
