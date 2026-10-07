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
async function openThread(page: Page, name = '已有项目分析') {
  const toggle = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.locator('.sidebar').getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.conversation-title')).toHaveText(name)
}
async function start(page: Page, request: APIRequestContext, scenario: string) {
  await request.get(MOCK_URL + '/test/reset')
  await request.get(MOCK_URL + '/test/scenario?name=' + scenario)
  await page.goto('/')
  await connect(page)
}

test('shows the linked worktree branch in the island without any goal', async ({ page, request }) => {
  await start(page, request, 'worktree')
  await openThread(page)
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toContainText('feature/island')
  await expect(badge).toHaveAttribute('title', /^工作树 · \/test\/project · 分支 feature\/island$/)
  await expect(page.locator('.composer-island .goal-panel')).toHaveCount(0)
  await expect(badge).toHaveClass(/is-linked/)
})

test('shows nothing when the directory is not a Git workspace', async ({ page, request }) => {
  await start(page, request, '')
  await openThread(page)
  await expect(page.locator('.composer-island .working-directory-trigger')).toBeVisible()
  await expect(page.locator('.composer-island .workspace-badge')).toHaveCount(0)
})

test('restores the actual command worktree and keeps same-directory conversations separate', async ({ page, request }) => {
  await start(page, request, 'worktree-activity')
  await openThread(page)
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toContainText('research/bfv-ready-packet-20261007')
  await expect(badge).toHaveAttribute('title', '最近命令 · 工作树 · /test/worktrees/ready/sdk · 分支 research/bfv-ready-packet-20261007')
  await expect(badge).toHaveClass(/is-linked/)
  await expect(page.locator('.directory-trigger-name')).toHaveText('project')
  await page.screenshot({ path: 'test-results/workspace-activity-' + test.info().project.name + '.png' })
  await openThread(page, '第二个会话')
  await expect(badge).toHaveText('main')
  await expect(badge).toHaveAttribute('title', 'Git 仓库 · /test/project · 分支 main')
  await expect(badge).not.toHaveClass(/is-linked/)
  await openThread(page)
  await expect(badge).toContainText('research/bfv-ready-packet-20261007')
  await page.reload()
  await expect(badge).toContainText('research/bfv-ready-packet-20261007')
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.received.filter((method: string) => method === 'turn/start' || method === 'thread/start' || method === 'thread/settings/update')).toHaveLength(0)
})

test('updates the worktree badge from a live command before the running turn finishes', async ({ page, request }) => {
  await start(page, request, 'worktree-activity')
  await openThread(page, '第二个会话')
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toHaveText('main')
  await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill('检查研究工作区')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(badge).toContainText('research/bfv-ready-packet-20261007')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await expect(page.locator('.directory-trigger-name')).toHaveText('project')
  await request.get(MOCK_URL + '/test/finish')
})
