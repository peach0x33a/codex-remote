import { describe, expect, test } from 'bun:test'
import type { Item, Thread } from '../../shared/protocol'
import { buildThreadInsights, latestTurnFiles, subAgentIdentity } from '../../src/lib/thread-insights'
import { fileChangeViews } from '../../src/lib/file-change-view'

function thread(...turns: Record<string, unknown>[][]): Thread {
  return { id: 'parent', cwd: '/project', createdAt: 0, updatedAt: 0, preview: '', turns: turns.map((items, index) => ({ id: 'turn-' + index, status: 'completed', items })) } as Thread
}
const collab = (patch: Record<string, unknown> = {}) => ({ id: 'collab', type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['child'], ...patch })
const change = (path: string, diff?: string, kind: unknown = { type: 'update', move_path: null }) => ({ path, diff, kind })
const file = (changes: unknown[], patch: Record<string, unknown> = {}) => ({ id: 'patch', type: 'fileChange', status: 'completed', changes, ...patch })
const replacement = '--- a/file\n+++ b/file\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n'

test('identifies native subagents and legacy source metadata without labeling ordinary forks', () => {
  const base = thread()
  expect(subAgentIdentity(base)).toBeNull()
  expect(subAgentIdentity({ ...base, source: 'cli', forkedFromId: 'other' } as Thread)).toBeNull()
  expect(subAgentIdentity({ ...base, parentThreadId: 'parent', agentNickname: 'Zeno', agentRole: 'worker' })).toEqual({ parentThreadId: 'parent', name: 'Zeno', role: 'worker' })
  for (const key of ['subAgent', 'subagent']) expect(subAgentIdentity({ ...base, source: { [key]: { thread_spawn: { parent_thread_id: 'parent', agent_path: '/root/explorer', agent_role: 'reviewer' } } } })).toEqual({ parentThreadId: 'parent', name: 'explorer', role: 'reviewer' })
  for (const source of [{ custom: 'subagent' }, { subAgent: null }, { subAgent: {} }, 'subAgent']) expect(subAgentIdentity({ ...base, source })).toBeNull()
  expect(subAgentIdentity({ ...base, source: { subAgent: 'review' } })).not.toBeNull()
})

test('file change views distinguish real unified updates from native add/delete contents and fallback output', () => {
  const views = fileChangeViews(file([
    change('/project/update.ts', replacement),
    change('/project/new.patch', replacement, { type: 'add' }),
    change('/project/old.txt', 'old\n+literal\n', { type: 'delete' }),
    change('/project/move.ts', replacement, { type: 'update', move_path: '/project/moved.ts' }),
    change('/project/unknown.ts', 'opaque raw text'),
    change('/project/partial.ts', '@@ -1,2 +1 @@\n-old\n+new\n'),
  ]) as Item)
  expect(views[0]).toMatchObject({ name: 'update.ts', label: '修改', structured: true, counts: { added: 2, removed: 1 } })
  expect(views[1]).toMatchObject({ label: '新增', counts: { added: 6, removed: 0 } })
  expect(views[1]!.diff).toContain('+--- a/file')
  expect(views[2]).toMatchObject({ label: '删除', counts: { added: 0, removed: 2 } })
  expect(views[2]!.diff).toContain('-+literal')
  expect(views[3]).toMatchObject({ label: '移动', movePath: '/project/moved.ts' })
  for (const view of views.slice(4)) { expect(view.structured).toBe(false); expect(view.counts).toBeUndefined(); expect(view.raw).toBe(view.diff) }
  expect(fileChangeViews({ id: 'bad', type: 'fileChange', changes: [null, { path: '' }] } as Item)).toEqual([])
})

