import { expect, test } from '../fixtures'
import { readFile } from 'node:fs/promises'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
import { sampleCode } from '../markdown-fixture'

test.beforeEach(async ({ page, request }, info) => {
  await request.get(MOCK_URL + '/test/reset')
  await request.get(MOCK_URL + '/test/scenario?name=file-links')
  await page.addInitScript(streaming => {
    const state = { bytes: 0, correct: true, closed: false, aborted: false, name: '' }
    ;(window as any).__fileWriter = state
    const picker = async (options: { suggestedName: string }) => {
      state.name = options.suggestedName
      return { createWritable: async () => ({
        write: async (data: Uint8Array) => { state.correct &&= data.every((byte, index) => byte === (state.bytes + index) % 256); state.bytes += data.length },
        close: async () => { state.closed = true }, abort: async () => { state.aborted = true },
      }) }
    }
    Object.defineProperty(window, 'showSaveFilePicker', { value: streaming ? picker : undefined, configurable: true })
  }, info.title.includes('streams downloads'))
  await page.goto('/')
  await expect(page.getByRole('button', { name: '文件浏览器', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('文件所在的远端设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  const toggle = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.locator('.sidebar').getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.getByRole('button', { name: '说明文档', exact: true })).toBeVisible()
})

test('browses the current directory from navigation and recovers from a missing default directory', async ({ page, request }, info) => {
  const trigger = page.getByRole('button', { name: '文件浏览器', exact: true })
  const panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  await expect(trigger).toBeEnabled(); await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(panel.locator('.workspace-file-path')).toHaveText('/test/project')
  await panel.getByRole('button', { name: 'src 文件夹', exact: true }).click()
  await panel.getByRole('button', { name: /^main.ts / }).click()
  await expect(panel.locator('.workspace-file-source')).toContainText('const one = 1')
  await panel.getByRole('button', { name: '上级文件夹', exact: true }).click()
  await expect(panel.locator('.workspace-file-path')).toHaveText('/test/project/src')
  await page.screenshot({ path: info.outputPath('file-browser.png') })
  await panel.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(trigger).toBeFocused()
  const before = await (await request.get(MOCK_URL + '/test/metrics')).json()
  const nav = page.getByRole('button', { name: /打开导航|展开侧栏/, exact: true })
  if (await nav.isVisible() && await nav.getAttribute('aria-expanded') !== 'true') await nav.click()
  await page.locator('.sidebar').getByRole('button', { name: 'Codex Remote 首页', exact: true }).click()
  await trigger.click()
  await expect(panel.getByRole('alert')).toContainText('文件不存在')
  await expect(panel.locator('.workspace-file-path')).toHaveText('~/codex-remote')
  await panel.getByRole('button', { name: '上级文件夹', exact: true }).click()
  await expect(panel.locator('.workspace-file-path')).toHaveText('/mock-home')
  await expect(panel.getByRole('button', { name: 'notes 文件夹', exact: true })).toBeVisible()
  const after = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(after.received.filter((method: string) => ['thread/start', 'turn/start', 'fs/createDirectory'].includes(method))).toEqual(before.received.filter((method: string) => ['thread/start', 'turn/start', 'fs/createDirectory'].includes(method)))
  const reads = after.requests.filter((call: any) => call.method === 'command/exec' && call.params.command?.some((arg: string) => arg.startsWith('# codex-remote workspace files')))
  expect(reads.every((call: any) => call.params.cwd === undefined)).toBe(true)
})

test('opens Markdown on the right and resolves its relative file links on the remote device', async ({ page }) => {
  const original = page.url(), badRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/test/files')) badRequests.push(request.url()) })
  await expect(page.getByRole('link', { name: '网站', exact: true })).toHaveAttribute('href', 'https://example.com')
  await page.getByRole('button', { name: '说明文档', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  await expect(panel.getByRole('heading', { name: '发布说明', exact: true })).toBeVisible()
  await expect(panel).toContainText('文件所在的远端设备')
  await expect(page.getByRole('dialog', { name: '下载文件？', exact: true })).toBeHidden()
  expect(await page.evaluate(() => (window as any).__filePreviewScript)).toBeUndefined()
  await expect(panel.locator('.markdown-code-block .hljs-keyword').first()).toHaveText('if')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__previewCode = text } }, configurable: true })
  })
  await panel.getByRole('button', { name: '复制代码', exact: true }).first().click()
  await expect.poll(() => page.evaluate(() => (window as any).__previewCode)).toBe(sampleCode)
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(panel.getByRole('heading', { name: '使用指南', exact: true })).toBeVisible()
  await expect(panel.locator('.workspace-file-path')).toHaveText('/test/files/guide.md')
  expect(page.url()).toBe(original)
  expect(badRequests).toEqual([])
  const box = await panel.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  if (page.viewportSize()!.width >= 1100) await expect.poll(async () => {
    const [composer, sidebar] = await Promise.all([page.locator('.composer').boundingBox(), panel.boundingBox()])
    return composer!.x + composer!.width <= sidebar!.x
  }).toBe(true)
})

