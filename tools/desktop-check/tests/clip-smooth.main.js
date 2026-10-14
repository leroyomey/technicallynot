/*
 * Technically Not tools · desktop-check/tests/clip-smooth.main.js — Main-process side of
 * clip-smooth.js: records the app window's own area of the screen with the real clip recorder
 * (desktop/snapshot-clip.js start / stop, no overlay), then reads the saved video's frame times
 * with ffprobe: how many frames, how many a second, and the longest wait between two. The window
 * must be visible and show something that moves on every frame (the test draws that). Needs ffprobe
 * on this PC; without it the answer says so and the test only checks that a clip was kept.
 */
'use strict';
const { screen } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
module.exports = win => {
  const clip = require('../../../desktop/snapshot-clip.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  return {
    fps: () => clip.FPS,
    // Records `ms` of the window's content area. → { saved, ms, bytes, exact, frames, seconds,
    // perSecond, longestGapMs, lateShare } or { error }.
    async record(ms) {
      // shown without taking the keyboard: the recording needs the window in front, not active
      win.showInactive();
      win.moveTop();
      await sleep(300);
      const b = win.getContentBounds(),
        display = screen.getDisplayMatching(b),
        sf = display.scaleFactor || 1;

      // The middle of the window, in the display's capture pixels (even numbers, as the overlay
      // hands them over).
      const pad = 60,
        even = n => Math.max(2, Math.round(n / 2) * 2);
      const region = {
        x: even((b.x - display.bounds.x + pad) * sf),
        y: even((b.y - display.bounds.y + pad) * sf),
        width: even((b.width - 2 * pad) * sf),
        height: even((b.height - 2 * pad) * sf),
      };

      // What the hidden recorder page says (its errors would otherwise be lost): kept for the
      // answer when the clip fails.
      const said = [],
        hear = (_e, wc) =>
          wc.on('console-message', (ev, level, message) =>
            said.push(String(ev && ev.message !== undefined ? ev.message : message).slice(0, 200))
          );
      require('electron').app.on('web-contents-created', hear);
      const done = clip.start(display, region, 'purple');
      await sleep(ms);
      clip.stop();
      const out = await Promise.race([
        done,
        sleep(15000).then(() => ({ error: 'the clip never came back' })),
      ]);
      require('electron').app.removeListener('web-contents-created', hear);
      if (!out || !out.saved)
        return { error: (out && out.error) || 'not saved', out, said: said.slice(0, 8) };
      const bytes = fs.statSync(out.video).size;
      const p = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'packet=pts_time',
          '-of',
          'csv=p=0',
          out.video,
        ],
        { encoding: 'utf8', windowsHide: true }
      );
      const keep = {
        saved: true,
        ms: out.ms,
        bytes,
        video: out.video,
        frameFiles: out.frames,
        recorder: out.stats,
      };
      if (p.error || p.status !== 0)
        return {
          ...keep,
          noProbe: String((p.error && p.error.message) || p.stderr || 'ffprobe failed').slice(
            0,
            160
          ),
        };
      const t = p.stdout
        .split(/\r?\n/)
        .map(x => parseFloat(x))
        .filter(n => Number.isFinite(n))
        .sort((a, c) => a - c);
      if (t.length < 3) return { ...keep, frames: t.length, probeSaid: p.stdout.slice(0, 160) };
      const gaps = t.slice(1).map((x, i) => (x - t[i]) * 1000),
        seconds = t[t.length - 1] - t[0],
        sorted = [...gaps].sort((a, c) => a - c),
        median = sorted[Math.floor(sorted.length / 2)];
      return {
        ...keep,
        frames: t.length,
        seconds: +seconds.toFixed(2),
        perSecond: +((t.length - 1) / seconds).toFixed(1),
        medianGapMs: +median.toFixed(1),
        longestGapMs: +Math.max(...gaps).toFixed(1),
        lateShare: +(gaps.filter(g => g > (2.5 * 1000) / clip.FPS).length / gaps.length).toFixed(3),
      };
    },
    // The kept clip and its stills are test leftovers in the throwaway profile's attachments:
    // removed here.
    clean(files) {
      for (const f of files || []) {
        try {
          fs.rmSync(f, { force: true });
        } catch (e) {}
      }
      return true;
    },
  };
};
