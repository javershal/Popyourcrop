# Daily Crop — Prototype Requirements

**Status:** Prototype. Not the final version. The purpose of this build is to answer one question: *does the moment of comparing crops in a group chat generate conversation?* Everything here is in service of getting to that test quickly, not to a shippable product.

**Audience:** Claude Code, to review in plan mode before building.

---

## 1. Concept

Each day a single image is released. The player is given a crop tool and nothing else — no prompt, no objective, no correct answer. They choose a crop, confirm it, and share it into a group chat. The interest comes from comparing how differently people framed the same photo.

There is deliberately **no stated objective**. Letting players invent their own purpose is a design bet being tested, not an oversight. Do not add scoring, prompts, or win conditions to the prototype.

---

## 2. Scope of this prototype

### In scope

1. Display one image per day.
2. A crop tool using a native-feeling pan/zoom interaction.
3. Confirm the crop, which locks the day.
4. Share the cropped image out to a messaging app.
5. A developer panel for tweaking parameters during testing.
6. Lightweight instrumentation of crop data.

### Explicitly out of scope

- Accounts, login, or any user identity beyond an anonymous device ID.
- A backend, unless the share spike proves one is needed.
- Consensus statistics or percentile scoring (planned for later; the prototype only needs to *capture the data* that would feed it).
- In-app comparison view. Comparison happens in the group chat.
- Personal gallery / archive of past crops.
- Streaks, notifications, push, PWA install flow.
- Any aspect-ratio or crop-area constraint enforced by default — the crop is free-form in the prototype, with constraints available as *toggleable dev parameters* so they can be tested rather than assumed.

---

## 3. Platform

- **Mobile-first web.** Not a native app. Not a desktop-optimized site. Desktop should not crash, but it does not need to be good.
- **Assume WebKit.** All browsers on iOS use WebKit, including Chrome — no alternative-engine browser has shipped on iOS. iOS Chrome is Safari with different chrome around it, and inherits every WebKit clipboard, share, and viewport quirk. iOS testing *is* Safari testing and is not an edge case.
- Android Chrome (Blink) is the secondary target and is expected to be the easier of the two.
- Use `dvh` or the visual viewport API for sizing. iOS Safari's collapsing address bar will otherwise cause the crop surface to jump mid-gesture.

---

## 4. The daily image

- One image per day, identical for all players on that day.
- The day boundary is **midnight in `America/Los_Angeles`**. Use the IANA zone identifier, not a fixed UTC offset — Pacific is UTC-8 for part of the year and UTC-7 for the rest, and offset math will silently shift the rollover twice a year.
- The day identifier is **frozen at page load** and only re-evaluated on refresh. A tab left open across midnight continues to show the previous day's image until reloaded. This is intentional.
- Image source is a hardcoded date-to-image map for the prototype. Images are personal photos; sourcing is not a constraint at this stage.
- **Images must be embedded as base64 `data:` URIs, not loaded from sibling files.** This is a correctness requirement, not a packaging preference: an image loaded cross-origin or from `file://` taints the canvas and causes `toBlob()` to throw, producing no cropped output at all. Data URIs do not taint. This is easy to get wrong and only fails at the very last step of the flow.
- Source images should be high enough resolution that a meaningfully zoomed-in crop still produces a good-looking output (see §5.3 on zoom bounds), but base64 inflates payload by roughly a third — downscale to around 3000px on the long edge so the file stays openable on a phone.

**Open question — server vs. client day:** the day is currently computed client-side from the device clock. A tester with a wrong or manually-changed clock will see a different image than their group chat, which breaks the one property the daily mechanic exists to guarantee. Serving the day identifier from a backend removes this. Decide whether the prototype accepts the risk or takes on a minimal backend.

---

## 5. Crop interaction

**Model: fixed frame, moving image.** The crop frame stays put on screen; the image pans, zooms, and settles beneath it. This is the Apple Photos / Google Photos model and is the one being built. It was chosen over the alternative (fixed image, draggable box) for feel, with eyes open about the tradeoff in §5.3.

### 5.1 Behavior

- Pinch to zoom and drag to pan, working simultaneously.
- Momentum on release.
- Rubber-band resistance when pulled past an image edge, snapping back so the image always fills the frame.
- Rule-of-thirds grid appears during interaction and fades when idle.
- Touch targets for any handles or controls need ~44px of hit area even when drawn smaller.
- `touch-action: none` and appropriate `preventDefault` to stop Safari's own pinch-zoom and double-tap-zoom from firing underneath the gesture.

