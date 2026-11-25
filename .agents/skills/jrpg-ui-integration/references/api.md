# jrpg-ui API reference (0.2.0)

Framework-agnostic DOM widgets for JRPG dialogue. Everything is browser-only ESM.
The public entry point exports:

```ts
export { configure, isDialogVisible, sendInput } from './jrpg-ui'
export type { Action, DialogConfig } from './jrpg-ui'
export { hideBubble, showBubble } from './jrpg-ui-bubble'
export type { Anchor, BubbleOptions } from './jrpg-ui-bubble'
export { showChoices } from './jrpg-ui-choices'
export type { Choice, ChoicesOptions } from './jrpg-ui-choices'
```

The global configuration is shared by all widgets. There is exactly one active
bubble and one active choice panel per page.

---

## configure()

```ts
function configure(
  patch: Partial<Omit<DialogConfig, 'keys'>> & {
    keys?: Partial<DialogConfig['keys']>
  },
): void
```

Applies a shallow patch to the shared configuration. `keys` merges per action;
every other field replaces the current value. `pauses` is replaced as a whole
table, not merged.

```ts
configure({
  root: gameRoot,
  theme: 'my-theme',
  cps: 35,
  keys: { confirm: ['Enter', ' ', 'z'] },
})
```

`DialogConfig`:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | `HTMLElement \| null` | `null` | Layer container. `null` means `<body>` (fixed, full-viewport layer). |
| `theme` | `string` | `''` | Extra class on `.jrpg-layer` for theme switching. |
| `cps` | `number` | `30` | Characters per second for the typewriter. `0` or `Infinity` means instant. |
| `inputDelay` | `number` | `150` | Milliseconds after choices appear during which confirmation/clicks are ignored. |
| `pauses` | `Record<string, number>` | `{ '.': 280, '!': 280, '?': 280, '…': 320, ',': 140, ';': 160, ':': 160, '—': 160 }` | Extra pause in ms after a character. Replaces the whole table. |
| `keys` | `Record<Action, string[]>` | confirm: Enter, Space, `z`; cancel: Escape, `x`; up: ArrowUp, ArrowLeft, `w`; down: ArrowDown, ArrowRight, `s` | `KeyboardEvent.key` values, compared case-insensitively. |

`Action` is `'confirm' | 'cancel' | 'up' | 'down'`.

Configuration is not validated. Invalid CSS selectors or roots fail later when
the layer is created.

---

## showBubble()

```ts
function showBubble(text: string, options?: BubbleOptions): Promise<void>
```

Shows a speech bubble, types the text, and resolves when the contract in
`options.waitForInput` is met. The bubble **remains on screen after resolution**
until `hideBubble()` is called or another bubble replaces it.

`BubbleOptions`:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `anchor` | `Anchor` | none | Tail target. Without it the bubble becomes a narrator bar at the bottom. |
| `speaker` | `string` | none | Speaker name above the text. |
| `cps` | `number` | `configure().cps` | Per-bubble typing speed. |
| `waitForInput` | `boolean` | `true` | `true`: resolve after typing **and** confirmation. `false`: resolve as soon as typing finishes. |
| `onChar` | `(char: string, index: number) => void` | none | Called for each revealed non-whitespace character. Does not fire while skipping. |
| `signal` | `AbortSignal` | none | Aborting removes the bubble and rejects with `AbortError`. |
| `root` | `HTMLElement` | `configure().root` or `<body>` | Layer override for this call. |

`Anchor` is either `HTMLElement` or `{ x: number; y: number }`.

Behaviour:

- **Typing**: grapheme-aware (`Intl.Segmenter` when available). The first
  `confirm` while typing reveals the whole line; the next `confirm` resolves.
  Hold-repeat for confirm/cancel is ignored to avoid skipping lines.
- **Timing**: `cps <= 0` or non-finite `cps` shows text instantly. Pauses are
  skipped between repeated punctuation and before closing quotes/brackets. After
  a tab wake-up the typewriter does not fast-forward through a backlog.
- **Text**: plain text only (`textContent`), `\n` preserved, long text scrolls
  inside the bubble. A blinking down arrow appears only when content remains
  below the visible area; `up`/`down` scroll it when it overflows.
- **Anchoring**: a DOM anchor points the tail at the element's top edge, or its
  bottom edge when there is not enough room above. Element rects are converted
  back into layer CSS pixels when the layer is transform-scaled.
- **Positioning lifecycle**: position is recalculated when shown and when the
  layer resizes. It does not follow camera motion, scrolling, or moving entities.
- **Replacement**: showing a new bubble closes the previous one and resolves its
  Promise. `hideBubble()` also resolves a pending bubble rather than rejecting.
- **Abort**: removes the bubble, rejects, and unregisters input.
- **Fonts**: waits for `document.fonts.ready` before measuring layout.
- **Accessibility**: the bubble is `role="status"`; the full speaker/text line is
  exposed once in a visually hidden node, while animated characters are hidden
  from assistive technology.

Without an anchor the bubble uses `.jrpg-bubble--free`: a bottom-anchored
narrator bar, centered, no tail.

---

## hideBubble()

```ts
function hideBubble(): void
```

Removes the current bubble and resolves its pending Promise. Safe to call when
no bubble exists or when the bubble already resolved. Use it when gameplay
resumes after a line.

---

## showChoices()

```ts
function showChoices<T>(
  choices: Choice<T>[],
  options?: ChoicesOptions<T>,
): Promise<T>
```

Shows an answer panel and resolves with the selected option's `value`.

