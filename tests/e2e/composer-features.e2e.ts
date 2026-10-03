import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL, TEST_URL } from '../config'

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
test.beforeEach(async ({ page, request }, info) => { await request.get(MOCK_URL + '/test/reset'); if (info.title.startsWith('fast toggles')) await request.get(MOCK_URL + '/test/scenario?name=fast-priority'); await page.goto('/'); await configure(page) })

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

test('ticks goal time without server polling and freezes it while paused', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  await page.clock.install()
  await editor(page).fill('/goal 检查目标实时计时'); await page.keyboard.press('Enter')
  const goal = page.getByRole('region', { name: '当前目标', exact: true })
  const time = goal.locator('.goal-time')
  await expect(time).toBeVisible()
  const seconds = async () => Number((await time.getAttribute('aria-label'))!.match(/(\d+) 秒/)![1])
  const initial = await seconds()
  const goalReads = async () => ((await (await request.get(MOCK_URL + '/test/metrics')).json()).requests as { method: string }[]).filter(call => call.method === 'thread/goal/get').length
  const readsBefore = await goalReads()
  await page.clock.fastForward(3_200)
  await expect.poll(seconds).toBeGreaterThanOrEqual(initial + 3)
  expect(await goalReads()).toBe(readsBefore)
  const current = await seconds()
  await expect(goal.locator('.goal-time-compact')).toHaveText('0:00:' + String(current).padStart(2, '0'))
  await goal.getByRole('button', { name: '编辑目标', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑目标', exact: true })
  await dialog.getByRole('button', { name: '暂停目标', exact: true }).click()
  await expect(goal.locator('[data-status="paused"]')).toBeVisible()
  const paused = await time.getAttribute('aria-label')
  await page.clock.fastForward(5_000)
  await expect(time).toHaveAttribute('aria-label', paused!)
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
  await goal.getByRole('button', { name: '恢复目标', exact: true }).click()
  await expect(goal.locator('[data-status="active"]')).toBeVisible()
  const resumed = await seconds()
  await page.clock.fastForward(2_200)
  await expect.poll(seconds).toBeGreaterThanOrEqual(resumed + 2)
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

test('folds long pasted text, submits it intact and follows the caret when expanded or pasted normally', async ({ page, request }, testInfo) => {
  const text = '中文😀 <script>window.__pastedScript = true</script>\n'.repeat(90) + '  \n'
  await editor(page).fill('前文后文')
  await editor(page).evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild!, 2); range.collapse(true); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range) })
  await editor(page).evaluate((element, text) => { const data = new DataTransfer(); data.setData('text/plain', text); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }, text)
  await expect(editor(page).locator('.editor-text-chip')).toContainText('粘贴的文本 (' + Array.from(text).length + '字符)')
  await page.keyboard.insertText('继续')
  for (const theme of process.env.COMPOSER_VISUAL_CHECK === '1' ? ['light', 'dark'] : []) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.locator('.composer').screenshot({ path: testInfo.outputPath('pasted-chip-' + theme + '.png') })
  }
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await request.get(MOCK_URL + '/test/finish')
  await expect(page.locator('.working-status')).toHaveCount(0)
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  const input = calls.findLast((call: { method: string }) => call.method === 'turn/start').params.input
  expect(input[0].text).toBe('前文'); expect(input[1].text).toBe(text); expect(input[2].text).toBe('继续后文')
  expect(input[1].text_elements).toEqual([{ byteRange: { start: 0, end: new TextEncoder().encode(text).length }, placeholder: '粘贴的文本 (' + Array.from(text).length + '字符)' }])
  const bubble = page.locator('.message-user').last().locator('.pasted-text')
  await expect(bubble.locator('pre')).not.toBeVisible(); await bubble.locator('summary').click(); await expect(bubble.locator('pre')).toHaveText(text)
  await editor(page).focus(); await page.keyboard.press('ArrowUp')
  await expect(editor(page).locator('.editor-text-chip')).toBeVisible()
  await editor(page).getByRole('button', { name: /^展开粘贴的文本/ }).click()
  await expect(editor(page).locator('.editor-text-chip')).toHaveCount(0)
  const geometry = () => editor(page).evaluate(element => { const box = element.getBoundingClientRect(), caret = window.getSelection()!.getRangeAt(0).getBoundingClientRect(); return { scroll: element.scrollTop, visible: caret.bottom <= box.bottom + 1 && caret.top >= box.top - 1 } })
  await expect.poll(async () => (await geometry()).visible).toBe(true)
  expect((await geometry()).scroll).toBeGreaterThan(0)
  await editor(page).fill('')
  const plain = Array.from({ length: 10 }, (_, i) => i + ': ' + '普通文本'.repeat(18)).join('\n')
  await editor(page).evaluate((element, text) => { const data = new DataTransfer(); data.setData('text/plain', text); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }, plain)
  await expect(editor(page).locator('.editor-text-chip')).toHaveCount(0)
  await expect.poll(async () => (await geometry()).visible).toBe(true)
  expect((await geometry()).scroll).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).__pastedScript)).toBeUndefined()
})

