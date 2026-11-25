# Integration patterns

Copy and adapt these patterns to the host project. They deliberately contain no
game-specific logic: keep dialogue content, quests, inventory, and scene state in
the host code.

---

## 1. Bootstrap (vanilla TypeScript)

`src/main.ts`:

```ts
import 'jrpg-ui/style.css'
import { configure } from 'jrpg-ui'
import { Game } from './game'

const root = document.querySelector<HTMLElement>('#game')
if (!root) throw new Error('Missing #game')

configure({
  root,
  cps: 35,
  keys: {
    confirm: ['Enter', ' ', 'z'],
    cancel: ['Escape', 'x'],
    up: ['ArrowUp', 'ArrowLeft', 'w'],
    down: ['ArrowDown', 'ArrowRight', 's'],
  },
})

const game = new Game(root)
game.start()
```

Load the CSS exactly once. If the host uses a global stylesheet entry instead of
the script entry, put the import there and keep it single.

---

## 2. Dialogue adapter

One module owns jrpg-ui calls. It gives the rest of the game a small, safe API
and prevents concurrent dialogs from fighting.

`src/ui/dialogue.ts`:

```ts
import { hideBubble, showBubble, showChoices } from 'jrpg-ui'
import type { Anchor, Choice } from 'jrpg-ui'

/** Abort is normal control flow: a dialog was replaced or its scene ended. */
export function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError'
}

export class Dialogue {
  private controller: AbortController | null = null

  /** Cancels the previous conversation and returns the new scene signal. */
  begin(): AbortSignal {
    this.controller?.abort()
    this.controller = new AbortController()
    return this.controller.signal
  }

  /** Cancels pending widgets and removes any visible line. */
  end(): void {
    this.controller?.abort()
    this.controller = null
    hideBubble()
  }

  /** Shows one line. Returns false when a newer dialog or scene aborted it. */
  async say(
    text: string,
    options: {
      speaker?: string
      anchor?: Anchor
      waitForInput?: boolean
    } = {},
  ): Promise<boolean> {
    const signal = this.begin()
    try {
      await showBubble(text, { ...options, signal })
      return true
    } catch (error) {
      if (isAbortError(error)) return false
      throw error
    }
  }

  /** Shows a prompt, then choices. Returns undefined when aborted. */
  async ask<T>(
    prompt: string,
    choices: Choice<T>[],
    options: {
      speaker?: string
      anchor?: Anchor
      cancelValue?: T
    } = {},
  ): Promise<T | undefined> {
    const signal = this.begin()
    try {
      await showBubble(prompt, {
        speaker: options.speaker,
        anchor: options.anchor,
        waitForInput: false,
        signal,
      })
      hideBubble()

      return await showChoices(choices, {
        position: 'bottom-right',
        signal,
        ...(options.cancelValue === undefined
          ? {}
          : { cancelValue: options.cancelValue }),
      })
    } catch (error) {
      if (isAbortError(error)) return undefined
      throw error
    }
  }
}
```

`say()` leaves the line visible after confirmation, matching JRPG behaviour. The
caller closes the conversation with `dialogue.end()` (or the next line replaces
it). If gameplay should resume immediately after each line, call `hideBubble()`
right after `await dialogue.say(...)`.

The spread for `cancelValue` is intentional: the option enables cancellation only
when the key exists. Passing `cancelValue: undefined` explicitly is different
from omitting it in JavaScript, but the spread keeps both paths unambiguous for
TypeScript.

If the host enables `exactOptionalPropertyTypes`, build option objects with
conditional spreads as above when a value may be `undefined`; otherwise passing
`speaker: undefined` is a type error.

### Alternative: queue instead of abort

If overlapping triggers should wait rather than cancel each other, serialize the
whole conversation instead of calling `begin()` for every line:

```ts
let tail: Promise<unknown> = Promise.resolve()

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.catch(() => undefined)
  return run
}
```

Use one strategy, not both. Queueing still needs a scene-level abort controller
to cancel when the player leaves.

---

## 3. Scene lifecycle

Tie dialogs to the scene that owns them:

```ts
import { isDialogVisible } from 'jrpg-ui'
import { Dialogue } from '../ui/dialogue'

export class FieldScene {
  private dialogue = new Dialogue()

  update(dt: number): void {
    if (isDialogVisible()) return
    // movement, NPC interaction, camera, combat...
  }

  async talkTo(npc: { name: string; line: string }): Promise<void> {
    await this.dialogue.say(npc.line, { speaker: npc.name })
    // Line remains visible; wait for the next trigger or close below.
  }

  leave(): void {
    this.dialogue.end()
  }
}
```

Call `leave()` from the scene teardown, route change, or unmount. It aborts
pending lines/choices and removes the bubble.

If a scene starts while a choice is open, its `AbortError` propagates to the old
`ask()` call, which returns `undefined`. Treat `undefined` as "aborted" and do
not apply the choice's game effects.

