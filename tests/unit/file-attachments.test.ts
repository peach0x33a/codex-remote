import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileReference, parseFileReference, readAttachments, uploadAttachment, UPLOAD_CHUNK_BYTES } from '../../src/lib/file-attachments'
import { messageParts, toInputs, type PromptPart } from '../../src/lib/prompt'
import { parseHistoryInput } from '../../shared/input-history'
import type { WorkspaceRun } from '../../src/lib/workspace-files'

let root = '', calls: string[][]
const run: WorkspaceRun = async params => {
  const command = params.command as string[]
  calls.push(command)
  const process = Bun.spawn(command, { env: { ...globalThis.process.env, TMPDIR: root }, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  return { exitCode, stdout, stderr }
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'codex-remote-upload-test-')); calls = [] })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test('uploads arbitrary binary files byte-for-byte in bounded chunks without encoding large argv values', async () => {
  const bytes = Uint8Array.from({ length: UPLOAD_CHUNK_BYTES * 3 + 71 }, (_, i) => i % 256)
  const file = await uploadAttachment(new File([bytes], 'archive.unknown', { type: 'application/x-unknown' }), 'device-a', run)
  expect(file).toMatchObject({ type: 'file', name: 'archive.unknown', size: bytes.length, deviceId: 'device-a' })
  expect(new Uint8Array(await readFile(file.path))).toEqual(bytes)
  expect(calls.filter(command => command[5] === 'chunk')).toHaveLength(4)
  expect(calls.flat().every(argument => new TextEncoder().encode(argument).length < 128 * 1024)).toBe(true)
  expect(calls.every(command => JSON.stringify(command).length < 4 * 1024 * 1024)).toBe(true)
})
test('accepts empty files and keeps unsafe filenames inside their own upload directory', async () => {
  const sentinel = join(root, 'sentinel'); await writeFile(sentinel, 'unchanged')
  const file = await uploadAttachment(new File([], '../sentinel;$(touch injected).bin'), 'device-a', run)
  expect(file.size).toBe(0)
  expect((await readFile(file.path)).length).toBe(0)
  expect(basename(file.path)).toBe('.._sentinel;$(touch injected).bin')
  expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
  expect(await readdir(root)).not.toContain('injected')
  expect(calls.filter(command => command[5] === 'chunk')).toHaveLength(0)
})
test('never automatically retries a chunk whose write acknowledgement is uncertain, and cleans its private partial file', async () => {
  let chunkCount = 0
  const uncertain: WorkspaceRun = async (params, options) => {
    const result = await run(params, options)
    if ((params.command as string[])[5] === 'chunk') { chunkCount++; throw new Error('connection lost after write') }
    return result
  }
  await expect(uploadAttachment(new File(['keep these bytes'], 'input.zip'), 'device-a', uncertain)).rejects.toThrow('connection lost after write')
  expect(chunkCount).toBe(1)
  expect(await readdir(root)).toEqual([])
})
test('a malformed acknowledgement cannot publish a partly uploaded attachment', async () => {
  const malformed: WorkspaceRun = async (params, options) => {
    const result = await run(params, options) as { exitCode: number; stdout: string }
    return (params.command as string[])[5] === 'chunk' ? { ...result, stdout: '{"ok":true,"offset":999999}' } : result
  }
  await expect(uploadAttachment(new File(['hello'], 'input.docx'), 'device-a', malformed)).rejects.toThrow('上传位置未确认')
  expect(await readdir(root)).toEqual([])
})
test('preserves native text, image and arbitrary file ordering through history without storing file bytes', async () => {
  const file = await uploadAttachment(new File(['\x00\xffpayload'], '中文资料.pdf'), 'device-a', run)
  const parts: PromptPart[] = [{ type: 'text', text: 'before ' }, file, { type: 'text', text: ' after' }]
  const input = toInputs(parts, 'device-a')
  expect(input.map(part => part.type)).toEqual(['text', 'text', 'text'])
  expect(JSON.stringify(input)).not.toContain('payload')
  expect(toInputs(messageParts(parseHistoryInput(input)))).toEqual(input)
  expect(messageParts(input)[1]).toMatchObject({ type: 'file', name: file.name, path: file.path, size: file.size, deviceId: 'device-a' })
  expect(() => toInputs(parts, 'device-b')).toThrow('另一台设备')
  expect(parseFileReference(fileReference(file), 'different-name')).toBeUndefined()
})
test('accepts every extension and MIME, including missing MIME, and keeps large images below the bridge frame limit', async () => {
  const selected = [new File(['PDF'], 'sample.pdf', { type: 'application/pdf' }), new File(['x'], 'unknown.unrecognized'), new File(['doc'], 'sample.docx'), new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]
  const parts = await readAttachments(selected, [], file => uploadAttachment(file, 'device-a', run))
  expect(parts.map(part => part.name)).toEqual(selected.map(file => file.name))
  expect(parts.every(part => part.type === 'file')).toBe(true)
  expect(JSON.stringify(toInputs(parts)).length).toBeLessThan(4096)
})
test('routes real large raster images through native localImage and keeps their file reference reversible', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 1)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = await readAttachments([new File([bytes], 'large.png', { type: 'image/png' })], [], file => uploadAttachment(file, 'device-a', run))
  const input = toInputs(parts, 'device-a')
  expect(input.map(part => part.type)).toEqual(['text', 'localImage'])
  expect(JSON.stringify(input).length).toBeLessThan(4096)
  expect(toInputs(messageParts(parseHistoryInput(input)), 'device-a')).toEqual(input)
})