test('persists multiple inputs across conversations, reloads and a fresh browser context', async ({ page, request, browser }) => {
  const inputs = ['服务端历史一', '服务端历史二', '服务端历史三']
  for (const text of inputs) {
    await editor(page).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.working-status')).toHaveCount(0)
    await expect(editor(page)).toBeEmpty()
    await editor(page).fill('/new'); await page.keyboard.press('Enter')
    await expect(editor(page)).toBeEmpty()
  }
  const { profiles } = await (await request.get(TEST_URL + '/api/profiles', { headers: { Origin: TEST_URL } })).json()
  await expect.poll(async () => (await (await request.get(TEST_URL + '/api/input-history?deviceId=' + profiles[0].id, { headers: { Origin: TEST_URL } })).json()).entries.length).toBe(3)
  await page.reload()
  await expect.poll(async () => { await editor(page).focus(); await page.keyboard.press('ArrowUp'); return await editor(page).textContent() }).toBe(inputs[2])
  await page.keyboard.press('ArrowUp'); await expect(editor(page)).toHaveText(inputs[1])
  await page.keyboard.press('ArrowUp'); await expect(editor(page)).toHaveText(inputs[0])
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await expect(editor(page)).toBeEmpty()
  const context = await browser.newContext({ viewport: page.viewportSize()! })
  try {
    const second = await context.newPage(), loaded = second.waitForResponse(response => response.url().includes('/api/input-history') && response.ok())
    await second.goto(TEST_URL); await loaded; await editor(second).focus()
    for (const input of [...inputs].reverse()) { await second.keyboard.press('ArrowUp'); await expect(editor(second)).toHaveText(input) }
    const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
    expect(metrics.requests.filter((call: any) => call.method === 'turn/start')).toHaveLength(3)
  } finally { await context.close() }
})

test('lets stopped unconsumed steers be removed or returned to the draft without automatic sends', async ({ page, request }, testInfo) => {
  await request.get(MOCK_URL + '/test/scenario?name=steer-not-consumed')
  for (const restore of [false, true]) {
    await editor(page).fill('执行长任务'); await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
    await editor(page).fill('尚未处理的插话'); await page.getByRole('button', { name: '发送到当前任务', exact: true }).click()
    await expect(page.locator('.island-steer')).toContainText('待插入')
    await expect(page.getByRole('button', { name: '撤回插话', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect(page.locator('.island-steer')).toContainText('回合已结束 · 未确认插入')
    await expect(page.locator('.working-status')).toHaveCount(0)
    for (const theme of process.env.COMPOSER_VISUAL_CHECK === '1' ? ['light', 'dark'] : []) {
      if (restore) break
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.locator('.composer-island').screenshot({ path: testInfo.outputPath('ended-steer-' + theme + '.png') })
    }
    await page.getByRole('button', { name: restore ? '取回插话草稿' : '移除未确认插话', exact: true }).click()
    await expect(page.locator('.island-steer')).toHaveCount(0)
    if (restore) await expect(editor(page)).toHaveText('尚未处理的插话')
    else await expect(editor(page)).toBeEmpty()
  }
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.filter((call: any) => call.method === 'turn/start')).toHaveLength(2)
  expect(metrics.requests.filter((call: any) => call.method === 'turn/steer')).toHaveLength(2)
  expect(metrics.requests.some((call: any) => call.method === 'thread/revert')).toBe(false)
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

test('fast toggles the priority tier through slash command and the reasoning lightning button', async ({ page, request }) => {
  await editor(page).fill('/fast'); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '思考强度', exact: true }).click()
  const power = page.getByRole('dialog', { name: '思考强度', exact: true })
  const lightning = power.getByRole('button', { name: '快速模式', exact: true })
  await expect(lightning).toHaveAttribute('aria-pressed', 'false')
  await lightning.click(); await expect(lightning).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await editor(page).fill('priority enabled'); await page.keyboard.press('Enter')
  await expect.poll(async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests.filter((row: any) => row.method === 'turn/start').at(-1)?.params.serviceTier).toBe('priority')
})
test('manual compact is available as a command and a context window button', async ({ page, request }) => {
  await editor(page).fill('创建压缩会话'); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '上下文用量', exact: true }).click()
  await page.getByRole('button', { name: '压缩上下文', exact: true }).click()
  await expect.poll(async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests.filter((row: any) => row.method === 'thread/compact/start').length).toBe(1)
  await expect(page.getByRole('button', { name: '压缩上下文', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await editor(page).fill('/compact'); await page.keyboard.press('Enter')
  await expect(editor(page)).toBeEmpty()
  await expect.poll(async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests.filter((row: any) => row.method === 'thread/compact/start').length).toBe(2)
})
