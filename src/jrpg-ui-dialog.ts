/**
 * jrpg-ui-dialog
 *
 * Two independent Promise-based functions called from game code:
 *   - showBubble(text, opts)    speech bubble with a typewriter effect
 *   - showChoices(choices, opts) answer selection
 *
 * Everything is an HTML overlay on top of the game (canvas). Styling lives in jrpg-ui-dialog.css.
 *
 * Requires ES2020+ and DOM. In tsconfig, prefer "target": "ES2022".
 */

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** Abstract input actions. You can send them manually (e.g. from a gamepad) via sendInput(). */
export type Action = 'confirm' | 'cancel' | 'up' | 'down';

/**
 * Point the bubble tail points at.
 * - { x, y }: CSS pixel coordinates relative to the UI layer (i.e. the game container)
 * - HTMLElement: the tail points at the element's top (or bottom) edge, horizontally centered
 */
export type Anchor = HTMLElement | { x: number; y: number };

export interface BubbleOptions {
  /** Where the tail should point. Without it: a narrator bar at the bottom of the screen, no tail. */
  anchor?: Anchor;
  /** Speaker name displayed above the text. */
  speaker?: string;
  /** Characters per second. 0 / Infinity = instant text. Defaults to configure(). */
  cps?: number;
  /**
   * true (default): the Promise resolves after the text is typed AND the player confirms.
   * false: resolves as soon as the text is typed (useful right before showChoices).
   */
  waitForInput?: boolean;
  /** Called after each visible character is revealed (spaces and enter skipped). Hook up a "blip" here. */
  onChar?: (char: string, index: number) => void;
  /** Abort: the bubble disappears and the Promise rejects with AbortError. */
  signal?: AbortSignal;
  /** UI layer container. Defaults to configure() or document.body. */
  root?: HTMLElement;
}

export interface Choice<T> {
  label: string;
  value: T;
  /** Visible but not selectable. */
  disabled?: boolean;
}

export interface ChoicesOptions<T> {
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'center';
  /** Which option is selected initially (defaults to the first enabled one). */
  initialIndex?: number;
  /** If provided, Escape / "cancel" returns this value. Without it, cancellation is disabled. */
  cancelValue?: T;
  /** How many ms after the options appear to ignore confirmation (protects against accidental clicks). */
  inputDelay?: number;
  signal?: AbortSignal;
  root?: HTMLElement;
}

export interface DialogConfig {
  /** UI layer container. When not <body>, it should have position: relative/absolute. */
  root: HTMLElement | null;
  /** Extra CSS class for the layer (theme switching). */
  theme: string;
  cps: number;
  inputDelay: number;
  /** Pause in ms after a given character (e.g. '.': 280). Replaces the whole table. */
  pauses: Record<string, number>;
  /** Keys (KeyboardEvent.key values, case-insensitive). */
  keys: Record<Action, string[]>;
}

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

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
};

export function configure(
  patch: Partial<Omit<DialogConfig, 'keys'>> & { keys?: Partial<DialogConfig['keys']> },
): void {
  const { keys, ...rest } = patch;
  Object.assign(config, rest);
  if (keys) Object.assign(config.keys, keys);
}

// ─────────────────────────────────────────────────────────────────────
// Internal state: one bubble and one choice at a time
// ─────────────────────────────────────────────────────────────────────

interface BubbleState {
  /** Returns true if the action was consumed. */
  onAction(action: Action): boolean;
  /** Closes the bubble; the pending Promise resolves. */
  close(): void;
}

interface ChoicesState {
  onAction(action: Action): boolean;
  abort(reason: unknown): void;
}

let bubbleState: BubbleState | null = null;
let choicesState: ChoicesState | null = null;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError');
}

function div(className: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Intl.Segmenter splits into graphemes (emoji, combined characters). Fallback: code points.
type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> };

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** UI layer inside the container (created on first use). */
function getLayer(rootOpt?: HTMLElement): HTMLElement {
  const root = rootOpt ?? config.root ?? document.body;
  let layer = root.querySelector<HTMLElement>(':scope > .pxd-layer');
  if (!layer) {
    layer = document.createElement('div');
    if (root !== document.body && getComputedStyle(root).position === 'static') {
      root.style.position = 'relative';
    }
    root.appendChild(layer);
  }
  layer.className = ['pxd-layer', root === document.body ? 'pxd-layer--fixed' : '', config.theme]
    .filter(Boolean)
    .join(' ');
  return layer;
}

