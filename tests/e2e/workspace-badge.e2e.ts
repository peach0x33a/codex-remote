import { expect, test, type APIRequestContext, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function connect(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function openExisting(page: Page) {
  const toggle = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.locator('.sidebar').getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.locator('.conversation-title')).toHaveText('已有项目分析')
}
async function start(page: Page, request: APIRequestContext, scenario: string) {
  await request.get(MOCK_URL + '/test/reset')
  await request.get(MOCK_URL + '/test/scenario?name=' + scenario)
  await page.goto('/')
  await connect(page)
}

test('shows the linked worktree branch in the island without any goal', async ({ page, request }) => {
  await start(page, request, 'worktree')
  await openExisting(page)
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toContainText('feature/island')
  await expect(badge).toHaveAttribute('title', /^工作树 · \/test\/project · 分支 feature\/island$/)
  await expect(page.locator('.composer-island .goal-panel')).toHaveCount(0)
  await expect(badge).toHaveClass(/is-linked/)
})

test('shows nothing when the directory is not a Git workspace', async ({ page, request }) => {
  await start(page, request, '')
  await openExisting(page)
  await expect(page.locator('.composer-island .working-directory-trigger')).toBeVisible()
  await expect(page.locator('.composer-island .workspace-badge')).toHaveCount(0)
})
