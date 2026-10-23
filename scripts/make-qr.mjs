// Usage (from a dir with qrcode, jsqr, pngjs installed): node make-qr.mjs <url> <out.svg>
// Builds an SVG QR and proves it decodes to exactly the URL by rasterising the same module matrix.
import QRCode from 'qrcode'; import jsQR from 'jsqr'; import {PNG} from 'pngjs'; import fs from 'node:fs';
const [url, out] = [process.argv[2], process.argv[3]];
const qr = QRCode.create(url, {errorCorrectionLevel: 'H'});
const n = qr.modules.size, q = 4, scale = 12, size = (n + 2 * q) * scale;
const png = new PNG({width: size, height: size}); png.data.fill(255);
let path = '';
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) {
  path += `M${x + q} ${y + q}h1v1h-1z`;
  for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
    const i = ((((y + q) * scale + dy) * size) + (x + q) * scale + dx) * 4; png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
  }
}
const r = jsQR(new Uint8ClampedArray(png.data), size, size);
if (!r || r.data !== url) { console.error('QR VERIFY FAILED', r && r.data); process.exit(1); }
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`);
console.log('QR OK ->', r.data, out);
