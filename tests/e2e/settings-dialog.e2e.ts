import { expect, test, type Locator, type Page } from '../fixtures'

async function openSettings(page: Page) {
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  if (!await trigger.isVisible()) await page.getByRole('button', { name: /打开导航|展开侧栏/ }).click()
  await trigger.click()
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

test('retains theme and width settings across close, reload and system theme changes', async ({ page }) => {
  let dialog = await openSettings(page)
  await dialog.getByRole('button', { name: '外观与背景', exact: true }).click()
  await dialog.getByRole('button', { name: '颜色主题', exact: true }).click()
  await dialog.getByRole('option', { name: '暗色', exact: true }).click()
  await dialog.getByRole('button', { name: '常规与内容', exact: true }).click()
  await dialog.getByRole('button', { name: '内容宽度', exact: true }).click()
  await dialog.getByRole('option', { name: '宽屏', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1280px')
  await adjust(dialog, '自定义内容宽度', '1120')
  await expect(page.locator('.app-shell')).toHaveCSS('--content-width', '1120px')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  dialog = await openSettings(page)
  await dialog.getByRole('button', { name: '外观与背景', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '颜色主题', exact: true })).toContainText('暗色')
  await expect(dialog.getByLabel('自定义内容宽度', { exact: true })).toHaveValue('1120')
  await dialog.getByRole('button', { name: '颜色主题', exact: true }).click()
  await dialog.getByRole('option', { name: '跟随系统', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await dialog.getByRole('button', { name: '常规与内容', exact: true }).click()
  await dialog.getByRole('button', { name: '内容宽度', exact: true }).click()
  await dialog.getByRole('option', { name: '铺满窗口', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '内容宽度', exact: true })).toContainText('铺满窗口')
})
