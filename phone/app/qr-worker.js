// The phone's own code reader, for a browser that has none built in (Safari on an iPhone). It runs
// apart from the page, in a worker: the reading code (vendor/jsqr.js: jsQR 1.4.0, Apache-2.0, its
// licence beside it) is not ours, so it gets the camera picture and nothing else. It cannot see the
// page, the key store or the session, and the host sends this file with a policy that lets it reach
// no address at all (phone/_headers). All it can do is hand back a text, which the page then checks
// like any scanned or pasted code (pair.mjs readCode).
importScripts('vendor/jsqr.js');
onmessage = e => {
  const { n, data, width, height } = e.data || {};
  let text = null;
  try {
    const hit = jsQR(new Uint8ClampedArray(data), width, height, {
      inversionAttempts: 'dontInvert',
    }); // the app shows dark on light
    if (hit && typeof hit.data === 'string' && hit.data) text = hit.data.slice(0, 2048);
  } catch {
    /* a picture it cannot read is a picture without a code */
  }
  postMessage({ n, text });
};
