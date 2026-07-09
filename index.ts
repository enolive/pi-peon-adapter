/**
 * peon-ping bridge for pi
 *
 * Thin adapter that maps pi lifecycle events to Claude-Code-style hook JSON
 * and pipes them into the installed `peon` CLI on stdin. The CLI handles
 * everything else (sound packs, volume, notifications, spam detection,
 * relay, etc.) — see `peon help`.
 *
 * Unlike re-implementations, this extension does NOT manage packs, audio,
 * config, or notifications itself. Configure via `peon` directly:
 *
 *   peon setup           # interactive wizard
 *   peon packs install … # install sound packs
 *   peon volume 0.4
 *   peon notifications off
 *
 * Override the binary with the PEON_BIN env var (default: `peon` on PATH).
 *
 * Set PI_PEON_ADAPTER_DEBUG_LOG to a path to enable debug logging.
 */
export { default } from './src/index'
