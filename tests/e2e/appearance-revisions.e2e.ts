import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
import { readFile } from 'node:fs/promises'

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

test('exports a portable background and fonts, imports in a clean browser and rejects corrupt files', async ({ page, browser }, info) => {
  await openDisplaySettings(page); await uploadBackground(page)
  const dialog = displaySettings(page)
  await dialog.getByRole('button', { name: '颜色主题', exact: true }).click(); await dialog.getByRole('option', { name: '暗色', exact: true }).click()
  await dialog.getByLabel('图片不透明度', { exact: true }).evaluate((element: HTMLInputElement) => { element.value = '71'; element.dispatchEvent(new Event('input', { bubbles: true })) })
  await dialog.getByRole('button', { name: '字体与字号', exact: true }).click()
  await dialog.getByRole('button', { name: 'UI 字体', exact: true }).click(); await dialog.getByRole('option', { name: '自定义', exact: true }).click()
  await dialog.getByLabel('自定义 UI 字体', { exact: true }).fill('中文自定义字体'); await dialog.getByLabel('自定义 UI 字体', { exact: true }).press('Enter')
  await dialog.getByRole('button', { name: '代码块字体', exact: true }).click(); await dialog.getByRole('option', { name: 'JetBrains Mono', exact: true }).click()
  await dialog.getByRole('button', { name: '常规与内容', exact: true }).click()
  await dialog.getByRole('button', { name: '内容宽度', exact: true }).click(); await dialog.getByRole('option', { name: '宽屏', exact: true }).click()
  await dialog.getByRole('switch', { name: '自动连接', exact: true }).click()
  await dialog.getByRole('button', { name: '外观与背景', exact: true }).click()
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出外观设置', exact: true }).click()
  const download = await pending, buffer = await readFile((await download.path())!), saved = JSON.parse(buffer.toString())
  expect(saved.background).toMatchObject({ type: 'image', name: '背景.png' }); expect(saved.background.dataUrl).toMatch(/^data:image\/webp;base64,/)
  expect(saved.appearance).toMatchObject({ theme: 'dark', contentWidth: 1280, imageBackground: { opacity: 71 } })
  expect(saved.typography).toMatchObject({ uiFont: '中文自定义字体', codeFont: 'JetBrains Mono' })
  expect(saved.appearance.autoConnect).toBeUndefined()
  const context = await browser.newContext({ viewport: page.viewportSize()! }), fresh = await context.newPage()
  try {
    await fresh.goto(page.url()); await openDisplaySettings(fresh)
    await fresh.getByLabel('导入外观设置文件', { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer })
    await expect(fresh.getByText('外观设置已导入并应用。', { exact: true })).toBeVisible()
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'dark'); await expect(fresh.locator('.app-shell')).toHaveCSS('--content-width', '1280px')
    await expect(fresh.locator('.workspace-image-backdrop img')).toBeVisible()
    await expect.poll(() => fresh.locator('.workspace-image-backdrop img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await expect(fresh.locator('html')).toHaveCSS('--ui-font-family', /中文自定义字体/)
    await expect(fresh.locator('html')).toHaveCSS('--code-font-family', /JetBrains Mono/)
    await displaySettings(fresh).getByRole('button', { name: '常规与内容', exact: true }).click()
    await expect(displaySettings(fresh).getByRole('switch', { name: '自动连接', exact: true })).toHaveAttribute('aria-checked', 'true')
    await displaySettings(fresh).getByRole('button', { name: '外观与背景', exact: true }).click()
    await fresh.getByLabel('导入外观设置文件', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...saved, typography: { ...saved.typography, codeSize: 99 } })) })
    await expect(displaySettings(fresh).getByRole('alert')).toContainText('文件无效')
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'dark')
    await fresh.reload(); await expect(fresh.locator('.workspace-image-backdrop img')).toBeVisible(); await expect(fresh.locator('html')).toHaveCSS('--ui-font-family', /中文自定义字体/)
    await openDisplaySettings(fresh)
    await displaySettings(fresh).screenshot({ path: info.outputPath('portable-appearance.png') })
  } finally { await context.close() }
})

test('loads a cross-origin URL without CORS, retains the last image on failure and persists the URL', async ({ page }) => {
  await openDisplaySettings(page)
  const dialog = displaySettings(page), image = page.locator('.workspace-image-backdrop img'), url = MOCK_URL + '/test/background.png'
  await dialog.getByRole('button', { name: '背景类型', exact: true }).click(); await dialog.getByRole('option', { name: '图片背景', exact: true }).click()
  await dialog.getByLabel('网络图片地址', { exact: true }).fill(url); await dialog.getByRole('button', { name: '使用图片地址', exact: true }).click()
  await expect(image).toHaveAttribute('src', url)
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await dialog.getByLabel('网络图片地址', { exact: true }).fill(MOCK_URL + '/missing-image.png'); await dialog.getByRole('button', { name: '使用图片地址', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('无法加载网络图片'); await expect(image).toHaveAttribute('src', url)
  await page.reload(); await expect(image).toHaveAttribute('src', url); await openDisplaySettings(page)
  await expect(dialog.getByLabel('网络图片地址', { exact: true })).toHaveValue(url)
  const pending = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出外观设置', exact: true }).click()
  const download = await pending, saved = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(saved.background).toEqual({ type: 'url', url })
  await dialog.locator('.background-preview').getByRole('button', { name: '移除', exact: true }).click(); await expect(image).toHaveCount(0)
  await page.reload(); await expect(image).toHaveCount(0)
})
