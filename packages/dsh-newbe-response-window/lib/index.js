// dsh-newbe-response-window — host half.
//
// Verified against DSH 0.1.7-alpha.1. Owns the durable settings namespace so the
// browser Settings UI can persist the window size etc. in the user settings
// document. The heavy lifting lives in the browser half (exports "./client").
//
// The host settings contract is the 0.1.7 one: the settings document is keyed
// by the profile entry id, a namespace only shows up in it when its Config
// schema projects at least one `volatile()` field, and a plugin opts out of the
// auto-generated page with `settings.configure({ auto: false }, ctx.fiber)`.
//
// Namespace + schema (browser `configForms.get(SETTINGS_NS)` mirrors it):
//   lines             window height in lines (default 10; 0 = uncapped)
//   collapsed         start slides collapsed instead of always-expanded
//   showReadOnly      include read-only tools in the slide list
//   minCollapseRows   min tool-call count for auto-collapse (collapsed mode)
//   liveStreamThink   how a streaming think block is shown:
//                     'off' — always folded into a one-line summary
//                     'in'  — auto-expand inside the slide, live scroll
//                     'out' — stream outside the slide (native row), then
//                             fold into the slide once settled (default 'out')

// The namespace must equal the profile entry id (the `id:` of the row this
// bundle patch inserts), because that is what the host settings document and
// `configForms.get()` are keyed by.

import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'dsh-newbe-response-window'

/** Durable settings namespace for this plugin (lowercase kebab-case). */
export const SETTINGS_NS = 'dsh-newbe-response-window'

/**
 * Settings schema. Only the two user-editable preferences are `volatile()`:
 * the browser settings document is projected from volatile fields alone, and
 * the rest stay patch-time configuration that the client reads from row config.
 */
export const Config = z.object({
  lines: z.natural().min(0).max(200).default(10).volatile(),
  collapsed: z.boolean().default(false),
  showReadOnly: z.boolean().default(true),
  minCollapseRows: z.natural().min(1).max(50).default(3),
  liveStreamThink: z.string().default('out').volatile(),
})

/**
 * Opt this plugin's entry out of the auto-generated settings page. Its
 * namespace is the profile entry id (`dsh-newbe-response-window`), which is
 * exactly {@link SETTINGS_NS}, so the browser half can bind the durable scope
 * through `configForms.get(SETTINGS_NS)`.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
