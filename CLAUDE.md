# Daily Crop — project state

Prototype of a daily photo-cropping game. One image a day, no prompt and no
objective, you crop it and share the crop into a group chat. The build exists to
answer exactly one question: **does comparing crops in a group chat generate
conversation?** It is not being built toward shippability.

Full spec: [daily-crop-prototype-requirements.md](daily-crop-prototype-requirements.md).
Section numbers (§4, §5.3, …) throughout this file and the code refer to it.

---

## ⚠ The one thing blocking everything

**The share spike has never been run on a device.** It is built, deployed, and
reachable — but nobody has pressed the buttons. §7 calls sharing the riskiest
area in the build and says to spike it before anything else, because if a
cropped image cannot reach a group chat there is no experiment.

Run it first thing next session:

> **https://javershal.github.io/Popyourcrop/spike.html** — on a real iPhone

Confirm `isSecureContext` is green at the top of the page, then press the three
buttons in order. **The test is whether the image lands in a real Messages
thread, not whether the button resolves.** Those are different outcomes and only
one of them counts. Report back per path:

1. `navigator.share({files})` — files only, no title/text (§7.1)
2. `clipboard.write` of `image/png` via `ClipboardItem`
3. long-press-to-save / download, attach by hand

The app already implements all three as a runtime-detected cascade, so the spike
result does not change what to write — it tells you which path actually carries
the product, and whether the whole premise holds.

---

## Where things stand

| Area | State |
|---|---|
| Share spike (§7.3) | built + deployed, **never run** |
| Crop interaction (§5) | built, **never touched on a phone** |
| Crop math (§5.2) | built, 18 headless assertions passing |
| Confirm + soft lock (§6) | built, unverified on device |
| Share cascade (§7) | built, unverified on device |
| Dev panel (§8) | built, unverified on device |
| Instrumentation (§9) | built, unverified on device |
| Deploy pipeline | working, used four times |

Everything is written. Almost nothing is confirmed against WebKit, which per §3
is the target and not an edge case. Assume feel and gesture bugs are ahead.

---

## Decisions already made — do not silently revisit

Settled with the user. Several are §10 open questions that were explicitly
closed; the rest resolve conflicts found while building.

| § | Question | Decision |
|---|---|---|
| §6 | hard vs. soft lock | **soft** — Redo stays available, prior attempt kept with `superseded: true` so the counterfactual survives |
| §4 | server vs. client day | **client clock**, `Intl` + `America/Los_Angeles` |
| §5.4 | zoom-visibility mitigation | **nothing** — ship the blind zoom; whether it bothers players is itself a finding |
| §5.1 | gesture library vs. hand-roll | **hand-rolled**, no dependency. Croppers implement the wrong model (fixed image / draggable box); gesture libs give recognition but not physics, which is the half that costs |
| — | distribution | **GitHub Pages, one photo per build, regenerated + redeployed daily** |
| — | photo exposure | public repo, but **squashed orphan commits** — only today's photo is ever in `gh-pages` history; `main` never receives a photo at all |
| §7.2 | watermark URL | `javershal.github.io/Popyourcrop`, **deliberately temporary** — one constant, `SITE_URL` in `app.html` |

### Two conclusions that came out of building, worth keeping

**§4's open question mostly dissolved.** With one photo per build, a skewed
device clock cannot show a tester a *different image* than their group chat —
there is only one image in the file. It shifts the day label and the lock key,
nothing else. That removes the reason to take on a backend. The dev panel
surfaces skew when it happens.

**A tunnel would have been wrong.** The original plan called for
`cloudflared`. Its URLs rotate every run, and §7.2 burns the URL into the shared
pixels — so yesterday's watermark would point nowhere today. A stable hosted URL
is not a convenience here, it is what makes the re-entry path work at all.

---

## Files

```
app.html                  the app — EDIT THIS. No image data in it.
tools/pack.py             packs one photo into dist/index.html as base64
tools/test-cropmath.js    headless check of the coordinate transform
deploy.sh                 pack (optional) + publish to gh-pages
spike/spike.html          §7.3 share spike, standalone
dist/                     generated, gitignored — never edit by hand
*.jpg                     source photos, gitignored, stay local
```

`app.html` is the source of truth. `dist/index.html` is generated output; edits
there are destroyed on the next pack.

Branches: `main` is source (no photos, ever). `gh-pages` is a single orphan
commit holding the packed `index.html` plus `spike.html`, force-replaced each
deploy.

---

## Working on it