---

## 4. React

`GameShell.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { configure, hideBubble } from 'jrpg-ui'
import 'jrpg-ui/style.css'

export function GameShell({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    configure({ root, cps: 35 })
    return () => {
      hideBubble()
      configure({ root: null })
    }
  }, [])

  return (
    <div ref={rootRef} className="game-root">
      {children}
    </div>
  )
}
```

```css
.game-root {
  position: relative;
  overflow: hidden;
  width: min(960px, 100vw);
  aspect-ratio: 16 / 9;
}
```

Rules:

- Never call `configure()` during render. Do it in an effect or app bootstrap.
- Trigger dialogue from event handlers/effects after the root is mounted.
- React StrictMode runs the effect twice in development. The cleanup resets the
  root to `<body>` and the next setup restores it; this is harmless as long as no
  dialog is open at that exact moment.
- Keep the adapter in a module (or a ref) so re-renders do not create a new
  AbortController and cancel the current line.
- Do not use a React portal for the layer; jrpg-ui must create `.jrpg-layer`
  directly inside the configured root.

Svelte, Vue, Solid, and similar frameworks follow the same lifecycle: configure
after the game element is mounted, keep one long-lived adapter, and abort/cleanup
on destroy. Do not configure from a computed value or render function.

---

## 5. Canvas projection

Numeric anchors use the UI layer's CSS pixel space. Project the speaker's world
position through the camera:

```ts
export interface Camera {
  /** World coordinate at the canvas's left edge. */
  x: number
  /** World coordinate at the canvas's top edge. */
  y: number
  /** World units per canvas CSS pixel. */
  zoom: number
}

/** World point → jrpg-ui anchor in layer CSS pixels. */
export function worldToAnchor(
  worldX: number,
  worldY: number,
  camera: Camera,
  canvas: HTMLCanvasElement,
  layer: HTMLElement,
): { x: number; y: number } {
  const c = canvas.getBoundingClientRect()
  const l = layer.getBoundingClientRect()
  // Numeric anchors are in the layer's untransformed local CSS pixel space.
  const layerScale = layer.offsetWidth ? l.width / layer.offsetWidth : 1
  const offsetX = (c.left - l.left) / layerScale
  const offsetY = (c.top - l.top) / layerScale

  return {
    x: offsetX + (worldX - camera.x) * camera.zoom,
    y: offsetY + (worldY - camera.y) * camera.zoom,
  }
}
```

Usage:

```ts
const npcX = npc.x
const npcY = npc.y - npc.height / 2
await dialogue.say(npc.line, {
  speaker: npc.name,
  anchor: worldToAnchor(npcX, npcY, camera, canvas, gameRoot),
})
```

Adjust the formula if the renderer maps world units to canvas backing-store
pixels: convert to canvas CSS pixels first (divide by `devicePixelRatio` and any
CSS scaling), then to layer-local pixels.

Camera caveat: the bubble is positioned once when shown and on layer resize. It
does not follow the camera. During dialogue:

- freeze camera scrolling/pans and shake, or
- keep the bubble in screen space (narrator bar or fixed coordinates), or
- close and re-show the bubble after the camera settles.

Do not try to mutate `.jrpg-bubble`'s inline position from the game loop; it is
private implementation and will be overwritten by the next placement pass.

For DOM sprites, pass the element directly and skip projection:

```ts
await dialogue.say(npc.line, { speaker: npc.name, anchor: npc.element })
```

---

## 6. Phaser / PixiJS notes

- **Phaser**: project world coordinates with the scene camera. Account for the
  camera viewport offset and zoom, for example
  `screenX = (worldX - camera.scrollX) * camera.zoom + camera.x`. Stop camera
  follow/scroll while a dialog is visible (`isDialogVisible()`).
- **PixiJS**: `app.stage.toGlobal(point)` yields renderer screen coordinates.
  Convert them to the layer's local CSS pixels by subtracting the canvas offset
  and dividing by the renderer resolution / CSS scale. Pause any camera container
  movement while dialogue is open.
- **Three.js or custom WebGL**: project with the camera's projection matrix to
  normalized device coordinates, then convert NDC to canvas CSS pixels, then to
  layer-local pixels. Clamp off-screen anchors or hide the bubble when the
  speaker is behind the camera.
- In all engines, the HTML layer must sit above the canvas with a stable
  z-index. Do not let engine pointer systems swallow clicks over choice panels.

---

## 7. Gamepad and on-screen controls

Poll gamepads in the same loop that already reads movement, and edge-trigger
dialog actions:

