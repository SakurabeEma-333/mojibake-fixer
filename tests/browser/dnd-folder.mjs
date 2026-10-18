/**
 * 浏览器端验证②：目录拖拽。
 *
 * 说明：CDP 注入的拖拽没有真实文件 URI，因此目录的 readEntries() 一定会失败，
 * 无法用它验证真实文件夹。这里改用「mock 目录条目」直接喂给页面的 drop 处理，
 * 专门验证递归逻辑：嵌套目录、分批读取（每次只返回 1 条）、深度限制。
 *
 * 运行：node tests/browser/dnd-folder.mjs
 *      node tests/browser/dnd-folder.mjs --shot docs/screenshot.png  （顺便出图）
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { launchPage, sleep } from './_cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shotIdx = process.argv.indexOf('--shot');
const shotPath = shotIdx > -1 ? process.argv[shotIdx + 1] : null;

const SCRIPT = `
(async () => {
  const E = window.MojibakeEngine;
  const u8 = s => new TextEncoder().encode(s);
  const ja = '【ソフト名】サンプルゲーム 体験版\\r\\n【動作環境】Windows 10 / 11\\r\\n\\r\\n■■■このファイルについて\\r\\nこれは文字化けの見本です。お手に取っていただきありがとうございます。';
  const moji = new TextDecoder('gbk').decode(E.encodeFile(ja, 'shift_jis')); // Shift_JIS 被按 GBK 误读（无损）
  const lossy = moji.slice(0, 150) + '\uFFFD' + moji.slice(150);   // 模拟“个别字节已丢失”的残缺文件

  function fileEntry(name, text) {
    return { isFile: true, isDirectory: false, name,
      file: (ok) => setTimeout(() => ok(new File([u8(text)], name)), 0) };
  }
  function dirEntry(name, children) {
    const kids = Object.keys(children).map(k =>
      typeof children[k] === 'string' ? fileEntry(k, children[k]) : dirEntry(k, children[k]));
    let served = 0;
    return { isFile: false, isDirectory: true, name,
      createReader: () => ({
        // 故意每次只返回 1 条，验证分批读取循环
        readEntries: (ok) => setTimeout(() => {
          const batch = kids.slice(served, served + 1);
          served += 1;
          ok(batch);
        }, 0)
      }) };
  }

  const root = dirEntry('示例文件夹', {
    'readme_乱码.txt': moji,
    'lossy_丢字.txt': lossy,
    'normal.txt': '正常的中文内容，不应该被改动。',
    'inner': { 'deep_乱码.txt': moji, 'deeper': { 'x_乱码.txt': moji } }
  });

  const dt = { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => root }], types: ['Files'] };
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  document.dispatchEvent(ev);

  await new Promise(r => setTimeout(r, 2500));
  return JSON.stringify({
    items: window.MojibakeApp.state.items.map(i => i.name + '|' + i.res.status + '|' + (i.res.chain || []).join('>')),
    diag: document.getElementById('diag').textContent
  });
})()
`;

const page = await launchPage('dist/mojibake-fixer.html');
let ok = false;
try {
  const out = JSON.parse(await page.evaluate(SCRIPT));
  console.log('浏览器:', page.browser);
  console.log('识别到:', out.items);
  console.log('\n诊断日志:\n' + out.diag);

  const names = out.items.map((s) => s.split('|')[0]);
  const expected = ['readme_乱码.txt', 'lossy_丢字.txt', 'normal.txt', 'deep_乱码.txt', 'x_乱码.txt'];
  ok = expected.every((n) => names.includes(n)) && out.items.filter((s) => s.includes('repairable')).length === 4;
  if (page.errors.length) { console.log('页面异常:', page.errors); ok = false; }

  if (shotPath) {
    await page.evaluate(`(() => {
      document.getElementById('diag').hidden = true;
      const items = window.MojibakeApp.state.items;
      const target = items.find(i => i.name.indexOf('lossy') >= 0) || items[0];
      target.open = true;
      window.MojibakeApp.render();
      return 1;
    })()`);
    await sleep(400);
    await page.screenshot(shotPath);
    console.log('截图已保存:', shotPath);
  }
} finally {
  page.close();
}

console.log(ok ? '✅ 拖入文件夹：递归正确（含嵌套与分批）' : '❌ 拖入文件夹：失败');
process.exit(ok ? 0 : 1);
