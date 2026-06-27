/**
 * png-to-emf.js
 * Wraps a PNG bitmap inside an EMF (Enhanced Metafile) container.
 * Pure Node.js — no external dependencies.
 *
 * EMF record types used:
 *   EMR_HEADER        (1)
 *   EMR_STRETCHDIBITS (81)
 *   EMR_EOF           (14)
 */

'use strict';

/**
 * Read PNG dimensions from raw PNG buffer.
 * IHDR chunk is always at offset 16 (8 magic + 4 len + 4 "IHDR" + 4W + 4H).
 */
function readPngDimensions(buf) {
  // PNG magic: 8 bytes, then IHDR chunk: 4 len + 4 type + 4 width + 4 height
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Build a BITMAPINFOHEADER (40 bytes) + pixel data wrapped as a DIB.
 * We embed the PNG as a BI_PNG (compression=6) DIB — supported in Vista+.
 */
function buildDib(pngBuf) {
  const { width, height } = readPngDimensions(pngBuf);

  // BITMAPINFOHEADER (40 bytes)
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);           // biSize
  bih.writeInt32LE(width,  4);        // biWidth
  bih.writeInt32LE(height, 8);        // biHeight (positive = bottom-up, but BI_PNG ignores this)
  bih.writeUInt16LE(1, 12);           // biPlanes
  bih.writeUInt16LE(32, 14);          // biBitCount (ignored for BI_PNG)
  bih.writeUInt32LE(6, 16);           // biCompression = BI_PNG
  bih.writeUInt32LE(pngBuf.length, 20); // biSizeImage
  bih.writeInt32LE(2835, 24);         // biXPelsPerMeter (~72dpi)
  bih.writeInt32LE(2835, 28);         // biYPelsPerMeter
  bih.writeUInt32LE(0, 32);           // biClrUsed
  bih.writeUInt32LE(0, 36);           // biClrImportant

  return { bih, width, height };
}

/**
 * Build EMR_STRETCHDIBITS record (type=81).
 * Draws the DIB stretched to fill the output rectangle.
 */
function buildStretchDibits(pngBuf, widthPx, heightPx) {
  const { bih, width, height } = buildDib(pngBuf);

  // Record size: 4(type)+4(size)+4*4(bounds)+4*2(xDest,yDest)+4*2(xSrc,ySrc)+
  //              4*2(cxSrc,cySrc)+4(offBmiSrc)+4(cbBmiSrc)+4(offBitsSrc)+4(cbBitsSrc)+
  //              4*2(cxDest,cyDest)+4(dwRop)+4(iUsageSrc)
  // = 4+4+16+8+8+4+4+4+4+8+4+4 = 72 bytes fixed + bih(40) + png data
  const fixedSize = 72;
  const recSize = fixedSize + bih.length + pngBuf.length;

  const rec = Buffer.alloc(recSize);
  let o = 0;

  rec.writeUInt32LE(81, o); o += 4;           // iType = EMR_STRETCHDIBITS
  rec.writeUInt32LE(recSize, o); o += 4;       // nSize

  // rclBounds (RECTL)
  rec.writeInt32LE(0, o); o += 4;              // left
  rec.writeInt32LE(0, o); o += 4;              // top
  rec.writeInt32LE(widthPx, o); o += 4;        // right
  rec.writeInt32LE(heightPx, o); o += 4;       // bottom

  rec.writeInt32LE(0, o); o += 4;              // xDest
  rec.writeInt32LE(0, o); o += 4;              // yDest
  rec.writeInt32LE(0, o); o += 4;              // xSrc
  rec.writeInt32LE(0, o); o += 4;              // ySrc
  rec.writeInt32LE(width, o); o += 4;          // cxSrc
  rec.writeInt32LE(height, o); o += 4;         // cySrc

  const offBmiSrc  = fixedSize;                // offset from record start to BITMAPINFO
  const cbBmiSrc   = bih.length;               // 40
  const offBitsSrc = fixedSize + bih.length;   // offset from record start to pixel data
  const cbBitsSrc  = pngBuf.length;

  rec.writeUInt32LE(offBmiSrc,  o); o += 4;
  rec.writeUInt32LE(cbBmiSrc,   o); o += 4;
  rec.writeUInt32LE(offBitsSrc, o); o += 4;
  rec.writeUInt32LE(cbBitsSrc,  o); o += 4;

  rec.writeInt32LE(widthPx,  o); o += 4;       // cxDest
  rec.writeInt32LE(heightPx, o); o += 4;       // cyDest
  rec.writeUInt32LE(0x00CC0020, o); o += 4;    // dwRop = SRCCOPY
  rec.writeUInt32LE(0, o); o += 4;             // iUsageSrc = DIB_RGB_COLORS

  bih.copy(rec, o); o += bih.length;
  pngBuf.copy(rec, o);

  return rec;
}

