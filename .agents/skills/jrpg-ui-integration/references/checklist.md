# Integration checklist

Use this before declaring the integration done. Check only what applies to the
host, and record anything intentionally skipped.

## Pre-flight

- [ ] `jrpg-ui` is installed and resolves from the host (`node_modules/jrpg-ui`
      or workspace link).
- [ ] The host typechecker resolves `jrpg-ui` types; no `any` shim is needed.
- [ ] The stylesheet is imported exactly once and appears in the built CSS.
- [ ] The game root is a positioned, overflow-clipped container with an explicit
      size.
- [ ] `configure()` runs during bootstrap, before any widget is shown.
- [ ] Theme class and design tokens are applied on `.jrpg-layer` if the default
      look is not used.
- [ ] The pixel font is loaded via `@font-face`; the host language's diacritics
      render correctly.
- [ ] The dialogue adapter exists and is the only module calling jrpg-ui widgets.
- [ ] Every dialog call is awaited or has an explicit rejection handler.
- [ ] Scene teardown aborts pending dialogs and calls `hideBubble()`.

## Dialog behaviour

- [ ] A short line types and waits for confirmation.
- [ ] Confirmation while typing reveals the whole line; the next confirmation
      settles the Promise.
- [ ] Holding confirm does not skip several lines.
- [ ] A line with `waitForInput: false` resolves after typing and still needs an
      explicit `hideBubble()`.
- [ ] A line stays visible after its Promise resolves; the game calls
      `hideBubble()` when gameplay resumes.
- [ ] A new line replaces the old one; the old Promise settles without a console
      error.
- [ ] A long line scrolls inside the bubble and shows the down arrow.
- [ ] `up`/`down` scroll a long bubble and are ignored when there is no overflow.
- [ ] Newlines (`\n`) create line breaks.
- [ ] Aborting a line removes it and produces a handled `AbortError`.
- [ ] `hideBubble()` on an already closed bubble is harmless.

## Choices

- [ ] The panel uses the intended position and does not overlap a visible bubble.
- [ ] Keyboard navigation skips disabled options.
- [ ] Mouse hover highlights; click selects; touch selects.
- [ ] Enter/Space/`z` confirms the selected value.
- [ ] Escape/`x` cancels only when `cancelValue` is supplied.
- [ ] The selected value reaches game state exactly once.
- [ ] `inputDelay` prevents accidental immediate confirmation without making the
      panel feel unresponsive.
- [ ] A choice list with no enabled entries fails predictably (rejected Promise).
- [ ] Replacing an open panel rejects the old call with `AbortError`; the old
      branch does not apply game effects.
- [ ] Focus returns to the previous element after settling.
- [ ] Scrolling works when the list is taller than the layer.

## Input integration

- [ ] Movement, camera, combat, and interaction are blocked while
      `isDialogVisible()` is true.
- [ ] Host keyboard handlers do not act on keys consumed by the dialog.
- [ ] Gamepad actions are edge-triggered and advance exactly one step.
- [ ] On-screen controls send `confirm` once; the global pointerdown handler does
      not double-advance.
- [ ] Clicking the game world while a line is visible advances the line and does
      not also move/attack.
- [ ] After the last line is hidden, `isDialogVisible()` is false and gameplay
      resumes.
- [ ] Tab/window focus changes do not leave stale dialogs or stuck input.

## Anchors and layout

- [ ] DOM anchors point at the intended element.
- [ ] Numeric anchors are in layer-local CSS pixels, not world units or canvas
      backing-store pixels.
- [ ] The bubble flips below the anchor when there is no room above.
- [ ] The tail stays away from bubble corners.
- [ ] Unanchored lines appear as a bottom narrator bar with no tail.
- [ ] Resizing the window/layer repositions the bubble.
- [ ] A transformed/scaled stage still receives the tail at the right point.
- [ ] Camera motion during dialogue is frozen or the dialog is screen-space.
- [ ] Off-screen or destroyed anchors are handled (close the dialog, do not
      throw).

## Visual, mobile, and accessibility

- [ ] Layer z-index is above the canvas and below any host modal that must win.
- [ ] The UI is readable on desktop and mobile.
- [ ] Notches, rounded corners, and gesture bars are respected via safe areas.
- [ ] `viewport-fit=cover` is set in the host document if the game is full-screen.
- [ ] The layer does not block canvas clicks except over choice panels and
      scrollable bubble text.
- [ ] Reduced-motion preference disables the blinking arrow animation.
- [ ] Screen readers get the full line once, not one character per node.
- [ ] Text remains readable in high-contrast/forced-colors modes or has a
      deliberate fallback.
- [ ] Choice panels have at least a 44 px touch target at the default UI unit.

## Edge cases

- [ ] Two systems triggering dialogue at once do not interleave lines (queue or
      abort policy is deliberate).
- [ ] Scene transition during typing and during choice selection both settle
      cleanly.
- [ ] Pause menu, inventory, and other host modals cannot open underneath a
      choice panel unless intended.
- [ ] Multiple game instances on one page are either unsupported and prevented,
      or use per-call roots with a single documented dialog owner.
- [ ] Localization length changes do not overflow the bubble or hide options.
- [ ] HMR/dev reload does not leave duplicate `.jrpg-layer` elements or duplicate
      listeners in the host.

## Build and release

- [ ] Host typecheck passes.
- [ ] Host lint passes (no unused imports, no floating Promises).
- [ ] Production build includes the jrpg-ui CSS and JS once.
- [ ] No `console.error` noise during a normal dialogue session.
- [ ] Bundle size impact is understood (the library is small; CSS is part of the
      build).
- [ ] The host's supported browsers match the library target (modern ESM,
      `Intl.Segmenter` optional).
