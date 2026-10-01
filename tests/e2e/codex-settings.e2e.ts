import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function settings(page: Page) {
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  if (!await trigger.isVisible()) await page.getByRole('button', { name: /打开导航|展开侧栏/ }).click()
  await trigger.click()
  return page.getByRole('dialog', { name: '设置', exact: true })
}
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/'); await configure(page) })
test('groups local settings above Codex settings and only writes explicit changes', async ({ page, request }) => {
  const dialog = await settings(page)
  await expect(page.locator('.sidebar-footer').getByRole('button', { name: '设置', exact: true })).toHaveCount(1)
  await expect(page.locator('.workspace-header').getByRole('button', { name: '设置', exact: true })).toHaveCount(0)
  const nav = dialog.getByRole('navigation', { name: '设置分类' })
  const local = await nav.getByRole('group', { name: '网页设置' }).boundingBox(), remote = await nav.getByRole('group', { name: 'Codex 设置' }).boundingBox()
  expect(local!.y + local!.height).toBeLessThan(remote!.y)
  await dialog.getByRole('button', { name: '模型与回复', exact: true }).click()
  const footerBefore = await dialog.locator('.settings-footer').boundingBox()
  await dialog.locator('.settings-body').evaluate(el => { el.scrollTop = el.scrollHeight })
  const footerAfter = await dialog.locator('.settings-footer').boundingBox()
  expect(footerAfter!.y).toBeCloseTo(footerBefore!.y, 0)
  await expect(dialog.getByRole('button', { name: '默认模型', exact: true })).toContainText('测试模型')
  let calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((c: any) => c.method === 'config/batchWrite')).toBe(false)
  await dialog.getByRole('button', { name: '回复详细程度', exact: true }).click()
  await dialog.getByRole('option', { name: '简洁', exact: true }).click()
  await dialog.getByRole('button', { name: '执行与权限', exact: true }).click()
  await dialog.getByRole('button', { name: '网络搜索', exact: true }).click()
  await dialog.getByRole('option', { name: '关闭', exact: true }).click()
  await dialog.getByRole('button', { name: '保存 Codex 设置', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('已保存')
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  const writes = calls.filter((c: any) => c.method === 'config/batchWrite')
  expect(writes).toHaveLength(1)
  expect(writes[0].params).toMatchObject({ expectedVersion: '1', filePath: '/test/codex/config.toml', reloadUserConfig: false, edits: [{ keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace' }, { keyPath: 'web_search', value: 'disabled', mergeStrategy: 'replace' }] })
  await dialog.getByRole('button', { name: '模型与回复', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '回复详细程度', exact: true })).toContainText('简洁')
  await page.screenshot({ path: '/tmp/codex-settings-' + test.info().project.name + '.png' })
})
test('retains changes on version conflict without automatic retries', async ({ page, request }) => {
  const dialog = await settings(page)
  await dialog.getByRole('button', { name: '上下文', exact: true }).click()
  await dialog.getByLabel('自动压缩阈值（tokens）').fill('120000')
  await request.get(MOCK_URL + '/test/scenario?name=config-conflict')
  await dialog.getByRole('button', { name: '保存 Codex 设置', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他客户端修改')
  await expect(dialog.getByLabel('自动压缩阈值（tokens）')).toHaveValue('120000')
  await expect(dialog.getByRole('button', { name: '保存 Codex 设置', exact: true })).toBeDisabled()
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((c: any) => c.method === 'config/batchWrite')).toHaveLength(1)
})
