/**
 * jrpg-ui-dialog
 *
 * Dwie niezależne funkcje, wywoływane z kodu i zwracające Promise:
 *   - showBubble(text, opts)    chmurka z efektem maszyny do pisania
 *   - showChoices(choices, opts) wybór odpowiedzi
 *
 * Całość to nakładka HTML na grę (canvas). Wygląd jest w jrpg-ui-dialog.css.
 *
 * Wymaga: ES2020+, DOM. Do tsconfig najlepiej "target": "ES2022".
 */

// ─────────────────────────────────────────────────────────────────────
// Typy publiczne
// ─────────────────────────────────────────────────────────────────────

/** Abstrakcyjne akcje wejścia. Możesz je wysyłać ręcznie (np. z gamepada) przez sendInput(). */
export type Action = 'confirm' | 'cancel' | 'up' | 'down';

/**
 * Punkt, na który wskazuje ogonek chmurki.
 * - { x, y }: współrzędne w pikselach CSS względem warstwy UI (czyli kontenera gry)
 * - HTMLElement: ogonek wskaże górną (lub dolną) krawędź elementu, jego środek w poziomie
 */
export type Anchor = HTMLElement | { x: number; y: number };

export interface BubbleOptions {
  /** Gdzie ma wskazywać ogonek. Bez tego: pasek narratora na dole ekranu, bez ogonka. */
  anchor?: Anchor;
  /** Imię mówiącego, wyświetlane nad tekstem. */
  speaker?: string;
  /** Znaków na sekundę. 0 / Infinity = tekst od razu. Domyślnie z configure(). */
  cps?: number;
  /**
   * true (domyślnie): Promise rozwiązuje się po dopisaniu tekstu I potwierdzeniu przez gracza.
   * false: rozwiązuje się zaraz po dopisaniu tekstu (przydatne tuż przed showChoices).
   */
  waitForInput?: boolean;
  /** Wywoływane po odsłonięciu każdej widocznej litery (spacje i enter pomijane). Tu podepnij "blip". */
  onChar?: (char: string, index: number) => void;
  /** Przerwanie: chmurka znika, a Promise odrzuca się z AbortError. */
  signal?: AbortSignal;
  /** Kontener dla warstwy UI. Domyślnie z configure() lub document.body. */
  root?: HTMLElement;
}

export interface Choice<T> {
  label: string;
  value: T;
  /** Opcja widoczna, ale niewybieralna. */
  disabled?: boolean;
}

export interface ChoicesOptions<T> {
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'center';
  /** Która opcja jest zaznaczona na starcie (domyślnie pierwsza aktywna). */
  initialIndex?: number;
  /** Jeśli podane, Escape / "cancel" zwraca tę wartość. Bez tego anulowanie jest wyłączone. */
  cancelValue?: T;
  /** Ile ms po pojawieniu się opcji ignorować potwierdzenie (ochrona przed przypadkowym kliknięciem). */
  inputDelay?: number;
  signal?: AbortSignal;
  root?: HTMLElement;
}

export interface DialogConfig {
  /** Kontener warstwy UI. Gdy nie jest to <body>, powinien mieć position: relative/absolute. */
  root: HTMLElement | null;
  /** Dodatkowa klasa CSS dla warstwy (przełączanie motywów). */
  theme: string;
  cps: number;
  inputDelay: number;
  /** Pauza w ms po danym znaku (np. '.': 280). Zastępuje całą tabelę. */
  pauses: Record<string, number>;
  /** Klawisze (wartości KeyboardEvent.key, bez rozróżniania wielkości liter). */
  keys: Record<Action, string[]>;
}

// ─────────────────────────────────────────────────────────────────────
// Konfiguracja
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
// Stan wewnętrzny: naraz jedna chmurka i jeden wybór
// ─────────────────────────────────────────────────────────────────────

interface BubbleState {
  /** Zwraca true, jeśli akcja została zużyta. */
  onAction(action: Action): boolean;
  /** Zamyka chmurkę; oczekujący Promise się rozwiązuje. */
  close(): void;
}

interface ChoicesState {
  onAction(action: Action): boolean;
  abort(reason: unknown): void;
}

let bubbleState: BubbleState | null = null;
let choicesState: ChoicesState | null = null;

// ─────────────────────────────────────────────────────────────────────
// Funkcje pomocnicze
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

