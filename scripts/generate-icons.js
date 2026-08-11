#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, bgColor, fgColor) {
  const bg = hexRgb(bgColor);
  const fg = hexRgb(fgColor);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const hourAngle = (((angle + Math.PI / 2) / (2 * Math.PI)) * 12 + 12) % 12;
      const isClockOuter = dist <= r && dist >= r * 0.78;
      const isClockInner = dist < r * 0.78;
      const isHandH = isClockInner && Math.abs(hourAngle - 3) < 0.45 && dist > size * 0.08;
      const isHandM = isClockInner && Math.abs(angle - 0) < 0.06 && dist > size * 0.08;
      const isCenter = dist < size * 0.04;

      let col = bg;
      if (isClockOuter || isHandH || isHandM || isCenter) col = fg;

      const off = 1 + x * 4;
      row[off] = col[0];
      row[off + 1] = col[1];
      row[off + 2] = col[2];
      row[off + 3] = 255;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const outDir = path.join(__dirname, '..', 'public');
const sizes = [192, 512];
const BG = '#9b72cf';
const FG = '#ffffff';

for (const s of sizes) {
  const png = makePng(s, BG, FG);
  const file = path.join(outDir, `icon-${s}.png`);
  fs.writeFileSync(file, png);
  console.log(`Generated ${file} (${png.length} bytes)`);
}
