/**
 * Public entry point of the jrpg-ui library.
 *
 * The import below pulls the default pixel-art theme (shared layer plus bubble
 * and choice styles) into the built `style.css` asset. Consumers load it once
 * as `jrpg-ui/style.css` (or replace it with their own stylesheet for the same
 * class names).
 */
import './style.css'

export { configure, isDialogVisible, sendInput } from './jrpg-ui'
export type { Action, DialogConfig } from './jrpg-ui'
export { hideBubble, showBubble } from './jrpg-ui-bubble'
export type { Anchor, BubbleOptions } from './jrpg-ui-bubble'
export { showChoices } from './jrpg-ui-choices'
export type { Choice, ChoicesOptions } from './jrpg-ui-choices'