// Intl.Segmenter dzieli na grafemy (emoji, znaki złożone). Fallback: punkty kodowe.
type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => { segment(input: string): Iterable<{ segment: string }> };

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** Warstwa UI w kontenerze (tworzona przy pierwszym użyciu). */
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
  // Jeśli kontener gry jest skalowany transformem, przeliczamy z powrotem na piksele CSS warstwy.
  const scale = layer.offsetWidth ? l.width / layer.offsetWidth : 1;
  return {
    x: (r.left + r.width / 2 - l.left) / scale,
    yTop: (r.top - l.top) / scale,
    yBottom: (r.bottom - l.top) / scale,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Wejście: jeden router dla klawiatury, dotyku/myszy i dowolnego źródła (gamepad)
// ─────────────────────────────────────────────────────────────────────

/** Czy któraś chmurka lub wybór jest teraz widoczny (np. do blokowania wejścia gry). */
export function isDialogVisible(): boolean {
  return bubbleState !== null || choicesState !== null;
}

/**
 * Wysyła akcję do aktywnego okna. Użyj do gamepada:
 *   if (padA.pressed) sendInput('confirm');
 * Zwraca true, jeśli akcja została zużyta.
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
    // Przytrzymany klawisz nie powinien przeskakiwać kolejnych kwestii.
    if (e.repeat && (action === 'confirm' || action === 'cancel')) return;
    if (sendInput(action)) e.preventDefault();
  });

  document.addEventListener('pointerdown', (e) => {
    // Gdy widoczny jest wybór, klik obsługują jego przyciski (zdarzenie click).
    if (e.button !== 0 || choicesState) return;
    sendInput('confirm');
  });
}

// ─────────────────────────────────────────────────────────────────────
// Maszyna do pisania
// ─────────────────────────────────────────────────────────────────────

interface Typewriter {
  skip(): void;
  stop(): void;
}

function pauseAfter(char: string, next: string | undefined, pauses: Record<string, number>): number {
  const p = pauses[char] ?? 0;
  if (!p || next === undefined) return 0;
  // "..." albo "?!" → pauza dopiero po ostatnim znaku; to samo przed zamykającym cudzysłowem.
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
    // Po uśpieniu karty nie nadrabiamy zaległości lawiną liter.
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
 * Pokazuje chmurkę z tekstem pisanym litera po literze.
 *
 * Pierwsze potwierdzenie w trakcie pisania odsłania cały tekst, kolejne kończy kwestię.
 * Po rozwiązaniu Promise chmurka zostaje na ekranie, dopóki nie wywołasz
 * hideBubble() lub nie pokażesz następnej chmurki.
 */
export async function showBubble(text: string, options: BubbleOptions = {}): Promise<void> {
  const { anchor, speaker, signal, onChar } = options;
  const waitForInput = options.waitForInput ?? true;
  const cps = options.cps ?? config.cps;

  if (signal?.aborted) throw abortError(signal);
  // Pomiar layoutu przed załadowaniem fontu dałby złe wymiary.
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
  textEl.setAttribute('aria-hidden', 'true'); // czytnik dostaje pełny tekst z .pxd-sr, nie litery po jednej
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

  // ── Pozycjonowanie: raz przy starcie i przy zmianie rozmiaru warstwy ──
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

    const below = pt.yTop - h - gap < padT; // nie mieści się nad kotwicą → pod nią
    el.classList.toggle('pxd-bubble--below', below);
    const top = below ? pt.yBottom : pt.yTop - h - gap;

    const left = clamp(pt.x - w / 2, padL, Math.max(padL, layer.clientWidth - padR - w));
    const u = tail.offsetWidth || 4;
    const tailX = clamp(pt.x - left, u * 4, w - u * 4); // ogonek nie wchodzi na rogi

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

/** Zamyka bieżącą chmurkę. Jeśli ktoś na nią czekał, jego Promise się rozwiązuje. */
export function hideBubble(): void {
  bubbleState?.close();
}

// ─────────────────────────────────────────────────────────────────────
// showChoices
// ─────────────────────────────────────────────────────────────────────

let uid = 0;

/**
 * Pokazuje listę odpowiedzi i zwraca `value` wybranej opcji.
 * Sterowanie: strzałki/WS, Enter/Spacja/Z, Escape/X (tylko z cancelValue), mysz, dotyk, sendInput().
 */
export function showChoices<T>(choices: Choice<T>[], options: ChoicesOptions<T> = {}): Promise<T> {
  if (!choices.some((c) => !c.disabled)) {
    return Promise.reject(new Error('showChoices: potrzebna co najmniej jedna aktywna opcja'));
  }
  const { position = 'bottom-right', signal } = options;
  if (signal?.aborted) return Promise.reject(abortError(signal));

  ensureListeners();
  choicesState?.abort(new DOMException('Zastąpione nowym wyborem', 'AbortError'));

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
    btn.tabIndex = -1; // nawigację robimy sami; fokus trzyma lista
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

      // Ręczne przewijanie listy (scrollIntoView mógłby przesunąć całą warstwę).
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
      // Podświetlanie hoverem tylko dla myszy; dotyk wybiera od razu przez click.
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