/**
 * Build EMR_EOF record (type=14).
 */
function buildEof() {
  const rec = Buffer.alloc(20);
  rec.writeUInt32LE(14, 0);   // iType = EMR_EOF
  rec.writeUInt32LE(20, 4);   // nSize
  rec.writeUInt32LE(0,  8);   // nPalEntries
  rec.writeUInt32LE(16, 12);  // offPalEntries (points past the fixed fields)
  rec.writeUInt32LE(20, 16);  // nSizeLast (total record size)
  return rec;
}

/**
 * Build ENHMETAHEADER (108 bytes, type=1).
 * @param {number} widthPx  - image width in pixels
 * @param {number} heightPx - image height in pixels
 * @param {number} fileSize - total EMF file size in bytes
 * @param {number} nRecords - number of records (header + draw + eof = 3)
 */
function buildHeader(widthPx, heightPx, fileSize, nRecords) {
  const rec = Buffer.alloc(108);
  let o = 0;

  rec.writeUInt32LE(1, o); o += 4;              // iType = EMR_HEADER
  rec.writeUInt32LE(108, o); o += 4;            // nSize

  // rclBounds (pixel coords)
  rec.writeInt32LE(0, o); o += 4;
  rec.writeInt32LE(0, o); o += 4;
  rec.writeInt32LE(widthPx - 1, o); o += 4;
  rec.writeInt32LE(heightPx - 1, o); o += 4;

  // rclFrame (in 0.01mm units, assuming 96dpi: px * 2540/96)
  const toHiMetric = px => Math.round(px * 2540 / 96);
  rec.writeInt32LE(0, o); o += 4;
  rec.writeInt32LE(0, o); o += 4;
  rec.writeInt32LE(toHiMetric(widthPx), o);  o += 4;
  rec.writeInt32LE(toHiMetric(heightPx), o); o += 4;

  rec.writeUInt32LE(0x464D4520, o); o += 4;   // dSignature = ENHMETA_SIGNATURE
  rec.writeUInt32LE(0x00010000, o); o += 4;   // nVersion
  rec.writeUInt32LE(fileSize, o); o += 4;     // nBytes (total file size)
  rec.writeUInt32LE(nRecords, o); o += 4;     // nRecords
  rec.writeUInt16LE(0, o); o += 2;            // nHandles
  rec.writeUInt16LE(0, o); o += 2;            // sReserved
  rec.writeUInt32LE(0, o); o += 4;            // nDescription
  rec.writeUInt32LE(0, o); o += 4;            // offDescription
  rec.writeUInt32LE(0, o); o += 4;            // nPalEntries

  // szlDevice (screen size in pixels, assume 1920x1080)
  rec.writeUInt32LE(1920, o); o += 4;
  rec.writeUInt32LE(1080, o); o += 4;

  // szlMillimeters (screen size in mm, assume 508x286 for 96dpi 1920x1080)
  rec.writeUInt32LE(508, o); o += 4;
  rec.writeUInt32LE(286, o); o += 4;

  // cbPixelFormat, offPixelFormat, bOpenGL (remaining 12 bytes)
  rec.writeUInt32LE(0, o); o += 4;
  rec.writeUInt32LE(0, o); o += 4;
  rec.writeUInt32LE(0, o); o += 4;

  return rec;
}

/**
 * Convert a PNG Buffer to an EMF Buffer.
 * @param {Buffer} pngBuf
 * @returns {Buffer}
 */
function pngToEmf(pngBuf) {
  const { width, height } = readPngDimensions(pngBuf);

  const dibRec = buildStretchDibits(pngBuf, width, height);
  const eofRec = buildEof();

  const fileSize = 108 + dibRec.length + eofRec.length;
  const headerRec = buildHeader(width, height, fileSize, 3);

  return Buffer.concat([headerRec, dibRec, eofRec]);
}

module.exports = { pngToEmf };
