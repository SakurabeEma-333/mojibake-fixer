/* 乱码一键恢复 · 应用逻辑 */
(function () {
  'use strict';
  var E = window.MojibakeEngine;
  var state = { items: [], seq: 0, filter: null };
  var MAX_SIZE = 20 * 1024 * 1024;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function stamp() {
    var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* ---------- 状态 ---------- */
  function statusOf(res) {
    if (res.status === 'binary') return { cls: 'skip', label: '二进制跳过' };
    if (res.status === 'unknown') return { cls: 'warn', label: '无法识别' };
    if (res.status === 'repairable') return { cls: 'fix', label: '需还原' };
    if (res.originalEncoding !== 'utf-8') return { cls: 'conv', label: '可转 UTF-8' };
    return { cls: 'ok', label: '正常' };
  }
  function defaultSteps(res) {
    if (!res.chain || !res.chain.length) return null;
    return res.chain.map(function (s) { return s.split(' → '); });
  }
  function currentText(item) {
    if (item.steps && item.steps.length) {
      var t = E.applySteps(item.res.text, item.steps);
      if (t) return t;
    }
    return item.res.text || '';
  }
  function outName(item) {
    var n = item.name || 'file.txt';
    var i = n.lastIndexOf('.');
    var base = i > 0 ? n.slice(0, i) : n;
    var ext = i > 0 ? n.slice(i) : '';
    return base + '_fixed' + ext;
  }
  function outputBytes(item, forKeep) {
    var text = currentText(item);
    var enc = 'utf-8';
    if (forKeep) enc = item.res.fixedEncoding || item.res.originalEncoding || 'utf-8';
    if (enc === 'utf-8') return E.encodeFile(text, 'utf-8', $('#optBom').checked);
    return E.encodeFile(text, enc, false);
  }

  /* ---------- 载入 ---------- */
  function addFiles(list) {
    var tasks = [];
    diag('addFiles: 收到 ' + (list ? list.length : 0) + ' 个文件');
    Array.prototype.forEach.call(list, function (f) {
      if (!f) return;
      if (f.size > MAX_SIZE) { toast('跳过过大的文件：' + f.name, 'warn'); return; }
      tasks.push(f.arrayBuffer().then(function (ab) {
        var bytes = new Uint8Array(ab);
        var res;
        try { res = E.analyzeBytes(bytes); }
        catch (e) { res = { status: 'unknown', reason: '分析失败：' + e.message, text: '', fixedText: '', originalEncoding: '?', size: bytes.length }; }
        var keepDefault = res.status === 'repairable' || (res.status === 'ok' && res.originalEncoding !== 'utf-8');
        state.items.push({
          id: ++state.seq,
          name: f.name,
          size: f.size,
          res: res,
          steps: defaultSteps(res),
          enabled: keepDefault,
          open: false
        });
      }));
    });
    return Promise.all(tasks).then(render);
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var wrap = $('#listWrap');
    var q = ($('#search').value || '').trim().toLowerCase();
    var items = state.items.filter(function (i) { return !q || i.name.toLowerCase().indexOf(q) >= 0; });

    if (!state.items.length) { wrap.hidden = true; $('#empty').hidden = false; return; }
    wrap.hidden = false; $('#empty').hidden = true;

    var counts = { fix: 0, conv: 0, ok: 0, skip: 0, warn: 0 };
    state.items.forEach(function (i) { counts[statusOf(i.res).cls]++; });
    $('#summary').innerHTML =
      '共 <b>' + state.items.length + '</b> 个文件：' +
      '<span class="dot fix"></span>需还原 ' + counts.fix +
      ' <span class="dot conv"></span>可转码 ' + counts.conv +
      ' <span class="dot ok"></span>正常 ' + counts.ok +
      (counts.skip ? ' <span class="dot skip"></span>跳过 ' + counts.skip : '');

    var html = '';
    items.forEach(function (item) {
      var st = statusOf(item.res);
      var chainHtml;
      if (item.steps && item.steps.length) {
        chainHtml = item.steps.map(function (s) {
          return '<span class="enc">' + esc(E.labelOf(s[0])) + '</span><span class="arrow">→</span>' +
                 '<span class="enc to">' + esc(E.labelOf(s[1])) + '</span>';
        }).join('<span class="sep">·</span>');
      } else {
        chainHtml = '<span class="enc">' + esc(E.labelOf(item.res.originalEncoding || '?')) + '</span>';
      }
      html += '<tr class="row ' + (item.enabled ? '' : 'off') + '" data-id="' + item.id + '">' +
        '<td class="c-sel"><input type="checkbox" class="sel"' + (item.enabled ? ' checked' : '') + '></td>' +
        '<td class="c-name"><div class="fname" title="' + esc(item.name) + '">' + esc(item.name) + '</div>' +
        '<div class="meta">' + fmtSize(item.size) +
        (item.res.lostChars ? ' · <span class="lostmini">含 ' + item.res.lostChars + ' 个已丢失字符</span>' : '') +
        '</div></td>' +
        '<td class="c-st"><span class="badge ' + st.cls + '">' + st.label + '</span></td>' +
        '<td class="c-chain">' + chainHtml + '</td>' +
        '<td class="c-act">' +
        '<button class="ghost view" title="预览">' + (item.open ? '收起' : '预览') + '</button>' +
        '<button class="ghost dl" title="下载这个文件">下载</button>' +
        '</td></tr>';

      if (item.open) {
        var fixed = currentText(item);
        var cands = item.res.candidates || [];
        var opts = '<option value="-1"' + (!item.steps ? ' selected' : '') + '>不还原（保持原样）</option>';
        cands.forEach(function (c, idx) {
          var sel = item.steps && item.steps.length && c.chain === item.steps.map(function (s) { return s[0] + ' → ' + s[1]; }).join(' → ');
          opts += '<option value="' + idx + '"' + (sel ? ' selected' : '') + '>' + esc(c.chain.replace(' → ', ' → ')) + '（可信度 ' + c.score.toFixed(1) + '）</option>';
        });
        html += '<tr class="detail" data-id="' + item.id + '"><td colspan="5"><div class="detail-inner">' +
          '<div class="reason">' + esc(item.res.reason || '') + '</div>' +
          '<div class="pane"><div class="pane-h">' + (item.steps && item.steps.length ? '现在的内容（乱码）' : '现在的内容') + '</div><pre>' + esc((item.res.text || '').slice(0, 700)) + '</pre></div>' +
          (item.res.lostChars ? '<div class="lost">⚠ 本文件有 <b>' + item.res.lostChars + '</b> 个字符在当初转码时就已经丢了（在下方显示为 <b>�</b>），这部分任何工具都救不回来；其余内容已正确还原。</div>' : '') +
          '<div class="pane"><div class="pane-h">还原后</div><pre>' + esc((fixed || '').slice(0, 700)) + '</pre></div>' +
          '<div class="pane-h">手动指定还原方式</div>' +
          '<select class="cand">' + opts + '</select>' +
          '</div></td></tr>';
      }
    });
    $('#tbody').innerHTML = html;
  }

  /* ---------- 下载 ---------- */
  function download(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function batchDownload() {
    var picked = state.items.filter(function (i) { return i.enabled && i.res.status !== 'binary' && i.res.status !== 'unknown'; });
    if (!picked.length) { toast('请先勾选要处理的文件', 'warn'); return; }
    var keep = $('#optOut').value === 'keep';
    var used = {};
    var entries = picked.map(function (i) {
      var name = outName(i);
      if (used[name]) { used[name]++; name = name.replace(/(\.[^.]+)$/, '_' + used[name] + '$1'); }
      else used[name] = 1;
      return { name: name, data: outputBytes(i, keep) };
    });
    if (entries.length === 1) download(entries[0].name, entries[0].data);
    else download('已还原_' + stamp() + '.zip', window.makeZip(entries));
    toast('已导出 ' + entries.length + ' 个文件', 'ok');
  }

  /* ---------- 事件 ---------- */
  $('#pickFiles').addEventListener('click', function () { $('#fileInput').click(); });
  $('#pickDir').addEventListener('click', function () { $('#dirInput').click(); });
  $('#fileInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  $('#dirInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  $('#search').addEventListener('input', render);

  /* ---------- 诊断日志 ---------- */
  var diagLines = [];
  function diag(msg) {
    var d = new Date();
    var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    diagLines.push('[' + hh + '] ' + msg);
    if (diagLines.length > 300) diagLines.shift();
    var box = document.getElementById('diag');
    if (box) box.textContent = diagLines.join('\n');
  }
  function showDiag() {
    var box = document.getElementById('diag');
    if (box) box.hidden = false;
  }

  /* ---------- 拖拽：文件 / 文件夹三层兜底 ---------- */
  function plainFilesOf(dt) {
    var a = [];
    if (dt.files) for (var i = 0; i < dt.files.length; i++) a.push(dt.files[i]);
    return a;
  }

  function entryOf(item) {
    if (!item || item.kind !== 'file' || !item.webkitGetAsEntry) return null;
    try { return item.webkitGetAsEntry(); }
    catch (e) { diag('webkitGetAsEntry 异常: ' + e.message); return null; }
  }

  // 旧版 FileSystemEntry 递归
  function walkEntry(entry, out, failed, depth) {
    return new Promise(function (resolve) {
      if (depth > 8 || !entry) return resolve();
      if (entry.isFile) {
        entry.file(function (f) { out.push(f); resolve(); }, function (err) {
          failed.push(entry.name + (err && err.message ? ' (' + err.message.slice(0, 40) + ')' : ''));
          resolve();
        });
      } else if (entry.isDirectory) {
        var reader;
        try { reader = entry.createReader(); }
        catch (e) { diag('createReader 失败(' + entry.name + '): ' + e.message); return resolve(); }
        var step = function () {
          reader.readEntries(function (batch) {
            if (!batch || !batch.length) return resolve();
            Promise.all(Array.prototype.map.call(batch, function (e2) { return walkEntry(e2, out, failed, depth + 1); }))
              .then(step, function () { resolve(); });
          }, function (err) {
            diag('readEntries 失败(' + entry.name + '): ' + (err && err.message || err));
            resolve();
          });
        };
        step();
      } else resolve();
    });
  }

  // 新版 File System Access API 递归
  async function walkHandle(handle, out, failed, depth) {
    if (depth > 8 || !handle) return;
    if (handle.kind === 'file') {
      try { out.push(await handle.getFile()); }
      catch (e) { failed.push(handle.name + ' (' + (e.message || '').slice(0, 40) + ')'); }
      return;
    }
    if (handle.kind === 'directory') {
      try { for await (var child of handle.values()) await walkHandle(child, out, failed, depth + 1); }
      catch (e) { diag('遍历目录失败(' + handle.name + '): ' + e.message); }
    }
  }

  async function collectViaHandles(items) {
    var out = [], failed = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind !== 'file') continue;
      var h = await items[i].getAsFileSystemHandle();
      if (h) await walkHandle(h, out, failed, 0);
    }
    return { files: out, failed: failed };
  }

  // 关键：任何一步都不能无限制地等下去，否则就是“拖进去没反应”
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        diag(label + ' 超时 ' + ms + 'ms，改用兜底方案');
        resolve(null);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        diag(label + ' 抛错: ' + (e && e.message || e));
        resolve(null);
      });
    });
  }

  async function collectDrop(snap) {
    var out = [], failed = [];

    // 路径①：新版 File System Access API（对文件夹最可靠，但可能卡住/需授权）
    if (snap.handles.length) {
      diag('路径① 尝试 getAsFileSystemHandle…');
      var r1 = await withTimeout((async function () {
        var files = [], fail = [];
        for (var i = 0; i < snap.handles.length; i++) {
          var h = await snap.handles[i];
          if (h) await walkHandle(h, files, fail, 0);
        }
        return { files: files, failed: fail };
      })(), 1500, '路径①');
      if (r1 && r1.files.length) {
        diag('路径① 成功，' + r1.files.length + ' 个文件');
        return { files: r1.files, failed: r1.failed };
      }
      diag('路径① 未取得文件（' + (r1 ? '0 个' : '超时/报错') + '），转路径②');
    } else {
      diag('路径① 此环境不支持 getAsFileSystemHandle');
    }

    // 路径②：旧版 entry API（只处理文件夹）
    var dirs = [];
    for (var j = 0; j < snap.entries.length; j++) {
      if (snap.entries[j] && snap.entries[j].isDirectory) dirs.push(snap.entries[j]);
    }
    diag('路径② 检测到目录 ' + dirs.length + ' 个（entry 共 ' + snap.entries.length + ' 个）');
    if (dirs.length) {
      for (var k = 0; k < dirs.length; k++) await walkEntry(dirs[k], out, failed, 0);
      if (out.length) { diag('路径② 成功，' + out.length + ' 个文件'); return { files: out, failed: failed }; }
      diag('路径② 没取到文件');
      return { files: out, failed: failed, dirFailed: true };
    }

    // 路径③：直接读 files（普通文件最稳）
    out = snap.plain.filter(function (f) { return f.size > 0; });
    diag('路径③ 直接读 dataTransfer.files，得到 ' + out.length + ' 个');
    return { files: out, failed: failed };
  }

  function handleDrop(e) {
    if (!e.dataTransfer) return;
    e.preventDefault();
    $('#drop').classList.remove('over');
    var dt = e.dataTransfer;

    // ！！！DataTransfer 只在事件同步阶段有效，await 之后就失效，所以先同步抓快照
    var snap = { plain: plainFilesOf(dt), entries: [], handles: [], itemCount: 0 };
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    snap.itemCount = items.length;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || it.kind !== 'file') continue;
      var en = null;
      try { en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }
      catch (x) { diag('webkitGetAsEntry 同步异常: ' + x.message); }
      snap.entries.push(en);
      if (typeof it.getAsFileSystemHandle === 'function') {
        try { snap.handles.push(it.getAsFileSystemHandle()); }
        catch (x) { diag('getAsFileSystemHandle 同步异常: ' + x.message); }
      }
    }
    diag('drop: files=' + snap.plain.length + ' items=' + snap.itemCount +
      ' entries=' + snap.entries.filter(Boolean).length +
      ' 目录=' + snap.entries.filter(function (x) { return x && x.isDirectory; }).length);

    collectDrop(snap).then(function (got) {
      if (got.failed && got.failed.length) diag('读取失败 ' + got.failed.length + ' 个：' + got.failed.slice(0, 3).join('; '));
      if (!got.files.length) {
        showDiag();
        toast(got.dirFailed ? '浏览器不给读这个文件夹，请改用「选择文件夹」' : '没读出文件，请改用「选择文件 / 选择文件夹」', 'warn');
        return;
      }
      addFiles(got.files);
    }).catch(function (err) {
      diag('drop 异常: ' + (err && err.message || err));
      showDiag();
      toast('拖拽处理出错，点「诊断信息」查看原因', 'warn');
    });
  }

  // 整个页面都当作投放区，避免拖歪了变成浏览器直接打开文件
  document.addEventListener('dragenter', function (e) {
    e.preventDefault();
    $('#drop').classList.add('over');
  });
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) { try { e.dataTransfer.dropEffect = 'copy'; } catch (x) { } }
  });
  document.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) $('#drop').classList.remove('over');
  });
  document.addEventListener('drop', handleDrop);
  window.addEventListener('unhandledrejection', function (e) {
    diag('未处理异常: ' + (e.reason && e.reason.message || e.reason));
    showDiag();
  });

  $('#tbody').addEventListener('click', function (e) {
    var row = e.target.closest('tr.row');
    if (!row) return;
    var id = +row.dataset.id;
    var item = state.items.find(function (i) { return i.id === id; });
    if (!item) return;
    if (e.target.classList.contains('sel')) { item.enabled = e.target.checked; render(); return; }
    if (e.target.classList.contains('view')) { item.open = !item.open; render(); return; }
    if (e.target.classList.contains('dl')) { download(outName(item), outputBytes(item, $('#optOut').value === 'keep')); return; }
  });

  $('#tbody').addEventListener('change', function (e) {
    var sel = e.target.closest('select.cand');
    if (!sel) return;
    var id = +sel.closest('tr.detail').dataset.id;
    var item = state.items.find(function (i) { return i.id === id; });
    if (!item) return;
    var idx = +sel.value;
    if (idx < 0) item.steps = null;
    else item.steps = item.res.candidates[idx].steps;
    item.enabled = true;
    render();
  });

  $('#checkAll').addEventListener('change', function (e) {
    var on = e.target.checked;
    state.items.forEach(function (i) { i.enabled = on && i.res.status !== 'binary'; });
    render();
  });
  $('#btnFix').addEventListener('click', batchDownload);
  $('#btnDiag').addEventListener('click', function () {
    var box = $('#diag');
    box.hidden = !box.hidden;
  });
  $('#btnClear').addEventListener('click', function () {
    state.items = []; render(); toast('已清空列表');
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); batchDownload(); }
  });

  render();

  // 便于调试 / 外部调用
  window.MojibakeApp = { addFiles: addFiles, render: render, state: state };
})();
