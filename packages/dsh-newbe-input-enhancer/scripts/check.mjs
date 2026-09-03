import { readFile } from 'node:fs/promises'

const [host, client] = await Promise.all([
  readFile('lib/index.js', 'utf8'),
  readFile('lib/client.js', 'utf8'),
])

for (const [name, content, required] of [
  ['Host', host, 'export function apply'],
  ['Client', client, "document.addEventListener('keydown', onKeyDown, true)"],
  ['Client', client, 'conversation.input.right'],
  ['Client', client, 'data-composer-card'],
  ['Client', client, 'data-dsh-input-enhancer'],
  ['Client', client, 'data-dsh-char-count'],
  ['Client', client, 'data-dsh-long-text'],
  ['Client', client, 'LONG_TEXT_THRESHOLD'],
  ['Client', client, 'dsh-firework-particle'],
  ['Client', client, 'function mountFirework'],
  ['Client', client, 'isSuggestionMenuOpen'],
  ['Client', client, 'tinyStore'],
  ['Client', client, 'createLockFeature'],
  ['Client', client, 'dsh-input-enhancer-char-count'],
  ['Client', client, 'event.stopImmediatePropagation'],
  ['Client', client, 'event.isComposing || event.keyCode === 229'],
  ['Client', client, 'event.altKey !== true'],
  ['Client', client, "event.code === 'KeyL'"],
  ['Client', client, 'SHORTCUT_ENABLED = true'],
  ['Client', client, 'data-dsh-stage'],
  ['Client', client, 'data-dsh-stage-filled'],
  ['Client', client, 'createStageFeature'],
  ['Client', client, 'STAGE_SHORTCUT_ENABLED'],
  ['Client', client, "code === 'KeyK'"],
  ['Client', client, 'dsh-input-enhancer-stage'],
  ['Client', client, 'StageIcon'],
  // DSH 0.1.2-alpha.1 composer is a Lexical contenteditable host, not a
  // <textarea>; the guard must detect it and read the draft from the input
  // store, so assert the compatibility fragments are present in the bundle.
  ['Client', client, "composerInput: '[data-composer-input]'"],
  ['Client', client, 'function isComposerInput'],
  ['Client', client, 'draftReaderRef'],
]) {
  if (!content.includes(required)) {
    throw new Error(`${name} bundle is missing required fragment: ${required}`)
  }
}

if (client.includes('settingsScope') || client.includes('settings-not-exposed')) {
  throw new Error('Client bundle unexpectedly depends on the Host settings API')
}

if (client.includes('dsh-enter-lock') || host.includes('dsh-enter-lock')) {
  throw new Error('Stale pre-rename fragment "dsh-enter-lock" still present in a bundle')
}

console.log('dsh-input-enhancer bundle artifacts passed structural checks.')