**The gesture physics are the bulk of this build's cost and the entire source of the "feels native" quality.** Plan mode should make an explicit call on whether to use an existing gesture or cropper library versus hand-rolling, and flag the estimate either way. Do not treat this as incidental to the rest of the UI.

### 5.2 Recording the crop

With a fixed frame and a moving image, the crop is a coordinate-transform problem rather than a read-off-the-box problem. The app tracks scale and translation; the crop must be derived by inverting that transform.

**Requirement:** the crop is stored as a rectangle in **normalized source-image coordinates** (`x`, `y`, `width`, `height` as fractions of the source, origin top-left), as first-class application state — not left implicitly encoded in DOM transforms or CSS. This is the data that feeds consensus statistics later, and it is easy for it to end up unrecoverable if the transform is the only representation.

Also derive and store: crop area as a fraction of the source, and crop aspect ratio.

### 5.3 Zoom bounds

- **Minimum zoom:** fit-to-frame.
- **Maximum zoom:** capped by output resolution rather than by a fixed multiplier. Without this, a player can zoom to a mushy few-hundred-pixel crop, and the shared image — which is the entire product — looks bad. Set a minimum acceptable output dimension and derive max zoom per image from it.

Note that this cap is a crop-area constraint arriving indirectly. Worth being aware of, since area constraints are also a dev-panel parameter (§8) and the two interact.

### 5.4 Known tradeoff — visibility

In this model, zooming in pushes the rest of the photo off-screen, so players cannot see what they are leaving out at the moment they decide. For a game whose whole subject is *what you chose out of everything available*, this may matter.

**Open question.** Options range from doing nothing, to an inset overview showing the frame's position within the whole image, to a pinch-out gesture that reveals the full photo. Not resolved. Do not add a mitigation unilaterally; flag it in plan mode if the build makes one cheap.

---

## 6. Confirm and lock

- Confirming the crop finalizes it. After confirming, the player sees their crop and the share affordance.
- The lock is stored client-side keyed on **`(dayId, deviceId)`**, not a single boolean "has played" flag. This keeps behavior coherent with the frozen-day rule in §4 — a stale tab showing yesterday and a fresh tab showing today are separate days and should lock separately.
- The lock is unenforceable by design: no accounts means it is localStorage, clearable, and gone in another browser. That is acceptable at this stage.
- `localStorage` is unreliable under `file://` (opaque origin) and may throw on access. Wrap it and fall back to in-memory state rather than letting it break the flow — the lock simply resets on reload in that case, which is acceptable.

**Open question — hard vs. soft lock.** A hard lock means a tester whose crop came out badly cannot retry, and the data about what they *would* have done is lost. A soft lock (confirm, share, but allow a redo with a prototype-only note) preserves that. Decide before building; it is a one-line difference in the build and a meaningful one in what the test yields.

---

## 7. Sharing

This is the riskiest technical area in the build and should be **spiked before anything else is built**, because a failure here invalidates the entire share flow and therefore the entire test.

### 7.1 What we know going in

- **Text and image will likely not travel together.** A single `ClipboardItem` can hold multiple MIME representations, but those are alternative renderings of one item — the paste target picks whichever it prefers, and a messaging app will take the image and drop the text. Getting two genuinely separate things onto the clipboard requires multiple `ClipboardItem` entries, which Safari's `write()` handles unreliably.
- **`navigator.share()` with files is the more native path on mobile**, opening the OS share sheet directly into Messages. But it has the same problem in different clothing: on iOS, file sharing is reported to work reliably only when `files` is the sole property of the share object, and including `title` or `text` has caused the image to be dropped in favor of the text.

### 7.2 Requirement

Plan on the shared artifact being **image-only**, and therefore on a **watermark burned into the pixels** carrying the wordmark and URL. The URL matters beyond branding: with no app install and no notification channel, the daily group-chat message *is* the re-entry path back into the game.

### 7.3 Spike

**Prerequisite: the spike cannot run without a secure context.** Both the Clipboard API and `navigator.share()` require HTTPS. `localhost` is exempt, but that exemption does not extend to a phone hitting a LAN IP, and `file://` is treated inconsistently — permissive in Chrome, less so in WebKit, which is the case that matters here. Opening the file directly on an iOS device may leave both APIs undefined. Testing the share path over `file://` or `http://192.168.x.x` and reporting failure is a false negative.

Before anything else, log `window.isSecureContext`, `typeof navigator.share`, and `typeof navigator.clipboard` on the actual target device, and confirm the environment is viable.

To get a real secure context for a single static file: serve the directory with any static HTTP server and expose it over HTTPS with a tunnel (`cloudflared tunnel --url http://localhost:PORT` needs no account or DNS setup). This also yields a publicly reachable URL that can be texted to testers, which is what the group-chat test requires anyway.

