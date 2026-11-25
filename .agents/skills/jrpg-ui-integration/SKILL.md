---
name: JRPG UI Integration
description: Integrate the jrpg-ui widget library into an existing browser game or web project. Use when adding JRPG-style speech bubbles, typewriter dialogue, choice menus, dialogue input routing, or when wiring jrpg-ui into a game loop, canvas renderer, UI framework, scene system, or custom input.
---

# JRPG UI Integration

Integrate `jrpg-ui` into a host project without rewriting its architecture. The
library is a small, framework-agnostic DOM overlay: it renders HTML widgets above
the game and exposes Promise-based APIs plus a shared input router.

## Working rules

- Inspect the host code before editing. Find its bootstrap, game root, update
  loop, input handling, scene system, and renderer. Adapt to those conventions.
- Make the smallest coherent change. Isolate jrpg-ui calls behind one adapter
  module (for example `src/ui/dialogue.ts`) instead of scattering them through
  gameplay code.
- Do not add a framework, state manager, or bundler to make jrpg-ui fit. It is
  browser-only, ESM, and TypeScript-friendly.
- Match the host project's style (quotes, semicolons, filenames) even though the
  jrpg-ui repository itself uses single quotes and no semicolons.
- Do not copy `example/main.ts` into the host. Use it only as a behaviour
  reference.
- Treat the installed type declarations as the source of truth. This skill
  describes API version 0.2.0; if `node_modules/jrpg-ui/dist/index.d.ts` differs,
  follow the declarations and report the difference.

## Non-negotiables

- Import the stylesheet exactly once from the application entry: `import 'jrpg-ui/style.css'`.
  Without it, widgets are unstyled absolutely positioned elements.
- The host container must establish a positioning context and clip overflow:
  `position: relative; overflow: hidden`. The UI layer fills it with `inset: 0`.
- Call `configure()` once during bootstrap, before the first widget is shown.
  Configuration is global, mutable, and shared by every widget.
- Treat every dialog call as async. Handle `AbortError`; it is normal when a
  dialog is replaced, a scene changes, or the user cancels.
- Block gameplay input while `isDialogVisible()` returns true. The library's
  keyboard and pointer listeners do not stop the host's listeners.

## Step 1 — Survey the host project

Collect these facts before choosing an integration point:

| Area | What to find | Why it matters |
| --- | --- | --- |
| Entry point | App bootstrap, CSS imports, dev/build scripts | Where to load the stylesheet and call `configure()` |
| Game root | The element wrapping the canvas/stage, its CSS size and positioning | Pass it as `root`; bubbles are placed and clipped inside it |
| Update loop | `requestAnimationFrame`, ECS, engine scene update | Gate updates with `isDialogVisible()` |
| Input | Keyboard handlers, pointer controls, gamepad polling, virtual buttons | Prevent double handling; route actions with `sendInput()` |
| Scenes | Scene/conversation state machine, transitions, teardown | Abort pending dialogs on transition |
| Renderer | Canvas, DOM sprites, Phaser/Pixi/Three, camera and scaling | Convert world/entity positions into bubble anchors |
| Dialogue | Existing dialogue data, localization, fonts | Preserve content and translation flow; load the font |
| Tooling | TypeScript strictness, module resolution, package manager | Choose install and import syntax; verify with typecheck/build |

## Step 2 — Install and load

Install the package with the host's package manager:

```sh
npm install jrpg-ui
```

If the host lives beside a local jrpg-ui checkout:

```sh
npm install ../jrpg-ui
```

Use the workspace protocol when the host is a workspace package. Inside the
jrpg-ui repository's own playground, import from `../src/index` instead.

