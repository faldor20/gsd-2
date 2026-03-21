/**
 * Shared parsing for gsd-web attach compatibility entry points.
 *
 * Keeping the parser separate from the bridge runtime lets the main CLI,
 * headless mode, and `/gsd web-attach` reuse the same validation logic
 * without importing the heavier runtime graph.
 */

export interface WebAttachFlags {
  managerUrl: string
  hostLabel: string | undefined
  instanceId: string | undefined
}

function formatWebAttachUsage(commandLabel: string): string {
  return `${commandLabel} --manager <ws-url> [--host-label <label>] [--instance-id <id>]`
}

export function parseWebAttachArgList(args: string[], commandLabel = 'gsd web attach'): WebAttachFlags {
  const flags: WebAttachFlags = {
    managerUrl: '',
    hostLabel: undefined,
    instanceId: undefined,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--manager' && i + 1 < args.length) {
      flags.managerUrl = args[++i]!
    } else if (arg === '--host-label' && i + 1 < args.length) {
      flags.hostLabel = args[++i]
    } else if (arg === '--instance-id' && i + 1 < args.length) {
      flags.instanceId = args[++i]
    } else {
      throw new Error(`Unknown web attach option: ${arg}\nUsage: ${formatWebAttachUsage(commandLabel)}`)
    }
  }

  if (!flags.managerUrl) {
    throw new Error(`web attach requires --manager <ws-url>\nUsage: ${formatWebAttachUsage(commandLabel)}`)
  }

  return flags
}

export function parseWebAttachArgs(argv: string[]): WebAttachFlags {
  try {
    return parseWebAttachArgList(argv.slice(4), 'gsd web attach')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[gsd] Error: ${message}\n`)
    process.exit(1)
  }
}