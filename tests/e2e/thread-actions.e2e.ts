import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Thread } from '../../shared/protocol'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

type RecordedCall = { method: string; params: Record<string, unknown> }
type Metrics = { requests: RecordedCall[]; resumed: string[]; forks: (Thread & { forkedFromId: string })[] }
async function metrics(request: APIRequestContext): Promise<Metrics> { return (await request.get(MOCK_URL + '/test/metrics')).json() }
const editor = (page: Page) => page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
const generationCalls = (calls: RecordedCall[]) => calls.filter(call => /^(turn\/(start|steer)|thread\/queue\/(start|enqueue))$/.test(call.method))

async function showSidebar(page: Page) {
  const home = page.locator('.sidebar').getByRole('button', { name: 'Codex Remote 首页', exact: true })
  const toggle = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(home).toBeVisible()
}
async function openThread(page: Page, title = '已有项目分析') {
  await showSidebar(page)
  await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click()
  await expect(page.locator('.conversation-title')).toHaveText(title)
}
async function actions(page: Page) {
  await page.getByRole('button', { name: '会话操作', exact: true }).click()
  const menu = page.getByRole('menu', { name: '会话操作', exact: true })
  await expect(menu).toBeVisible()
  return menu
}
async function forkMenu(page: Page) {
  await (await actions(page)).getByRole('menuitem', { name: '分叉', exact: true }).click()
  const menu = page.getByRole('menu', { name: '分叉对话', exact: true })
  await expect(menu).toBeVisible()
  return menu
}
async function send(page: Page, text: string) {
  await editor(page).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
}

test.beforeEach(async ({ page, request }) => {
  expect((await request.get(MOCK_URL + '/test/reset')).ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('会话操作测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByPlaceholder('例如：/home/me/projects/my-app').fill('/test/project')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await openThread(page)
  await expect(page.locator('.message-list')).toContainText('这是保存在远端的会话。')
})

test('starts a new draft from the sidebar logo without a duplicate new-conversation button', async ({ page, request }) => {
  await editor(page).fill('尚未发送的草稿')
  await showSidebar(page)
  await expect(page.locator('.sidebar').getByRole('button', { name: '开启新对话', exact: true })).toHaveCount(0)
  await page.locator('.sidebar').getByRole('button', { name: 'Codex Remote 首页', exact: true }).click()
  await expect(page.locator('.welcome')).toBeVisible()
  await expect(editor(page)).toBeEmpty()
  await expect(page.getByRole('button', { name: '会话操作', exact: true })).toHaveCount(0)
  const calls = (await metrics(request)).requests
  expect(calls.filter(call => ['thread/start', 'thread/fork'].includes(call.method))).toHaveLength(0)
  expect(generationCalls(calls)).toHaveLength(0)
})

test('renames through the thread menu, validates empty names, and persists the native name', async ({ page, request }) => {
  await (await actions(page)).getByRole('menuitem', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名对话', exact: true })
  const name = dialog.getByRole('textbox', { name: '对话名称', exact: true })
  await expect(name).toHaveValue('已有项目分析')
  await name.fill('不应保存的名称')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await metrics(request)).requests.filter(call => call.method === 'thread/name/set')).toHaveLength(0)
  await (await actions(page)).getByRole('menuitem', { name: '重命名', exact: true }).click()
  await name.fill('   ')
  await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
  await name.fill('  原生重命名会话  ')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.conversation-title')).toHaveText('原生重命名会话')
  await showSidebar(page)
  await expect(page.locator('.sidebar').getByRole('button', { name: '原生重命名会话', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar').getByRole('button', { name: '已有项目分析', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await openThread(page, '原生重命名会话')
  const calls = (await metrics(request)).requests
  expect(calls.filter(call => call.method === 'thread/name/set').map(call => call.params)).toEqual([{ threadId: 'existing-thread', name: '原生重命名会话' }])
  expect(generationCalls(calls)).toHaveLength(0)
})

test('pins an older thread ahead of recent threads, persists across reload, and unpins', async ({ page, request }) => {
  await openThread(page, '第二个会话')
  await (await actions(page)).getByRole('menuitem', { name: '置顶', exact: true }).click()
  await showSidebar(page)
  const rows = page.locator('.sidebar .thread-select')
  await expect(rows.first()).toHaveText('第二个会话')
  const savedPins = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('codex-remote.pinned-threads.')).flatMap(key => JSON.parse(localStorage.getItem(key)!)))
  await expect.poll(savedPins).toEqual(['second-thread'])
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await showSidebar(page)
  await expect(rows.first()).toHaveText('第二个会话')
  await rows.first().click()
  await (await actions(page)).getByRole('menuitem', { name: '取消置顶', exact: true }).click()
  await expect.poll(savedPins).toEqual([])
  await showSidebar(page)
  await expect(rows.first()).toHaveText('已有项目分析')
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})

test('keeps the scheduled entry disabled and skips it during menu keyboard navigation', async ({ page, request }) => {
  const menu = await actions(page)
  const scheduled = menu.getByRole('menuitem', { name: '添加计划任务…', exact: true })
  await expect(scheduled).toBeVisible()
  await expect(scheduled).toBeDisabled()
  await expect(scheduled).toHaveAttribute('title', '当前 Codex App Server 未提供计划任务接口')
  await menu.getByRole('menuitem', { name: '分叉', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: '复制', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: '会话操作', exact: true })).toBeFocused()
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})

test('copies the current Session ID from the copy submenu and follows conversation switches', async ({ page, request }) => {
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__copiedSession = text } }, configurable: true }) })
  for (const [name, id] of [['已有项目分析', 'existing-thread'], ['第二个会话', 'second-thread']]) {
    await openThread(page, name)
    await (await actions(page)).getByRole('menuitem', { name: '复制', exact: true }).click()
    await page.getByRole('menu', { name: '复制对话', exact: true }).getByRole('menuitem', { name: '复制 Session ID', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__copiedSession)).toBe(id)
    await expect(page.getByRole('menu', { name: '复制对话', exact: true })).toHaveCount(0)
  }
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})

