import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('命令测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
const editor = (page: Page) => page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/'); await configure(page) })

test('starts a goal directly, refills it for editing, and previews status temporarily in the island', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  const objective = '完成迁移，保留  两个空格'
  await editor(page).fill('/goal ' + objective)
  await page.keyboard.press('Enter')
  const island = page.getByRole('region', { name: '对话浮岛', exact: true })
  const goal = island.getByRole('region', { name: '当前目标', exact: true })
  await expect(goal).toContainText(objective)
  await expect(page.getByRole('dialog', { name: '设置目标', exact: true })).toHaveCount(0)
  await expect(goal.locator('.goal-status-details')).toHaveCount(0)
  await editor(page).fill('/goal edit')
  await page.keyboard.press('Enter')
  await expect(editor(page)).toHaveText('/goal ' + objective)
  await expect(page.getByRole('dialog', { name: '编辑目标', exact: true })).toHaveCount(0)
  await page.clock.install()
  await editor(page).fill('/goal status')
  await page.keyboard.press('Enter')
  await expect(goal.locator('.goal-status-details')).toContainText('1,240')
  await page.clock.fastForward(8_100)
  await expect(goal.locator('.goal-status-details')).toHaveCount(0)
  await expect(goal).toContainText(objective)
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'thread/goal/set')).toHaveLength(1)
  expect(calls.find((call: any) => call.method === 'thread/goal/set').params).toMatchObject({ objective, status: 'active' })
})

test('resumes a paused goal directly from the compact island', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  await editor(page).fill('/goal 继续已有目标')
  await page.keyboard.press('Enter')
  const goal = page.getByRole('region', { name: '当前目标', exact: true })
  await goal.getByRole('button', { name: '编辑目标', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑目标', exact: true })
  await dialog.getByRole('button', { name: '暂停目标', exact: true }).click()
  await expect(goal).toContainText('已暂停')
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  await goal.getByRole('button', { name: '恢复目标', exact: true }).click()
  await expect(goal).toContainText('进行中')
  await expect(goal.getByRole('button', { name: '恢复目标', exact: true })).toHaveCount(0)
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'thread/goal/set').at(-1).params).toEqual({ threadId: expect.any(String), status: 'active' })
})

test('opens the changes workspace, jumps to files, uses real scopes, and reverses only after confirmation', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=inspector')
  await editor(page).fill('查看变更面板')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const card = page.getByRole('region', { name: '已编辑 4 个文件', exact: true })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '查看变更', exact: true }).click()
  const panel = page.locator('.changes-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.diff-file')).toHaveCount(4)
  await panel.getByRole('button', { name: '跳转到文件', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索变更文件', exact: true }).fill('README')
  await page.getByRole('menuitem', { name: 'README.md', exact: true }).click()
  await expect(panel.locator('[data-diff-path="README.md"] > button')).toBeFocused()
  const layoutButton = panel.getByRole('button', { name: '差异布局', exact: true })
  if (await layoutButton.isVisible()) { await layoutButton.click(); await page.getByRole('menuitemradio', { name: '并排', exact: true }).click() }
  else { await panel.getByRole('button', { name: '更多变更操作', exact: true }).click(); await page.getByRole('menuitemradio', { name: '并排布局', exact: true }).click() }
  await expect(panel.locator('.diff-split')).toHaveCount(4)
  if (await panel.getByRole('button', { name: '折叠全部变更', exact: true }).isVisible()) await panel.getByRole('button', { name: '折叠全部变更', exact: true }).click()
  else { await panel.getByRole('button', { name: '更多变更操作', exact: true }).click(); await page.getByRole('menuitem', { name: '折叠全部变更', exact: true }).click() }
  await expect(panel.locator('.diff-code')).toHaveCount(0)
  if (await panel.getByRole('button', { name: '展开全部变更', exact: true }).isVisible()) await panel.getByRole('button', { name: '展开全部变更', exact: true }).click()
  else { await panel.getByRole('button', { name: '更多变更操作', exact: true }).click(); await page.getByRole('menuitem', { name: '展开全部变更', exact: true }).click() }
  await expect(panel.locator('.diff-code')).toHaveCount(4)
  await panel.getByRole('button', { name: '变更范围', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '未暂存', exact: true }).click()
  await expect(panel.locator('.diff-file')).toHaveCount(1)
  let calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((call: any) => call.method === 'command/exec' && call.params.cwd === '/test/project' && call.params.command.includes('diff'))).toBe(true)
  await panel.getByRole('button', { name: '关闭变更', exact: true }).click()
  await card.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(panel.getByText('撤销本轮文件修改？', { exact: true })).toBeVisible()
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((call: any) => call.method === 'command/exec' && call.params.command[0] === 'python3')).toBe(false)
  await panel.getByRole('button', { name: '确认撤销', exact: true }).click()
  await expect(page.getByRole('region', { name: '已撤销 4 个文件', exact: true })).toHaveCount(1)
  await panel.getByRole('button', { name: '关闭变更', exact: true }).click()
  await page.getByRole('button', { name: '重新应用', exact: true }).click()
  await panel.getByRole('button', { name: '确认重新应用', exact: true }).click()
  await expect(card).toHaveCount(1)
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'command/exec' && call.params.command[0] === 'python3')).toHaveLength(2)
  expect(calls.some((call: any) => call.method === 'thread/revert')).toBe(false)
})

