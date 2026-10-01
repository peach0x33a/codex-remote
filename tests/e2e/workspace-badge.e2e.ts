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

test('shows the branch of an ordinary repository without calling it a worktree', async ({ page, request }) => {
  await start(page, request, 'branch')
  await openExisting(page)
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toContainText('main')
  await expect(badge).toHaveAttribute('title', /^Git 仓库 · /)
  await expect(badge).not.toHaveClass(/is-linked/)
})

test('shows nothing when the directory is not a Git workspace', async ({ page, request }) => {
  await start(page, request, '')
  await openExisting(page)
  await expect(page.locator('.composer-island .working-directory-trigger')).toBeVisible()
  await expect(page.locator('.composer-island .workspace-badge')).toHaveCount(0)
})

const longObjective = '完成跨设备工作区迁移，并持续验证全部目标、队列以及子代理状态在连接恢复后保持一致'
const longBranch = 'feature/island-layout-with-a-long-linked-worktree-branch-name'

async function startWorkspaceGoal(page: Page, request: APIRequestContext, long = true) {
  // Keep real RPCs and server state transitions; only widen the fixture's display data.
  await page.routeWebSocket(/\/api\/socket(?:\?|$)/, socket => {
    const upstream = socket.connectToServer()
    upstream.onMessage(raw => socket.send(JSON.stringify(JSON.parse(String(raw), (key, value) => {
      if (key === 'timeUsedSeconds') return 8 * 3600 + 23 * 60 + 6
      if (long && key === 'stdout' && value === 'refs/heads/feature/island\n') return 'refs/heads/' + longBranch + '\n'
      return value
    }))))
  })
  await start(page, request, 'worktree')
  await openExisting(page)
  const badge = page.locator('.composer-island .workspace-badge')
  await expect(badge).toHaveAttribute('aria-label', /工作树/)
  await expect(badge).toContainText(long ? longBranch : 'feature/island')
  await expect(page.locator('.composer-island .goal-panel')).toHaveCount(0)
  // Existing workspace data stays mounted when goal support is enabled.
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  await page.locator('#message-input').fill('/goal ' + (long ? longObjective : '完成迁移'))
  await page.keyboard.press('Enter')
  await expect(page.locator('.goal-objective')).toHaveText(long ? longObjective : '完成迁移')
  await expect(badge).toBeVisible()
}

async function islandLayoutIssues(page: Page) {
  return page.locator('.island-context').evaluate(context => {
    const issues: string[] = []
    const bounds = context.getBoundingClientRect()
    const selectors = ['.working-directory-trigger', '.workspace-badge', '.goal-objective', '.goal-heading > .goal-status', '.goal-time', '.goal-status-toggle', '.goal-edit', '.goal-refresh']
    const items = selectors.map(selector => {
      const element = context.querySelector<HTMLElement>(selector)!
      return { selector, element, box: element.getBoundingClientRect() }
    })
    for (const { selector, box } of items) {
      if (box.width <= 0 || box.height <= 0) issues.push(selector + ' has no visible area')
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) issues.push(selector + ' escapes the context row')
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!
      if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) issues.push(a.selector + ' overlaps ' + b.selector)
    }
    if (items.find(item => item.selector === '.goal-objective')!.box.width < 20) issues.push('objective has no room for a readable character')
    for (const { selector, box } of items.filter(item => /goal-(status-toggle|edit|refresh)/.test(item.selector))) {
      if (box.width < 44 || box.height < 44) issues.push(selector + ' is smaller than a 44px touch target')
    }
    for (const selector of ['.goal-summary', '.goal-row', '.goal-time']) {
      const element = context.querySelector<HTMLElement>(selector)!
      if (element.scrollWidth > element.clientWidth + 1) issues.push(selector + ' overflows horizontally')
    }
    if (context.scrollWidth > context.clientWidth + 1) issues.push('context row overflows horizontally')
    const time = context.querySelector<HTMLElement>('.goal-time')!
    const visibleTime = [...time.children].find(element => getComputedStyle(element).display !== 'none')!
    const range = document.createRange()
    range.selectNodeContents(visibleTime)
    if (range.getBoundingClientRect().right > time.getBoundingClientRect().right + 1) issues.push('elapsed text is clipped')
    const goal = context.querySelector('.goal-row')!.getBoundingClientRect()
    for (const { selector, box } of items.slice(0, 2)) {
      if (Math.abs(box.y + box.height / 2 - goal.y - goal.height / 2) > 1) issues.push(selector + ' is no longer in the same row as the goal')
    }
    return issues
  })
}