describe('latest turn summary', () => {
  test('a new empty running turn hides the previous summary but retains inspector history', () => {
    const conversation = thread([file([change('old.ts', replacement)])])
    expect(latestTurnFiles(conversation).map(file => file.path)).toEqual(['old.ts'])
    // Queuing changes no turns, so the footer remains until the next turn actually starts.
    expect(latestTurnFiles({ ...conversation })).toHaveLength(1)
    conversation.turns.push({ id: 'new', status: 'inProgress', items: [] })
    expect(latestTurnFiles(conversation)).toEqual([])
    expect(buildThreadInsights(conversation).files).toHaveLength(1)
    // Late updates to earlier turns cannot resurrect their footer.
    conversation.turns[0]!.items.push(file([change('late.ts', replacement)], { id: 'late' }) as Item)
    expect(latestTurnFiles(conversation)).toEqual([])
  })
  test('new edits replace the footer and loading older history does not affect it', () => {
    const conversation = thread([file([change('old.ts', replacement)])], [file([change('new.ts', replacement)])])
    expect(latestTurnFiles(conversation).map(file => file.path)).toEqual(['new.ts'])
    conversation.turns.unshift({ id: 'earlier', status: 'completed', items: [file([change('earlier.ts', replacement)]) as Item] })
    expect(latestTurnFiles(conversation).map(file => file.path)).toEqual(['new.ts'])
    expect(latestTurnFiles(null)).toEqual([])
    expect(latestTurnFiles(thread())).toEqual([])
  })
})

describe('loaded thread agent projection', () => {

  test('deduplicates receivers and state-only agents in stable discovery order', () => {
    const result = buildThreadInsights(thread([
      collab({ receiverThreadIds: ['b', 'a', 'b', 'parent'], agentsStates: { c: { status: 'running' }, a: { status: 'pendingInit' } } }),
    ], [
      collab({ agentsStates: { a: { status: 'completed', message: 'Verified.' }, b: { status: 'errored', message: 'Connection lost' } }, receiverThreadIds: ['a'] }),
    ]))
    expect(result.agents).toEqual([
      { id: 'b', name: 'b', status: 'errored', message: 'Connection lost' },
      { id: 'a', name: 'a', status: 'completed', message: 'Verified.' },
      { id: 'c', name: 'c', status: 'running' },
    ])
  })

  test('successful wait or spawn is not evidence of agent completion', () => {
    for (const tool of ['wait', 'spawnAgent', 'closeAgent', 'sendInput']) {
      expect(buildThreadInsights(thread([collab({ tool })])).agents).toEqual([{ id: 'child', name: 'child' }])
      expect(buildThreadInsights(thread([collab({ tool, agentsStates: { child: { status: 'running' } } })])).agents[0]?.status).toBe('running')
    }
  })

  test('real nickname and role enrich targets without adding unrelated summaries', () => {
    const result = buildThreadInsights(thread([collab()]), [
      { id: 'child', name: 'Thread title', agentNickname: 'Tesla', agentRole: 'explorer' },
      { id: 'other', agentNickname: 'Unrelated', parentThreadId: 'elsewhere', status: { type: 'active' } },
    ])
    expect(result.agents).toEqual([{ id: 'child', name: 'Tesla', role: 'explorer' }])
  })

  test('collab status and message take priority over thread metadata and lastMessage', () => {
    const result = buildThreadInsights(thread([collab({ agentsStates: { child: { status: 'running', message: 'Actual agent message' } } })]), [
      { id: 'child', status: { type: 'idle' }, lastMessage: 'Older answer', preview: 'Initial request' },
    ])
    expect(result.agents[0]).toEqual({ id: 'child', name: 'child', status: 'running', message: 'Actual agent message' })
  })

  test('a resumed agent clears an explicitly null result and partial states preserve targets', () => {
    expect(buildThreadInsights(thread([
      collab({ agentsStates: { child: { status: 'completed', message: 'Old result' } } }),
      collab({ receiverThreadIds: [], agentsStates: { child: { status: 'running', message: null } } }),
      collab({ receiverThreadIds: [], agentsStates: {} }),
    ])).agents).toEqual([{ id: 'child', name: 'child', status: 'running' }])
  })

  test('malformed records and prototype-like thread IDs cannot fabricate metadata', () => {
    const states = JSON.parse('{"__proto__":{"status":"running"},"constructor":{"message":"literal"},"":{}}')
    const result = buildThreadInsights(thread([
      collab({ receiverThreadIds: [null, 2, {}, '', ' '], agentsStates: states }),
      collab({ receiverThreadIds: {}, agentsStates: [] }),
      { id: 'wrong-tool', type: 'mcpToolCall', receiverThreadIds: ['not-an-agent'] },
    ]), [{ id: '__proto__', agentNickname: '<b>Literal name</b>' }])
    expect(result.agents).toEqual([{ id: '__proto__', name: '<b>Literal name</b>', status: 'running' }, { id: 'constructor', name: 'constructor', message: 'literal' }])
  })
})

