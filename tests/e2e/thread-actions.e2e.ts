import { expect, test, type APIRequestContext, type Page } from '../fixtures'
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
  await page.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await openThread(page)
  await expect(page.locator('.message-list')).toContainText('这是保存在远端的会话。')
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

test('shows a selectable Session ID in the context window when the clipboard API is unavailable', async ({ page, request }, testInfo) => {
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }) })
  await (await actions(page)).getByRole('menuitem', { name: '复制', exact: true }).click()
  await page.getByRole('menu', { name: '复制对话', exact: true }).getByRole('menuitem', { name: '复制 Session ID', exact: true }).click()
  const context = page.getByRole('dialog', { name: '上下文用量', exact: true })
  const id = context.getByRole('textbox', { name: 'Session ID', exact: true })
  await expect(context).toBeVisible(); await expect(id).toHaveValue('existing-thread')
  await expect(id).toHaveAttribute('readonly', '')
  await expect(id).toBeFocused()
  expect(await id.evaluate(element => {
    const field = element as HTMLTextAreaElement
    return field.value.slice(field.selectionStart, field.selectionEnd)
  })).toBe('existing-thread')
  await expect(page.getByText('已选中 Session ID，可手动复制。', { exact: true })).toBeVisible()
  await context.screenshot({ path: testInfo.outputPath('context-session-id.png') })
  await page.keyboard.press('Escape'); await openThread(page, '第二个会话')
  await page.getByRole('button', { name: '上下文用量', exact: true }).click()
  await expect(id).toHaveValue('second-thread')
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})
