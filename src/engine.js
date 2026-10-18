/* MojibakeEngine v3 — 乱码检测与还原引擎（零依赖，浏览器 / Node 通用） */
(function (global) {
  'use strict';

  const MULTI = new Set(['shift_jis', 'euc-jp', 'gbk', 'gb18030', 'big5']);
  const WRONG_ENC = ['gbk', 'shift_jis', 'euc-jp', 'big5', 'utf-8', 'windows-1252'];
  const RIGHT_ENC = ['utf-8', 'shift_jis', 'euc-jp', 'gbk', 'big5'];
  const SAMPLE_LIMIT = 3000;

  /* ================= 编码基础 ================= */
  const decCache = new Map();
  function getDecoder(label) {
    let d = decCache.get(label);
    if (!d) { d = new TextDecoder(label, { fatal: true }); decCache.set(label, d); }
    return d;
  }
  function decodeStrict(bytes, label) {
    try { return getDecoder(label).decode(bytes); } catch (e) { return null; }
  }
  const lenCache = new Map();
  function decodeLenient(bytes, label) {
    let d = lenCache.get(label);
    if (!d) { d = new TextDecoder(label, { fatal: false }); lenCache.set(label, d); }
    return d.decode(bytes);
  }

  /* 字符 -> 字节 反向表（用解码器枚举生成，免第三方依赖） */
  const tableCache = new Map();
  function buildTable(label) {
    const t = new Map();
    const d = getDecoder(label);
    const one = (arr) => {
      try {
        const s = d.decode(Uint8Array.from(arr));
        if (s.length === 1 && s !== '\uFFFD') return s;
      } catch (e) { }
      return null;
    };
    for (let b = 0; b < 256; b++) {
      if (label === 'utf-8' && b >= 0x80) continue;
      const s = one([b]);
      if (s && !t.has(s)) t.set(s, [b]);
    }
    if (MULTI.has(label)) {
      for (let lead = 0x81; lead <= 0xFE; lead++)
        for (let trail = 0x40; trail <= 0xFE; trail++) {
          const s = one([lead, trail]);
          if (s && !t.has(s)) t.set(s, [lead, trail]);
        }
    }
    return t;
  }
  function getTable(label) {
    if (!tableCache.has(label)) tableCache.set(label, buildTable(label));
    return tableCache.get(label);
  }

  function encodeSegments(str, label) {
    if (label === 'utf-8') return { parts: [{ bytes: new TextEncoder().encode(str) }], missing: 0 };
    const t = getTable(label);
    const parts = [];
    let buf = [], missing = 0;
    for (const ch of str) {
      const b = t.get(ch);
      if (!b) {
        if (buf.length) { parts.push({ bytes: Uint8Array.from(buf) }); buf = []; }
        parts.push({ ch, missing: true });
        missing++;
      } else for (const x of b) buf.push(x);
    }
    if (buf.length) parts.push({ bytes: Uint8Array.from(buf) });
    return { parts, missing };
  }

  function decodeSegments(parts, label) {
    let out = '';
    for (const p of parts) out += p.missing ? p.ch : decodeLenient(p.bytes, label);
    return out;
  }

  function concat(parts) {
    let len = 0;
    for (const p of parts) if (p.bytes) len += p.bytes.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) if (p.bytes) { out.set(p.bytes, o); o += p.bytes.length; }
    return out;
  }

  /* ================= 常用字频模型（离线生成，无需语料） =================
     GB2312 一级汉字(3755) + JIS X 0208 第一水准汉字(2965) = 中日文高频字近似集合。
     乱码产生的汉字大多落在这两套常用字库之外，可用于区分“真文本”与“乱码垃圾”。 */
  let commonSet = null;
  function getCommon() {
    if (commonSet) return commonSet;
    const s = new Set();
    const push = (dec, a, b) => {
      try {
        const t = dec.decode(Uint8Array.from([a, b]));
        if (t.length === 1) s.add(t);
      } catch (e) { }
    };
    const gbk = getDecoder('gbk'), sjis = getDecoder('shift_jis');
    for (let lead = 0xB0; lead <= 0xD7; lead++)
      for (let trail = 0xA1; trail <= 0xFE; trail++) push(gbk, lead, trail);
    for (let lead = 0x88; lead <= 0x98; lead++)
      for (let trail = 0x9F; trail <= 0xFC; trail++) push(sjis, lead, trail);
    commonSet = s;
    return commonSet;
  }

  /* ================= 打分 ================= */
  function stats(text) {
    const common = getCommon();
    let base = 0, n = 0, kana = 0, cjk = 0, bad = 0, halfwidth = 0, latin = 0, lossy = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0); n++;
      if (cp === 0xFFFD) { lossy++; bad++; continue; }
      if (cp === 9 || cp === 10 || cp === 13) { base += 1; continue; }
      if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) { base -= 8; bad++; continue; }
      if (cp >= 0x3041 && cp <= 0x309F) { base += 8; kana++; continue; }
      if (cp >= 0x30A0 && cp <= 0x30FF) { base += 6; kana++; continue; }
      if (cp >= 0xFF66 && cp <= 0xFF9F) { base -= 5; halfwidth++; bad++; continue; }
      if (cp >= 0x3400 && cp <= 0x9FFF) {
        cjk++;
        if (common.has(ch)) { base += 4; }
        else { base += 0.2; bad += 0.5; }   // 非常用汉字：乱码高发区
        continue;
      }
      if (cp >= 0xF900 && cp <= 0xFAFF) { base += 0.2; cjk++; continue; }
      if (cp === 0x3000 || (cp >= 0x3001 && cp <= 0x303F) || (cp >= 0xFF01 && cp <= 0xFF60) ||
          (cp >= 0xFFE0 && cp <= 0xFFE6)) { base += 2; continue; }
      if (cp >= 0x20 && cp < 0x7F) { base += 1; continue; }
      if (cp >= 0xE000 && cp <= 0xF8FF) { base -= 8; bad++; continue; }
      if (cp >= 0xC0 && cp <= 0xFF) { base -= 1.5; latin++; continue; }
      if (cp >= 0xA0 && cp <= 0xBF) { base -= 0.5; latin++; continue; }
      if (cp >= 0x2000 && cp <= 0x206F) { base += 1; continue; }
      if (cp >= 0x2E80 && cp <= 0x2FDF) { base += 2; cjk++; continue; }
      base += 0.2;
    }
    return { base, n, kana, cjk, bad, halfwidth, latin, lossy };
  }

  /* 假名统计：真日文里假名总是成串出现，乱码产生的假名则一个个孤立地散在汉字中间 */
  function kanaStats(text) {
    let kana = 0, iso = 0;
    const isK = (c) => (c >= 0x3041 && c <= 0x309F) || (c >= 0x30A0 && c <= 0x30FF);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (!isK(c)) continue;
      kana++;
      const p = i > 0 ? text.charCodeAt(i - 1) : -1;
      const n = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (!isK(p) && !isK(n)) iso++;
    }
    return { kana, iso };
  }

  function score(text) {
    if (!text) return -1e6;
    const s = stats(text);
    if (!s.n) return -1e6;
    const k = kanaStats(text);
    let v = s.base / s.n;
    if (k.kana / s.n > 0.02) v += 1.4;          // 有假名 = 日文特征
    if (k.kana >= 4) v -= 1.2 * (k.iso / k.kana); // 假名全部孤立的几乎肯定是乱码
    v -= (s.lossy / s.n) * 3;                   // 丢字（权重不能太重，否则会为了“不丢字”而选垃圾结果）
    v -= (s.halfwidth / s.n) * 6;               // 半角片假名噪音
    return v;
  }

  /* 是否仍是“中间态”：把它当作某个错误编码写回，字节又能按 UTF-8 读通 */
  function stillMojibake(text) {
    for (const w of ['gbk', 'shift_jis', 'big5', 'windows-1252']) {
      const seg = encodeSegments(text, w);
      if (seg.missing) continue;
      const bytes = concat(seg.parts);
      if (bytes.length < 8) continue;
      if (decodeStrict(bytes, 'utf-8') !== null) return 1;
      const loose = decodeLenient(bytes, 'utf-8');
      if (loose !== text) {
        let bad = 0, n = 0;
        for (const ch of loose) { n++; if (ch === '\uFFFD') bad++; }
        if (n && bad / n < 0.05) return 1;
      }
    }
    return 0;
  }

  /* ================= 单步 / 链路 ================= */
  function applyStep(text, w, t) {
    const seg = encodeSegments(text, w);
    const out = decodeSegments(seg.parts, t);
    return (!out || out === text) ? null : out;
  }
  const stepCache = new Map();
  function cachedStep(text, w, t) {
    const key = w + '|' + t + '|' + text.length + '|' + text.slice(0, 24);
    let m = stepCache.get(key);
    if (!m) { m = new Map(); stepCache.set(key, m); }
    if (m.has(text)) return m.get(text);
    const v = applyStep(text, w, t);
    m.set(text, v);
    if (stepCache.size > 200) stepCache.delete(stepCache.keys().next().value);
    return v;
  }

  function chainScore(text, depth) {
    return score(text) - 1.1 * (depth - 1) - 2.2 * stillMojibake(text);
  }

  function sampleText(text, limit) {
    limit = limit || SAMPLE_LIMIT;
    if (text.length <= limit) return text;
    const head = text.slice(0, limit - Math.floor(limit * 0.27));
    const mid = text.slice((text.length >> 1), (text.length >> 1) + Math.floor(limit * 0.27));
    return head + '\n' + mid;
  }

  function evalDepth1(work) {
    const out = [];
    for (const w of WRONG_ENC) for (const t of RIGHT_ENC) {
      if (w === t) continue;
      const nt = cachedStep(work, w, t);
      if (!nt) continue;
      out.push({ work: nt, steps: [[w, t]], endEnc: t, depth: 1, score: chainScore(nt, 1) });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /* 搜索最优还原链：深度 1 用长样本，深度 2 用小样本穷举 */
  function searchChain(text, maxDepth) {
    maxDepth = maxDepth || 2;
    const w1 = sampleText(text, 2500);
    const lvl1 = evalDepth1(w1);
    let best = lvl1[0] || null;
    if (maxDepth >= 2) {
      const w2 = sampleText(text, 700);
      for (const n1 of evalDepth1(w2)) {
        for (const w of WRONG_ENC) for (const t of RIGHT_ENC) {
          if (w === t) continue;
          const nt = cachedStep(n1.work, w, t);
          if (!nt) continue;
          const sc = chainScore(nt, 2);
          if (!best || sc > best.score)
            best = { work: nt, steps: n1.steps.concat([[w, t]]), endEnc: t, depth: 2, score: sc };
        }
      }
    }
    return { best, base: score(w1), work: w1 };
  }

  function repairText(text, maxDepth) {
    const { best, base } = searchChain(text, maxDepth);
    if (best && best.score > base + 0.4) {
      let out = text;
      for (const [w, t] of best.steps) out = applyStep(out, w, t) || out;
      return {
        text: out, changed: true, score: best.score, encoding: best.endEnc,
        chain: best.steps.map(s => s[0] + ' → ' + s[1]),
        candidates: listCandidates(text)
      };
    }
    return { text, changed: false, score: base, encoding: null, chain: [], candidates: listCandidates(text) };
  }

  function listCandidates(text) {
    const work = sampleText(text, 2500);
    const out = [];
    for (const w of WRONG_ENC) for (const t of RIGHT_ENC) {
      if (w === t) continue;
      const nt = cachedStep(work, w, t);
      if (!nt) continue;
      out.push({ sample: nt, chain: w + ' → ' + t, steps: [[w, t]], right: t, depth: 1, score: chainScore(nt, 1) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 6);
  }

  /* 用指定链路还原（供手动选择） */
  function applySteps(text, steps) {
    let out = text;
    for (const [w, t] of steps) out = applyStep(out, w, t) || out;
    return out;
  }

  /* ================= 文件层 ================= */
  const TRY_ENC = ['shift_jis', 'euc-jp', 'gbk', 'big5', 'windows-1252'];

  function looksBinary(bytes) {
    const lim = Math.min(bytes.length, 8192);
    let zeros = 0, ctrl = 0;
    for (let i = 0; i < lim; i++) { if (bytes[i] === 0) zeros++; else if (bytes[i] < 7) ctrl++; }
    return lim ? (zeros / lim > 0.05 || ctrl / lim > 0.05) : false;
  }

  function decodeFile(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      const s = decodeStrict(bytes.subarray(3), 'utf-8');
      if (s !== null) return { text: s, encoding: 'utf-8', bom: true, confident: true };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      const s = decodeStrict(bytes.subarray(2), 'utf-16le');
      if (s !== null) return { text: s, encoding: 'utf-16le', bom: true, confident: true };
    }
    const u = decodeStrict(bytes, 'utf-8');
    if (u !== null) return { text: u, encoding: 'utf-8', bom: false, confident: true };

    let best = null;
    for (const enc of TRY_ENC) {
      const d = decodeStrict(bytes, enc);
      if (d === null) continue;
      const sc = score(d);
      if (!best || sc > best.score) best = { text: d, encoding: enc, bom: false, confident: true, score: sc };
    }
    if (best) return best;
    return { text: decodeLenient(bytes, 'utf-8'), encoding: 'utf-8', bom: false, confident: false, lossyDecode: true };
  }

  function labelOf(e) {
    return ({ 'utf-8': 'UTF-8', 'shift_jis': 'Shift_JIS', 'euc-jp': 'EUC-JP', 'gbk': 'GBK',
      'big5': 'Big5', 'windows-1252': 'Windows-1252', 'utf-16le': 'UTF-16LE' })[e] || e;
  }

  /* 统计 U+FFFD：这些字符在当初的转码事故里就已经丢了，任何工具都恢复不了 */
  function countLost(text) {
    let n = 0;
    for (const ch of text) if (ch === '\uFFFD') n++;
    return n;
  }

  function analyzeBytes(bytes) {
    const meta = { size: bytes.length };
    if (looksBinary(bytes)) return Object.assign({ status: 'binary', reason: '二进制文件，已跳过', text: '', fixedText: '', lostChars: 0 }, meta);
    const dec = decodeFile(bytes);
    const rep = repairText(dec.text);
    return Object.assign({
      lostChars: countLost(rep.text),
      status: rep.changed ? 'repairable' : 'ok',
      originalEncoding: dec.encoding,
      text: dec.text,
      fixedText: rep.text,
      fixedEncoding: (rep.changed && rep.encoding) ? rep.encoding : dec.encoding,
      chain: rep.chain,
      candidates: rep.candidates,
      scoreOriginal: score(dec.text),
      scoreFixed: rep.score,
      lossyDecode: !!dec.lossyDecode,
      reason: rep.changed
        ? ('编码错认：' + rep.chain.join(' → ') + '，已还原')
        : ('按 ' + labelOf(dec.encoding) + ' 读取即为正确文本')
    }, meta);
  }

  function encodeFile(text, encoding, withBom) {
    if (encoding === 'utf-16le') {
      const b = new Uint8Array(2 + text.length * 2);
      b[0] = 0xFF; b[1] = 0xFE;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        b[2 + i * 2] = c & 255; b[3 + i * 2] = c >> 8;
      }
      return b;
    }
    if (encoding === 'utf-8') {
      const body = new TextEncoder().encode(text);
      if (!withBom) return body;
      const out = new Uint8Array(body.length + 3);
      out.set([0xEF, 0xBB, 0xBF], 0); out.set(body, 3);
      return out;
    }
    const seg = encodeSegments(text, encoding);
    return concat(seg.parts);
  }

  const api = {
    score, repairText, listCandidates, applySteps, analyzeBytes, decodeFile, encodeFile,
    looksBinary, labelOf, countLost, ENCODINGS: RIGHT_ENC,
    _internal: { stats, stillMojibake, applyStep, getTable, buildTable, searchChain }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MojibakeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