for (const width of [320, 390]) for (const scale of [1, 1.5]) {
  test(`keeps worktree and goal readable with usable actions at ${width}px and ${scale * 100}% typography`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 960 })
    await startWorkspaceGoal(page, request)
    // Exercise enlargement beyond the current settings maximum of 20/14.
    await page.evaluate(value => document.documentElement.style.setProperty('--ui-font-scale', String(value)), scale)
    const goal = page.locator('.composer-island .goal-panel')
    await expect(goal.locator('.goal-time-compact')).toHaveText('8:23:06')
    await expect(goal.locator('.goal-time')).toHaveAttribute('aria-label', '已用 8 小时 23 分 6 秒')
    await expect(page.locator('.directory-trigger-content')).toHaveAttribute('title', '/test/project')
    await expect.poll(() => islandLayoutIssues(page)).toEqual([])

    await goal.getByRole('button', { name: '暂停目标', exact: true }).click()
    await expect(goal.getByRole('button', { name: '恢复目标', exact: true })).toBeEnabled()
    await expect.poll(() => islandLayoutIssues(page)).toEqual([])
    await goal.getByRole('button', { name: '恢复目标', exact: true }).click()
    await expect(goal.getByRole('button', { name: '暂停目标', exact: true })).toBeEnabled()
    await goal.getByRole('button', { name: '编辑目标', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑目标', exact: true })
    await dialog.getByLabel('目标', { exact: true }).fill(longObjective + '，完成最终验收')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(goal.locator('.goal-objective')).toHaveText(longObjective + '，完成最终验收')
    const calls = async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests as { method: string; params: Record<string, unknown> }[]
    const mutations = (await calls()).filter(call => call.method === 'thread/goal/set')
    expect(mutations.map(call => call.params.status)).toEqual(['active', 'paused', 'active', 'active'])
    expect(mutations.at(-1)!.params.objective).toBe(longObjective + '，完成最终验收')
    const before = (await calls()).filter(call => call.method === 'thread/goal/get').length
    await goal.getByRole('button', { name: '刷新目标', exact: true }).click()
    await expect.poll(async () => (await calls()).filter(call => call.method === 'thread/goal/get').length).toBeGreaterThan(before)
    await expect(goal.getByRole('button', { name: '刷新目标', exact: true })).toBeEnabled()
    await expect.poll(() => islandLayoutIssues(page)).toEqual([])
    await expect(page.locator('.composer-island .workspace-badge')).toHaveAttribute('aria-label', '工作树 · /test/project · 分支 ' + longBranch)
  })
}

test('adapts to the island container on desktop and restores full labels when room returns', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await startWorkspaceGoal(page, request, false)
  const goal = page.locator('.composer-island .goal-panel')
  await expect(goal.locator('.goal-time-full')).toBeVisible()
  const label = page.locator('.workspace-badge-text')
  expect((await label.boundingBox())!.width).toBeGreaterThan(30)
  await page.locator('.composer-area').evaluate(element => { element.style.maxWidth = '380px' })
  await expect(goal.locator('.goal-time-compact')).toBeVisible()
  await expect.poll(() => islandLayoutIssues(page)).toEqual([])
  await page.locator('.composer-area').evaluate(element => { element.style.removeProperty('max-width') })
  await expect(goal.locator('.goal-time-full')).toBeVisible()
  await expect.poll(async () => (await label.boundingBox())!.width).toBeGreaterThan(30)
})
