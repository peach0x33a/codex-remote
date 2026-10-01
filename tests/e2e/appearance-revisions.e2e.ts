import { expect, test, type Page } from '@playwright/test'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
type ImageEffects = { opacity: number; blur: number; color: string; colorOpacity: number }
const appearances = [
  { theme: 'light', label: '浅色', color: '#ffffff', composerColor: 'rgb(255, 255, 255)' },
  { theme: 'dark', label: '暗色', color: '#181818', composerColor: 'rgb(43, 43, 43)' },
] as const
function displaySettings(page: Page) { return page.getByRole('dialog', { name: '设置', exact: true }) }
async function openDisplaySettings(page: Page) {
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  if (!await trigger.isVisible()) await page.getByRole('button', { name: /打开导航|展开侧栏/ }).click()
  await trigger.click()
  await expect(displaySettings(page)).toBeVisible()
  await displaySettings(page).getByRole('button', { name: '外观与背景', exact: true }).click()
}
async function closeDisplaySettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(displaySettings(page)).toBeHidden()
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()
}
async function uploadBackground(page: Page) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGOwTPn3H4QZYAwAV+IKaYtEenEAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('上传背景图片', { exact: true }).setInputFiles({ name: '背景.png', mimeType: 'image/png', buffer: png })
  const image = page.locator('.workspace-image-backdrop img')
  await expect(image).toBeVisible()
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
}
async function setImageControl(page: Page, label: string, value: string | number) {
  const input = page.getByLabel(label, { exact: true })
  await expect(input).toBeVisible()
  // Range/color inputs must update on input, before a change event or reload.
  await input.evaluate((element: HTMLInputElement, next) => {
    element.value = next
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, String(value))
}
async function expectImageEffects(page: Page, settings: ImageEffects) {
  await expect(page.getByRole('group', { name: '图片背景设置', exact: true })).toBeVisible()
  await expect(page.getByLabel('图片不透明度', { exact: true })).toHaveValue(String(settings.opacity))
  await expect(page.getByLabel('图片模糊度', { exact: true })).toHaveValue(String(settings.blur))
  await expect(page.getByLabel('背景叠加颜色', { exact: true })).toHaveValue(settings.color)
  await expect(page.getByLabel('背景颜色强度', { exact: true })).toHaveValue(String(settings.colorOpacity))
  const backdrop = page.locator('.workspace-image-backdrop'), image = backdrop.locator('img')
  await expect(image).toBeVisible()
  await expect(image).toHaveCSS('opacity', String(settings.opacity / 100))
  await expect(image).toHaveCSS('filter', `blur(${settings.blur}px)`)
  const rgb = [1, 3, 5].map(offset => parseInt(settings.color.slice(offset, offset + 2), 16))
  await expect.poll(() => backdrop.evaluate(element => {
    const overlay = getComputedStyle(element, '::after')
    return { color: overlay.backgroundColor, opacity: overlay.opacity }
  })).toEqual({ color: `rgb(${rgb.join(', ')})`, opacity: String(settings.colorOpacity / 100) })
}
async function expectSolidComposer(page: Page, color: string) {
  const composer = page.locator('form.composer')
  await expect(composer).toHaveCSS('background-color', color)
  await expect(composer).toHaveCSS('background-image', 'none')
  await expect(composer).toHaveCSS('opacity', '1')
  await expect(composer).toHaveCSS('backdrop-filter', 'none')
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

test('persists dark appearance and follows the system only when requested', async ({ page }) => {
  await openDisplaySettings(page)
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '暗色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await displaySettings(page).getByRole('button', { name: '常规与内容', exact: true }).click(); await page.getByRole('button', { name: '内容宽度', exact: true }).click(); await page.getByRole('option', { name: '宽屏', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1280px')
  await openDisplaySettings(page)
  await expect(displaySettings(page)).toHaveCSS('background-color', 'rgb(43, 43, 43)')
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '跟随系统', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('keeps one attached approval card and advances after successful approval', async ({ page }, testInfo) => {
  await configure(page)
  const island = page.locator('.composer-island')
  await expect(island.getByRole('button', { name: '工作目录', exact: true })).toBeVisible()
  await send(page, '多个审批')
  await expect(page.locator('.approval-card')).toHaveCount(1)
  await expect(page.locator('.conversation .approval-card')).toHaveCount(0)
  await expect(island.getByRole('button', { name: '工作目录', exact: true })).toHaveCount(0)
  await expect(island.locator('pre').first()).toContainText('printf first')
  await island.getByRole('button', { name: '下一个请求' }).click()
  await expect(island.locator('pre').first()).toContainText('printf second')
  await island.getByRole('button', { name: '上一个请求' }).click()
  await page.screenshot({ path: testInfo.outputPath('approval-island.png'), animations: 'disabled' })
  await island.getByRole('button', { name: '允许这一次', exact: true }).click()
  await expect(page.locator('.approval-card')).toHaveCount(1)
  await expect(island.locator('pre').first()).toContainText('printf second')
  await island.getByRole('button', { name: '允许这一次', exact: true }).click()
  await expect(page.locator('.approval-card')).toHaveCount(0)
  await expect(island.getByRole('button', { name: '工作目录', exact: true })).toBeVisible()
})

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

test('keeps the background mode across manual and system appearance changes', async ({ page }) => {
  await openDisplaySettings(page)
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '浅色', exact: true }).click()
  await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '纯色背景', exact: true }).click()
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '暗色', exact: true }).click()
  await expect(page.locator('.hero-backdrop')).toHaveCount(0)
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'none')
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '跟随系统', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'none')
  await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '动效背景', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('.hero-backdrop.is-dark')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.hero-backdrop.is-dark')).toHaveCount(1)
  await openDisplaySettings(page)
  await page.getByRole('button', { name: '颜色主题', exact: true }).click()
  await page.getByRole('option', { name: '浅色', exact: true }).click()
  await expect(page.getByRole('button', { name: '背景类型', exact: true })).toContainText('动效背景')
  await expect(page.locator('.hero-backdrop')).toHaveCount(1)
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

