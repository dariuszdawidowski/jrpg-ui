/**
 * jrpg-ui-bubble
 *
 * Speech bubbles with a typewriter effect. The bubble is an HTML overlay on top
 * of the game (canvas); its appearance lives in jrpg-ui-bubble.css.
 */
import {
  abortError,
  clamp,
  div,
  ensureInputListeners,
  getConfig,
  getLayer,
  registerInputTarget,
  unregisterInputTarget,
} from './jrpg-ui'
import type { Action } from './jrpg-ui'

/**
 * Point the bubble tail points at.
 * - { x, y }: CSS pixel coordinates relative to the UI layer (i.e. the game container)
 * - HTMLElement: the tail points at the element's top (or bottom) edge, horizontally centered
 */
export type Anchor = HTMLElement | { x: number; y: number }

export interface BubbleOptions {
  /** Where the tail should point. Without it: a narrator bar at the bottom of the screen, no tail. */
  anchor?: Anchor
  /** Speaker name displayed above the text. */
  speaker?: string
  /** Characters per second. 0 / Infinity = instant text. Defaults to configure(). */
  cps?: number
  /**
   * true (default): the Promise resolves after the text is typed AND the player confirms.
   * false: resolves as soon as the text is typed (useful right before showChoices).
   */
  waitForInput?: boolean
  /** Called after each visible character is revealed (spaces and enter skipped). Hook up a "blip" here. */
  onChar?: (char: string, index: number) => void
  /** Abort: the bubble disappears and the Promise rejects with AbortError. */
  signal?: AbortSignal
  /** UI layer container. Defaults to configure() or document.body. */
  root?: HTMLElement
}

interface BubbleState {
  /** Returns true if the action was consumed. */
  onAction(action: Action): boolean
  /** Closes the bubble; the pending Promise resolves. */
  close(): void
}

let bubbleState: BubbleState | null = null

// Intl.Segmenter splits into graphemes (emoji, combined characters). Fallback: code points.
type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> }

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null

function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

