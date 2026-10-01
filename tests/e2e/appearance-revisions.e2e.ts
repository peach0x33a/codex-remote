import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

function displaySettings(page: Page) { return page.getByRole('dialog', { name: '设置', exact: true }) }
async function openDisplaySettings(page: Page) {
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  if (!await trigger.isVisible()) await page.getByRole('button', { name: /打开导航|展开侧栏/ }).click()
  await trigger.click()
  await expect(displaySettings(page)).toBeVisible()
  await displaySettings(page).getByRole('button', { name: '外观与背景', exact: true }).click()
}

async function uploadBackground(page: Page) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGOwTPn3H4QZYAwAV+IKaYtEenEAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('上传背景图片', { exact: true }).setInputFiles({ name: '背景.png', mimeType: 'image/png', buffer: png })
  const image = page.locator('.workspace-image-backdrop img')
  await expect(image).toBeVisible()
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
}

async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('测试工作站')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
}
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/') })

test('edits a submitted message and durably withdraws the replacement', async ({ page, request }) => {
  await configure(page); await send(page, '原来的消息')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await expect(page.locator('.message-agent')).toContainText('流式回复')
  await page.locator('.message-user').first().hover()
  await page.getByRole('button', { name: '编辑消息', exact: true }).click()
  await page.getByRole('textbox', { name: '编辑消息内容', exact: true }).fill('修改后的消息')
  await page.getByRole('button', { name: '保存并重新发送', exact: true }).click()
  await expect(page.locator('.message-user')).toContainText('修改后的消息')
  await expect(page.locator('.message-user')).not.toContainText('原来的消息')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await page.locator('.message-user').first().hover()
  await page.getByRole('button', { name: '撤回消息', exact: true }).click()
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
  await expect(page.locator('.message-user')).toHaveCount(0)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/revert')).toHaveLength(2)
})

test('persists an uploaded background, restores it after reload and removes it', async ({ page }) => {
  await openDisplaySettings(page)
  await uploadBackground(page)
  const image = page.locator('.workspace-image-backdrop img')
  await page.reload()
  await expect(image).toBeVisible()
  await openDisplaySettings(page)
  await expect(page.locator('.background-preview')).toContainText('背景.png')
  await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '纯色背景', exact: true }).click()
  await expect(image).toHaveCount(0)
  await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '图片背景', exact: true }).click()
  await expect(image).toBeVisible()
  await page.locator('.background-preview').getByRole('button', { name: '移除', exact: true }).click()
  await expect(image).toHaveCount(0)
  await page.reload()
  await expect(image).toHaveCount(0)
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'none')
})
