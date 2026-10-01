import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'

async function viewport(page: Page, height: number, top = 0, scale = 1) {
  await page.evaluate(value => (window as any).__setVisualViewport(value), { height, top, scale })
}
async function expectAboveKeyboard(page: Page, selector: string, bottom: number, top = 0) {
  const element = page.locator(selector)
  await expect.poll(async () => {
    const box = await element.boundingBox()
    return !!box && box.y >= top - 1 && box.y + box.height <= bottom + 1
  }).toBe(true)
}
test.beforeEach(async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile' ? 'dark' : 'light' })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-no-visual-viewport')) { Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined }); return }
    let size: { height?: number; top?: number; scale?: number } = {}
    const visual = new EventTarget()
    Object.defineProperties(visual, {
      height: { get: () => size.height ?? innerHeight }, width: { get: () => innerWidth },
      offsetTop: { get: () => size.top ?? 0 }, offsetLeft: { get: () => 0 },
      pageTop: { get: () => (size.top ?? 0) + scrollY }, pageLeft: { get: () => scrollX },
      scale: { get: () => size.scale ?? 1 },
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual })
    ;(window as any).__setVisualViewport = (value: typeof size) => {
      size = value; visual.dispatchEvent(new Event('resize')); visual.dispatchEvent(new Event('scroll'))
      let keyboard = document.querySelector<HTMLElement>('[data-test-keyboard]')
      if (!keyboard) { keyboard = document.createElement('div'); keyboard.dataset.testKeyboard = ''; document.body.append(keyboard) }
      keyboard.textContent = '模拟输入法区域'
      keyboard.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#24262b;color:white;text-align:center;padding-top:24px;box-sizing:border-box;pointer-events:none'
      const height = Math.max(0, innerHeight - (size.height ?? innerHeight) - (size.top ?? 0))
      keyboard.style.height = height + 'px'; keyboard.style.display = height ? 'block' : 'none'
    }
  })
  await request.get(MOCK_URL + '/test/reset')
  await page.goto('/')
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('输入法测试设备')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
})
test('tracks a visual-only keyboard resize, pan and dismissal without losing the draft or forcing zoom', async ({ page }, testInfo) => {
  const editor = page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
  await editor.fill('输入法打开后继续编辑中文草稿')
  await viewport(page, 360)
  await expectAboveKeyboard(page, '.composer', 360)
  await page.screenshot({ path: testInfo.outputPath('keyboard-open.png') })
  await expectAboveKeyboard(page, '#message-input', 360)
  await expect(editor).toBeFocused(); await expect(editor).toHaveText('输入法打开后继续编辑中文草稿')
  await viewport(page, 320, 48)
  await expectAboveKeyboard(page, '.composer', 368, 48)
  await expect.poll(async () => (await page.locator('.app-shell').boundingBox())?.y).toBe(48)
  const beforeZoom = await page.locator('.app-shell').boundingBox()
  await viewport(page, 200, 80, 1.5)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.locator('.app-shell').boundingBox()).toEqual(beforeZoom)
  await viewport(page, 844)
  await expect.poll(async () => (await page.locator('.app-shell').boundingBox())?.height).toBe(844)
  await expectAboveKeyboard(page, '.composer', 844)
  await expect(editor).toHaveText('输入法打开后继续编辑中文草稿')
})
test('keeps a side-chat composer above the keyboard in portrait and landscape', async ({ page }) => {
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '已有项目分析', exact: true }).click()
  await page.getByRole('button', { name: '会话操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建侧边聊天', exact: true }).click()
  const input = page.getByRole('textbox', { name: '侧边聊天消息', exact: true })
  await input.fill('侧边聊天草稿')
  await viewport(page, 360, 24)
  await expectAboveKeyboard(page, '.side-chat-input form', 384, 24)
  await expect(input).toBeFocused()
  await page.setViewportSize({ width: 844, height: 390 }); await viewport(page, 240)
  await expectAboveKeyboard(page, '.side-chat-input form', 240)
  await expectAboveKeyboard(page, '.side-chat-actions', 240)
  await expect(input).toHaveText('侧边聊天草稿')
})
test('viewport resizing does not jump a reader back to the latest message', async ({ page, request }) => {
  await request.get(MOCK_URL + '/test/scenario?name=paged')
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  await page.locator('.sidebar').getByRole('button', { name: '已有项目分析', exact: true }).click()
  await expect(page.locator('.message-agent')).not.toHaveCount(0)
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await viewport(page, 360)
  await expect.poll(() => page.locator('.conversation').evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(100)
})
test('uses layout resizing when VisualViewport is absent', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('test-no-visual-viewport', '1'))
  await page.reload()
  expect(await page.evaluate(() => window.visualViewport)).toBeUndefined()
  const editor = page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
  await editor.fill('没有 VisualViewport 时也保留输入')
  await page.setViewportSize({ width: 390, height: 420 })
  await expectAboveKeyboard(page, '.composer', 420)
  await page.setViewportSize({ width: 390, height: 844 })
  await expectAboveKeyboard(page, '.composer', 844)
  await expect(editor).toHaveText('没有 VisualViewport 时也保留输入')
})

test('goal inputs and modal controls stay inside the visible area when the keyboard opens', async ({ page, request }, testInfo) => {
  await request.get(MOCK_URL + '/test/scenario?name=goal')
  const composer = page.getByRole('textbox', { name: '发送给 Codex 的消息', exact: true })
  await composer.fill('/goal 测试目标编辑'); await page.keyboard.press('Enter')
  const goal = page.getByRole('region', { name: '当前目标', exact: true })
  await goal.getByRole('button', { name: '编辑目标', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑目标', exact: true })
  const input = dialog.getByRole('textbox', { name: '目标', exact: true })
  await input.fill('保留目标草稿')
  await viewport(page, 360)
  await expectAboveKeyboard(page, '.goal-dialog', 360)
  await expectAboveKeyboard(page, '.goal-dialog textarea', 360)
  await expect(input).toBeFocused(); await expect(input).toHaveValue('保留目标草稿')
  expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: testInfo.outputPath('keyboard-goal-dialog.png') })
  await viewport(page, 844)
  await expect(input).toHaveValue('保留目标草稿')
})