```bash
python3 tools/pack.py --placeholder     # synthetic 3000×2000, multi-scale detail
python3 tools/pack.py photo.jpg         # pack a real photo for today
python3 tools/pack.py photo.jpg --date 2026-09-01
node tools/test-cropmath.js             # run after ANY change to the transform
./deploy.sh                             # publish whatever is in dist/
./deploy.sh photo.jpg                   # pack + publish in one step
```

Local iteration: `python3 -m http.server 8000` and open
`http://127.0.0.1:8000/dist/index.html`. Gesture work needs no secure context.
Anything touching share, clipboard, or storage must be tested on the Pages URL —
§7.3 is explicit that a `file://` or LAN-IP failure is a **false negative**, not
a result.

Dev panel: five taps on the top-right corner, or `?dev=1`.

On-device debugging: connect the phone to a Mac, enable Web Inspector under iOS
Settings → Safari → Advanced, and the tab appears in Safari's Develop menu. Works
for Chrome on iOS too — it is WebKit underneath.

---

## Things that will bite

**Source images must be big.** Max zoom is derived from a minimum acceptable
*output* dimension (§5.3, `CFG.minOutPx`, default 900), not a fixed multiplier.
A short edge under ~900px puts max zoom *below* fit-to-frame, the app clamps max
down to min, and **zoom silently turns off** — a crop tool that cannot crop. This
already happened once with a 500×333 photo. `tools/pack.py` now refuses to let it
pass quietly. Rough headroom: short edge ÷ 900. The current `test2.jpg` is
2878×1800, giving exactly 2.0×, which is real but not generous.

**A crop's aspect ratio is always the frame's aspect ratio.** That is inherent to
the fixed-frame model §5 chose, and it has a consequence: reloading in a
different orientation cannot reproduce a stored crop exactly. So a confirmed crop
is rendered **from the stored normalized rect**, never re-derived from the live
view — otherwise a reload hands the player back a *different image* than the one
they confirmed. `tools/test-cropmath.js` asserts this on purpose; if someone
"simplifies" `restore()` later, that test is what catches it.

**"Free-form" aspect is not achievable in this model — flagged, not decided.**
§2 says the crop is free-form by default, but the frame never changes shape, so
the ratio is always exactly the frame's. "free" currently means *the frame takes
the source photo's ratio*, which gives the clean property that opening the app
shows the whole photo uncropped and the readout reads `x:0 y:0 w:1 h:1`. That is
not the same as unconstrained. Touches §10.5 and is the user's call, not the
implementation's.

**GitHub Pages CDN lags a deploy by a minute or two.** A stale byte count right
after `./deploy.sh` is cache, not a failed push. Check `w: <number>` in the
served HTML against `dist/index.html` rather than trusting size.

**`localStorage` throws under `file://`** (opaque origin). Wrapped, with an
in-memory fallback — the lock just resets on reload, which §6 accepts.

---

## Still open — none of these are the implementation's call (§10)

1. **Spoiler ordering / anchoring.** The first person to post plays a different
   game from the fifth, who has seen four crops first. Bug to suppress, feature
   to lean into, or noise to accept? Untouched in the build. Unenforceable
   without accounts anyway.
2. **Whether the crop constraint collapses to position-only.** Locking both area
   and aspect would make crops cleanly comparable but turns a crop tool into a
   pointing tool. The dev panel exists to *test* this; defaults ship free-form
   and presume nothing.
3. **Whether comparison ever comes back into the app.** Right now the group chat
   is the comparison view — the best moment in the product happens in someone
   else's UI where nothing can be overlaid or aggregated. The dev panel's crop
   overlay is a device-local debugging view, deliberately not a product surface.
4. **The watermark URL.** `javershal.github.io/Popyourcrop` is 31 mixed-case
   characters, and because text does not travel with the image (§7.1) a player
   has to *read it off the picture and type it*. That is the only re-entry path
   into the game. A shorter URL would measurably help; the user has a domain
   (`jacobavershal.com`) and deferred the decision.

---

## House rules

- **Single self-contained HTML file, no build toolchain** (§12). No bundler, no
  framework, no runtime dependencies, plain JS. `tools/pack.py` is a packer, not
  a toolchain — §4 requires base64 embedding and that cannot be done by hand.
- **Images must be base64 `data:` URIs.** Not a packaging preference: a
  cross-origin or `file://` image taints the canvas and `toBlob()` throws,
  producing no output at all, and it fails at the very last step of the flow
  after the player has done all the work.
- **Do not add scoring, prompts, timers, or win conditions.** The absence of a
  stated objective is the design bet being tested (§1).
- **Do not optimize this for future extraction into a larger codebase** (§12).
  If the test succeeds the real version gets a real stack; if it fails, none of
  the structure mattered.
- Flag anything that would force a §10 question closed. Do not close one by
  implementing it.
