import test from 'node:test'
import assert from 'node:assert/strict'

import { parseWebAttachArgList } from '../web-attach-args.ts'

test('parseWebAttachArgList parses manager and optional flags', () => {
  const flags = parseWebAttachArgList([
    '--manager', 'ws://localhost:4040/ws/instance',
    '--host-label', 'dev-laptop',
    '--instance-id', 'instance-123',
  ], 'gsd web-attach')

  assert.equal(flags.managerUrl, 'ws://localhost:4040/ws/instance')
  assert.equal(flags.hostLabel, 'dev-laptop')
  assert.equal(flags.instanceId, 'instance-123')
})

test('parseWebAttachArgList requires manager', () => {
  assert.throws(
    () => parseWebAttachArgList([], 'gsd headless web-attach'),
    /requires --manager <ws-url>/,
  )
})

test('parseWebAttachArgList rejects unknown flags', () => {
  assert.throws(
    () => parseWebAttachArgList(['--bogus'], '/gsd web-attach'),
    /Unknown web attach option: --bogus/,
  )
})