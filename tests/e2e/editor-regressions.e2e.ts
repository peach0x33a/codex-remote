import { expect, test, type Page } from '../fixtures'
import { MOCK_ENDPOINT, MOCK_URL } from '../config'
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dwAAAABJRU5ErkJggg=='
async function configure(page: Page) {
  await page.getByRole('button', { name: '选择设备', exact: true }).click()
  await page.getByRole('menuitem', { name: '添加设备', exact: true }).click()
  await page.getByLabel('设备名称').fill('测试工作站')
  await page.getByLabel('App Server 地址').fill(MOCK_ENDPOINT)
  await page.getByPlaceholder('留空使用 ~/codex-remote').fill('/test/project')
  await page.getByRole('button', { name: '保存并连接', exact: true }).click()
  await expect(page.getByTestId('selected-device')).toContainText('已连接')
}
async function pasteImage(page: Page) {
  await page.locator('#message-input').evaluate((editor, data) => {
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([Uint8Array.from(atob(data), character => character.charCodeAt(0))], '粘贴图片.png', { type: 'image/png' }))
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
  }, pixel)
  await expect(page.locator('#message-input .editor-image-chip')).toHaveCount(1)
}
test.beforeEach(async ({ page, request }) => { await request.get(MOCK_URL + '/test/reset'); await page.goto('/'); await configure(page) })

test('preserves trailing text when typing after an image pasted into the middle', async ({ page, request }) => {
  const editor = page.locator('#message-input')
  await editor.fill('前文后文')
  await editor.evaluate(element => { const range = document.createRange(); range.setStart(element.firstChild!, 2); range.collapse(true); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range) })
  await pasteImage(page); await page.keyboard.insertText('新增文字')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.message-user')).toContainText('新增文字后文')
  const calls = (await (await request.get(MOCK_URL + '/test/metrics')).json()).requests
  const input = calls.findLast((call: { method: string }) => call.method === 'turn/start').params.input
  expect(input[0].text).toBe('前文'); expect(input.at(-1).text).toBe('新增文字后文')
})