describe('loaded file-change projection', () => {
  test('aggregates every distinct change of the same path and preserves raw diffs and latest kind', () => {
    const second = '@@ -3,0 +4 @@\n+last line\n'
    const result = buildThreadInsights(thread([
      file([change('src/a.ts', replacement), change('src/b.ts', second)]),
      file([change('src/a.ts', second, { type: 'update', move_path: 'src/new.ts' })], { id: 'patch-2' }),
    ]))
    expect(result.files).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1, diff: replacement + '\n' + second, kind: 'update' },
      { path: 'src/b.ts', added: 1, removed: 0, diff: second, kind: 'update' },
    ])
  })

  test('repeated lifecycle snapshots count once while distinct identical operations count separately', () => {
    const first = file([change('a', replacement)], { status: 'inProgress' })
    expect(buildThreadInsights(thread([first, { ...first, status: 'completed' }])).files[0]).toMatchObject({ added: 2, removed: 1 })
    expect(buildThreadInsights(thread([file([change('a', replacement)]), file([change('a', replacement)], { id: 'second' })])).files[0]).toMatchObject({ added: 4, removed: 2 })
    // Item IDs are scoped to their turn for defensive legacy history handling.
    expect(buildThreadInsights(thread([file([change('a', replacement)])], [file([change('a', replacement)])])).files[0]).toMatchObject({ added: 4, removed: 2 })
  })

  test.each([
    'Binary files a/a and b/a differ',
    '@@ -1 +1 @@\n-old\n+new\n+extra',
    '@@ -9007199254740992 +1 @@\n-old\n+new'
  ])('unrecognized or incomplete diff keeps line totals unknown: %j', diff => {
    const projected = buildThreadInsights(thread([file([change('a', diff)])])).files[0]!
    expect(projected).toEqual({ path: 'a', diff, kind: 'update' })
    expect(projected).not.toHaveProperty('added')
    expect(projected).not.toHaveProperty('removed')
  })

  test('raw add/delete contents are not guessed from their kind, and absent diffs remain unknown', () => {
    expect(buildThreadInsights(thread([file([
      change('new.txt', '+raw content', { type: 'add' }),
      change('old.txt', '-raw content', { type: 'delete' }),
      change('missing.txt'),
    ])])).files).toEqual([
      { path: 'new.txt', kind: 'add', diff: '+raw content' },
      { path: 'old.txt', kind: 'delete', diff: '-raw content' },
      { path: 'missing.txt', kind: 'update', diff: '' },
    ])
  })

  test('adding a patch file does not mistake its raw contents for changes to another file', () => {
    for (const type of ['add', 'delete']) {
      expect(buildThreadInsights(thread([file([change('saved.patch', replacement, { type })])])).files).toEqual([
        { path: 'saved.patch', kind: type, diff: replacement },
      ])
    }
  })

  test('known zero counts are retained only when the hunk explicitly establishes them', () => {
    expect(buildThreadInsights(thread([file([change('a', '@@ -0,0 +0,0 @@\n')])])).files[0]).toMatchObject({ added: 0, removed: 0 })
    expect(buildThreadInsights(thread([file([change('b', '@@ -1 +0,0 @@\n-deleted\n')])])).files[0]).toMatchObject({ added: 0, removed: 1 })
  })

  test('failed, declined and pending patches do not masquerade as completed edits', () => {
    const result = buildThreadInsights(thread(['failed', 'declined', 'inProgress', 'futureStatus'].map(status => file([change(status, replacement)], { id: status, status }))))
    expect(result.files).toEqual([])
  })

  test('ignores other tool payloads and invalid change shapes without coercing text', () => {
    expect(buildThreadInsights(thread([
      { id: 'other', type: 'mcpToolCall', changes: [change('fake', replacement)] },
      file([null, [], 5, { path: {} }, { path: '' }, change('literal <path>', undefined, { unexpected: true })]),
    ])).files).toEqual([{ path: 'literal <path>', diff: '' }])
  })

})