test('animates the released conversation width when the file panel closes, respecting reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const trigger = page.getByRole('button', { name: '文件浏览器', exact: true }), panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  const fullWidth = (await page.locator('.chat-body').boundingBox())!.width
  await trigger.click(); await expect(panel.getByRole('button', { name: 'src 文件夹', exact: true })).toBeVisible()
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(200)
  await expect.poll(async () => panel.evaluate(element => element.getAnimations().length)).toBe(0)
  const openedWidth = (await page.locator('.chat-body').boundingBox())!.width
  const samples = await page.evaluate(async () => {
    const values: number[] = [], chat = document.querySelector('.chat-body')!
    document.querySelector<HTMLButtonElement>('[aria-label="关闭文件预览"]')!.click()
    const start = performance.now()
    while (performance.now() - start < 340) { await new Promise(requestAnimationFrame); values.push(chat.getBoundingClientRect().width) }
    return values
  })
  await expect(panel).toHaveCount(0)
  if (page.viewportSize()!.width >= 1100) {
    expect(fullWidth - openedWidth).toBeGreaterThan(200)
    expect(samples.filter(width => width > openedWidth + 8 && width < fullWidth - 8).length).toBeGreaterThan(2)
  } else expect(samples.every(width => Math.abs(width - fullWidth) < 2)).toBe(true)
  expect(Math.abs(samples.at(-1)! - fullWidth)).toBeLessThan(3)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.click()
  await expect(panel).toBeVisible(); await panel.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  await expect(panel).toHaveCount(0)
})

