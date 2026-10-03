import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function configure(page: Page, name = 'URL 测试设备', endpoint = MOCK_ENDPOINT) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill(name)
  await page.getByLabel('App Server 地址').fill(endpoint)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function sidebar(page: Page) {
  const nav = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await nav.isVisible() && await nav.getAttribute('aria-expanded') !== 'true') await nav.click()
}
async function select(page: Page, name: string) {
  await sidebar(page); await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
}
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/') })

test('stale unfinished history neither runs the clock nor steers the next message, including URL reloads', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=stale-turn')
  await configure(page); await select(page, '已有项目分析')
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  await expect(page.locator('.working-status')).toHaveCount(0)
  await expect(page.getByText('工作了 10 分 12 秒', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/thread=existing-thread/)
  const link = page.url(), target = new URL(link)
  expect(target.searchParams.get('device')).toBeTruthy()
  expect([...target.searchParams.keys()].sort()).toEqual(['device', 'thread'])
  await page.reload()
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  await expect(page.locator('.working-status')).toHaveCount(0)
  await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill('继续问一个新问题')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('你好，这是通过真实 WebSocket 桥接返回的流式回复。', { exact: true })).toBeVisible()
  await expect(page.locator('.working-status')).toHaveCount(0)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.received.filter((method: string) => method === 'turn/start')).toHaveLength(1)
  expect(metrics.received.filter((method: string) => method === 'turn/steer' || method === 'thread/queue/add')).toHaveLength(0)
  await select(page, '第二个会话'); await expect(page).toHaveURL(/thread=second-thread/)
  await sidebar(page); await page.getByRole('button', { name: 'Codex Remote 首页', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('thread')).toBe(false)
  expect(new URL(page.url()).searchParams.has('device')).toBe(false)
})

test('a pasted URL restores its own device and session instead of the last selected device', async ({ page, context, request }) => {
  await configure(page, '链接中的设备'); await select(page, '已有项目分析')
  await expect(page).toHaveURL(/thread=existing-thread/)
  const link = page.url()
  await configure(page, '后来选择的设备', MOCK_ENDPOINT + '/second')
  const fresh = await context.newPage()
  await fresh.goto(link)
  await expect(fresh.getByTestId('selected-device')).toContainText('链接中的设备')
  await expect(fresh.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
  await expect(fresh).toHaveURL(link)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.received.filter((method: string) => method === 'turn/start' || method === 'thread/start')).toHaveLength(0)
  await fresh.close()
})

test('unavailable URL targets keep the requested identifiers and do not resume another session', async ({ page, request }) => {
  await configure(page); await select(page, '已有项目分析'); await expect(page).toHaveURL(/thread=existing-thread/)
  const url = new URL(page.url())
  url.searchParams.set('thread', 'missing-thread')
  await page.goto(url.href)
  await expect(page.getByRole('heading', { name: '会话未能加载' })).toBeVisible()
  await expect(page).toHaveURL(url.href)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('thread')).toBe(false)
  const previous = (await (await request.get(MOCK_URL + '/test/metrics')).json()).resumed.length
  url.searchParams.set('device', 'missing-device')
  await page.goto(url.href)
  await expect(page.getByText('链接对应的设备已不存在，请选择设备后打开会话。', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(url.href)
  expect((await (await request.get(MOCK_URL + '/test/metrics')).json()).resumed.length).toBe(previous)
})
