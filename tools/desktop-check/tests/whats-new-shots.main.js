/*
 * Technically Not tools · desktop-check/tests/whats-new-shots.main.js — Main-process side of
 * whats-new-shots.js: hands the window one state as the remote service would push it
 * (`remote:change`), so the Devices page can be pictured with a paired computer that has agents
 * without a second app or a relay. The state is made up by the test and labeled as such there;
 * nothing is sent anywhere. Same as devices-page.main.js.
 */
'use strict';
module.exports = win => ({
  show(state) {
    win.webContents.send('remote:change', state);
    return true;
  },
});
