const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Generate a sleek 256x256 PNG and wrap it in a valid ICO container for Windows installer & window icon
const width = 256;
const height = 256;

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function insideRoundedRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const rawData = Buffer.alloc(height * (1 + width * 4));
for (let y = 0; y < height; y++) {
  const rowStart = y * (1 + width * 4);
  rawData[rowStart] = 0; // No filter
  for (let x = 0; x < width; x++) {
    const idx = rowStart + 1 + x * 4;
    if (!insideRoundedRect(x, y, 16, 16, 224, 224, 52)) {
      rawData[idx] = 0;
      rawData[idx + 1] = 0;
      rawData[idx + 2] = 0;
      rawData[idx + 3] = 0;
      continue;
    }
    // Gradient from #2B65F3 (43,101,243) to #A855F7 (168,85,247)
    const t = (x + y) / (width + height);
    let r = Math.round(43 * (1 - t) + 168 * t);
    let g = Math.round(101 * (1 - t) + 85 * t);
    let b = Math.round(243 * (1 - t) + 247 * t);

    // Draw note lines in white
    const isLine1 = insideRoundedRect(x, y, 64, 76, 128, 18, 9);
    const isLine2 = insideRoundedRect(x, y, 64, 118, 128, 18, 9);
    const isLine3 = insideRoundedRect(x, y, 64, 160, 88, 18, 9);

    if (isLine1 || isLine2 || isLine3) {
      r = 255;
      g = 255;
      b = 255;
    }

    rawData[idx] = r;
    rawData[idx + 1] = g;
    rawData[idx + 2] = b;
    rawData[idx + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const idatData = zlib.deflateSync(rawData, { level: 9 });
const pngBuffer = Buffer.concat([
  pngSignature,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', idatData),
  makeChunk('IEND', Buffer.alloc(0))
]);

// ICO header (6 bytes) + 1 directory entry (16 bytes) + PNG payload
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0); // Reserved
icoHeader.writeUInt16LE(1, 2); // Type: 1 = ICO
icoHeader.writeUInt16LE(1, 4); // Count: 1 image
icoHeader[6] = 0; // Width 256 -> 0
icoHeader[7] = 0; // Height 256 -> 0
icoHeader[8] = 0; // Palette
icoHeader[9] = 0; // Reserved
icoHeader.writeUInt16LE(1, 10); // Color planes
icoHeader.writeUInt16LE(32, 12); // Bits per pixel
icoHeader.writeUInt32LE(pngBuffer.length, 14); // Size
icoHeader.writeUInt32LE(22, 18); // Offset

const icoBuffer = Buffer.concat([icoHeader, pngBuffer]);
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffer);
console.log('Generated build/icon.ico and build/icon.png');
