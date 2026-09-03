export const name = 'dsh-input-enhancer'

/**
 * Host half of dsh-input-enhancer.
 *
 * This bundle is intentionally dependency-free on the Host side. The lock
 * state is kept in browser memory, scoped per session, and the Enter guard is
 * installed by the browser half (src/client.js). Keeping this half empty also
 * means the plugin can be installed from Git without any Host settings
 * namespace, RPC route, or extra dependencies.
 */
export function apply() {}