test('allows copying the Session ID even when the conversation has no messages', async ({ page }) => {
  await page.routeWebSocket(/\/api\/socket(?:\?|$)/, socket => {
    const upstream = socket.connectToServer()
    const emptyPages = new Set<number>()
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.params?.threadId === 'existing-thread' && ['thread/turns/list', 'thread/items/list'].includes(message.method)) emptyPages.add(message.id)
      upstream.send(raw)
    })
    upstream.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.result?.thread?.id === 'existing-thread') message.result.thread.turns = []
      if (emptyPages.has(message.id)) message.result = { data: [], nextCursor: null }
      socket.send(JSON.stringify(message))
    })
  })
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await openThread(page)
  await expect(page.locator('.empty-thread')).toBeVisible()
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__copiedSession = text } }, configurable: true }) })
  await (await actions(page)).getByRole('menuitem', { name: '复制', exact: true }).click()
  const menu = page.getByRole('menu', { name: '复制对话', exact: true })
  await expect(menu.getByRole('menuitem', { name: '复制已加载的对话', exact: true })).toBeDisabled()
  await menu.getByRole('menuitem', { name: '复制 Session ID', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__copiedSession)).toBe('existing-thread')
})

for (const completedOnly of [false, true]) {
  test('uses native fork metadata from ' + (completedOnly ? 'the last completed turn' : 'the latest position') + ' without starting generation', async ({ page, request }) => {
    await send(page, '队列任务保留在原会话')
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
    const menu = await forkMenu(page)
    await menu.getByRole('menuitem', { name: completedOnly ? '从上一轮完成处分叉' : '从最新位置分叉', exact: true }).click()
    await expect.poll(async () => (await metrics(request)).forks.length).toBe(1)
    const result = await metrics(request), fork = result.forks[0]!
    expect(fork).toMatchObject({ forkedFromId: 'existing-thread', name: '已有项目分析', cwd: '/test/project', source: 'cli', status: { type: 'idle' } })
    expect(fork.id).not.toBe('existing-thread')
    expect(fork.parentThreadId).toBeUndefined()
    expect(fork.turns).toHaveLength(completedOnly ? 1 : 2)
    expect(fork.turns[0]!.id).toBe('existing-turn')
    expect(fork.turns.at(-1)!.status).toBe(completedOnly ? 'completed' : 'interrupted')
    expect(result.requests.filter(call => call.method === 'thread/fork').map(call => call.params)).toEqual([{
      threadId: 'existing-thread', excludeTurns: true, deferGoalContinuation: true, ...(completedOnly ? { lastTurnId: 'existing-turn' } : {}),
    }])
    await expect.poll(async () => (await metrics(request)).resumed.includes(fork.id)).toBe(true)
    await expect(page.locator('.message-list')).toContainText('这是保存在远端的会话。')
    const heldMessage = page.locator('.message-list').getByText('队列任务保留在原会话', { exact: true })
    if (completedOnly) await expect(heldMessage).toHaveCount(0)
    else await expect(heldMessage).toBeVisible()
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
    await expect(editor(page)).toBeEmpty()
    await expect(page.getByRole('complementary', { name: '侧边聊天', exact: true })).toHaveCount(0)
    const calls = (await metrics(request)).requests
    expect(calls.filter(call => call.method === 'thread/start')).toHaveLength(0)
    expect(generationCalls(calls).map(call => ({ method: call.method, threadId: call.params.threadId }))).toEqual([{ method: 'turn/start', threadId: 'existing-thread' }])
  })
}