test('creates folders and files, rejects duplicates and sets a browsed directory for the next conversation', async ({ page, request }, info) => {
  const panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  await page.getByRole('button', { name: '文件浏览器', exact: true }).click()
  await panel.getByRole('button', { name: '新建文件夹', exact: true }).click()
  const folder = page.getByRole('dialog', { name: '新建文件夹', exact: true })
  await folder.getByLabel('文件夹名称', { exact: true }).fill('新项目'); await folder.getByRole('button', { name: '创建', exact: true }).click()
  await expect(folder).toBeHidden(); await expect(panel.getByRole('button', { name: '新项目 文件夹', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '新建文件夹', exact: true }).click()
  await folder.getByLabel('文件夹名称', { exact: true }).fill('新项目'); await folder.getByRole('button', { name: '创建', exact: true }).click()
  await expect(folder.getByRole('alert')).toContainText('同名'); await folder.getByRole('button', { name: '取消', exact: true }).click()
  await panel.getByRole('button', { name: '新项目 文件夹', exact: true }).click()
  await panel.getByRole('button', { name: '新建文件', exact: true }).click()
  const file = page.getByRole('dialog', { name: '新建文件', exact: true })
  await file.getByLabel('文件名称', { exact: true }).fill('README.md'); await file.getByRole('button', { name: '创建', exact: true }).click()
  await expect(file).toBeHidden(); await expect(panel.getByRole('button', { name: 'README.md 0 B', exact: true })).toBeVisible()
  await panel.screenshot({ path: info.outputPath('directory-actions.png') })
  const before = await (await request.get(MOCK_URL + '/test/metrics')).json()
  await panel.getByRole('button', { name: '设为工作目录', exact: true }).click(); await expect(panel).toHaveCount(0)
  const input = page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
  await input.fill('在新目录工作'); await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.message-agent')).toContainText('流式回复')
  const after = await (await request.get(MOCK_URL + '/test/metrics')).json()
  expect(after.requests.findLast((call: any) => call.method === 'thread/start').params.cwd).toBe('/test/project/新项目')
  expect(before.requests.filter((call: any) => call.method === 'thread/start')).toHaveLength(0)
  expect(before.requests.filter((call: any) => call.method === 'command/exec' && call.params.command.includes('create-directory'))).toHaveLength(2)
})

test('renders HTML and inline SVG in an isolated preview and switches back to line-referenced source', async ({ page }, info) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('blocked-resource.png')) requests.push(request.url()) })
  await page.getByRole('button', { name: '文件浏览器', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  await panel.getByRole('button', { name: /^index.html / }).click()
  const frame = panel.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'HTML 页面预览', exact: true })).toBeVisible()
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(12, 34, 56)')
  await expect(frame.locator('svg circle')).toHaveCount(1)
  await expect(panel.locator('iframe')).toHaveAttribute('sandbox', '')
  expect(await page.evaluate(() => (window as any).__htmlPreviewScript)).toBeUndefined(); expect(requests).toEqual([])
  await panel.screenshot({ path: info.outputPath('html-file-preview.png') })
  await panel.getByRole('button', { name: '源代码', exact: true }).click()
  await expect(panel.locator('.workspace-file-source')).toContainText('<!doctype html>')
  await expect(panel.locator('iframe')).toHaveCount(0)
  await panel.getByRole('button', { name: '页面预览', exact: true }).click()
  await expect(frame.getByRole('heading', { name: 'HTML 页面预览', exact: true })).toBeVisible()
})

test('asks before downloading an unsupported file and fetches every binary chunk', async ({ page, request }) => {
  await page.getByRole('button', { name: 'AppImage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '下载文件？', exact: true })
  await expect(dialog).toContainText('build.AppImage')
  await expect(page.getByRole('complementary', { name: '文件预览', exact: true })).toBeHidden()
  const commands = async () => ((await (await request.get(MOCK_URL + '/test/metrics')).json()).requests as any[]).filter(call => call.method === 'command/exec').map(call => call.params.command as string[])
  expect((await commands()).filter(args => args.includes('chunk'))).toHaveLength(0)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'AppImage', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '下载', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('build.AppImage')
  const bytes = await readFile((await download.path())!)
  expect(bytes.length).toBe(600123)
  expect(bytes.every((value, index) => value === index % 256)).toBe(true)
  expect((await commands()).filter(args => args.includes('chunk'))).toHaveLength(3)
})

test('supports code line references and ignores responses after the preview closes', async ({ page }) => {
  await page.getByRole('button', { name: '源代码', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '文件预览', exact: true })
  await expect(panel.locator('mark')).toHaveText('const two = 2')
  await expect(panel.locator('.workspace-file-path')).toHaveText('/test/project/src/main.ts')
  await panel.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  await page.getByRole('button', { name: '慢文件', exact: true }).click()
  await expect(panel).toContainText('正在读取')
  await panel.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  await page.getByRole('button', { name: '说明文档', exact: true }).click()
  await expect(panel.getByRole('heading', { name: '发布说明', exact: true })).toBeVisible()
  await page.waitForTimeout(1100)
  await expect(panel.getByRole('heading', { name: '发布说明', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件预览', exact: true }).click()
  await page.getByRole('button', { name: '不存在', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('文件不存在')
})
