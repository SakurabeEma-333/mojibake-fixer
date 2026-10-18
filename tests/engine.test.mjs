/**
 * 引擎回归测试（零依赖，Node 18+）
 * 运行：node tests/engine.test.mjs
 */
await import('../src/engine.js');
const E = globalThis.MojibakeEngine;

const utf8 = (s) => new TextEncoder().encode(s);
const gbkMoj = (s) => new TextDecoder('gbk').decode(utf8(s));          // UTF-8 被按 GBK 读
const sjisMoj = (s) => new TextDecoder('shift_jis').decode(utf8(s));   // UTF-8 被按 SJIS 读
const asGbkOfSjis = (s) => new TextDecoder('gbk').decode(E.encodeFile(s, 'shift_jis'));

const JA = '【ソフト名】サンプルゲーム 体験版\r\n' +
  '【動作環境】Windows 10 / 11\r\n' +
  '【起動方法】フォルダ内の sample.exe を実行してください。';
const ZH = '你好，这是一个中文测试文件，用来验证编码还原是否正确。';

let pass = 0, total = 0;
const failures = [];

function check(name, bytes, expect) {
  total++;
  const t0 = Date.now();
  const r = E.analyzeBytes(new Uint8Array(bytes));
  const ms = Date.now() - t0;
  const ok = expect(r);
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? '✅' : '❌'} ${name}  (${ms}ms)`);
  console.log(`   status=${r.status} ${r.originalEncoding} → ${r.fixedEncoding} chain=${JSON.stringify(r.chain)}`);
  console.log(`   text=${JSON.stringify((r.fixedText || '').slice(0, 56))}`);
  return r;
}

/* ---------- 应被还原的 ---------- */
check('日文 UTF-8 被按 GBK 误读后另存为 UTF-8', utf8(gbkMoj(JA)), (r) =>
  r.status === 'repairable' && r.fixedText.includes('サンプルゲーム') && r.chain.join('').includes('gbk'));

check('Shift_JIS 日文被按 GBK 误读后另存为 UTF-8', utf8(asGbkOfSjis(JA)), (r) =>
  r.fixedText.includes('サンプルゲーム 体験版'));

check('中文 UTF-8 被按 GBK 误读后另存为 UTF-8', utf8(gbkMoj(ZH)), (r) =>
  r.fixedText.includes('你好，这是一个中文测试文件'));

check('日文 UTF-8 被按 Shift_JIS 误读（字节部分丢失）', utf8(sjisMoj(JA)), (r) =>
  r.fixedText.includes('サンプル'));

check('双层坏死：SJIS→GBK 误读→再被 GBK 误读', utf8(gbkMoj(asGbkOfSjis(JA))), (r) =>
  r.fixedText.includes('サンプル') && r.chain.length === 2);

check('误读结果又存成了 GBK（少见）', E.encodeFile(gbkMoj(JA), 'gbk'), (r) =>
  r.fixedText.includes('サンプル'));

/* ---------- 不该被动的高级情况 ---------- */
check('真正的 Shift_JIS 文件：内容没坏，只需换编码', E.encodeFile(JA, 'shift_jis'), (r) =>
  r.status === 'ok' && r.originalEncoding === 'shift_jis' && r.fixedText.includes('サンプル'));

check('正常 UTF-8 中文：必须原样不动', utf8(ZH), (r) =>
  r.status === 'ok' && r.fixedText === ZH);

check('正常 UTF-8 日文：必须原样不动', utf8(JA), (r) =>
  r.status === 'ok' && r.fixedText === JA);

check('正常 GBK 中文文件：不改内容', E.encodeFile(ZH, 'gbk'), (r) =>
  r.fixedText === ZH);

check('带 BOM 的 UTF-8：不动，且去掉 BOM 后内容一致', new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8(ZH)]), (r) =>
  r.status === 'ok' && r.fixedText === ZH);

check('纯 ASCII：不动', utf8('Hello world, plain readme.'), (r) =>
  r.status === 'ok' && r.fixedText === 'Hello world, plain readme.');

check('空文件：不崩、不报错', new Uint8Array(0), (r) =>
  r.status !== 'repairable');

/* ---------- 不该被碰的二进制 ---------- */
check('PNG 二进制：识别为二进制并跳过', new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D]), (r) =>
  r.status === 'binary');

/* ---------- 丢字计数（UI 用它区分「字体缺字」与「真丢字」） ---------- */
check('丢字计数：无损往返时为 0（Shift_JIS→GBK）', utf8(asGbkOfSjis(JA)), (r) =>
  r.status === 'repairable' && r.lostChars === 0);

check('丢字计数：真丢字时应大于 0（UTF-8→Shift_JIS）', utf8(sjisMoj(JA)), (r) =>
  r.lostChars > 0);

check('丢字计数：正常文件恒为 0', utf8(ZH), (r) =>
  r.status === 'ok' && r.lostChars === 0);

check('countLost 只数 U+FFFD', new Uint8Array([0x41, 0xEF, 0xBF, 0xBD, 0x42]), () =>
  E.countLost('A\uFFFDB') === 1 && E.countLost('正常文本') === 0);

/* ---------- 编码互转 ---------- */
{
  total++;
  const bytes = E.encodeFile(JA, 'shift_jis');
  const back = E.decodeFile(new Uint8Array(bytes));
  const ok = back.encoding === 'shift_jis' && back.text === JA;
  if (ok) pass++; else failures.push('Shift_JIS 编码/解码往返');
  console.log(`${ok ? '✅' : '❌'} Shift_JIS 编码/解码往返`);
}

console.log(`\n${pass}/${total} 通过`);
if (failures.length) {
  console.log('失败用例：\n - ' + failures.join('\n - '));
  process.exit(1);
}
