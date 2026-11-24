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

document.querySelector('#bubble')?.addEventListener('click', () => {
  run(
    showBubble('The old lamp flickers.\nSomewhere below, a door creaks open.', {
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