Test and report on, in order of preference:

1. `navigator.share({ files: [file] })` — files only, no title or text.
2. Clipboard write of `image/png` via `ClipboardItem`.
3. Long-press-to-save / explicit download, with the user attaching manually.

All three fail differently and on different devices. Implement whichever works with graceful fallback to the others, detected at runtime rather than by user-agent sniffing.

---

## 8. Developer tools

A dev panel, hidden behind a query param or a hidden tap target, providing:

- **Swap the current image** — pick from the available set regardless of date.
- **Jump to an arbitrary day** — set the frozen day identifier directly.
- **Reset today's state** — clear the lock and stored crop for the current day.
- **Live-toggle crop constraints** — lock the frame to a fixed aspect ratio (free / 1:1 / 4:3) and/or a fixed crop area as a percentage of the source. These are the parameters the next round of design decisions depends on, so they must be adjustable at runtime rather than at build time. The fixed-frame model makes aspect ratio trivial to vary.
- **Crop rectangle readout** — display the current crop in normalized source coordinates live, so the transform math can be verified by eye without instrumenting anything.
- **Overlay all crops recorded on this device** on the source image, so the comparison view can be previewed informally.
- **Export crop data** — dump the session's recorded crops as JSON to the clipboard.

---

## 9. Instrumentation

Without this the test produces vibes and screenshots. Capture, per crop:

- Crop rectangle in normalized source coordinates.
- Crop area fraction and aspect ratio.
- Final zoom level.
- Time from image display to confirm.
- Abandons — image displayed, no crop confirmed.
- Anonymous device ID.
- Day identifier.

A device-local store plus the dev-panel export is sufficient for the prototype. Note that an anonymous device ID is enough to power consensus statistics later without any login, so "no account" and "no server" are separable decisions.

---

## 10. Open questions carried into the build

Listed here so they are not resolved silently. None of these should be decided by the implementation.

1. **Spoiler ordering / anchoring.** The crop is a teaser and the full image is the payoff, which means the first person to post plays a structurally different game from the fifth, who has seen four crops first. Is this a bug to suppress, a feature to lean into as a collaborative reveal, or noise to accept? Without accounts it cannot be enforced anyway.
2. **Crop-visibility mitigation when zoomed** (§5.4).
3. **Hard vs. soft lock** (§6).
4. **Server-computed vs. client-computed day** (§4).
5. **Whether the crop constraint eventually collapses to position-only.** Locking both area and aspect ratio would guarantee bounded spoilage and make crops cleanly comparable — but it turns the game from a crop tool into a pointing tool, trading expressiveness for comparability. The dev panel exists to test this, not to presume it.
6. **Whether comparison ever comes back into the app.** Currently the group chat *is* the comparison view, which means the best moment in the product happens in someone else's UI where nothing can be overlaid or aggregated.

---

## 11. Notes for plan mode

- Sequence the share spike first, including its secure-context prerequisite (§7.3). It gates the value of everything else.
- Make an explicit call on the gesture library question (§5.1) and surface the cost.
- Flag any place where the build would force a resolution to a §10 open question.
- Work within the single-file constraint in §12 rather than proposing a build toolchain.

---

## 12. Delivery and packaging

**The prototype ships as a single self-contained HTML file.** No build step, no bundler, no module graph, no package manager.

- All CSS and JavaScript inline in the one file.
- All images embedded as base64 data URIs (§4).
- No external dependencies fetched at runtime. If a gesture library is used (§5.1), it must be vendored inline — and its inlined size is part of the cost to weigh when making that call.
- Plain JavaScript. No JSX, no TypeScript, no framework requiring compilation. A small hand-rolled state object is sufficient for the state this app holds.

This is chosen for portability and iteration speed at prototype stage: the file can be opened directly, served statically, tunneled, or handed around without setup. The tradeoff is accepted — there is no module structure and no tooling, which will not survive into a real product. **Do not optimize this build for future extraction into a larger codebase.** If the test succeeds, the real version gets a real stack; if it fails, none of the structure mattered.

**Testing loop.** Open directly via `file://` for fast iteration on the crop interaction, which needs no secure context. Switch to static-server-plus-tunnel for anything touching share, clipboard, or persistence (§7.3). Expect `file://` to break `localStorage` (§6) and both share paths, and treat those failures as environmental rather than as bugs.

**Debugging on device.** Connect the phone to a Mac, enable Web Inspector under iOS Settings → Safari → Advanced, and the tab appears in Safari's Develop menu. This works for Chrome on iOS as well, since it is WebKit underneath.
