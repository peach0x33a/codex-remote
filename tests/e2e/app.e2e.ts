import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
import { sampleCode, samplePlainCode, sampleIndentedCode } from '../markdown-fixture'
const transportToken = 'e2e-transport-token'

async function configure(page: Page, connect = true, endpoint = MOCK_ENDPOINT) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '连接你的设备' })
  await dialog.getByLabel('设备名称').fill('测试工作站')
  await dialog.getByLabel('App Server 地址').fill(endpoint)
  await expect(dialog.getByRole('switch', { name: '记住令牌', exact: true })).toHaveAttribute('aria-checked', 'true')
  await dialog.getByPlaceholder('App Server 的 Bearer token').fill(transportToken)
  await dialog.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
  await dialog.getByRole('button', { name: connect ? '保存并连接' : '仅保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  if (connect) await expect(page.getByTestId('selected-device')).toContainText('测试工作站')
}
async function send(page: Page, text: string) { await page.getByRole('textbox', { name: '发送给 Codex 的消息' }).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click() }
async function showSidebar(page: Page) { if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible() && await page.getByRole('button', { name: '打开导航', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '打开导航', exact: true }).click() }

test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/') })

test('initializes the protocol, streams a turn, restores history, and reconnects', async ({ page, request }) => {
  await configure(page)
  await expect(page.getByRole('button', { name: '选择模型' })).toBeEnabled()
  await send(page, '你好')
  await expect(page.getByText('你好，这是通过真实 WebSocket 桥接返回的流式回复。', { exact: true })).toBeVisible()
  await expect(page.locator('.message-user')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await request.get(MOCK_URL + '/test/disconnect')
  await expect.poll(async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).received.filter((m: string) => m === 'thread/resume').length).toBeGreaterThan(0)
  await expect(page.getByText('你好，这是通过真实 WebSocket 桥接返回的流式回复。', { exact: true })).toBeVisible()
  await showSidebar(page)
  await page.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByText('这是保存在远端的会话。', { exact: true })).toBeVisible()
})

test('waits for explicit approval and handles a server question', async ({ page, request }) => {
  await configure(page)
  await send(page, '测试权限')
  await expect(page.getByRole('heading', { name: '确认执行操作' })).toBeVisible()
  expect((await (await request.get(MOCK_URL + '/test/metrics')).json()).approved).toBe(0)
  await page.getByRole('button', { name: '允许这一次', exact: true }).click()
  await expect(page.getByText('已获批准，操作完成。', { exact: true })).toBeVisible()
  await send(page, '请向我提问')
  await page.getByRole('radio', { name: /方案 A/ }).check()
  await page.getByRole('button', { name: '提交回答' }).click()
  await expect(page.getByText('已收到你的选择：方案 A', { exact: true })).toBeVisible()
})

test('interrupts a turn and retains its frozen work time through later messages and reload', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=work-duration')
  await configure(page)
  await send(page, '长任务')
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await expect(page.getByText('Codex 正在工作', { exact: true })).toHaveCount(0)
  const footer = page.locator('.turn-stopped-duration')
  await expect(footer).toHaveText('已停止 · 工作了 2 分 18 秒')
  await page.clock.install(); await page.clock.fastForward(10_000)
  await expect(footer).toHaveText('已停止 · 工作了 2 分 18 秒')
  await send(page, '下一轮继续')
  await expect(page.locator('.message-user')).toHaveCount(2)
  expect(await footer.evaluate(element => !!(element.compareDocumentPosition(document.querySelectorAll('.message-user')[1]!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await page.reload(); await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await showSidebar(page); await page.locator('.sidebar').getByRole('button', { name: '长任务', exact: true }).click()
  await expect(footer).toHaveText('已停止 · 工作了 2 分 18 秒')
})

test('sanitizes assistant Markdown and never loads remote images', async ({ page }) => {
  const remote: string[] = []
  page.on('request', request => { if (request.url().includes('tracker.example')) remote.push(request.url()) })
  await configure(page)
  await send(page, '安全测试')
  await expect(page.locator('.image-label')).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __xss?: boolean }).__xss)).toBeUndefined()
  await expect(page.locator('.markdown script, .markdown img, .markdown a[href^="javascript:"]')).toHaveCount(0)
  expect(remote).toEqual([])
})