function resolveAnchor(anchor: Anchor, layer: HTMLElement): { x: number; yTop: number; yBottom: number } {
  if (!(anchor instanceof HTMLElement)) return { x: anchor.x, yTop: anchor.y, yBottom: anchor.y }
  const r = anchor.getBoundingClientRect()
  const l = layer.getBoundingClientRect()
  // If the game container is scaled by a transform, convert back to the layer's CSS pixels.
  const scale = layer.offsetWidth ? l.width / layer.offsetWidth : 1
  return {
    x: (r.left + r.width / 2 - l.left) / scale,
    yTop: (r.top - l.top) / scale,
    yBottom: (r.bottom - l.top) / scale,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Typewriter
// ─────────────────────────────────────────────────────────────────────

interface Typewriter {
  skip(): void
  stop(): void
}

function pauseAfter(char: string, next: string | undefined, pauses: Record<string, number>): number {
  const p = pauses[char] ?? 0
  if (!p || next === undefined) return 0
  // "..." or "?!" → pause only after the last character; same before a closing quote.
  if (next in pauses || /["'”’»)\]]/.test(next)) return 0
  return p
}

function typewrite(
  spans: HTMLElement[],
  chars: string[],
  cps: number,
  pauses: Record<string, number>,
  onChar: BubbleOptions['onChar'],
  onDone: () => void,
): Typewriter {
  let shown = 0
  let raf = 0
  let stopped = false

  const reveal = (i: number) => spans[i].classList.add('jrpg-on')
  const finish = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    onDone()
  }

  const skip = () => {
    if (stopped) return
    for (; shown < chars.length; shown++) reveal(shown)
    finish()
  }
  const stop = () => {
    stopped = true
    cancelAnimationFrame(raf)
  }

  if (!(cps > 0) || !Number.isFinite(cps)) {
    queueMicrotask(skip)
    return { skip, stop }
  }

  const interval = 1000 / cps
  let nextAt = 0

  const tick = (now: number) => {
    if (stopped) return
    // After the tab wakes from sleep, do not catch up with an avalanche of letters.
    if (!nextAt || now - nextAt > 250) nextAt = now

    while (shown < chars.length && now >= nextAt) {
      const c = chars[shown]
      reveal(shown)
      shown++
      if (!/^\s+$/.test(c)) {
        onChar?.(c, shown - 1)
        nextAt += interval + pauseAfter(c, chars[shown], pauses)
      }
    }

    if (shown >= chars.length) finish()
    else raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return { skip, stop }
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
  const { anchor, speaker, signal, onChar } = options
  const waitForInput = options.waitForInput ?? true
  const settings = getConfig()
  const cps = options.cps ?? settings.cps

  if (signal?.aborted) throw abortError(signal)
  // Measuring layout before the font loads would give wrong dimensions.
  if (document.fonts && document.fonts.status === 'loading') await document.fonts.ready
  if (signal?.aborted) throw abortError(signal)

  ensureInputListeners()
  bubbleState?.close()

  const layer = getLayer(options.root)
  const chars = splitGraphemes(text)

  // ── DOM ──
  const el = div('jrpg-bubble')
  el.setAttribute('role', 'status')
  if (!anchor) el.classList.add('jrpg-bubble--free')

  if (speaker) {
    const name = div('jrpg-name', speaker)
    name.setAttribute('aria-hidden', 'true')
    el.append(name)
  }

  const textEl = div('jrpg-text')
  textEl.setAttribute('aria-hidden', 'true'); // screen readers get the full text from .jrpg-sr, not one letter at a time
  const spans = chars.map((c) => {
    const s = document.createElement('span')
    s.className = 'jrpg-ch'
    s.textContent = c
    textEl.append(s)
    return s
  })

  const sr = document.createElement('span')
  sr.className = 'jrpg-sr'
  sr.textContent = speaker ? `${speaker}: ${text}` : text

  const tail = div('jrpg-tail')
  const next = div('jrpg-next')
  el.append(textEl, sr, tail, next)
  layer.append(el)

  // The arrow is a scroll hint, so it only appears once typing is done and
  // there is still content below the visible part of the text.
  const isScrollable = () => textEl.scrollHeight > textEl.clientHeight + 1
  const hasMoreBelow = () => textEl.scrollHeight - textEl.scrollTop > textEl.clientHeight + 1
  const updateScrollState = () => {
    el.classList.toggle('jrpg-scroll', el.classList.contains('jrpg-done') && hasMoreBelow())
  }
  textEl.addEventListener('scroll', updateScrollState, { passive: true })
  // A tap on scrollable text is meant for scrolling, not for advancing the dialog.
  textEl.addEventListener('pointerdown', (event) => {
    if (isScrollable()) event.stopPropagation()
  })

  // ── Positioning: once at startup and when the layer is resized ──
  const place = () => {
    if (!anchor) return
    const pt = resolveAnchor(anchor, layer)

    el.classList.remove('jrpg-bubble--below')
    const w = el.offsetWidth
    const h = el.offsetHeight
    const cs = getComputedStyle(layer)
    const padT = parseFloat(cs.paddingTop) || 0
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const gap = parseFloat(getComputedStyle(el).marginBottom) || 0

    const below = pt.yTop - h - gap < padT; // does not fit above the anchor → place it below
    el.classList.toggle('jrpg-bubble--below', below)
    const top = below ? pt.yBottom : pt.yTop - h - gap

    const left = clamp(pt.x - w / 2, padL, Math.max(padL, layer.clientWidth - padR - w))
    const u = tail.offsetWidth || 4
    const tailX = clamp(pt.x - left, u * 4, w - u * 4); // keep the tail away from the corners

    el.style.setProperty('--jrpg-tail-x', `${Math.round(tailX)}px`)
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
  }

  return new Promise<void>((resolve, reject) => {
    let typing = true
    let waiting = false
    let tw: Typewriter | null = null
    const ro = anchor && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null

    const cleanup = () => {
      tw?.stop()
      ro?.disconnect()
      signal?.removeEventListener('abort', onAbort)
      unregisterInputTarget('bubble', state)
      if (bubbleState === state) bubbleState = null
    }
    const onAbort = () => {
      cleanup()
      el.remove()
      reject(abortError(signal))
    }

    const state: BubbleState = {
      onAction(action) {
        if (action === 'up' || action === 'down') {
          if (typing || !isScrollable()) return false
          textEl.scrollTop += (action === 'down' ? 1 : -1) * textEl.clientHeight * 0.8
          updateScrollState()
          return true
        }
        if (action !== 'confirm') return false
        if (typing) {
          tw?.skip()
          return true
        }
        if (waiting) {
          waiting = false
          el.classList.remove('jrpg-wait')
          resolve()
          return true
        }
        return false
      },
      close() {
        cleanup()
        el.remove()
        resolve()
      },
    }

    bubbleState = state
    registerInputTarget('bubble', state)
    signal?.addEventListener('abort', onAbort, { once: true })
    place()
    ro?.observe(layer)

    tw = typewrite(spans, chars, cps, settings.pauses, onChar, () => {
      typing = false
      el.classList.add('jrpg-done')
      updateScrollState()
      if (waitForInput) {
        waiting = true
        el.classList.add('jrpg-wait')
      } else {
        resolve()
      }
    })
  })
}

/** Closes the current bubble. If someone was waiting for it, their Promise resolves. */
export function hideBubble(): void {
  bubbleState?.close()
}
