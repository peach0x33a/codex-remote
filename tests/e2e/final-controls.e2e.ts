import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接你的设备' })
  await dialog.getByLabel('设备名称').fill('测试工作站')
  await dialog.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await dialog.getByPlaceholder('App Server 的 Bearer token').fill('e2e-transport-token')
  await dialog.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
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

test.beforeEach(async ({ page, request }) => {
  expect((await request.get(MOCK_URL + '/test/reset')).ok()).toBe(true)
  await page.goto('/')
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
