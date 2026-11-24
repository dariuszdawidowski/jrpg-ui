import { configure, showBubble, showChoices } from '../src/index'

const game = document.querySelector<HTMLElement>('#game')
if (!game) throw new Error('Playground: missing #game container')

configure({ root: game, cps: 35 })

/** Reports unexpected failures while treating replaced dialogs as normal. */
function run(task: Promise<unknown>): void {
  task.catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    console.error(error)
  })
}

const SHORT_TEXT = 'The old lamp flickers.\nSomewhere below, a door creaks open.'

const LONG_TEXT = [
  'The old lamp flickers.',
  'Somewhere below, a door creaks open.',
  'You count the steps as you descend: ten, twenty, thirty —',
  'the air grows colder with each one, and the walls press closer.',
  'At the bottom, a corridor stretches into darkness.',
  'A single candle burns at its far end, though no one is holding it.',
  'You feel, more than hear, something breathing in the dark.',
  'Then the candle goes out, and the breathing stops.',
].join('\n')

document.querySelector('#bubble-short')?.addEventListener('click', () => {
  run(
    showBubble(SHORT_TEXT, {
      speaker: 'Narrator',
      anchor: { x: game.clientWidth / 2, y: game.clientHeight / 2 },
    }),
  )
})

document.querySelector('#bubble-long')?.addEventListener('click', () => {
  run(
    showBubble(LONG_TEXT, {
      speaker: 'Narrator',
      anchor: { x: game.clientWidth / 2, y: game.clientHeight / 2 },
    }),
  )
})

document.querySelector('#choices')?.addEventListener('click', () => {
  run(
    (async () => {
      const answer = await showChoices(
        [
          { label: 'Open the door', value: 'open' },
          { label: 'Listen closely', value: 'listen' },
          { label: 'Leave it alone', value: 'leave', disabled: true },
        ],
        { position: 'bottom-center', cancelValue: 'cancel' },
      )
      await showBubble(`You chose: ${answer}.`, { waitForInput: false })
    })(),
  )
})
