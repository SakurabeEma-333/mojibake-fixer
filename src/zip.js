/* 极简 ZIP 打包（仅存储、不压缩，无需第三方库） */
(function (global) {
  'use strict';
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(entries) {
    var enc = new TextEncoder();
    var chunks = [], central = [], offset = 0;

    entries.forEach(function (e) {
      var nameBytes = enc.encode(e.name);
      var crc = crc32(e.data);
      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);      // 需要的版本
      dv.setUint16(6, 0x0800, true);  // 文件名用 UTF-8
      dv.setUint16(8, 0, true);       // 存储方式：0 = 不压缩
      dv.setUint16(10, 0, true);      // 时间
      dv.setUint16(12, 0x21, true);   // 日期
      dv.setUint32(14, crc, true);
      dv.setUint32(18, e.data.length, true);
      dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, e.data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var dv2 = new DataView(cd.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0x21, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, e.data.length, true);
      dv2.setUint32(24, e.data.length, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + e.data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    var dve = new DataView(end.buffer);
    dve.setUint32(0, 0x06054b50, true);
    dve.setUint16(4, 0, true);
    dve.setUint16(6, 0, true);
    dve.setUint16(8, entries.length, true);
    dve.setUint16(10, entries.length, true);
    dve.setUint32(12, cdSize, true);
    dve.setUint32(16, offset, true);
    dve.setUint16(20, 0, true);

    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  global.makeZip = makeZip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
