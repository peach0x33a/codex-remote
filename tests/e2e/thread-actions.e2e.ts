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

test('renames directly when the slash command includes a name', async ({ page, request }) => {
  await editor(page).fill('/rename 解包BFV资源')
  await page.keyboard.press('Enter')
  await expect(page.locator('.conversation-title')).toHaveText('解包BFV资源')
  await expect(editor(page)).toBeEmpty()
  await expect(page.getByRole('dialog', { name: '重命名对话', exact: true })).toHaveCount(0)
  const calls = (await metrics(request)).requests
  expect(calls.filter(call => call.method === 'thread/name/set').map(call => call.params)).toEqual([{ threadId: 'existing-thread', name: '解包BFV资源' }])
  expect(generationCalls(calls)).toHaveLength(0)
  await showSidebar(page)
  await expect(page.locator('.sidebar').getByRole('button', { name: '解包BFV资源', exact: true })).toBeVisible()
})

test('opens a themed name field only when the rename command has no name', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await editor(page).fill('/rename')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '重命名对话', exact: true })
  const name = dialog.getByRole('textbox', { name: '对话名称', exact: true })
  await expect(dialog).toBeVisible()
  await expect(name).toHaveValue('已有项目分析')
  await expect(name).toBeFocused()
  await name.fill('解包BFV资源')
  await dialog.screenshot({ path: testInfo.outputPath('rename-dialog-dark.png') })
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.conversation-title')).toHaveText('解包BFV资源')
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})

test('keeps the rename command available to retry when saving fails', async ({ page, request }) => {
  let rejectNextRename = true
  await page.routeWebSocket(/\/api\/socket(?:\?|$)/, socket => {
    const upstream = socket.connectToServer()
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.method === 'thread/name/set' && rejectNextRename) {
        rejectNextRename = false
        socket.send(JSON.stringify({ id: message.id, error: { code: -32603, message: '名称保存失败，请重试。' } }))
      } else upstream.send(raw)
    })
    upstream.onMessage(raw => socket.send(raw))
  })
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await expect(page.locator('.conversation-title')).toHaveText('已有项目分析')
  await editor(page).fill('/rename 解包BFV资源')
  await page.keyboard.press('Enter')
  await expect(page.getByText('名称保存失败，请重试。', { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText('/rename 解包BFV资源')
  await expect(page.locator('.conversation-title')).toHaveText('已有项目分析')
  await expect(page.getByRole('dialog', { name: '重命名对话', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.conversation-title')).toHaveText('解包BFV资源')
  await expect(editor(page)).toBeEmpty()
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})

test('copies Session ID only from context capacity and follows conversation switches', async ({ page, request }) => {
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__copiedSession = text } }, configurable: true }) })
  await (await actions(page)).getByRole('menuitem', { name: '复制', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '复制 Session ID', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  for (const [name, id] of [['已有项目分析', 'existing-thread'], ['第二个会话', 'second-thread']]) {
    await openThread(page, name)
    await page.getByRole('button', { name: '上下文用量', exact: true }).click()
    const context = page.getByRole('dialog', { name: '上下文用量', exact: true })
    await expect(context.getByRole('textbox', { name: 'Session ID', exact: true })).toHaveText(id)
    await context.getByRole('button', { name: '复制 Session ID', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__copiedSession)).toBe(id)
    await expect(context).toBeVisible()
    await page.keyboard.press('Escape')
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
  await page.getByRole('button', { name: '上下文用量', exact: true }).click()
  const context = page.getByRole('dialog', { name: '上下文用量', exact: true })
  await expect(context.getByRole('textbox', { name: 'Session ID', exact: true })).toHaveText('existing-thread')
  await context.getByRole('button', { name: '复制 Session ID', exact: true }).click()
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

test('HTTP copy stays in the context window and failures never open a popup or select the displayed ID', async ({ page, request }, testInfo) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = (command: string) => {
      if (command !== 'copy') return false
      ;(window as any).__copiedSession = (document.activeElement as HTMLTextAreaElement)?.value
      return true
    }
  })
  await page.getByRole('button', { name: '上下文用量', exact: true }).click()
  const context = page.getByRole('dialog', { name: '上下文用量', exact: true })
  const id = context.getByRole('textbox', { name: 'Session ID', exact: true })
  await expect(id).toHaveText('existing-thread'); await expect(id).toHaveAttribute('aria-readonly', 'true')
  expect((await id.boundingBox())!.height).toBeLessThan(42)
  await id.evaluate(element => { element.focus(); const selection = window.getSelection()!, range = document.createRange(); range.setStart(element.firstChild!, 3); range.collapse(true); selection.removeAllRanges(); selection.addRange(range) })
  await context.getByRole('button', { name: '复制 Session ID', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__copiedSession)).toBe('existing-thread')
  await expect(context).toBeVisible()
  expect(await id.evaluate(() => { const selection = window.getSelection()!; return [selection.anchorOffset, selection.focusOffset] })).toEqual([3, 3])
  await context.screenshot({ path: testInfo.outputPath('context-session-copy-button.png') })
  await page.evaluate(() => { document.execCommand = () => false })
  await context.getByRole('button', { name: '复制 Session ID', exact: true }).click()
  await expect(page.getByText('复制失败，请手动选择文字复制。', { exact: true })).toBeVisible()
  expect(await id.evaluate(() => { const selection = window.getSelection()!; return [selection.anchorOffset, selection.focusOffset] })).toEqual([3, 3])
  await page.keyboard.press('Escape')
  await (await actions(page)).getByRole('menuitem', { name: '复制', exact: true }).click()
  await page.getByRole('menuitem', { name: '复制最近一条回复', exact: true }).click()
  await expect(context).toHaveCount(0)
  await expect(page.getByText('复制失败，请手动选择文字复制。', { exact: true })).toBeVisible()
  expect(generationCalls((await metrics(request)).requests)).toHaveLength(0)
})