test('copies individual streamed code blocks exactly and supports HTTP fallback without a popup', async ({ page, request }, info) => {
  await request.get(MOCK_URL + '/test/scenario?name=markdown-code')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__copiedCode = text } }, configurable: true })
  })
  await configure(page); await send(page, '显示代码')
  const blocks = page.locator('.message-agent .markdown-code-block'), first = blocks.first()
  await expect(first.locator('code')).toContainText('console')
  await expect(first.locator('.hljs-keyword').first()).toHaveText('if')
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  const partial = await page.evaluate(() => {
    const block = document.querySelector('.message-agent .markdown-code-block')!
    const code = block.querySelector('code')!.textContent
    block.querySelector<HTMLButtonElement>('button')!.click()
    return code
  })
  await expect.poll(() => page.evaluate(() => (window as any).__copiedCode)).toBe(partial)
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await expect(blocks).toHaveCount(4)
  const expected = [sampleCode, samplePlainCode, sampleIndentedCode, '']
  for (let index = 0; index < expected.length; index++) {
    await expect(blocks.nth(index).locator('code')).toHaveJSProperty('textContent', expected[index])
    await blocks.nth(index).getByRole('button', { name: '复制代码', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).__copiedCode)).toBe(expected[index])
  }
  await expect(page.locator('.markdown p > code')).toHaveText('inlineOnly')
  await expect(page.locator('.markdown script')).toHaveCount(0)
  await expect(first.locator('.hljs-string').first()).toHaveText('"你好"')
  await expect(blocks.nth(1).locator('[class^="hljs-"]')).toHaveCount(0)
  const button = first.getByRole('button', { name: '复制代码', exact: true })
  await button.scrollIntoViewIfNeeded()
  const before = await button.boundingBox()
  expect(before!.height).toBeGreaterThanOrEqual(44)
  expect(before!.x + before!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await first.locator('pre').evaluate(pre => { pre.scrollLeft = pre.scrollWidth })
  expect((await button.boundingBox())!.x).toBe(before!.x)
  await first.locator('pre').evaluate(pre => { pre.scrollLeft = 0 })
  await first.screenshot({ path: info.outputPath('code-copy.png') })
  const lightColors = await first.locator('code').evaluate(code => ({
    base: getComputedStyle(code).color, keyword: getComputedStyle(code.querySelector('.hljs-keyword')!).color,
    string: getComputedStyle(code.querySelector('.hljs-string')!).color, comment: getComputedStyle(code.querySelector('.hljs-comment')!).color,
  }))
  expect(new Set(Object.values(lightColors)).size).toBe(4)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await first.screenshot({ path: info.outputPath('code-copy-dark.png') })
  const darkColors = await first.locator('code').evaluate(code => ({
    base: getComputedStyle(code).color, keyword: getComputedStyle(code.querySelector('.hljs-keyword')!).color,
    string: getComputedStyle(code.querySelector('.hljs-string')!).color, comment: getComputedStyle(code.querySelector('.hljs-comment')!).color,
  }))
  expect(new Set(Object.values(darkColors)).size).toBe(4)
  expect(darkColors.keyword).not.toBe(lightColors.keyword)
  expect(darkColors.string).not.toBe(lightColors.string)
  await expect(first.locator('code')).toHaveJSProperty('textContent', sampleCode)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = command => {
      if (command !== 'copy') return false
      ;(window as any).__copiedCode = (document.activeElement as HTMLTextAreaElement).value
      return true
    }
  })
  await button.focus(); await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).__copiedCode)).toBe(sampleCode)
  await expect(button).toBeFocused()
  await expect(page.getByText('已复制到剪贴板。', { exact: true })).toBeVisible()
  await page.evaluate(() => { document.execCommand = () => false })
  await button.click()
  await expect(page.getByText('复制失败，请手动选择文字复制。', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
})

test('ships an installable manifest and opens the cached shell offline', async ({ page, context, request }) => {
  await configure(page, false)
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone'); expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '有什么需要帮忙？' })).toBeVisible()
  expect(await page.evaluate(() => fetch('/api/health').then(() => true).catch(() => false))).toBe(false)
  await expect(page.locator('.top-notice.offline')).toContainText('联网后将同步服务端设备配置')
  await expect(page.getByTestId('selected-device')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('codex-remote.connections.v1'))).toBeNull()
  await context.setOffline(false)
  await expect(page.getByTestId('selected-device')).toContainText('测试工作站')
})

test('loads a bounded recent page and fetches earlier messages without duplicates', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=paged')
  await configure(page); await showSidebar(page)
  await page.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.locator('.message-user')).toHaveCount(30)
  await expect(page.getByRole('button', { name: '思考强度', exact: true })).toContainText('深度')
  await page.getByRole('button', { name: '加载更早消息' }).click()
  await expect(page.locator('.message-user')).toHaveCount(45)
  await expect(page.getByRole('button', { name: '加载更早消息' })).toHaveCount(0)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.find((r: { method: string }) => r.method === 'thread/resume').params.excludeTurns).toBe(true)
  expect(metrics.requests.filter((r: { method: string }) => r.method === 'thread/items/list').every((r: { params: { limit: number } }) => r.params.limit === 60)).toBe(true)
})