function resolveAnchor(anchor: Anchor, layer: HTMLElement): { x: number; yTop: number; yBottom: number } {
  if (!(anchor instanceof HTMLElement)) return { x: anchor.x, yTop: anchor.y, yBottom: anchor.y };
  const r = anchor.getBoundingClientRect();
  const l = layer.getBoundingClientRect();
  // If the game container is scaled by a transform, convert back to the layer's CSS pixels.
  const scale = layer.offsetWidth ? l.width / layer.offsetWidth : 1;
  return {
    x: (r.left + r.width / 2 - l.left) / scale,
    yTop: (r.top - l.top) / scale,
    yBottom: (r.bottom - l.top) / scale,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Input: one router for keyboard, touch/mouse, and any source (gamepad)
// ─────────────────────────────────────────────────────────────────────

/** Whether any bubble or choice is currently visible (e.g. to block game input). */
export function isDialogVisible(): boolean {
  return bubbleState !== null || choicesState !== null;
}

/**
 * Sends an action to the active window. Use it for a gamepad:
 *   if (padA.pressed) sendInput('confirm');
 * Returns true if the action was consumed.
 */
export function sendInput(action: Action): boolean {
  if (choicesState) return choicesState.onAction(action);
  if (bubbleState) return bubbleState.onAction(action);
  return false;
}

function keyToAction(key: string): Action | null {
  const k = key.toLowerCase();
  for (const action of Object.keys(config.keys) as Action[]) {
    if (config.keys[action].some((x) => x.toLowerCase() === k)) return action;
  }
  return null;
}

let listening = false;
function ensureListeners(): void {
  if (listening) return;
  listening = true;

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = keyToAction(e.key);
    if (!action) return;
    // A held key should not skip through consecutive lines.
    if (e.repeat && (action === 'confirm' || action === 'cancel')) return;
    if (sendInput(action)) e.preventDefault();
  });

  document.addEventListener('pointerdown', (e) => {
    // While choices are visible, their buttons handle clicks (the click event).
    if (e.button !== 0 || choicesState) return;
    sendInput('confirm');
  });
}

// ─────────────────────────────────────────────────────────────────────
// Typewriter
// ─────────────────────────────────────────────────────────────────────

interface Typewriter {
  skip(): void;
  stop(): void;
}