Load CSS and API once in the app entry (or the root component's module):

```ts
import 'jrpg-ui/style.css'
import {
  configure,
  hideBubble,
  isDialogVisible,
  sendInput,
  showBubble,
  showChoices,
} from 'jrpg-ui'
import type { Anchor, Choice } from 'jrpg-ui'
```

Do not import the CSS from multiple components: duplicate imports make cascade
order unpredictable and may inject the stylesheet twice.

## Step 3 — Mount the layer

Choose the element that visually contains the game and is clipped to the
playable area:

```ts
const gameRoot = document.querySelector<HTMLElement>('#game')
if (!gameRoot) throw new Error('Missing #game container')

configure({ root: gameRoot, cps: 35 })
```

Host CSS should make that element a positioned, clipped box:

```css
#game {
  position: relative;
  overflow: hidden;
  width: min(960px, 100vw);
  height: min(540px, 100vh);
}
```

Notes:

- `root: null` mounts the layer on `<body>` as `position: fixed`, covering the
  whole viewport. Use it only for full-screen games.
- A custom root gives an absolute layer. If its computed position is `static`,
  the library sets `position: relative` inline. Prefer declaring it in CSS.
- The layer is created lazily on the first widget and reused. Changing `root`
  later creates a new layer; remove dialogues and the old layer deliberately.
- The layer defaults to `z-index: 1000` and `pointer-events: none`; only choice
  panels and scrollable bubble text capture pointer events. Raise `--jrpg-z` if
  the host has higher HUD layers.

## Step 4 — Add a dialogue adapter

Wrap the library in a project-specific adapter so game code never handles
replacement, aborts, and cleanup ad hoc. A complete template is in
`references/integration-patterns.md`. The adapter should:

- own one `AbortController` per scene or conversation;
- serialize dialogue triggers, or abort the previous conversation before
  starting a new one;
- await lines and choices, and translate results into game state;
- call `hideBubble()` when gameplay resumes after a line;
- swallow only `AbortError`, never real errors;
- keep game logic out of the adapter and UI code out of gameplay systems.

## Step 5 — Connect input

The library installs document-level keyboard and pointer listeners on first
use. Keyboard mappings are configurable; clicking/tapping anywhere (except over
choices) sends `confirm`. Gamepad and on-screen controls must call `sendInput()`.

Gate the host's own input:

```ts
function update(dt: number): void {
  if (isDialogVisible()) return
  // movement, interaction, camera, combat, ...
}
```

Details that commonly break integrations:

- `preventDefault()` in the library does not stop propagation. A host keydown
  listener still fires for the same key; gate it with `isDialogVisible()`.
- A bubble remains visible and registered after its Promise resolves. Call
  `hideBubble()` after the line if gameplay should resume. Otherwise
  `isDialogVisible()` stays true forever.
- Choices take input priority over bubbles. With `cancelValue` omitted, Escape
  is not consumed by choices; do not let it open the game menu underneath.
- The global pointerdown handler also fires for clicks on custom on-screen
  buttons. Either rely on it for `confirm`, or call `event.stopPropagation()` in
  the button handler. Never send `confirm` twice for one tap.
- For gamepads, edge-trigger actions (compare against the previous frame) so a
  held button does not skip every line:

```ts
if (padConfirmPressed && !padConfirmHeld) sendInput('confirm')
padConfirmHeld = padConfirmPressed
```

## Step 6 — Anchor bubbles

Three anchor modes:

```ts
// Tail points at a DOM element (works for DOM-based sprites and UI markers)
await showBubble('Watch your step.', { anchor: npcElement, speaker: 'Ela' })

// Tail points at explicit layer coordinates in CSS pixels
await showBubble('Up here!', { anchor: { x: 320, y: 180 }, speaker: 'Ela' })

// No anchor: narrator bar at the bottom, no tail
await showBubble('The door creaks open.', { speaker: 'Narrator' })
```

Rules for canvas games:

- Numeric anchors are in the UI layer's CSS pixel space, not canvas backing
  store pixels and not world units.
- Project the speaker's world position through the camera into layer pixels.
  See `references/integration-patterns.md` for a projection helper.
- A DOM anchor is measured with `getBoundingClientRect()` and corrected for a
  transform-scaled layer.
- Positions are computed when the bubble is shown and when the layer resizes.
  They do **not** follow a moving camera or moving entity. Pause camera/entity
  movement during dialogue, keep the conversation screen-space, or explicitly
  re-show the bubble when the anchor changes. Do not fake follow by mutating the
  bubble's private DOM.

## Step 7 — Sequence lines and choices

Normal line-by-line flow:

```ts
await showBubble('The old lamp flickers.', { speaker: 'Narrator' })
hideBubble()

const answer = await showChoices(
  [
    { label: 'Open the door', value: 'open' },
    { label: 'Listen closely', value: 'listen' },
  ],
  { position: 'bottom-right', cancelValue: 'cancel' },
)

if (answer === 'open') await showBubble('The hinges scream.', { speaker: 'Narrator' })
```

Prompt immediately followed by choices:

```ts
await showBubble('What will you do?', { speaker: 'Ela', waitForInput: false })
hideBubble()
const answer = await showChoices(choices, { cancelValue: 'cancel' })
```

`waitForInput: false` resolves as soon as the text finishes typing. The bubble
still stays on screen, so hide it before opening choices or it will overlap the
panel. Choices do not close bubbles automatically.

Concurrency rules:

- Only one bubble and one choice panel exist globally. A new bubble closes the
  previous one and resolves its Promise.
- A new choice panel rejects the previous one with `AbortError`.
- If several gameplay systems can trigger dialogue, queue those triggers instead
  of firing them concurrently.

## Step 8 — Theme, fonts, and accessibility

- Pass a theme class with `configure({ theme: 'my-theme' })`. It is appended to
  `.jrpg-layer` on the next widget.
- Override design tokens on `.jrpg-layer.my-theme` (or `.jrpg-layer`); defaults
  live in `:where()` with zero specificity:
  `--jrpg-bg`, `--jrpg-border`, `--jrpg-text`, `--jrpg-accent`, `--jrpg-muted`,
  `--jrpg-u`, `--jrpg-font`, `--jrpg-font-size`, `--jrpg-line-height`,
  `--jrpg-bubble-max`, `--jrpg-text-max`, `--jrpg-z`, and the `--jrpg-safe-*`
  insets.
- Load the pixel font with `@font-face` in the host application. jrpg-ui does
  not ship fonts. Verify the host language's diacritics (for Polish: ą, ć, ę,
  ł, ń, ó, ś, ź, ż) and use font sizes that are multiples of the pixel grid.