test('cancels a stalled resume and ignores its late response after switching threads', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=slow'); await configure(page); await showSidebar(page)
  await page.getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消加载' })).toBeVisible()
  await showSidebar(page); await page.getByRole('button', { name: '第二个会话', exact: true }).click()
  await expect(page.getByText('第二个会话的消息。', { exact: true })).toBeVisible()
  await expect.poll(async () => (await (await request.get(MOCK_URL + '/test/metrics')).json()).resumed).toContain('existing-thread')
  await expect(page.getByText('第二个会话的消息。', { exact: true })).toBeVisible()
  await expect(page.getByText('正在打开对话…', { exact: true })).toHaveCount(0)
})

async function enqueue(page: Page, text: string) { await page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true }).fill(text); await page.getByRole('button', { name: '加入消息队列', exact: true }).click() }

test('edits and removes queued messages and applies settings changed during a turn', async ({ page, request }) => {
  await configure(page); await send(page, '队列任务开始')
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  await enqueue(page, '第二条'); await enqueue(page, '需要移除的消息')
  const queue = page.locator('.composer-island').getByRole('region', { name: '消息队列' })
  await expect(queue.locator('.queue-item')).toHaveCount(2)
  await queue.getByRole('button', { name: '编辑排队消息' }).first().click()
  await queue.getByRole('textbox').fill('修改后的消息')
  await queue.getByRole('button', { name: '保存修改' }).click()
  await queue.getByRole('button', { name: '移除排队消息' }).last().click()
  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /轻量模型/ }).click()
  await page.getByRole('button', { name: '思考强度', exact: true }).click()
  await page.getByRole('slider', { name: '思考强度' }).press('End')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '更改权限' }).click()
  await page.getByRole('menuitemradio', { name: /帮我批准/ }).click()
  await request.get(MOCK_URL + '/test/finish')
  await expect(queue).toHaveCount(0)
  await expect(page.locator('.message-user').getByText('修改后的消息', { exact: true })).toBeVisible()
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const turns = metrics.requests.filter((r: { method: string }) => r.method === 'turn/start')
  expect(turns).toHaveLength(2)
  expect(turns[1].params).toMatchObject({ model: 'quick-model', effort: 'medium', approvalsReviewer: 'auto_review', approvalPolicy: 'on-request' })
  expect(turns[1].params.input[0].text).toBe('修改后的消息')
})

test('pauses the queue when stopped and retains a failed message for manual retry', async ({ page, request }) => {
  await configure(page); await send(page, '队列任务开始'); await enqueue(page, '发送失败')
  await page.getByRole('button', { name: '停止生成' }).click()
  const queue = page.getByRole('region', { name: '消息队列' })
  await expect(queue).toContainText('已暂停')
  await request.get(MOCK_URL + '/test/scenario?name=queue-fail')
  await queue.getByRole('button', { name: '继续队列' }).click()
  await expect(queue.getByRole('alert')).toContainText('测试发送失败')
  await expect(queue.locator('.queue-item')).toHaveCount(1)
  await request.get(MOCK_URL + '/test/scenario?name=normal')
  await queue.getByRole('button', { name: '继续队列' }).click()
  await expect(queue).toHaveCount(0)
  await expect(page.locator('.message-user').getByText('发送失败', { exact: true })).toBeVisible()
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(metrics.requests.filter((r: { method: string }) => r.method === 'turn/start')).toHaveLength(3)
})

test('sends text-image-text in order with inline filenames and hover/click previews', async ({ page, request }, testInfo) => {
  await configure(page)
  const editor = page.locator('#message-input')
  await editor.fill('前文 后文')
  await editor.evaluate(el => { const range = document.createRange(); range.setStart(el.firstChild!, 3); range.collapse(true); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })) })
  await page.getByLabel('选择附件', { exact: true }).setInputFiles({ name: '示意图.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dwAAAABJRU5ErkJggg==', 'base64') })
  await expect(editor.locator('.editor-image-chip')).toHaveCount(1)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const bubble = page.locator('.message-user .user-bubble')
  await expect(bubble).toContainText('示意图.png')
  const order = await bubble.locator(':scope > *').allTextContents()
  expect(order).toEqual(['前文 ', '示意图.png', '后文'])
  expect((await bubble.boundingBox())!.height).toBeLessThan(130)
  await page.screenshot({ path: 'test-results/' + testInfo.project.name + '-inline-images.png', animations: 'disabled' })
  await bubble.getByRole('button', { name: '预览图片 示意图.png' }).hover()
  await expect(page.getByRole('tooltip', { name: '示意图.png', exact: true })).toBeVisible()
  await bubble.getByRole('button', { name: '预览图片 示意图.png' }).click()
  await expect(page.getByRole('dialog', { name: '示意图.png', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '示意图.png', exact: true })).toHaveCount(0)
  const metrics = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const input = metrics.requests.findLast((r: { method: string }) => r.method === 'turn/start').params.input
  expect(input.map((p: { type: string }) => p.type)).toEqual(['text', 'text', 'image', 'text'])
  expect(input[0].text).toBe('前文 '); expect(input[3].text).toBe('后文')
})
