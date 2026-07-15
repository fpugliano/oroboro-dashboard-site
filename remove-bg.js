// Strips dark background pixels from an RGBA PNG, making them transparent.
// Usage: node remove-bg.js <input.png> <output.png>
const fs = require('fs');
const zlib = require('zlib');

const [,, src, dst] = process.argv;
const buf = fs.readFileSync(src);

// ── PNG parser ────────────────────────────────────────────────────────────────
function readChunks(b) {
  let o = 8; // skip 8-byte PNG signature
  const chunks = [];
  while (o < b.length) {
    const len  = b.readUInt32BE(o);
    const type = b.slice(o+4, o+8).toString('ascii');
    const data = b.slice(o+8, o+8+len);
    chunks.push({ type, data });
    o += 12 + len;
  }
  return chunks;
}

function writeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// CRC-32 (PNG spec)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Reconstruct filtered scanlines ────────────────────────────────────────────
function recon(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rawOff = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rawOff++];
    const row = raw.slice(rawOff, rawOff + stride);
    rawOff += stride;
    const prev = y > 0 ? out.slice((y-1)*stride, y*stride) : Buffer.alloc(stride);
    const cur  = out.slice(y*stride, (y+1)*stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x-bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x-bpp] : 0;
      let px = row[x];
      if      (filter === 1) px = (px + a) & 0xff;
      else if (filter === 2) px = (px + b) & 0xff;
      else if (filter === 3) px = (px + Math.floor((a+b)/2)) & 0xff;
      else if (filter === 4) px = (px + paeth(a,b,c)) & 0xff;
      cur[x] = px;
    }
  }
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
  return pa<=pb && pa<=pc ? a : pb<=pc ? b : c;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const chunks = readChunks(buf);
const ihdr   = chunks.find(c => c.type === 'IHDR').data;
const width  = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const bitDepth  = ihdr[8];
const colorType = ihdr[9];

if (bitDepth !== 8 || colorType !== 6) {
  console.error('Expected 8-bit RGBA PNG (colorType 6)'); process.exit(1);
}

// Concatenate and decompress all IDAT chunks
const compressed = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
const raw = zlib.inflateSync(compressed);

// Reconstruct pixels (bpp=4 for RGBA)
const pixels = recon(raw, width, height, 4);

// Make dark pixels transparent
// Threshold: if perceived brightness < 80 (out of 255), set alpha to 0
// Use a soft edge: blend alpha for pixels near the threshold
const THRESHOLD = 80;
const FEATHER   = 30;
for (let i = 0; i < pixels.length; i += 4) {
  const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
  const luma = 0.299*r + 0.587*g + 0.114*b;
  if (luma < THRESHOLD - FEATHER) {
    pixels[i+3] = 0;
  } else if (luma < THRESHOLD) {
    const t = (luma - (THRESHOLD - FEATHER)) / FEATHER;
    pixels[i+3] = Math.round(t * pixels[i+3]);
  }
}

// Re-filter with filter=0 (None) and recompress
const stride = width * 4;
const filtered = Buffer.alloc(height * (stride + 1));
for (let y = 0; y < height; y++) {
  filtered[y*(stride+1)] = 0; // filter type None
  pixels.copy(filtered, y*(stride+1)+1, y*stride, (y+1)*stride);
}
const recompressed = zlib.deflateSync(filtered, { level: 9 });

// Rebuild PNG
const sig = Buffer.from([137,80,78,71,13,10,26,10]);
const out  = [sig];
for (const ch of chunks) {
  if (ch.type === 'IDAT') continue; // drop old IDATs
  if (ch.type === 'IEND') {
    out.push(writeChunk('IDAT', recompressed));
  }
  out.push(writeChunk(ch.type, ch.data));
}
fs.writeFileSync(dst, Buffer.concat(out));
console.log(`Written ${dst} (${width}x${height})`);