test('Enter steers the active turn while Tab keeps a separate queued message', async ({ page, request }) => {
  await editor(page).fill('队列任务运行中')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await editor(page).fill('请先处理入口逻辑')
  await page.keyboard.press('Enter')
  await expect(editor(page)).toBeEmpty()
  await editor(page).fill('完成后再检查样式')
  await page.keyboard.press('Tab')
  await expect(editor(page)).toBeEmpty()
  await expect(page.locator('.queue-list')).toContainText('完成后再检查样式')
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.filter((call: any) => call.method === 'turn/start')).toHaveLength(1)
  const steers = calls.filter((call: any) => call.method === 'turn/steer')
  expect(steers).toHaveLength(1)
  expect(steers[0].params.input[0].text).toBe('请先处理入口逻辑')
})

test('selects an enabled island skill with Tab and sends its native skill metadata', async ({ page, request }) => {
  await editor(page).fill('$')
  const list = page.getByRole('region', { name: '对话浮岛', exact: true }).getByRole('listbox', { name: '技能', exact: true })
  await expect(list.getByRole('option', { name: /Audit/ })).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Tab')
  await expect(editor(page).locator('.editor-skill-chip')).toHaveAttribute('title', '/test/skills/audit/SKILL.md')
  await expect(list).toHaveCount(0)
  await expect(editor(page)).toBeFocused()
  let calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  expect(calls.some((call: any) => call.method === 'turn/start')).toBe(false)
  await page.keyboard.press('Enter')
  await expect(page.locator('.message-user')).toContainText('audit')
  // The visible message is optimistic; wait for the actual server submission.
  await expect.poll(async () => {
    const data = await (await request.get(MOCK_URL + '/test/metrics')).json()
    return data.requests.filter((call: { method: string }) => call.method === 'turn/start').length
  }).toBe(1)
  calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  const starts = calls.filter((call: any) => call.method === 'turn/start')
  expect(starts).toHaveLength(1)
  expect(starts[0].params.input).toEqual(expect.arrayContaining([{ type: 'skill', name: 'audit', path: '/test/skills/audit/SKILL.md' }]))
  expect(starts[0].params.input).toEqual(expect.arrayContaining([{ type: 'text', text: '$audit', text_elements: [{ byteRange: { start: 0, end: 6 }, placeholder: 'audit' }] }]))
})

test('recalls prior inputs with Up and restores the draft with Down', async ({ page }) => {
  for (const input of ['历史输入一', '历史输入二']) {
    await editor(page).fill(input)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.message-user').last()).toContainText(input)
    await expect(page.locator('.working-status')).toHaveCount(0)
  }
  await editor(page).focus()
  await page.keyboard.press('ArrowUp'); await expect(editor(page)).toHaveText('历史输入二')
  await page.keyboard.press('ArrowUp'); await expect(editor(page)).toHaveText('历史输入一')
  await page.keyboard.press('ArrowDown'); await expect(editor(page)).toHaveText('历史输入二')
  await page.keyboard.press('ArrowDown'); await expect(editor(page)).toBeEmpty()
  await editor(page).fill('尚未发送的草稿')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowUp'); await expect(editor(page)).toHaveText('历史输入二')
  await page.keyboard.press('ArrowDown'); await expect(editor(page)).toHaveText('尚未发送的草稿')
})

test('restores the limited-goal resume control and asks before increasing an exhausted budget', async ({ page, request }, testInfo) => {
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  await editor(page).fill('/goal 继续实现受限任务'); await page.keyboard.press('Enter')
  const goal = page.getByRole('region', { name: '当前目标', exact: true })
  await expect(goal).toContainText('继续实现受限任务')
  await request.get(MOCK_URL + '/test/goal-status?status=usageLimited')
  await goal.getByRole('button', { name: '刷新目标', exact: true }).click()
  await expect(goal.locator('[data-status="usageLimited"]')).toBeVisible()
  const resume = goal.getByRole('button', { name: '恢复目标', exact: true })
  await expect(resume).toBeVisible()
  await goal.screenshot({ path: testInfo.outputPath('usage-limited-resume.png') })
  await resume.click()
  await expect(goal.locator('[data-status="active"]')).toBeVisible()
  let metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const resumed = metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/goal/set').at(-1).params
  expect(resumed.status).toBe('active'); expect(resumed.tokenBudget).toBeUndefined(); expect(resumed.objective).toBeUndefined()
  await request.get(MOCK_URL + '/test/goal-status?status=budgetLimited')
  await goal.getByRole('button', { name: '刷新目标', exact: true }).click()
  await expect(goal.locator('[data-status="budgetLimited"]')).toBeVisible()
  const writesBefore = metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/goal/set').length
  await resume.click()
  const dialog = page.getByRole('dialog', { name: '编辑目标', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存并恢复', exact: true })).toBeDisabled()
  metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/goal/set')).toHaveLength(writesBefore)
  await dialog.getByRole('textbox', { name: /^Token 预算/ }).fill('2000')
  await dialog.getByRole('button', { name: '保存并恢复', exact: true }).click()
  await expect(dialog).toBeHidden(); await expect(goal.locator('[data-status="active"]')).toBeVisible()
  metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const budgetResume = metrics.requests.filter((entry: { method: string }) => entry.method === 'thread/goal/set').at(-1).params
  expect(budgetResume).toMatchObject({ status: 'active', tokenBudget: 2000 })
  expect(budgetResume.objective).toBeUndefined()
})