```ts
import { sendInput } from 'jrpg-ui'
import type { Action } from 'jrpg-ui'

const previous = new Map<number, boolean>()

export function pollDialogPad(): void {
  const pad = navigator.getGamepads()[0]
  if (!pad) return

  const check = (index: number, action: Action): void => {
    const pressed = pad.buttons[index]?.pressed ?? false
    if (pressed && !previous.get(index)) sendInput(action)
    previous.set(index, pressed)
  }

  check(0, 'confirm') // south face button (A / cross)
  check(1, 'cancel') // east face button (B / circle)
  check(12, 'up')
  check(13, 'down')
  check(14, 'up')
  check(15, 'down')
}
```

`sendInput()` returns `false` when nothing consumes the action, so it is safe to
call while gameplay is active.

On-screen buttons must avoid the library's document-level pointerdown handler:

```ts
okButton.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  // Otherwise the document handler also sends confirm for the same tap.
  event.stopPropagation()
  sendInput('confirm')
})
```

Alternatively, do not bind the button at all while a bubble is visible and let
the global "tap anywhere to advance" behaviour handle it.

---

## 8. Typewriter blips and effects

Use `onChar` for a per-character sound. It fires only for revealed
non-whitespace characters and not during a skip.

```ts
const blip = new Audio('/audio/blip.wav')
let lastBlipAt = 0

const options = {
  speaker: npc.name,
  onChar: () => {
    const now = performance.now()
    if (now - lastBlipAt < 55) return
    lastBlipAt = now
    blip.currentTime = 0
    void blip.play()
  },
}

await showBubble(npc.line, options)
```

Throttle the sound; at 30 cps an unthrottled sample becomes noise. Audio must be
unlocked by a user gesture according to browser autoplay rules.

---

## 9. Content, localization, and text

- jrpg-ui renders plain text with `textContent`. HTML, BBCode, and rich-text tags
  appear literally. Use `\n` for line breaks.
- Keep dialogue lines in the host's existing data/localization format and pass
  only the translated string to the widget. Speaker names are plain text too.
- Typewriter pacing may need adjustment per language; `cps` can be set globally
  or per line.
- Long lines scroll inside `--jrpg-text-max`. Do not pre-split content only to
  dodge scrolling; test the longest translated line.
- Choices are labels plus typed values. Keep values stable identifiers
  (`'accept'`, `'decline'`, IDs), never localized display text.

---

## 10. Migrating an existing dialogue system

Do not replace the host's dialogue data or scene logic wholesale. Wrap it:

1. Inventory the existing model: text, speaker, choices, conditions, branching,
   localization keys, side effects, and voice/sound hooks.
2. Add a thin renderer boundary: `renderLine(node)`, `renderChoices(node)`. Keep
   branching and side effects in the host, outside the UI layer.
3. Map each node to `showBubble`/`showChoices`; map the selected `value` back to
   the host's next node.
4. Keep one adapter per scene and abort it when leaving the scene or starting a
   new conversation.
5. Migrate one complete conversation first (line, choice, branch, return), then
   enable the adapter broadly once replacement and abort paths are verified.
6. Preserve existing localization keys and content. jrpg-ui renders plain text;
   convert markup to plain text rather than injecting HTML.
7. Delete the old renderer only after the new adapter covers its behaviour and
   the host's tests/typecheck pass.

If the host has an automated dialogue test harness, assert on game state changes
after choices rather than on DOM internals; the widget DOM is private.

## 11. Common integration mistakes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Widgets are unstyled or sit in the page corner | Stylesheet not imported | Import `jrpg-ui/style.css` once |
| Bubble at the wrong place or clipped | Root is not the game stage, or root is static/unclipped | Configure the stage element; set `position: relative; overflow: hidden` |
| Player moves while reading | Update loop ignores dialog state | `if (isDialogVisible()) return` |
| Game is permanently blocked after a line | Bubble resolved but still visible/registered | Call `hideBubble()` before resuming gameplay |
| Enter/arrow also triggers game actions | Host keydown listener still runs | Gate host input; `preventDefault` does not stop propagation |
| One tap advances twice | Custom button sends confirm and the global pointer handler also does | `event.stopPropagation()` or bind only one path |
| Choice panel and bubble overlap | `showChoices` does not hide bubbles | `hideBubble()` before `showChoices` |
| Bubble stays behind after a scene transition | Pending dialog not aborted | Abort the scene controller and call `hideBubble()` |
| Unhandled `AbortError` in console | Replacement/scene abort treated as failure | Catch and treat `AbortError` as control flow |
| Bubble lags behind moving NPC/camera | Position is computed once | Freeze camera/entity or keep dialog screen-space |
| Tail points at the wrong spot in a scaled stage | Anchor mixed canvas/world/scaled units | Project to layer-local CSS pixels |
| Text is too big/small on a pixel font | Font size not on the pixel grid | Use multiples; load the font via `@font-face` |
| Choice click ignored right after opening | `inputDelay` guard | Lower `inputDelay` or wait before clicking |
| Escape closes an underlying menu while choices are open | No `cancelValue` | Supply `cancelValue` or gate the menu |