```ts
interface Choice<T> {
  label: string
  value: T
  disabled?: boolean
}
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `position` | `'bottom-right' \| 'bottom-left' \| 'bottom-center' \| 'center'` | `'bottom-right'` | Panel placement inside the layer. |
| `initialIndex` | `number` | `0` | Initially selected index, clamped. If disabled, moves to the next enabled option. |
| `cancelValue` | `T` | absent | When the key is present, `cancel`/Escape resolves with this value. When absent, cancellation is disabled. |
| `inputDelay` | `number` | `configure().inputDelay` | Confirmation and clicks are ignored for this many ms after opening. Navigation still works. |
| `signal` | `AbortSignal` | none | Aborting removes the panel and rejects with `AbortError`. |
| `root` | `HTMLElement` | `configure().root` or `<body>` | Layer override for this call. |

Behaviour:

- At least one enabled option is required. Otherwise the returned Promise is
  rejected with `Error('showChoices: at least one enabled option is required')`.
- Replacing an open panel rejects the previous Promise with
  `DOMException('Replaced by a new choice', 'AbortError')`.
- Disabled options are visible, marked `aria-disabled`, skipped by navigation,
  and ignore clicks.
- Controls: arrows/W/S (up/down), Enter/Space/Z (confirm), Escape/X (cancel only
  with `cancelValue`), mouse hover/click, touch, and `sendInput()`.
- On settle or abort the panel is removed, input unregisters, and previous focus
  is restored.
- Choices do **not** hide a bubble. Hide it first to avoid overlap.

---

## isDialogVisible()

```ts
function isDialogVisible(): boolean
```

Returns true while a bubble or choice panel is registered. A bubble remains
registered after its Promise resolves while it is still on screen, so
`isDialogVisible()` stays true until `hideBubble()` or replacement. Use it to
block gameplay input/update.

---

## sendInput()

```ts
function sendInput(action: Action): boolean
```

Routes an abstract action to the active widget. Choices take priority over
bubbles. Returns true if the action was consumed. Use it for gamepads, on-screen
controls, and automated tests.

```ts
if (padConfirmPressed && !padConfirmHeld) sendInput('confirm')
```

---

## Errors and rejection behaviour

| Situation | Result |
| --- | --- |
| `showBubble` / `showChoices` aborted by signal | Rejects with `AbortError` (`DOMException`) or the signal's reason. |
| New bubble while one is visible | Previous Promise resolves; previous bubble is removed. |
| New choice panel while one is open | Previous Promise rejects with `AbortError`. |
| `showBubble` with a signal already aborted | Rejects immediately. |
| `showChoices` with no enabled option | Rejected `Error` (not a synchronous throw). |
| Invalid choice index | Clamped to the list range. |
| Bubble dismissed via `hideBubble` | Promise resolves, not rejects. |

`AbortError` is expected control flow; do not log it as a failure.

---

## CSS integration

Load the compiled default theme once:

```ts
import 'jrpg-ui/style.css'
```

It contains the shared layer/tokens, bubble styles, and choice styles in cascade
order.

### Classes

```text
.jrpg-layer                         overlay layer (--fixed when root = <body>)
  .jrpg-bubble                      bubble (--below, --free; .jrpg-done, .jrpg-wait, .jrpg-scroll)
    .jrpg-name                        speaker name
    .jrpg-text                        scrollable text
      .jrpg-ch                        one character (.jrpg-on = revealed)
    .jrpg-tail                        tail
    .jrpg-next                        scroll hint arrow
    .jrpg-sr                          screen-reader-only full text
  .jrpg-choices                     answer panel (--bottom-right | --bottom-left | --bottom-center | --center)
    .jrpg-list                        scrollable listbox
      .jrpg-choice                    option (.jrpg-selected, .jrpg-disabled)
```

The layer is `position: absolute; inset: 0; pointer-events: none`. Choice panels
opt back into pointer events; scrollable bubble text does too.

### Design tokens

Defaults live in `:where(.jrpg-layer)`, so any host rule wins regardless of
stylesheet order.

```css
.jrpg-layer.my-theme {
  --jrpg-u: 4px;              /* UI pixel: border width, steps, spacing */
  --jrpg-bg: #1a1a2e;
  --jrpg-border: #f5f1e6;
  --jrpg-text: #f5f1e6;
  --jrpg-accent: #ffd23f;
  --jrpg-muted: #6e6e8f;
  --jrpg-font: "Press Start 2P", "Pixelify Sans", ui-monospace, monospace;
  --jrpg-font-size: 16px;
  --jrpg-line-height: 1.75;
  --jrpg-pad-x: calc(var(--jrpg-u) * 3);
  --jrpg-pad-y: calc(var(--jrpg-u) * 3);
  --jrpg-gap: calc(var(--jrpg-u) * 3);
  --jrpg-edge: calc(var(--jrpg-u) * 4);
  --jrpg-bubble-max: 420px;
  --jrpg-text-max: calc(var(--jrpg-u) * 35);
  --jrpg-z: 1000;
  --jrpg-safe-t: max(var(--jrpg-edge), env(safe-area-inset-top, 0px));
  --jrpg-safe-r: max(var(--jrpg-edge), env(safe-area-inset-right, 0px));
  --jrpg-safe-b: max(var(--jrpg-edge), env(safe-area-inset-bottom, 0px));
  --jrpg-safe-l: max(var(--jrpg-edge), env(safe-area-inset-left, 0px));
}
```

`--jrpg-gap` is both the visual gap and the tail height; JS reads the bubble's
computed `margin-bottom` to position it. Keep the CSS and JS in sync by changing
the token, not the margins.

### Styling strategies

1. Override tokens on `.jrpg-layer` or a theme class passed to `configure()`.
2. Override the classes themselves (`.jrpg-bubble`, `.jrpg-choice`, ...).
3. Skip `jrpg-ui/style.css` entirely and write custom CSS for the same classes.

Option 3 means the host owns all layout-critical rules, including layer
positioning, pointer events, bubble margins, and choice positioning.
