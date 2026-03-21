import type { VisualizerData } from '../resources/extensions/gsd/visualizer-data.js'
import { buildRecentMessages, buildUiState, createEmptyRuntimeUiState, type RpcSnapshot } from '../web-runtime/ui-state.js'
import { createTestContext } from '../resources/extensions/gsd/tests/test-helpers.ts'

const { assertEq, report } = createTestContext()

const emptyRpc: RpcSnapshot = {
  connected: false,
  state: null,
  stats: null,
  messages: [],
  availableModels: [],
  error: null,
}

console.log('\n=== web runtime recent messages ===')

{
  const recentMessages = buildRecentMessages(
    [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need to inspect the build output before editing.' },
          { type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { filePath: '/tmp/demo.ts' } },
          { type: 'serverToolUse', id: 'srv-1', name: 'web_search', input: { query: 'elysia recent messages' } },
        ],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-5.4',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: 'toolUse',
        timestamp: 1700000000000,
      } as any,
    ],
    false,
  )

  assertEq(recentMessages.length, 1, 'structured assistant messages are retained in recent messages')
  assertEq(
    recentMessages[0]?.text,
    'Need to inspect the build output before editing. read_file({"filePath":"/tmp/demo.ts"}) web_search({"query":"elysia recent messages"})',
    'recent messages summarize assistant thinking and tool activity instead of dropping the message',
  )
}

report()