function pauseAfter(char: string, next: string | undefined, pauses: Record<string, number>): number {
  const p = pauses[char] ?? 0;
  if (!p || next === undefined) return 0;
  // "..." or "?!" → pause only after the last character; same before a closing quote.
  if (next in pauses || /["'”’»)\]]/.test(next)) return 0;
  return p;
}

function typewrite(
  spans: HTMLElement[],
  chars: string[],
  cps: number,
  pauses: Record<string, number>,
  onChar: BubbleOptions['onChar'],
  onDone: () => void,
): Typewriter {
  let shown = 0;
  let raf = 0;
  let stopped = false;

  const reveal = (i: number) => spans[i].classList.add('pxd-on');
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    onDone();
  };

  const skip = () => {
    if (stopped) return;
    for (; shown < chars.length; shown++) reveal(shown);
    finish();
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };

  if (!(cps > 0) || !Number.isFinite(cps)) {
    queueMicrotask(skip);
    return { skip, stop };
  }

  const interval = 1000 / cps;
  let nextAt = 0;

  const tick = (now: number) => {
    if (stopped) return;
    // After the tab wakes from sleep, do not catch up with an avalanche of letters.
    if (!nextAt || now - nextAt > 250) nextAt = now;

    while (shown < chars.length && now >= nextAt) {
      const c = chars[shown];
      reveal(shown);
      shown++;
      if (!/^\s+$/.test(c)) {
        onChar?.(c, shown - 1);
        nextAt += interval + pauseAfter(c, chars[shown], pauses);
      }
    }

    if (shown >= chars.length) finish();
    else raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return { skip, stop };
}

// ─────────────────────────────────────────────────────────────────────
// showBubble
// ─────────────────────────────────────────────────────────────────────

/**
 * Shows a bubble with text typed character by character.
 *
 * The first confirmation while typing reveals the whole text; the next one ends the line.
 * After the Promise resolves the bubble stays on screen until you call
 * hideBubble() or show another bubble.
 */
export async function showBubble(text: string, options: BubbleOptions = {}): Promise<void> {
  const { anchor, speaker, signal, onChar } = options;
  const waitForInput = options.waitForInput ?? true;
  const cps = options.cps ?? config.cps;

  if (signal?.aborted) throw abortError(signal);
  // Measuring layout before the font loads would give wrong dimensions.
  if (document.fonts && document.fonts.status === 'loading') await document.fonts.ready;
  if (signal?.aborted) throw abortError(signal);

  ensureListeners();
  bubbleState?.close();

  const layer = getLayer(options.root);
  const chars = splitGraphemes(text);

  // ── DOM ──
  const el = div('pxd-bubble');
  el.setAttribute('role', 'status');
  if (!anchor) el.classList.add('pxd-bubble--free');

  if (speaker) {
    const name = div('pxd-name', speaker);
    name.setAttribute('aria-hidden', 'true');
    el.append(name);
  }

  const textEl = div('pxd-text');
  textEl.setAttribute('aria-hidden', 'true'); // screen readers get the full text from .pxd-sr, not one letter at a time
  const spans = chars.map((c) => {
    const s = document.createElement('span');
    s.className = 'pxd-ch';
    s.textContent = c;
    textEl.append(s);
    return s;
  });

  const sr = document.createElement('span');
  sr.className = 'pxd-sr';
  sr.textContent = speaker ? `${speaker}: ${text}` : text;

  const tail = div('pxd-tail');
  const next = div('pxd-next');
  el.append(textEl, sr, tail, next);
  layer.append(el);

  // ── Positioning: once at startup and when the layer is resized ──
  const place = () => {
    if (!anchor) return;
    const pt = resolveAnchor(anchor, layer);

    el.classList.remove('pxd-bubble--below');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const cs = getComputedStyle(layer);
    const padT = parseFloat(cs.paddingTop) || 0;
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const gap = parseFloat(getComputedStyle(el).marginBottom) || 0;

    const below = pt.yTop - h - gap < padT; // does not fit above the anchor → place it below
    el.classList.toggle('pxd-bubble--below', below);
    const top = below ? pt.yBottom : pt.yTop - h - gap;

    const left = clamp(pt.x - w / 2, padL, Math.max(padL, layer.clientWidth - padR - w));
    const u = tail.offsetWidth || 4;
    const tailX = clamp(pt.x - left, u * 4, w - u * 4); // keep the tail away from the corners

    el.style.setProperty('--pxd-tail-x', `${Math.round(tailX)}px`);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  return new Promise<void>((resolve, reject) => {
    let typing = true;
    let waiting = false;
    let tw: Typewriter | null = null;
    const ro = anchor && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;

    const cleanup = () => {
      tw?.stop();
      ro?.disconnect();
      signal?.removeEventListener('abort', onAbort);
      if (bubbleState === state) bubbleState = null;
    };
    const onAbort = () => {
      cleanup();
      el.remove();
      reject(abortError(signal));
    };

    const state: BubbleState = {
      onAction(action) {
        if (action !== 'confirm') return false;
        if (typing) {
          tw?.skip();
          return true;
        }
        if (waiting) {
          waiting = false;
          el.classList.remove('pxd-wait');
          resolve();
          return true;
        }
        return false;
      },
      close() {
        cleanup();
        el.remove();
        resolve();
      },
    };

    bubbleState = state;
    signal?.addEventListener('abort', onAbort, { once: true });
    place();
    ro?.observe(layer);

    tw = typewrite(spans, chars, cps, config.pauses, onChar, () => {
      typing = false;
      el.classList.add('pxd-done');
      if (waitForInput) {
        waiting = true;
        el.classList.add('pxd-wait');
      } else {
        resolve();
      }
    });
  });
}

/** Closes the current bubble. If someone was waiting for it, their Promise resolves. */
export function hideBubble(): void {
  bubbleState?.close();
}

// ─────────────────────────────────────────────────────────────────────
// showChoices
// ─────────────────────────────────────────────────────────────────────

let uid = 0;

/**
 * Shows a list of answers and returns the `value` of the selected option.
 * Controls: arrows/W-S, Enter/Space/Z, Escape/X (only with cancelValue), mouse, touch, sendInput().
 */
export function showChoices<T>(choices: Choice<T>[], options: ChoicesOptions<T> = {}): Promise<T> {
  if (!choices.some((c) => !c.disabled)) {
    return Promise.reject(new Error('showChoices: at least one enabled option is required'));
  }
  const { position = 'bottom-right', signal } = options;
  if (signal?.aborted) return Promise.reject(abortError(signal));

  ensureListeners();
  choicesState?.abort(new DOMException('Replaced by a new choice', 'AbortError'));

  const hasCancel = 'cancelValue' in options;
  const inputDelay = options.inputDelay ?? config.inputDelay;
  const layer = getLayer(options.root);
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const id = `pxd-${++uid}`;

  // ── DOM ──
  const box = div(`pxd-choices pxd-choices--${position}`);
  const list = div('pxd-list');
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  box.append(list);

  const items = choices.map((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${id}-${i}`;
    btn.className = 'pxd-choice';
    btn.tabIndex = -1; // we handle navigation ourselves; the list keeps focus
    btn.setAttribute('role', 'option');
    btn.textContent = c.label;
    if (c.disabled) {
      btn.classList.add('pxd-disabled');
      btn.setAttribute('aria-disabled', 'true');
    }
    list.append(btn);
    return btn;
  });

  layer.append(box);
  list.focus({ preventScroll: true });

  return new Promise<T>((resolve, reject) => {
    const readyAt = performance.now() + inputDelay;
    let index = clamp(options.initialIndex ?? 0, 0, choices.length - 1);

    const select = (i: number) => {
      index = i;
      items.forEach((b, j) => {
        b.classList.toggle('pxd-selected', j === i);
        b.setAttribute('aria-selected', String(j === i));
      });
      list.setAttribute('aria-activedescendant', items[i].id);

      // Manual list scrolling (scrollIntoView could scroll the whole layer).
      const b = items[i];
      if (b.offsetTop < list.scrollTop) list.scrollTop = b.offsetTop;
      else if (b.offsetTop + b.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = b.offsetTop + b.offsetHeight - list.clientHeight;
      }
    };

    const move = (dir: 1 | -1) => {
      let i = index;
      for (let k = 0; k < choices.length; k++) {
        i = (i + dir + choices.length) % choices.length;
        if (!choices[i].disabled) {
          select(i);
          return;
        }
      }
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      box.remove();
      if (choicesState === state) choicesState = null;
      prevFocus?.focus?.({ preventScroll: true });
    };
    const finish = (value: T) => {
      cleanup();
      resolve(value);
    };
    const abort = (reason: unknown) => {
      cleanup();
      reject(reason);
    };
    const onAbort = () => abort(abortError(signal));

    const state: ChoicesState = {
      onAction(action) {
        switch (action) {
          case 'up':
            move(-1);
            return true;
          case 'down':
            move(1);
            return true;
          case 'confirm':
            if (performance.now() >= readyAt) finish(choices[index].value);
            return true;
          case 'cancel':
            if (!hasCancel) return false;
            finish(options.cancelValue as T);
            return true;
        }
      },
      abort,
    };

    items.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (performance.now() >= readyAt && !choices[i].disabled) finish(choices[i].value);
      });
      // Highlight on hover for mouse only; touch selects immediately via click.
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !choices[i].disabled) select(i);
      });
    });

    choicesState = state;
    signal?.addEventListener('abort', onAbort, { once: true });
    select(index);
    if (choices[index].disabled) move(1);
  });
}
