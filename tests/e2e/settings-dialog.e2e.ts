import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function adjust(dialog: Locator, label: string, value: string) {
  const input = dialog.getByLabel(label, { exact: true })
  await input.evaluate((element: HTMLInputElement, next) => {
    element.value = next
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await expect(input).toHaveValue(value)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('/')
})

test('opens a responsive native settings dialog with keyboard navigation and focus restoration', async ({ page }) => {
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  const dialog = await openSettings(page)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true)
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await expect(dialog.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
  await expect(dialog.getByRole('menu', { name: '背景类型', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '内容宽度', exact: true })).toBeVisible()
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const viewport = page.viewportSize()!
  const bounds = (await dialog.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(10)
  expect(bounds.y).toBeGreaterThanOrEqual(10)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 10)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 10)
  if (viewport.width >= 800) await expect(dialog).toHaveCSS('width', '720px')

  await dialog.getByRole('menuitemradio', { name: '浅色', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('menuitemradio', { name: '暗色', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByLabel('自定义内容宽度', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await openSettings(page)
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('retains theme and width settings across close, reload and system theme changes', async ({ page }) => {
  let dialog = await openSettings(page)
  await dialog.getByRole('menuitemradio', { name: '暗色', exact: true }).click()
  await dialog.getByRole('menuitemradio', { name: '宽屏', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1280px')
  await adjust(dialog, '自定义内容宽度', '1120')
  await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1120px')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  dialog = await openSettings(page)
  await expect(dialog.getByRole('menuitemradio', { name: '暗色', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByLabel('自定义内容宽度', { exact: true })).toHaveValue('1120')
  await dialog.getByRole('menuitemradio', { name: '跟随系统', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await dialog.getByRole('menuitemradio', { name: '铺满窗口', exact: true }).click()
  await expect(dialog.getByRole('menuitemradio', { name: '铺满窗口', exact: true })).toHaveAttribute('aria-checked', 'true')
})

test('persists auto-connect and connects only when enabled at startup', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/reset')
  await page.evaluate(endpoint => localStorage.setItem('codex-remote.connections.v1', JSON.stringify({ version: 1, selectedId: 'saved-device', profiles: [{ id: 'saved-device', name: '保存的设备', endpoint, cwd: '/test', createdAt: 0 }] })), MOCK_ENDPOINT)
  let dialog = await openSettings(page)
  const toggle = dialog.getByRole('switch', { name: '自动连接', exact: true })
  await expect(toggle).toBeChecked()
  await toggle.focus(); await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('未连接')
  dialog = await openSettings(page)
  await expect(dialog.getByRole('switch', { name: '自动连接', exact: true })).not.toBeChecked()
  let calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((call: any) => call.method === 'initialize')).toBe(false)
  await dialog.getByRole('switch', { name: '自动连接', exact: true }).click()
  await page.reload()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'initialize')).toHaveLength(1)
  expect(calls.some((call: any) => call.method === 'turn/start')).toBe(false)
})

test('keeps background upload, theme-independent image adjustments, reload, reset and removal in the dialog', async ({ page }) => {
  let dialog = await openSettings(page)
  await dialog.getByRole('menuitemradio', { name: '浅色', exact: true }).click()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGOwTPn3H4QZYAwAV+IKaYtEenEAAAAASUVORK5CYII=', 'base64')
  await dialog.getByLabel('上传背景图片', { exact: true }).setInputFiles({ name: '设置背景.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByAltText('背景缩略图')).toBeVisible()
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
  const values = [['图片不透明度', '47'], ['图片模糊度', '9'], ['背景叠加颜色', '#234567'], ['背景颜色强度', '25']] as const
  for (const [label, value] of values) await adjust(dialog, label, value)
  await expect(page.locator('.workspace-image-backdrop img')).toHaveCSS('opacity', '0.47')
  await expect(page.locator('.workspace-image-backdrop img')).toHaveCSS('filter', 'blur(9px)')
  await dialog.getByRole('menuitemradio', { name: '暗色', exact: true }).click()
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
  for (const [label, value] of values) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value)
  await dialog.getByRole('menuitemradio', { name: '浅色', exact: true }).click()
  for (const [label, value] of values) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value)
  await page.reload()
  dialog = await openSettings(page)
  for (const [label, value] of values) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value)
  await dialog.getByRole('button', { name: '重置图片效果', exact: true }).click()
  for (const [label, value] of [['图片不透明度', '35'], ['图片模糊度', '0'], ['背景叠加颜色', '#ffffff'], ['背景颜色强度', '0']]) {
    await expect(dialog.getByLabel(label!, { exact: true })).toHaveValue(value!)
  }
  await dialog.getByRole('button', { name: '移除', exact: true }).click()
  await expect(dialog.getByAltText('背景缩略图')).toHaveCount(0)
  await expect(dialog.getByRole('group', { name: '图片背景设置', exact: true })).toHaveCount(0)
})
