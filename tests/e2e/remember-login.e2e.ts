import { expect, test, type Page } from '../fixtures'
import { AUTH_TEST_KEY, AUTH_TEST_URL } from '../config'

const loginDialog = (page: Page) => page.getByRole('dialog', { name: '欢迎回来', exact: true })
async function signOut(page: Page) {
  const nav = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await nav.isVisible() && await nav.getAttribute('aria-expanded') !== 'true') await nav.click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(loginDialog(page)).toBeVisible()
}
test.beforeEach(async ({ page }) => { await page.goto(AUTH_TEST_URL); await expect(loginDialog(page)).toBeVisible() })
test.afterEach(async ({ context }) => { await context.request.delete(AUTH_TEST_URL + '/api/session', { headers: { Origin: AUTH_TEST_URL } }) })

test('remembers login across reloads and new browser contexts, without storing the access password', async ({ page, context, browser }, info) => {
  if (info.project.name === 'mobile') await page.emulateMedia({ colorScheme: 'dark' })
  const dialog = loginDialog(page), toggle = dialog.getByRole('switch', { name: '记住密码', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toHaveAttribute('aria-describedby', 'remember-login-hint')
  const box = await toggle.boundingBox()
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44); expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('remember-login.png'), animations: 'disabled' })
  await dialog.getByLabel('应用访问密码').fill(AUTH_TEST_KEY)
  await dialog.getByRole('button', { name: '进入工作空间', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const cookie = (await context.cookies(AUTH_TEST_URL)).find(cookie => cookie.name === 'codex_remote_session')!
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict')
  expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(29 * 24 * 60 * 60)
  expect(await page.evaluate(() => document.cookie)).not.toContain('codex_remote_session')
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(AUTH_TEST_KEY)
  await page.reload(); await expect(page.getByRole('button', { name: '退出登录', exact: true, includeHidden: true })).toBeAttached()
  await expect(dialog).toHaveCount(0)
  const state = await context.storageState()
  await page.close()
  const reopened = await browser.newContext({ storageState: state })
  try {
    const fresh = await reopened.newPage()
    await fresh.goto(AUTH_TEST_URL)
    await expect(fresh.getByRole('button', { name: '退出登录', exact: true, includeHidden: true })).toBeAttached()
    await expect(loginDialog(fresh)).toHaveCount(0)
    await signOut(fresh)
    await expect(fresh.getByLabel('应用访问密码')).toHaveValue('')
    expect((await reopened.cookies(AUTH_TEST_URL)).some(cookie => cookie.name === 'codex_remote_session')).toBe(false)
    await fresh.reload(); await expect(loginDialog(fresh)).toBeVisible()
  } finally { await reopened.close() }
})

test('turning remember off preserves the choice and creates only a browser session cookie', async ({ page, context }) => {
  const toggle = loginDialog(page).getByRole('switch', { name: '记住密码', exact: true })
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.reload(); await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.getByLabel('应用访问密码').fill(AUTH_TEST_KEY)
  await page.keyboard.press('Enter')
  await expect(loginDialog(page)).toHaveCount(0)
  expect((await context.cookies(AUTH_TEST_URL)).find(cookie => cookie.name === 'codex_remote_session')!.expires).toBe(-1)
  await page.reload(); await expect(page.getByRole('button', { name: '退出登录', exact: true, includeHidden: true })).toBeAttached()
  await expect(loginDialog(page)).toHaveCount(0)
  await signOut(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByLabel('应用访问密码')).toHaveValue('')
})

test('a failed password keeps the input for correction and keyboard controls submit successfully', async ({ page, context }) => {
  const dialog = loginDialog(page), input = dialog.getByLabel('应用访问密码')
  await input.fill('incorrect-password')
  await page.keyboard.press('Tab'); await page.keyboard.press('Space')
  await expect(dialog.getByRole('switch', { name: '记住密码', exact: true })).toHaveAttribute('aria-checked', 'false')
  await input.press('Enter')
  await expect(dialog.getByRole('alert')).toHaveText('访问密码不正确，请重试。')
  await expect(input).toHaveValue('incorrect-password')
  expect((await context.cookies(AUTH_TEST_URL)).some(cookie => cookie.name === 'codex_remote_session')).toBe(false)
  await input.fill(AUTH_TEST_KEY); await input.press('Enter')
  await expect(dialog).toHaveCount(0)
})

test('pending login disables its controls and cannot dispatch a duplicate request', async ({ page }) => {
  let release!: () => void, attempts = 0
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/session', async route => {
    if (route.request().method() === 'POST') { attempts++; await held }
    await route.continue()
  })
  const dialog = loginDialog(page)
  await dialog.getByLabel('应用访问密码').fill(AUTH_TEST_KEY)
  await dialog.getByRole('button', { name: '进入工作空间', exact: true }).click()
  try {
    await expect(dialog.getByRole('button', { name: '正在验证…', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('switch', { name: '记住密码', exact: true })).toBeDisabled()
    await expect(dialog.getByLabel('应用访问密码')).toBeDisabled()
    await dialog.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(attempts).toBe(1)
  } finally { release() }
  await expect(dialog).toHaveCount(0)
})
