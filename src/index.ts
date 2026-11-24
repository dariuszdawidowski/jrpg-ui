/**
 * Public entry point of the jrpg-ui library.
 *
 * The import below pulls the default pixel-art theme into the built
 * `jrpg-ui-dialog.css` asset. Consumers load it once as `jrpg-ui/style.css`
 * (or replace it with their own stylesheet for the same class names).
 */
import './jrpg-ui-dialog.css'

export { configure, hideBubble, isDialogVisible, sendInput, showBubble, showChoices } from './jrpg-ui-dialog'
export type { Action, Anchor, BubbleOptions, Choice, ChoicesOptions, DialogConfig } from './jrpg-ui-dialog'