- The accessible text is exposed once through a screen-reader-only node; visual
  characters are `aria-hidden`. Do not re-add per-character ARIA.
- Text is rendered with `textContent`. There is no HTML/markup support. Use
  `\n` for line breaks and keep localization strings plain.
- Safe-area insets come from `env(safe-area-inset-*)`. Test notches and gesture
  bars on mobile; `viewport-fit=cover` is required in the host page.

## Step 9 — Verify

Run the host's checks (typecheck, lint, tests, build) and then exercise the
integration in a browser. At minimum verify:

- every dialogue path settles; no spinner/soft lock and no unhandled rejection;
- gameplay cannot move or trigger interactions behind an open dialog;
- keyboard, pointer/touch, and gamepad/on-screen controls all advance once;
- long text scrolls inside the bubble and the down arrow appears;
- choices handle keyboard, hover, click/touch, disabled entries, cancellation,
  and the input delay;
- scene changes abort pending lines and choices cleanly;
- mobile safe areas, resizing, and the pixel font look correct;
- replacing a line with another line and replacing a choice panel behave as
  documented.

A detailed manual QA list is in `references/checklist.md`.

## References

- `references/api.md` — exported functions, options, lifecycle, errors, CSS
  classes, and design tokens.
- `references/integration-patterns.md` — adapter template, React wiring, canvas
  projection, gamepad, blips, and scene-abort patterns.
- `references/checklist.md` — pre-flight and manual verification checklist.