for (const appearance of appearances) {
  test(`updates ${appearance.theme} image effects live, retains them across themes and persists resets`, async ({ page }) => {
    const other = appearances.find(value => value.theme !== appearance.theme)!
    const defaults = { opacity: 35, blur: 0, color: '#ffffff', colorOpacity: 0 }
    const effects = { opacity: 72, blur: 9, color: '#123456', colorOpacity: 28 }
    const otherEffects = { opacity: 54, blur: 18, color: '#abcdef', colorOpacity: 61 }
    const savedEffects = () => page.evaluate(() => JSON.parse(localStorage.getItem('codex-remote.ui.v1') || '{}').imageBackground)
    await openDisplaySettings(page)
    await page.getByRole('button', { name: '颜色主题', exact: true }).click()
    await page.getByRole('option', { name: appearance.label, exact: true }).click()
    await displaySettings(page).getByRole('button', { name: '常规与内容', exact: true }).click(); await page.getByRole('radio', { name: '宽屏', exact: true }).click(); await displaySettings(page).getByRole('button', { name: '外观与背景', exact: true }).click()
    await uploadBackground(page)
    await expectImageEffects(page, defaults)
    await setImageControl(page, '图片不透明度', effects.opacity)
    await expectImageEffects(page, { ...defaults, opacity: effects.opacity })
    await setImageControl(page, '图片模糊度', effects.blur)
    await expectImageEffects(page, { ...defaults, opacity: effects.opacity, blur: effects.blur })
    await setImageControl(page, '背景叠加颜色', effects.color)
    await expectImageEffects(page, { ...effects, colorOpacity: 0 })
    await setImageControl(page, '背景颜色强度', effects.colorOpacity)
    await expectImageEffects(page, effects)
    await expectSolidComposer(page, appearance.composerColor)
    await expect.poll(savedEffects).toEqual(effects)

    await page.getByRole('radio', { name: other.label, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', other.theme)
    await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
    await expectImageEffects(page, effects)
    await setImageControl(page, '图片不透明度', otherEffects.opacity)
    await setImageControl(page, '图片模糊度', otherEffects.blur)
    await setImageControl(page, '背景叠加颜色', otherEffects.color)
    await setImageControl(page, '背景颜色强度', otherEffects.colorOpacity)
    await expectImageEffects(page, otherEffects)
    await expect.poll(savedEffects).toEqual(otherEffects)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', other.theme)
    await openDisplaySettings(page)
    await expectImageEffects(page, otherEffects)
    await page.getByRole('button', { name: '颜色主题', exact: true }).click()
    await page.getByRole('option', { name: appearance.label, exact: true }).click()
    await expectImageEffects(page, otherEffects)
    await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '纯色背景', exact: true }).click()
    await expect(page.locator('.workspace-image-backdrop')).toHaveCount(0)
    await expect(page.getByRole('group', { name: '图片背景设置', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '背景类型', exact: true }).click()
  await page.getByRole('option', { name: '图片背景', exact: true }).click()
    await expectImageEffects(page, otherEffects)
    await page.getByRole('button', { name: '重置图片效果', exact: true }).click()
    await expectImageEffects(page, defaults)
    await expect(page.locator('.workspace')).toHaveAttribute('data-background', 'image')
    await expect(page.locator('.background-preview')).toContainText('背景.png')
    await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1280px')
    await expect.poll(savedEffects).toEqual(defaults)
    await page.getByRole('radio', { name: other.label, exact: true }).click()
    await expectImageEffects(page, defaults)

    await page.reload()
    await openDisplaySettings(page)
    await expectImageEffects(page, defaults)
    await page.getByRole('button', { name: '颜色主题', exact: true }).click()
    await page.getByRole('option', { name: appearance.label, exact: true }).click()
    await expectImageEffects(page, defaults)
  })

  test(`keeps the ${appearance.theme} hero and both canvas nodes when welcome becomes a conversation`, async ({ page }) => {
    await configure(page)
    await openDisplaySettings(page)
    await page.getByRole('button', { name: '颜色主题', exact: true }).click()
    await page.getByRole('option', { name: appearance.label, exact: true }).click()
    await closeDisplaySettings(page)
    const hero = page.locator('.hero-backdrop')
    await expect(page.locator('.welcome')).toBeVisible()
    await expect(hero).toBeVisible()
    await expect(hero).not.toHaveClass(/is-conversation/)
    await expect(hero.locator('canvas')).toHaveCount(2)
    await expectSolidComposer(page, appearance.composerColor)
    // Retain the actual nodes: a new matching locator would miss remounts.
    const before = await hero.evaluateHandle(root => ({ root, canvases: [...root.querySelectorAll('canvas')] }))
    try {
      await send(page, '进入对话后保留动效画布')
      await expect(page.locator('.message-agent')).toContainText('流式回复')
      await expect(page.locator('.welcome')).toHaveCount(0)
      await expect(hero).toHaveClass(/is-conversation/)
      await expect(hero.locator('canvas')).toHaveCount(2)
      expect(await before.evaluate(({ root, canvases }) => root.isConnected && root === document.querySelector('.hero-backdrop')
        && canvases.length === 2 && canvases.every((canvas, index) => canvas.isConnected && canvas === root.querySelectorAll('canvas')[index]))).toBe(true)
      await expectSolidComposer(page, appearance.composerColor)
    } finally { await before.dispose() }
  })
}

test('keeps the composer solid across both themes and all backgrounds in welcome and conversation', async ({ page }) => {
  await configure(page)
  await openDisplaySettings(page)
  await uploadBackground(page)
  await closeDisplaySettings(page)
  for (const view of ['welcome', 'conversation'] as const) {
    if (view === 'conversation') {
      await send(page, '检查对话输入框背景')
      await expect(page.locator('.message-agent')).toContainText('流式回复')
      await expect(page.locator('.welcome')).toHaveCount(0)
    } else { await expect(page.locator('.welcome')).toBeVisible() }
    await openDisplaySettings(page)
    for (const appearance of appearances) {
      await page.getByRole('button', { name: '颜色主题', exact: true }).click()
      await page.getByRole('option', { name: appearance.label, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', appearance.theme)
      for (const background of [{ label: '动效背景', mode: 'animated' }, { label: '图片背景', mode: 'image' }, { label: '纯色背景', mode: 'none' }]) {
        await test.step(`${view}, ${appearance.theme}, ${background.mode}`, async () => {
          await page.getByRole('radio', { name: background.label, exact: true }).click()
          await expect(page.locator('.workspace')).toHaveAttribute('data-background', background.mode)
          await expect(page.locator('.hero-backdrop')).toHaveCount(background.mode === 'animated' ? 1 : 0)
          await expect(page.locator('.workspace-image-backdrop img')).toHaveCount(background.mode === 'image' ? 1 : 0)
          await expectSolidComposer(page, appearance.composerColor)
        })
      }
    }
    await closeDisplaySettings(page)
  }
})

test('keeps the animated canvas anchored while toggling the desktop sidebar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'The mobile sidebar overlays the workspace.')
  const canvas = page.locator('.hero-grid canvas')
  const geometry = () => canvas.evaluate((element: HTMLCanvasElement) => ({ x: element.getBoundingClientRect().x, width: element.width, height: element.height, cssWidth: element.getBoundingClientRect().width }))
  await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width)
  const before = await geometry()
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await expect.poll(() => page.locator('.workspace').evaluate(element => element.getBoundingClientRect().left)).toBe(0)
  await expect.poll(async () => (await geometry()).x).toBeCloseTo(before.x, 1)
  expect(await geometry()).toMatchObject({ width: before.width, height: before.height, cssWidth: before.cssWidth })
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect.poll(() => page.locator('.workspace').evaluate(element => element.getBoundingClientRect().left)).toBeGreaterThan(200)
  await expect.poll(async () => (await geometry()).x).toBeCloseTo(before.x, 1)
  expect(await geometry()).toMatchObject({ width: before.width, height: before.height, cssWidth: before.cssWidth })
})
