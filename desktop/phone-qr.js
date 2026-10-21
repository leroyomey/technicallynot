// Technically Not · phone-qr.js — the "Add a phone" code as squares for the Devices page to draw.
// The text is the one phone-pair.js show() makes (plain data, not a web link). The main process
// turns it into rows of dark and light squares with qrcode-generator 1.4.4 (MIT, Kazuhiko Arase;
// its notice is in desktop/vendor/qrcode.js, kept byte for byte), so the window draws a picture
// from plain rows and needs no library. The code is never written to disk or a log.
// phone/test/phone-qr-test.mjs reads what this makes with the phone's own reader (jsQR).
const qrcode = require('./vendor/qrcode.js');

// The longest code text phone-pair.js makes is about 120 characters; anything far longer is not
// one of its codes and is refused.
const TEXT_MAX = 400;

// → { size, rows: ['1010…', …] } with '1' a dark square, or null.
function qrRows(text) {
  if (typeof text !== 'string' || !text || text.length > TEXT_MAX) return null;
  try {
    const q = qrcode(0, 'M');
    q.addData(text, 'Byte');
    q.make();
    const size = q.getModuleCount();
    const rows = [];
    for (let y = 0; y < size; y++) {
      let row = '';
      for (let x = 0; x < size; x++) row += q.isDark(y, x) ? '1' : '0';
      rows.push(row);
    }
    return { size, rows };
  } catch {
    return null;
  }
}

module.exports = { qrRows, TEXT_MAX };
