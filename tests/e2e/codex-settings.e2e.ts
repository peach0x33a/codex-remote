import { expect, test, type Page } from '@playwright/test'
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
test('shows unsupported configuration errors without affecting local settings', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=config-unsupported')
  const dialog = await settings(page)
  await dialog.getByRole('button', { name: '模型与回复', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('配置接口不可用')
  await dialog.getByRole('button', { name: '常规与内容', exact: true }).click()
  await expect(dialog.getByRole('switch', { name: '启用自动换行', exact: true })).toBeEnabled()
})
for (const position of ['end', 'middle', 'selection'] as const) {
  test('Shift+Enter moves the caret and inserts subsequent text at ' + position, async ({ page, request }) => {
    const editor = page.locator('#message-input')
    await editor.fill('前文后文')
    await editor.evaluate((element, where) => {
      const range = document.createRange(), node = element.firstChild!
      range.setStart(node, where === 'end' ? 4 : 2)
      range.setEnd(node, where === 'selection' ? 4 : where === 'end' ? 4 : 2)
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
    }, position)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.insertText('下一行')
    const callsBefore = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
    expect(callsBefore.some((c: any) => c.method === 'turn/start')).toBe(false)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.message-user')).toContainText('下一行')
    const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
    const input = calls.find((c: any) => c.method === 'turn/start').params.input
    expect(input[0].text).toBe(position === 'end' ? '前文后文\n\n下一行' : position === 'middle' ? '前文\n\n下一行后文' : '前文\n\n下一行')
  })
}
test('asks before discarding unsaved Codex changes and hides the save bar on website panes', async ({ page }) => {
  const dialog = await settings(page)
  await expect(dialog.getByRole('button', { name: '保存 Codex 设置', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: '上下文', exact: true }).click()
  await dialog.getByLabel('自动压缩阈值（tokens）').fill('90000')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('未保存的更改')
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(dialog.getByLabel('自动压缩阈值（tokens）')).toHaveValue('90000')
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await dialog.getByRole('button', { name: '放弃更改', exact: true }).click()
  await expect(dialog).toBeHidden()
})
