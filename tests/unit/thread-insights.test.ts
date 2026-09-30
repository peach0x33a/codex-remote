import { describe, expect, test } from 'bun:test'
import type { Item, Thread } from '../../shared/protocol'
import { buildThreadInsights, latestTurnFiles } from '../../src/lib/thread-insights'

function thread(...turns: Record<string, unknown>[][]): Thread {
  return { id: 'parent', cwd: '/project', createdAt: 0, updatedAt: 0, preview: '', turns: turns.map((items, index) => ({ id: 'turn-' + index, status: 'completed', items })) } as Thread
}
const collab = (patch: Record<string, unknown> = {}) => ({ id: 'collab', type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['child'], ...patch })
const change = (path: string, diff?: string, kind: unknown = { type: 'update', move_path: null }) => ({ path, diff, kind })
const file = (changes: unknown[], patch: Record<string, unknown> = {}) => ({ id: 'patch', type: 'fileChange', status: 'completed', changes, ...patch })
const replacement = '--- a/file\n+++ b/file\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n'

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
  test('no thread means no insights, regardless of globally cached summaries', () => {
    expect(buildThreadInsights(null, [{ id: 'child', agentNickname: 'Tesla' }])).toEqual({ agents: [], files: [] })
    expect(buildThreadInsights(thread(), [{ id: 'child', parentThreadId: 'parent', agentNickname: 'Tesla' }])).toEqual({ agents: [], files: [] })
  })

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

  test('partial metadata records preserve known names and use name when nickname is absent', () => {
    expect(buildThreadInsights(thread([collab({ receiverThreadIds: ['a', 'b', 'c'] })]), [
      { id: 'a', agentNickname: 'Tesla' }, { id: 'a', agentRole: 'reviewer' },
      { threadId: 'b', name: 'Named by user', agentNickname: null },
      { id: 'c', name: { unsafe: true }, agentNickname: '  ', agentRole: [] },
    ]).agents).toEqual([
      { id: 'a', name: 'Tesla', role: 'reviewer' }, { id: 'b', name: 'Named by user' }, { id: 'c', name: 'c' },
    ])
  })

  test('collab status and message take priority over thread metadata and lastMessage', () => {
    const result = buildThreadInsights(thread([collab({ agentsStates: { child: { status: 'running', message: 'Actual agent message' } } })]), [
      { id: 'child', status: { type: 'idle' }, lastMessage: 'Older answer', preview: 'Initial request' },
    ])
    expect(result.agents[0]).toEqual({ id: 'child', name: 'child', status: 'running', message: 'Actual agent message' })
  })

  test.each(['idle', 'active', 'systemError', 'notLoaded'])('summary runtime status %s stays literal and lastMessage is a fallback', status => {
    expect(buildThreadInsights(thread([collab()]), [{ id: 'child', status: { type: status }, lastMessage: 'Latest real message' }]).agents[0]).toEqual({ id: 'child', name: 'child', status, message: 'Latest real message' })
  })

  test('preview and collab prompt never become a completed agent result', () => {
    expect(buildThreadInsights(thread([collab({ prompt: 'Do the task', agentsStates: { child: { status: 'completed', message: null } } })]), [
      { id: 'child', preview: 'Initial user request', lastMessage: { text: 'malformed' } },
    ]).agents[0]).toEqual({ id: 'child', name: 'child', status: 'completed' })
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

  test('counts hunk lines including literal +++/--- content, empty lines and no-newline markers', () => {
    const diff = 'diff --git a/a b/a\r\nindex abc..def 100644\r\n--- a/a\r\n+++ b/a\r\n@@ -1,3 +1,4 @@ title\r\n unchanged\r\n---literal removed\r\n-old\r\n+++literal added\r\n+\r\n+new\r\n\\ No newline at end of file\r\n'
    expect(buildThreadInsights(thread([file([change('a', diff)])])).files[0]).toMatchObject({ added: 3, removed: 2, diff })
  })

  test('sums complete multiple hunks and accepts native move notes outside hunks', () => {
    const diff = '@@ -1,2 +1 @@\n-removed\n kept\n@@ -8 +7,2 @@\n x\n+y\n\nMoved to: renamed.txt'
    expect(buildThreadInsights(thread([file([change('a', diff)])])).files[0]).toMatchObject({ added: 1, removed: 1 })
  })

  test.each([
    '', '+looks added\n-looks removed', 'raw new file content\n', 'Binary files a/a and b/a differ',
    '--- a/a\n+++ b/a\n', '@@ -1 +1 @@\n-old', '@@ -1 +1 @@\n-old\n+new\n+extra',
    '@@ -1,2 +1 @@\n-old\n+new', '@@@ -1 -1 +1 @@@\n++combined', '@@ -9007199254740992 +1 @@\n-old\n+new',
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

  test.each([true, false])('one unknown contribution prevents an understated sum (unknown first: %s)', unknownFirst => {
    const diffs = unknownFirst ? ['raw content', replacement] : [replacement, 'raw content']
    const projected = buildThreadInsights(thread(diffs.map((diff, i) => file([change('a', diff)], { id: 'patch-' + i })))).files[0]!
    expect(projected.diff).toBe(diffs.join('\n'))
    expect(projected.added).toBeUndefined(); expect(projected.removed).toBeUndefined()
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

  test('is pure, does not consult summary histories and does not retain another thread data', () => {
    const original = thread([collab(), file([change('a', replacement)])])
    const summaries = [{ id: 'child', agentNickname: 'Tesla', turns: [{ items: [file([change('child-file', replacement)])] }] }]
    const before = structuredClone({ original, summaries })
    const first = buildThreadInsights(original, summaries)
    expect({ original, summaries }).toEqual(before)
    first.agents[0]!.name = 'Changed by consumer'; first.files[0]!.added = 999
    expect(buildThreadInsights(original, summaries).files[0]?.added).toBe(2)
    expect(buildThreadInsights(original, summaries).agents[0]?.name).toBe('Tesla')
    expect(buildThreadInsights(thread(), summaries)).toEqual({ agents: [], files: [] })
  })
})
