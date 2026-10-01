import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL, TEST_URL } from '../config'

async function configure(page: Page, cwd = '', connect = true) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接你的设备' })
  await dialog.getByLabel('设备名称').fill('跨端工作站')
  await dialog.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await dialog.getByPlaceholder('留空使用 ~/codex-remote').fill(cwd)
  await dialog.getByPlaceholder('App Server 的 Bearer token').fill('test-shared-secret')
  await dialog.getByRole('button', { name: connect ? '保存并连接' : '仅保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  if (connect) await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function edit(page: Page, name = '跨端工作站') {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '编辑设备 ' + name, exact: true }).click()
  return page.getByRole('dialog', { name: '连接你的设备' })
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 Codex 的消息' }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
}
test.beforeEach(async ({ request }) => { await request.get(MOCK_URL + '/test/reset') })

test('shares add/edit/remove across clean browser contexts and supports missing randomUUID', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined }))
  await page.goto('/')
  await configure(page, '', false)
  expect(await page.evaluate(() => localStorage.getItem('codex-remote.connections.v1'))).toBeNull()
  const context = await browser.newContext()
  try {
    const other = await context.newPage(); await other.goto(TEST_URL)
    await expect(other.getByTestId('selected-device')).toContainText('跨端工作站')
    await expect(other.getByTestId('selected-device')).toContainText('已连接')
    expect(await other.evaluate(() => localStorage.getItem('codex-remote.connections.v1'))).toBeNull()
    let dialog = await edit(other)
    await expect(dialog.getByPlaceholder('留空使用 ~/codex-remote')).toHaveValue('~/codex-remote')
    await expect(dialog.getByPlaceholder('已保存在服务器，留空保留', { exact: true })).toHaveValue('')
    await dialog.getByLabel('设备名称').fill('同步后的工作站')
    await dialog.getByPlaceholder('留空使用 ~/codex-remote').fill('/shared/default')
    await dialog.getByRole('button', { name: '仅保存', exact: true }).click()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByTestId('selected-device')).toContainText('同步后的工作站')
    dialog = await edit(other, '同步后的工作站')
    await dialog.getByRole('button', { name: '移除', exact: true }).click()
    await dialog.getByRole('button', { name: '确认移除？', exact: true }).click()
    await expect(dialog.getByLabel('设备名称')).toHaveValue('')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByTestId('selected-device')).toHaveCount(0)
  } finally { await context.close() }
})

test('migrates legacy browser records once and clears local metadata only after success', async ({ page }) => {
  const legacy = { version: 1, selectedId: 'legacy', profiles: [{ id: 'legacy', name: '旧浏览器设备', endpoint: MOCK_ENDPOINT, cwd: '', createdAt: 1 }] }
  await page.addInitScript(value => {
    localStorage.setItem('codex-remote.connections.v1', JSON.stringify(value))
    localStorage.setItem('codex-remote.ui.v1', JSON.stringify({ autoConnect: false }))
  }, legacy)
  await page.route('**/api/profiles', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试迁移失败' }) }) : route.continue())
  await page.goto('/')
  await expect(page.locator('.error-banner')).toContainText('测试迁移失败')
  expect(await page.evaluate(() => localStorage.getItem('codex-remote.connections.v1'))).toBe(JSON.stringify(legacy))
  await page.unroute('**/api/profiles')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('selected-device')).toContainText('旧浏览器设备')
  expect(await page.evaluate(() => localStorage.getItem('codex-remote.connections.v1'))).toBeNull()
  await expect(page.locator('.error-banner')).not.toBeVisible()
  const profiles = await page.evaluate(async () => (await (await fetch('/api/profiles')).json()).profiles)
  expect(profiles).toHaveLength(1); expect(profiles[0].cwd).toBe('~/codex-remote')
})

for (const [configured, expected] of [['', '/mock-home/codex-remote'], ['/custom/home', '/custom/home'], ['~/codex-home', '/mock-home/codex-home']]) {
  test('uses the device default for no-project work: ' + (configured || 'blank'), async ({ page, request }) => {
    await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined }))
    await page.goto('/'); await configure(page, configured)
    await page.getByRole('button', { name: '工作目录', exact: true }).click()
    let picker = page.getByRole('dialog', { name: '工作目录', exact: true })
    await picker.getByRole('menuitem', { name: '添加项目', exact: true }).click()
    await picker.getByRole('textbox', { name: '工作目录路径', exact: true }).fill('/project/chosen')
    await picker.getByRole('button', { name: '使用此目录', exact: true }).click()
    await page.getByRole('button', { name: '工作目录', exact: true }).click()
    picker = page.getByRole('dialog', { name: '工作目录', exact: true })
    await expect(picker.getByRole('menuitem', { name: '不在项目中工作', exact: true })).toHaveAttribute('title', '不指定项目，使用 ' + expected)
    await picker.getByRole('menuitem', { name: '不在项目中工作', exact: true }).click()
    await send(page, '你好')
    await expect(page.getByText('你好，这是通过真实 WebSocket 桥接返回的流式回复。', { exact: true })).toBeVisible()
    const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
    expect(metrics.requests.findLast((entry: { method: string }) => entry.method === 'thread/start').params.cwd).toBe(expected)
  })
}

test('renders subAgentActivity as readable activity instead of raw JSON', async ({ page }) => {
  await page.goto('/'); await configure(page, '/test/project')
  await send(page, '子代理事件')
  const activity = page.locator('details.tool-activity').filter({ hasText: '与子代理交互' })
  await expect(activity).toBeVisible()
  await activity.locator('summary').click()
  await expect(activity).toContainText('/root/crossflow_sol')
  await expect(activity).toContainText('01a0f75e-a768-7682-ad2f-2716871ce8f1')
  await expect(activity.locator('pre')).toHaveCount(0)
  await expect(activity).not.toContainText('任务完成')
})
