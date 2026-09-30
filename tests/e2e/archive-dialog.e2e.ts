import { expect, test, type Page } from '@playwright/test'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('归档测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function sidebar(page: Page) {
  const toggle = page.getByRole('button', { name: '打开导航', exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
async function archives(page: Page) {
  await sidebar(page)
  await page.getByRole('button', { name: '归档会话', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '归档会话', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/'); await configure(page) })

test('archives on the server and restores the same conversation with its history', async ({ page, request }) => {
  await sidebar(page)
  await expect(page.getByRole('button', { name: '已有项目分析', exact: true })).toBeVisible()
  const row = page.locator('.thread-row').filter({ has: page.getByRole('button', { name: '已有项目分析', exact: true }) })
  if ((page.viewportSize()?.width || 0) > 760) await row.hover()
  await row.getByRole('button', { name: '归档 已有项目分析', exact: true }).click()
  await expect(page.getByRole('button', { name: '已有项目分析', exact: true })).toHaveCount(0)
  const dialog = await archives(page)
  await expect(dialog.locator('.archive-row')).toHaveCount(2)
  await dialog.getByRole('button', { name: '恢复并打开 已有项目分析', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.conversation')).toContainText('这是保存在远端的会话。')
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((call: any) => call.method === 'thread/archive' && call.params.threadId === 'existing-thread')).toBe(true)
  expect(calls.some((call: any) => call.method === 'thread/unarchive' && call.params.threadId === 'existing-thread')).toBe(true)
  expect(calls.some((call: any) => call.method === 'thread/delete')).toBe(false)
  await archives(page)
  await expect(dialog.locator('.archive-row')).toHaveCount(1)
  await expect(dialog).toContainText('归档历史会话')
})

test('loads old archives only on demand and searches the server beyond the first page', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=archive-pages')
  let calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'thread/list' && call.params.archived)).toHaveLength(0)
  const dialog = await archives(page)
  await expect(dialog.locator('.archive-row')).toHaveCount(30)
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'thread/list' && call.params.archived)).toHaveLength(1)
  await dialog.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(dialog.locator('.archive-row')).toHaveCount(35)
  await dialog.getByRole('searchbox', { name: '搜索归档会话' }).fill('历史归档 33')
  await expect(dialog.locator('.archive-row')).toHaveCount(1)
  await expect(dialog.locator('.archive-row')).toContainText('历史归档 33')
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  const search = calls.findLast((call: any) => call.method === 'thread/list' && call.params.archived)
  expect(search.params).toMatchObject({ archived: true, limit: 30, searchTerm: '历史归档 33', sortKey: 'updated_at', sortDirection: 'desc' })
})

test('keeps failed restorations in the archive and allows retry', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=archive-fail')
  const dialog = await archives(page)
  const restore = dialog.getByRole('button', { name: '恢复并打开 归档历史会话', exact: true })
  await restore.click()
  await expect(dialog.getByRole('alert')).toContainText('测试恢复失败')
  await expect(dialog.locator('.archive-row')).toHaveCount(1)
  await expect(restore).toBeEnabled()
  await request.get(MOCK_URL + '/test/scenario?name=')
  await restore.click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.conversation')).toContainText('归档前保存的会话内容。')
})
