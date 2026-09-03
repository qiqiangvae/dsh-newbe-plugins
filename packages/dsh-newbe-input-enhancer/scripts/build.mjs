import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'

await mkdir('lib', { recursive: true })
await cp('src/index.js', 'lib/index.js')

// Assemble the client bundle: inline the pure core (src/core.js, an ESM module)
// into the CJS-wrapped factory so `advanceTripleTap` / `swapResult` are in
// scope. The core stays the single source of truth and is unit-tested directly.
const client = await readFile('src/client.js', 'utf8')
const core = await readFile('src/core.js', 'utf8')
const inlined = client.replace(
  /(\s*var React = require\('react'\)\s*)/,
  (m) => `${m}\n${toCjsBody(core)}\n`
)
await writeFile('lib/client.js', inlined)

// Syntax-check the generated client bundle so an invalid artifact fails at
// build time (non-zero exit) rather than surfacing only when the web shell
// boots it. lib/index.js (the host half) is an ESM module validated by Node's
// own loader — `new Function` only applies to the browser bundle.
for (const file of ['lib/client.js']) {
  const src = await readFile(file, 'utf8')
  try {
    new Function(src)
  } catch (e) {
    throw new Error(`build: syntax check failed on ${file}: ${e.message}`)
  }
}

console.log('Built lib/index.js and lib/client.js (core inlined, client syntax-checked)')

/**
 * Convert an ESM module body (export function/const) to plain CJS declarations
 * and strip the leading JSDoc block, ready for inlining into the factory.
 */
function toCjsBody(source) {
  let s = source
  s = s.replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '')
  s = s.replace(/export\s+(function|const)\s+/g, '$1 ')
  return s.trim().split('\n').map((l) => '    ' + l).join('\n')
}