for (const status of ['failed', 'interrupted'] as const) {
  test('skips ' + (status === 'failed' ? 'a failed' : 'an interrupted') + ' turn when forking from the last completed turn', async ({ page, request }) => {
    if (status === 'failed') {
      await request.get(MOCK_URL + '/test/scenario?name=terminal-error')
      await send(page, '失败的后续任务')
      await expect(page.locator('.turn-failure')).toContainText('429 Too Many Requests')
    } else {
      await send(page, '队列任务随后中断')
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
      await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
    }
    await (await forkMenu(page)).getByRole('menuitem', { name: '从上一轮完成处分叉', exact: true }).click()
    await expect.poll(async () => (await metrics(request)).forks.length).toBe(1)
    const result = await metrics(request)
    // A failed or interrupted round is terminal, but it is not a completed cutoff.
    expect(result.requests.find(call => call.method === 'thread/fork')!.params.lastTurnId).toBe('existing-turn')
    expect(result.forks[0]!.turns.map(turn => turn.id)).toEqual(['existing-turn'])
    expect(generationCalls(result.requests)).toHaveLength(1)
  })
}

test('opens an independent side chat from a native fork and sends only after explicit input', async ({ page, request }) => {
  await editor(page).fill('保留在主会话的草稿')
  await (await actions(page)).getByRole('menuitem', { name: '新建侧边聊天', exact: true }).click()
  const side = page.getByRole('complementary', { name: '侧边聊天', exact: true })
  const sideInput = side.getByRole('textbox', { name: '侧边聊天消息', exact: true })
  await expect(side).toBeVisible()
  await expect(sideInput).toBeEnabled()
  await expect(sideInput).toBeEmpty()
  await expect(side.locator('.message-user, .message-agent')).toHaveCount(0)
  await expect(page.locator('.message-list')).toContainText('这是保存在远端的会话。')
  await expect(editor(page)).toHaveText('保留在主会话的草稿')
  const opened = await metrics(request), fork = opened.forks[0]!
  expect(opened.forks).toHaveLength(1)
  expect(fork).toMatchObject({ forkedFromId: 'existing-thread', cwd: '/test/project', source: 'cli' })
  expect(opened.resumed).toContain(fork.id)
  expect(opened.requests.find(call => call.method === 'thread/fork')!.params).toEqual({ threadId: 'existing-thread', excludeTurns: true, deferGoalContinuation: true })
  expect(generationCalls(opened.requests)).toHaveLength(0)
  expect(opened.requests.filter(call => call.method === 'thread/start')).toHaveLength(0)
  await sideInput.fill('队列任务侧聊独立执行')
  await side.getByRole('button', { name: '发送侧边聊天消息', exact: true }).click()
  const stop = side.getByRole('button', { name: '停止侧边聊天生成', exact: true })
  await expect(stop).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await sideInput.fill('侧聊插话草稿')
  await expect(stop).toHaveCount(0)
  await expect(side.getByRole('button', { name: '发送侧边聊天消息', exact: true })).toBeEnabled()
  await sideInput.fill('')
  await expect(stop).toBeVisible()
  await stop.click()
  await expect(stop).toHaveCount(0)
  await expect(page.locator('.message-list')).not.toContainText('队列任务侧聊独立执行')
  await expect(editor(page)).toHaveText('保留在主会话的草稿')
  const sent = (await metrics(request)).requests
  expect(generationCalls(sent).map(call => ({ method: call.method, threadId: call.params.threadId }))).toEqual([{ method: 'turn/start', threadId: fork.id }])
  expect(sent.filter(call => call.method === 'turn/interrupt').map(call => call.params.threadId)).toEqual([fork.id])
  await side.getByRole('button', { name: '关闭侧边聊天', exact: true }).click()
  await expect(side).toHaveCount(0)
  await send(page, '队列任务主会话仍可发送')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  expect((await metrics(request)).requests.filter(call => call.method === 'turn/start').map(call => call.params.threadId)).toEqual([fork.id, 'existing-thread'])
})
