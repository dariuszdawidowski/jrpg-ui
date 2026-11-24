/**
 * jrpg-ui
 *
 * Shared infrastructure for the JRPG-UI widgets: configuration, the UI layer,
 * DOM helpers, and the input router used by bubbles and choices.
 */

/** Abstract input actions. You can send them manually (e.g. from a gamepad) via sendInput(). */
export type Action = 'confirm' | 'cancel' | 'up' | 'down'

export interface DialogConfig {
  /** UI layer container. When not <body>, it should have position: relative/absolute. */
  root: HTMLElement | null
  /** Extra CSS class for the layer (theme switching). */
  theme: string
  cps: number
  inputDelay: number
  /** Pause in ms after a given character (e.g. '.': 280). Replaces the whole table. */
  pauses: Record<string, number>
  /** Keys (KeyboardEvent.key values, case-insensitive). */
  keys: Record<Action, string[]>
}

const config: DialogConfig = {
  root: null,
  theme: '',
  cps: 30,
  inputDelay: 150,
  pauses: { '.': 280, '!': 280, '?': 280, '…': 320, ',': 140, ';': 160, ':': 160, '—': 160 },
  keys: {
    confirm: ['Enter', ' ', 'z'],
    cancel: ['Escape', 'x'],
    up: ['ArrowUp', 'ArrowLeft', 'w'],
    down: ['ArrowDown', 'ArrowRight', 's'],
  },
}

/**
 * Applies a partial configuration patch.
 *
 * @param patch - Values merged into the shared configuration. The `keys`
 *   object is merged per action, so omitted actions keep their current keys.
 */
export function configure(
  patch: Partial<Omit<DialogConfig, 'keys'>> & { keys?: Partial<DialogConfig['keys']> },
): void {
  const { keys, ...rest } = patch
  Object.assign(config, rest)
  if (keys) Object.assign(config.keys, keys)
}

/** Returns the shared configuration. Treat the result as read-only. */
export function getConfig(): Readonly<DialogConfig> {
  return config
}

// ─────────────────────────────────────────────────────────────────────
// Input routing
// ─────────────────────────────────────────────────────────────────────

/** Receives routed input actions. */
export interface InputTarget {
  /** Returns true if the action was consumed. */
  onAction(action: Action): boolean
}

export type DialogKind = 'bubble' | 'choices'

const targets: Record<DialogKind, InputTarget | null> = {
  bubble: null,
  choices: null,
}

/**
 * Registers the active widget as the receiver for input actions.
 * Choices take priority over bubbles when both are registered.
 */
export function registerInputTarget(kind: DialogKind, target: InputTarget): void {
  targets[kind] = target
}

/**
 * Clears a widget's registration if it is still the active target.
 *
 * @param kind - Widget kind that owns the target.
 * @param target - Instance previously passed to registerInputTarget().
 */
export function unregisterInputTarget(kind: DialogKind, target: InputTarget): void {
  if (targets[kind] === target) targets[kind] = null
}

/** Whether any bubble or choice is currently visible (e.g. to block game input). */
export function isDialogVisible(): boolean {
  return targets.bubble !== null || targets.choices !== null
}

/**
 * Sends an action to the active window. Use it for a gamepad:
 *   if (padA.pressed) sendInput('confirm');
 * Returns true if the action was consumed.
 */
export function sendInput(action: Action): boolean {
  const target = targets.choices ?? targets.bubble
  return target ? target.onAction(action) : false
}

function keyToAction(key: string): Action | null {
  const k = key.toLowerCase()
  for (const action of Object.keys(config.keys) as Action[]) {
    if (config.keys[action].some((x) => x.toLowerCase() === k)) return action
  }
  return null
}

let listening = false

/** Installs the shared keyboard and pointer listeners once. */
export function ensureInputListeners(): void {
  if (listening) return
  listening = true

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const action = keyToAction(e.key)
    if (!action) return
    // A held key should not skip through consecutive lines.
    if (e.repeat && (action === 'confirm' || action === 'cancel')) return
    if (sendInput(action)) e.preventDefault()
  })

  document.addEventListener('pointerdown', (e) => {
    // While choices are visible, their buttons handle clicks (the click event).
    if (e.button !== 0 || targets.choices) return
    sendInput('confirm')
  })
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Clamps a number to the inclusive [min, max] range. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/** Returns the abort reason for a signal, or a new AbortError when no reason is set. */
export function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Creates a div with the given class name and optional text. */
export function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

/** UI layer inside the container (created on first use). */
export function getLayer(rootOpt?: HTMLElement): HTMLElement {
  const root = rootOpt ?? config.root ?? document.body
  let layer = root.querySelector<HTMLElement>(':scope > .pxd-layer')
  if (!layer) {
    layer = document.createElement('div')
    if (root !== document.body && getComputedStyle(root).position === 'static') {
      root.style.position = 'relative'
    }
    root.appendChild(layer)
  }
  layer.className = ['pxd-layer', root === document.body ? 'pxd-layer--fixed' : '', config.theme]
    .filter(Boolean)
    .join(' ')
  return layer
}
