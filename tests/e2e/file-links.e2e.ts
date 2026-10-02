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
