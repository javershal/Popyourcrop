/*
 * Headless check of the coordinate transform in app.html (§5.2).
 *
 * The forward and inverse transforms are EXTRACTED FROM app.html by regex, not
 * retyped -- retyping them would only test the copy. If app.html changes shape
 * this fails loudly rather than silently testing stale math.
 *
 *   node tools/test-cropmath.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

function extract(name, re) {
  const m = src.match(re);
  if (!m) { console.error(`FAIL: could not extract ${name} from app.html`); process.exit(1); }
  return m[0];
}

// Pull the real function bodies out of the app.
const fnComputeCrop = extract('computeCrop', /function computeCrop\(\)[\s\S]*?\n  \}/);
const fnRestore     = extract('restore',     /function restore\(c\)[\s\S]*?\n  \}/);
const fnBounds      = extract('computeBounds', /function computeBounds\(\)[\s\S]*?\n  \}/);

// Minimal host: the same variables app.html's IIFE holds, and no DOM.
const harness = `
  var DAY, view, frame, bounds, crop, devOpen = false, CFG;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function paintReadout() {}
  function apply() { computeCrop(); }
  function clampNow() {
    var rx = txRange(view.scale), ry = tyRange(view.scale);
    view.tx = clamp(view.tx, rx[0], rx[1]);
    view.ty = clamp(view.ty, ry[0], ry[1]);
    apply();
  }
  function txRange(s) { return [frame.x + frame.w - DAY.w * s, frame.x]; }
  function tyRange(s) { return [frame.y + frame.h - DAY.h * s, frame.y]; }
  function confirmCrop() {}          // restore() calls this; irrelevant here
  ${fnComputeCrop}
  ${fnBounds}
  ${fnRestore}
  return { computeCrop, computeBounds, restore,
           set: function (d, v, f, b, c) { DAY = d; view = v; frame = f; bounds = b; CFG = c; },
           view: function () { return view; }, bounds: function () { return bounds; } };
`;
const api = new Function(harness)();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

console.log('\ncrop transform (§5.2)\n');

// ---- 1. fit-to-frame on a source-aspect frame is exactly the whole image ----
{
  const DAY = { w: 3000, h: 2000 };
  const frame = { x: 20, y: 60, w: 360, h: 240 };      // same 3:2 as source
  const view = { scale: 1, tx: 0, ty: 0 };
  const bounds = { min: 1, max: 1 };
  const CFG = { minOutPx: 900, areaPct: 0 };
  api.set(DAY, view, frame, bounds, CFG);
  api.computeBounds();
  view.scale = bounds.min;
  view.tx = frame.x + (frame.w - DAY.w * view.scale) / 2;
  view.ty = frame.y + (frame.h - DAY.h * view.scale) / 2;
  const c = api.computeCrop();
  ok('min zoom => x=0', near(c.x, 0, 1e-9), 'got ' + c.x);
  ok('min zoom => y=0', near(c.y, 0, 1e-9), 'got ' + c.y);
  ok('min zoom => w=1', near(c.width, 1, 1e-9), 'got ' + c.width);
  ok('min zoom => h=1', near(c.height, 1, 1e-9), 'got ' + c.height);
  ok('area = 1.0', near(c.areaFraction, 1, 1e-9), 'got ' + c.areaFraction);
  ok('aspect = source', near(c.aspect, 1.5, 1e-9), 'got ' + c.aspect);
}

// ---- 2. max zoom honours the output-resolution cap, not a multiplier (§5.3) --
{
  const DAY = { w: 3000, h: 2000 };
  const frame = { x: 0, y: 0, w: 360, h: 240 };
  const view = { scale: 1, tx: 0, ty: 0 };
  const bounds = { min: 1, max: 1 };
  const CFG = { minOutPx: 900, areaPct: 0 };
  api.set(DAY, view, frame, bounds, CFG);
  api.computeBounds();
  view.scale = bounds.max;
  view.tx = frame.x; view.ty = frame.y;
  const c = api.computeCrop();
  const outW = c.width * DAY.w, outH = c.height * DAY.h;
  ok('at max zoom, short edge >= minOutPx',
     Math.min(outW, outH) >= CFG.minOutPx - 1e-6,
     'output ' + Math.round(outW) + 'x' + Math.round(outH) + ' vs min ' + CFG.minOutPx);
  ok('max zoom is not a fixed multiple of min',
     !near(bounds.max / bounds.min, 3, 1e-6),
     'ratio ' + (bounds.max / bounds.min).toFixed(3));
}

// ---- 3. pinned area (§8) produces exactly that area fraction ----------------
{
  const DAY = { w: 3000, h: 2000 };
  const frame = { x: 0, y: 0, w: 300, h: 300 };        // 1:1 frame, 3:2 source
  const view = { scale: 1, tx: 0, ty: 0 };
  const bounds = { min: 1, max: 1 };
  const CFG = { minOutPx: 900, areaPct: 25 };
  api.set(DAY, view, frame, bounds, CFG);
  api.computeBounds();
  view.scale = bounds.min;
  view.tx = frame.x; view.ty = frame.y;
  const c = api.computeCrop();
  ok('areaPct=25 => areaFraction=0.25', near(c.areaFraction, 0.25, 1e-9),
     'got ' + c.areaFraction);
  ok('pinned area locks zoom (min===max)', near(bounds.min, bounds.max, 1e-12),
     bounds.min + ' vs ' + bounds.max);
}

// ---- 4. round trip: restore() must reproduce the crop it was given ----------
//        including at a DIFFERENT frame size (reload in another orientation).
{
  const DAY = { w: 4032, h: 3024 };
  const CFG = { minOutPx: 900, areaPct: 0 };

  // confirm on a portrait-ish frame
  const frameA = { x: 12, y: 40, w: 351, h: 263 };
  const viewA = { scale: 1, tx: 0, ty: 0 };
  const boundsA = { min: 1, max: 1 };
  api.set(DAY, viewA, frameA, boundsA, CFG);
  api.computeBounds();
  viewA.scale = boundsA.min * 2.1;
  viewA.tx = frameA.x - 0.31 * DAY.w * viewA.scale;
  viewA.ty = frameA.y - 0.22 * DAY.h * viewA.scale;
  const original = api.computeCrop();

  // reload on a landscape frame of a different size
  const frameB = { x: 40, y: 8, w: 620, h: 465 };
  const viewB = { scale: 1, tx: 0, ty: 0 };
  const boundsB = { min: 1, max: 1 };
  api.set(DAY, viewB, frameB, boundsB, CFG);
  api.computeBounds();
  api.restore(original);
  const round = api.computeCrop();

  ok('round trip x', near(round.x, original.x, 1e-6), original.x + ' -> ' + round.x);
  ok('round trip y', near(round.y, original.y, 1e-6), original.y + ' -> ' + round.y);
  ok('round trip w', near(round.width, original.width, 1e-6), original.width + ' -> ' + round.width);
  ok('round trip survives a different frame', !near(frameA.w, frameB.w, 1e-9));

  // Height is NOT expected to round trip across frames of differing aspect:
  // in a fixed-frame model the crop's aspect is always the frame's aspect, so
  // a reload in another orientation can only approximate the stored rect. This
  // is why the confirmed image is rendered from the stored rect, not from the
  // restored view -- assert that the two genuinely differ so the reason for
  // that design stays visible if anyone "simplifies" it later.
  const aspectA = frameA.w / frameA.h, aspectB = frameB.w / frameB.h;
  ok('differing frame aspect => height cannot round trip (documented)',
     near(aspectA, aspectB, 1e-9) ? near(round.height, original.height, 1e-6)
                                  : !near(round.height, original.height, 1e-9),
     'frame aspects ' + aspectA.toFixed(5) + ' vs ' + aspectB.toFixed(5) +
     '; h ' + original.height.toFixed(6) + ' -> ' + round.height.toFixed(6));
}

// ---- 5. the frame must always be covered by the image ----------------------
{
  const DAY = { w: 3000, h: 2000 };
  const frame = { x: 0, y: 0, w: 400, h: 400 };
  const view = { scale: 1, tx: 0, ty: 0 };
  const bounds = { min: 1, max: 1 };
  const CFG = { minOutPx: 900, areaPct: 0 };
  api.set(DAY, view, frame, bounds, CFG);
  api.computeBounds();
  view.scale = bounds.min;
  view.tx = frame.x; view.ty = frame.y;
  const c = api.computeCrop();
  ok('crop never exceeds the source (w)', c.width <= 1 + 1e-9, 'w=' + c.width);
  ok('crop never exceeds the source (h)', c.height <= 1 + 1e-9, 'h=' + c.height);
  ok('1:1 frame on 3:2 source => square crop', near(c.aspect, 1, 1e-9), 'aspect ' + c.aspect);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
