/**
 * jrpg-ui-choices
 *
 * Answer selection panels rendered as an HTML overlay on top of the game (canvas).
 * Their appearance lives in jrpg-ui-choices.css.
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

export interface Choice<T> {
  label: string
  value: T
  /** Visible but not selectable. */
  disabled?: boolean
}

export interface ChoicesOptions<T> {
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'center'
  /** Which option is selected initially (defaults to the first enabled one). */
  initialIndex?: number
  /** If provided, Escape / "cancel" returns this value. Without it, cancellation is disabled. */
  cancelValue?: T
  /** How many ms after the options appear to ignore confirmation (protects against accidental clicks). */
  inputDelay?: number
  signal?: AbortSignal
  root?: HTMLElement
}

interface ChoicesState {
  onAction(action: Action): boolean
  abort(reason: unknown): void
}

let choicesState: ChoicesState | null = null
let uid = 0

/**
 * Shows a list of answers and returns the `value` of the selected option.
 * Controls: arrows/W-S, Enter/Space/Z, Escape/X (only with cancelValue), mouse, touch, sendInput().
 */
export function showChoices<T>(choices: Choice<T>[], options: ChoicesOptions<T> = {}): Promise<T> {
  if (!choices.some((c) => !c.disabled)) {
    return Promise.reject(new Error('showChoices: at least one enabled option is required'))
  }
  const { position = 'bottom-right', signal } = options
  if (signal?.aborted) return Promise.reject(abortError(signal))

  ensureInputListeners()
  choicesState?.abort(new DOMException('Replaced by a new choice', 'AbortError'))

  const hasCancel = 'cancelValue' in options
  const inputDelay = options.inputDelay ?? getConfig().inputDelay
  const layer = getLayer(options.root)
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const id = `jrpg-${++uid}`

  // ── DOM ──
  const box = div(`jrpg-choices jrpg-choices--${position}`)
  const list = div('jrpg-list')
  list.setAttribute('role', 'listbox')
  list.tabIndex = -1
  box.append(list)

  const items = choices.map((c, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = `${id}-${i}`
    btn.className = 'jrpg-choice'
    btn.tabIndex = -1; // we handle navigation ourselves; the list keeps focus
    btn.setAttribute('role', 'option')
    btn.textContent = c.label
    if (c.disabled) {
      btn.classList.add('jrpg-disabled')
      btn.setAttribute('aria-disabled', 'true')
    }
    list.append(btn)
    return btn
  })

  layer.append(box)
  list.focus({ preventScroll: true })

  return new Promise<T>((resolve, reject) => {
    const readyAt = performance.now() + inputDelay
    let index = clamp(options.initialIndex ?? 0, 0, choices.length - 1)

    const select = (i: number) => {
      index = i
      items.forEach((b, j) => {
        b.classList.toggle('jrpg-selected', j === i)
        b.setAttribute('aria-selected', String(j === i))
      })
      list.setAttribute('aria-activedescendant', items[i].id)

      // Manual list scrolling (scrollIntoView could scroll the whole layer).
      const b = items[i]
      if (b.offsetTop < list.scrollTop) list.scrollTop = b.offsetTop
      else if (b.offsetTop + b.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = b.offsetTop + b.offsetHeight - list.clientHeight
      }
    }

    const move = (dir: 1 | -1) => {
      let i = index
      for (let k = 0; k < choices.length; k++) {
        i = (i + dir + choices.length) % choices.length
        if (!choices[i].disabled) {
          select(i)
          return
        }
      }
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      box.remove()
      unregisterInputTarget('choices', state)
      if (choicesState === state) choicesState = null
      prevFocus?.focus?.({ preventScroll: true })
    }
    const finish = (value: T) => {
      cleanup()
      resolve(value)
    }
    const abort = (reason: unknown) => {
      cleanup()
      reject(reason)
    }
    const onAbort = () => abort(abortError(signal))

    const state: ChoicesState = {
      onAction(action) {
        switch (action) {
          case 'up':
            move(-1)
            return true
          case 'down':
            move(1)
            return true
          case 'confirm':
            if (performance.now() >= readyAt) finish(choices[index].value)
            return true
          case 'cancel':
            if (!hasCancel) return false
            finish(options.cancelValue as T)
            return true
        }
      },
      abort,
    }

    items.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (performance.now() >= readyAt && !choices[i].disabled) finish(choices[i].value)
      })
      // Highlight on hover for mouse only; touch selects immediately via click.
      btn.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !choices[i].disabled) select(i)
      })
    })

    choicesState = state
    registerInputTarget('choices', state)
    signal?.addEventListener('abort', onAbort, { once: true })
    select(index)
    if (choices[index].disabled) move(1)
  })
}
