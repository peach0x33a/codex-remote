import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接你的设备' })
  await dialog.getByLabel('设备名称').fill('测试工作站')
  await dialog.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await dialog.getByPlaceholder('App Server 的 Bearer token').fill('e2e-transport-token')
  await dialog.getByPlaceholder('例如：/home/me/projects/my-app').fill('/test/project')
  await dialog.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
}

async function enqueue(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '加入消息队列', exact: true }).click()
}

async function reopenAfterReload(page: Page, title: string) {
  await page.reload()
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /测试工作站/ }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await showSidebar(page)
  await page.locator('.sidebar').getByRole('button', { name: new RegExp('^' + title) }).click()
}

async function showSidebar(page: Page) {
  const toggle = page.getByRole('button', { name: '打开导航', exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}

function projectGroup(page: Page, basename: string) {
  return page.locator('.project-group').filter({ has: page.getByText(basename, { exact: true }) })
}

async function expectNoComposerHints(page: Page) {
  await expect(page.locator('.composer')).toBeVisible()
  await expect(page.locator('.composer-footnote')).toHaveCount(0)
  await expect(page.locator('.composer-area').getByText(/连接后即可发送消息|Enter\s*发送|Shift\s*\+\s*Enter\s*换行|可继续输入并加入队列|模型和权限修改从下一条消息生效/)).toHaveCount(0)
}

async function finish(page: Page, request: APIRequestContext) {
  expect((await request.get(MOCK_URL + '/test/finish')).ok()).toBe(true)
  await expect(page.locator('.working-status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await expect(page.locator('.message-agent')).toContainText('当前任务已完成。')
}

test.beforeEach(async ({ page, request }) => {
  expect((await request.get(MOCK_URL + '/test/reset')).ok()).toBe(true)
  await page.goto('/')
})

test('keeps both project and task lists in the newest session date window and uses custom grouping', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  expect((await request.get(MOCK_URL + '/test/scenario?name=recent-window')).ok()).toBe(true)
  await configure(page); await showSidebar(page)
  await expect(projectGroup(page, 'project')).toBeVisible()
  await expect(projectGroup(page, 'other-project')).toBeVisible()
  await expect(projectGroup(page, 'old-project')).toHaveCount(0)
  const dismiss = page.getByRole('button', { name: '关闭导航', exact: true })
  if (await dismiss.isVisible()) await dismiss.click()
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '任务中心', exact: true })
  await expect(dialog.locator('.agent-center-row')).toHaveCount(2)
  await expect(dialog.getByText('旧项目会话', { exact: true })).toHaveCount(0)
  const grouping = dialog.getByRole('button', { name: '任务分组方式', exact: true })
  await grouping.focus(); await grouping.press('ArrowDown')
  const choices = dialog.getByRole('listbox', { name: '任务分组方式', exact: true })
  await expect(choices).toBeVisible()
  await expect(choices.getByRole('option', { name: '项目', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(grouping).toHaveText('状态')
  await expect(grouping).toBeFocused()
  await grouping.click(); await page.keyboard.press('Escape')
  await expect(choices).toHaveCount(0); await expect(dialog).toBeVisible()
  await expect(page.locator('select')).toHaveCount(0)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.filter((entry: { method: string }) => /thread\/(resume|queue\/start)|turn\/start/.test(entry.method))).toHaveLength(0)
})

test('shows threads directly under their cwd basenames without a project filter', async ({ page }) => {
  await configure(page)
  await showSidebar(page)
  const project = projectGroup(page, 'project')
  const otherProject = projectGroup(page, 'other-project')
  await expect(project.getByText('project', { exact: true })).toBeVisible()
  await expect(otherProject.getByText('other-project', { exact: true })).toBeVisible()
  await expect(project.locator('.thread-row')).toHaveCount(1)
  await expect(otherProject.locator('.thread-row')).toHaveCount(1)
  await expect(project.getByRole('button', { name: '已有项目分析', exact: true })).toBeVisible()
  await expect(otherProject.getByRole('button', { name: '第二个会话', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '按项目筛选', exact: true })).toHaveCount(0)
  await expect(page.locator('.project-filter-trigger')).toHaveCount(0)

  await project.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  await showSidebar(page)
  await otherProject.getByRole('button', { name: '第二个会话', exact: true }).click()
  await expect(page.getByText('第二个会话的消息。', { exact: true })).toBeVisible()
})

test('uses the composer working directory for the next thread/start request', async ({ page, request }) => {
  await configure(page)
  await showSidebar(page)
  await page.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  await showSidebar(page)
  await page.locator('.sidebar').getByRole('button', { name: 'Codex Remote 首页', exact: true }).click()

  const directory = page.locator('.composer-area').getByRole('button', { name: '工作目录', exact: true })
  await expect(directory).toBeVisible()
  await directory.click()
  const popup = page.getByRole('dialog', { name: '工作目录', exact: true })
  await popup.getByRole('menuitem', { name: '添加项目', exact: true }).click()
  const cwd = '/test/final-controls-project'
  await popup.getByRole('textbox', { name: '工作目录路径', exact: true }).fill(cwd)
  await popup.getByRole('button', { name: '使用此目录', exact: true }).click()
  await expect(popup).not.toBeVisible()

  const prompt = '使用新的工作目录'
  await send(page, prompt)
  await expect(page.getByText('你好，这是通过真实 WebSocket 桥接返回的流式回复。', { exact: true })).toBeVisible()
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const starts = metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/start')
  expect(starts).toHaveLength(1)
  expect(starts[0].params.cwd).toBe(cwd)
  await showSidebar(page)
  await expect(projectGroup(page, 'final-controls-project').getByRole('button', { name: prompt, exact: true })).toBeVisible()
  await expect(projectGroup(page, 'project').getByRole('button', { name: '已有项目分析', exact: true })).toBeVisible()
})

test('omits composer footnotes and hint sentences while disconnected, idle, and streaming', async ({ page, request }) => {
  await expectNoComposerHints(page)
  await configure(page)
  await expectNoComposerHints(page)
  await send(page, '思考计时')
  await expect(page.locator('.working-status')).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await expectNoComposerHints(page)
  await finish(page, request)
  await expectNoComposerHints(page)
})

test('substitutes upstream retry text for live reasoning and resumes without an error banner', async ({ page, request }) => {
  await configure(page)
  await send(page, '思考计时')
  const status = page.locator('.working-status')
  const preview = page.locator('.composer-island .island-thinking-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('先检查事件顺序')
  const initialReasoning = (await preview.innerText()).trim()
  await expect(page.locator('.error-banner')).toHaveCount(0)

  expect((await request.post(MOCK_URL + '/test/upstream-retry')).ok()).toBe(true)
  const retryText = 'Reconnecting... 1/5'
  await expect(status).toContainText(retryText)
  await expect(status).not.toContainText(initialReasoning)
  await expect(page.locator('.error-banner')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  expect((await request.post(MOCK_URL + '/test/upstream-resume')).ok()).toBe(true)
  await expect(status).toHaveCount(0)
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('重连后继续检查。')
  await expect(page.locator('.error-banner')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await finish(page, request)
  await expect(page.locator('.error-banner')).toHaveCount(0)
})

test('advances elapsed thinking time during a real held reasoning stream', async ({ page, request }) => {
  // Install before mounting so intervals created by the app use the controlled clock.
  await page.clock.install()
  await page.reload()
  await configure(page)
  await send(page, '思考计时')
  const status = page.locator('.composer-island .island-thinking')
  await expect(status.locator('.island-thinking-preview')).toBeVisible()
  await expect(status.locator('.island-thinking-preview')).toContainText('先检查事件顺序')
  await expect(page.locator('.message-list .reasoning')).toHaveCount(0)
  await expect(page.locator('.working-status')).toHaveCount(0)
  await expect(status).toContainText(/思考[\s\S]*\d+(?:\.\d+)?\s*秒/)
  const elapsedSeconds = async () => {
    const match = (await status.innerText()).match(/(\d+(?:\.\d+)?)\s*秒/)
    expect(match, 'the live thinking status should include elapsed seconds').not.toBeNull()
    return Number(match![1])
  }
  const before = await elapsedSeconds()
  await page.clock.fastForward(3_500)
  await expect.poll(elapsedSeconds).toBeGreaterThan(before)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await expect(page.locator('.error-banner')).toHaveCount(0)
  await finish(page, request)
  await expect(status).toHaveCount(0)
  const completed = page.locator('.message-list .reasoning')
  await expect(completed).toHaveCount(1)
  await expect(completed).not.toHaveAttribute('open', '')
  await expect(completed.locator('.markdown')).toHaveCount(0)
  await completed.locator('summary').click()
  await expect(completed.locator('.markdown')).toContainText('先检查事件顺序')
})

test('shares native queue edits across clients and restores them after reload without browser dispatch', async ({ page, request }) => {
  expect((await request.get(MOCK_URL + '/test/scenario?name=native-queue')).ok()).toBe(true)
  await configure(page)
  const title = '队列任务原生回归'
  await send(page, title)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /轻量模型/ }).click()
  await page.getByRole('button', { name: '思考强度', exact: true }).click()
  await page.getByRole('slider', { name: '思考强度', exact: true }).press('Home')
  await page.keyboard.press('Escape')
  await enqueue(page, '共享待发送消息')
  const queue = page.getByRole('region', { name: '消息队列', exact: true })
  await expect(queue.locator('.queue-item')).toHaveCount(1)
  await enqueue(page, '删除这个排队消息')
  await expect(queue.locator('.queue-item')).toHaveCount(2)
  await expect(queue).toContainText('服务端队列')
  await expect(queue.getByRole('button', { name: /暂停队列|继续队列/ })).toHaveCount(0)
  const initial = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const calls = initial.requests as { method: string; params: Record<string, any> }[]
  const starts = calls.filter(entry => entry.method === 'turn/start')
  expect(starts).toHaveLength(1)
  const threadId = starts[0]!.params.threadId as string
  const settingsIndex = calls.findIndex(entry => entry.method === 'thread/settings/update')
  const addIndex = calls.findIndex(entry => entry.method === 'thread/queue/add')
  expect(settingsIndex).toBeGreaterThanOrEqual(0)
  expect(settingsIndex).toBeLessThan(addIndex)
  expect(calls[settingsIndex]!.params).toMatchObject({ threadId, model: 'quick-model', effort: 'low' })
  expect(initial.nativeQueues[threadId]).toHaveLength(2)
  const nativeId = initial.nativeQueues[threadId][0].id as string

  await queue.getByRole('button', { name: '编辑排队消息', exact: true }).first().click()
  await queue.getByRole('textbox').fill('浏览器修改后的消息')
  await queue.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(queue.locator('.queue-text').first()).toHaveText('浏览器修改后的消息')
  await queue.getByRole('button', { name: '移除排队消息', exact: true }).last().click()
  await expect(queue.locator('.queue-item')).toHaveCount(1)
  expect((await request.post(MOCK_URL + '/test/native-queue', { data: { threadId, action: 'add', id: 'other-client', text: '另一端新增消息' } })).ok()).toBe(true)
  await expect(queue.locator('.queue-item')).toHaveCount(2)
  await expect(queue).toContainText('另一端新增消息')
  expect((await request.post(MOCK_URL + '/test/native-queue', { data: { threadId, action: 'update', id: nativeId, text: '另一端修改后的共享消息' } })).ok()).toBe(true)
  await expect(queue.locator('.queue-text').first()).toHaveText('另一端修改后的共享消息')
  expect((await request.post(MOCK_URL + '/test/native-queue', { data: { threadId, action: 'delete', id: 'other-client' } })).ok()).toBe(true)
  await expect(queue.locator('.queue-item')).toHaveCount(1)

  await reopenAfterReload(page, title)
  await expect(queue).toContainText('服务端队列')
  await expect(queue.locator('.queue-text')).toHaveText('另一端修改后的共享消息')
  await expect(queue.locator('.queue-item')).toHaveAttribute('data-queue-id', nativeId)
  await queue.getByRole('button', { name: '移除排队消息', exact: true }).click()
  await expect(queue).toHaveCount(0)
  const after = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(after.nativeQueues[threadId]).toEqual([])
  expect(after.requests.filter((entry: { method: string }) => entry.method === 'turn/start')).toHaveLength(1)
  expect(after.requests.filter((entry: { method: string }) => entry.method === 'turn/steer')).toHaveLength(0)
  expect(after.requests.filter((entry: { method: string }) => entry.method === 'thread/queue/add')).toHaveLength(2)
  expect(after.requests.filter((entry: { method: string }) => entry.method === 'thread/queue/update')).toHaveLength(1)
  expect(after.requests.filter((entry: { method: string }) => entry.method === 'thread/queue/delete')).toHaveLength(2)
})

test('restores composer controls from external thread settings and the next native resume', async ({ page, request }) => {
  expect((await request.get(MOCK_URL + '/test/scenario?name=native-queue')).ok()).toBe(true)
  await configure(page); await showSidebar(page)
  await page.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  const threadSettings = { model: 'quick-model', effort: 'low', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
  expect((await request.post(MOCK_URL + '/test/native-settings', { data: { threadId: 'existing-thread', threadSettings } })).ok()).toBe(true)
  const assertControls = async () => {
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('轻量模型')
    await expect(page.getByRole('button', { name: '思考强度', exact: true })).toContainText('轻度')
    await page.getByRole('button', { name: '更改权限', exact: true }).click()
    await expect(page.getByRole('menuitemradio', { name: /只读/ })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
  }
  await assertControls()
  await reopenAfterReload(page, '已有项目分析')
  await assertControls()
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.nativeSettings['existing-thread']).toEqual(threadSettings)
  expect(metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/settings/update')).toHaveLength(0)
})
