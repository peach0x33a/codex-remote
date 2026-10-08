import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, open, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceFiles, FILE_CHUNK_BYTES, type WorkspaceFile, type WorkspaceRun } from '../../src/lib/workspace-files'

const roots: string[] = []
const TEXT_BYTES = 128 * 1024
const IMAGE_BYTES = 8 * 1024 * 1024
const OUTPUT_BYTES = 960 * 1024
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64')
type RunOptions = Parameters<WorkspaceRun>[1]
type Result = { exitCode: number; stdout: string; stderr: string }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function temp() { const path = await mkdtemp(join(tmpdir(), 'workspace-files-')); roots.push(path); return path }
async function execute(params: Record<string, unknown>, options?: RunOptions, env: Record<string, string | undefined> = process.env): Promise<Result> {
  options?.signal?.throwIfAborted()
  const proc = Bun.spawn(params.command as string[], { ...(params.cwd ? { cwd: params.cwd as string } : {}), env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const abort = () => proc.kill()
  options?.signal?.addEventListener('abort', abort, { once: true })
  // A faulty FIFO implementation must fail the test, never hang the test process.
  const timer = setTimeout(abort, 2000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    options?.signal?.throwIfAborted()
    return { exitCode, stdout, stderr }
  } finally { clearTimeout(timer); options?.signal?.removeEventListener('abort', abort) }
}
async function fixture(files: Record<string, string | Uint8Array> = {}) {
  const cwd = await temp()
  for (const [path, data] of Object.entries(files)) { await mkdir(join(cwd, path, '..'), { recursive: true }); await writeFile(join(cwd, path), data) }
  const calls: { params: Record<string, unknown>; options: RunOptions; result: Result }[] = []
  const run: WorkspaceRun = async (params, options) => {
    const result = await execute(params, options)
    calls.push({ params, options, result })
    return result
  }
  return { cwd, run, calls, service: createWorkspaceFiles(run, { cwd }) }
}

test('reads PDF/audio through bounded chunks and refuses previews above 32 MiB', async () => {
  const { richPdf, richWav } = await import('../rich-fixture')
  const { service, cwd, calls } = await fixture({ 'doc.pdf': Buffer.from(richPdf, 'base64'), 'voice.wav': Buffer.from(richWav, 'base64'), 'fake.wav': 'text only' })
  expect((await service.inspect('doc.pdf')).preview).toEqual({ kind: 'pdf', mime: 'application/pdf', dataBase64: richPdf })
  expect((await service.inspect('voice.wav')).preview).toEqual({ kind: 'audio', mime: 'audio/wav', dataBase64: richWav })
  expect((await service.inspect('fake.wav')).preview?.kind).toBe('text')
  const file = await open(join(cwd, 'doc.pdf'), 'r+')
  try { await file.truncate(32 * 1024 * 1024 + 1) } finally { await file.close() }
  const before = calls.length
  expect((await service.inspect('doc.pdf')).preview).toEqual({ kind: 'binary' })
  expect(calls.length - before).toBe(1)
})

test('creates remote directories and empty files with literal names and refreshable listings', async () => {
  const { cwd, service, calls } = await fixture({ 'keep.txt': 'unchanged' })
  const name = "项目 ' $(touch SHOULD_NOT_EXIST)"
  expect(await service.create(cwd, name, 'directory')).toEqual({ path: join(cwd, name), name, kind: 'directory' })
  expect((await stat(join(cwd, name))).isDirectory()).toBe(true)
  expect(await service.create(join(cwd, name), 'README.md', 'file')).toMatchObject({ kind: 'file' })
  expect(await Bun.file(join(cwd, name, 'README.md')).text()).toBe('')
  expect((await service.inspect(join(cwd, name))).entries?.map(entry => entry.name)).toEqual(['README.md'])
  expect(await Bun.file(join(cwd, 'keep.txt')).text()).toBe('unchanged')
  expect(await Bun.file(join(cwd, 'SHOULD_NOT_EXIST')).exists()).toBe(false)
  expect(calls[0]!.params.command).toContain(name)
})

test('creation never overwrites existing files, directories or symlink targets', async () => {
  const { cwd, service } = await fixture({ 'keep.txt': 'preserve' })
  await mkdir(join(cwd, 'folder')); await symlink(join(cwd, 'keep.txt'), join(cwd, 'link'))
  for (const name of ['keep.txt', 'folder', 'link']) for (const kind of ['file', 'directory'] as const) await expect(service.create(cwd, name, kind)).rejects.toThrow('同名')
  expect(await Bun.file(join(cwd, 'keep.txt')).text()).toBe('preserve')
  expect((await service.inspect(cwd)).entries?.map(entry => entry.name)).toEqual(['folder', 'keep.txt', 'link'])
  await expect(service.create(join(cwd, 'keep.txt'), 'child', 'file')).rejects.toThrow('只能在文件夹')
  await expect(service.create(join(cwd, 'missing'), 'child', 'directory')).rejects.toThrow('不存在')
})

test('creation validates names on both ends and reports permission failures without partial files', async () => {
  const { cwd, service, run, calls } = await fixture()
  for (const name of ['', '.', '..', '../escape', 'nested/file', 'nul\0name', '中文'.repeat(86)]) await expect(service.create(cwd, name, 'directory')).rejects.toThrow()
  expect(calls).toHaveLength(0)
  const hostile: WorkspaceRun = (params, options) => { const command = [...params.command as string[]]; command[8] = '../escape'; return run({ ...params, command }, options) }
  await expect(createWorkspaceFiles(hostile, { cwd: '' }).create(cwd, 'safe', 'directory')).rejects.toThrow('名称')
  expect(await Bun.file(join(cwd, 'safe')).exists()).toBe(false)
  if (process.getuid?.() !== 0) {
    await chmod(cwd, 0o500)
    try { await expect(service.create(cwd, 'denied', 'file')).rejects.toThrow('权限') }
    finally { await chmod(cwd, 0o700) }
    expect(await Bun.file(join(cwd, 'denied')).exists()).toBe(false)
  }
})
const reply = (report: unknown) => ({ exitCode: 0, stdout: JSON.stringify(report), stderr: '' })
function descriptor(bytes = 1): WorkspaceFile { return { path: '/remote/file', name: 'file', kind: 'file', size: bytes, fingerprint: '1:2:' + bytes + ':3:4', preview: { kind: 'binary' } } }
function chunkReply(file: WorkspaceFile, extra: Record<string, unknown> = {}) {
  return reply({ ok: true, path: file.path, fingerprint: file.fingerprint, size: file.size, offset: 0, dataBase64: '/w==', ...extra })
}
function instrument(run: WorkspaceRun, prefix: string): WorkspaceRun {
  return (params, options) => {
    const command = [...params.command as string[]]
    const script = command.indexOf('-c') + 1
    command[script] = prefix + '\n' + command[script]
    return run({ ...params, command }, options)
  }
}

describe('remote filesystem paths and read-only commands', () => {
  test('reads real relative/absolute paths, spaces, quotes, UTF-8 and shell metacharacters literally', async () => {
    const names = ['space file.txt', '中文 😺.txt', "quote'\";$(touch SHOULD_NOT_EXIST).txt", 'back\\slash.txt', '-option', ' leading trailing ']
    const text = 'hello 世界 😺\nsecond\tline\r\n'
    const { cwd, service, calls } = await fixture(Object.fromEntries(names.map(name => [name, text])))
    for (const name of names) {
      const file = await service.inspect(name)
      expect(file).toMatchObject({ path: join(cwd, name), name, kind: 'file', size: Buffer.byteLength(text), preview: { kind: 'text', text, mime: 'text/plain', truncated: false } })
      expect(await service.readChunk(file, 0)).toEqual(new Uint8Array(Buffer.from(text)))
      expect((await service.inspect(join(cwd, name))).fingerprint).toBe(file.fingerprint)
    }
    await mkdir(join(cwd, 'nested'))
    expect((await createWorkspaceFiles(serviceRun(calls), { cwd: join(cwd, 'nested') }).inspect('../space file.txt')).path).toBe(join(cwd, 'space file.txt'))
    expect(await Bun.file(join(cwd, 'SHOULD_NOT_EXIST')).exists()).toBe(false)
    expect(new Set(calls.map(call => (call.params.command as string[])[4])).size).toBe(1)
    for (const { params, options, result } of calls) {
      const command = params.command as string[]
      expect(command.slice(0, 4)).toEqual(['python3', '-I', '-S', '-c'])
      expect(command[4]).toStartWith('# codex-remote workspace files\n')
      expect(['inspect', 'chunk']).toContain(command[5])
      expect(params.outputBytesCap).toBe(OUTPUT_BYTES)
      expect(Number(params.outputBytesCap)).toBeLessThan(1024 * 1024)
      expect(params.timeoutMs).toBe(10_000)
      expect(options?.timeoutMs).toBe(10_000)
      expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(OUTPUT_BYTES)
    }
  })

  test('allows absent cwd for absolute paths and expands only the remote home', async () => {
    const { cwd } = await fixture({ 'home with spaces/文.txt': 'remote home\n' })
    const home = join(cwd, 'home with spaces'), calls: Record<string, unknown>[] = []
    const service = createWorkspaceFiles(async (params, options) => { calls.push(params); return execute(params, options, { ...process.env, HOME: home }) }, { cwd: '' })
    const file = await service.inspect('~/文.txt')
    expect(file.path).toBe(join(home, '文.txt'))
    expect(file.preview?.text).toBe('remote home\n')
    expect(await service.readChunk(file, 0)).toEqual(new Uint8Array(Buffer.from('remote home\n')))
    expect((await service.inspect('~')).path).toBe(home)
    expect((await service.inspect(join(home, '文.txt'))).path).toBe(file.path)
    expect(calls.every(params => !Object.hasOwn(params, 'cwd'))).toBe(true)
    await expect(service.inspect('relative.txt')).rejects.toMatchObject({ code: 'unsafe-path' })
    const badHome = createWorkspaceFiles((params, options) => execute(params, options, { ...process.env, HOME: 'relative-home' }), { cwd })
    await expect(badHome.inspect('~/file')).rejects.toMatchObject({ code: 'unsafe-path', message: '无法确定远端用户的主目录。' })
  })

  test('rejects path controls, lone surrogates, oversized paths and invalid cwd before dispatch', async () => {
    let calls = 0
    const run: WorkspaceRun = async () => { calls++; throw new Error('must not run') }
    const service = createWorkspaceFiles(run, { cwd: '/remote' })
    for (const path of ['', 'x\0y', 'x\ny', 'x\ry', 'x\ty', 'x\x7fy', 'x\u0085y', 'x\ud800y', 'x'.repeat(4097), '文'.repeat(1400)]) {
      await expect(service.inspect(path)).rejects.toMatchObject({ code: 'unsafe-path' })
    }
    for (const cwd of ['relative', '/bad\npath', '/bad\0path', 'C:\\Windows']) expect(() => createWorkspaceFiles(run, { cwd })).toThrow()
    expect(calls).toBe(0)
  })

  test('never executes executable targets, workspace modules or Python startup hooks', async () => {
    const { cwd, service } = await fixture({ 'runnable.AppImage': '#!/bin/sh\ntouch EXECUTED\n', 'json.py': 'open("EXECUTED", "w").write("bad")', 'sitecustomize.py': 'open("EXECUTED", "w").write("bad")' })
    await chmod(join(cwd, 'runnable.AppImage'), 0o755)
    const file = await service.inspect('runnable.AppImage')
    expect(file.preview?.kind).toBe('text')
    await service.readChunk(file, 0)
    expect(await Bun.file(join(cwd, 'EXECUTED')).exists()).toBe(false)
    expect(await Bun.file(join(cwd, '__pycache__/json.pyc')).exists()).toBe(false)
  })

  test('follows file/directory symlinks and reports dangling symlinks as other entries', async () => {
    const { cwd, service } = await fixture({ 'folder/target': 'contents' })
    await symlink('folder/target', join(cwd, 'link'))
    await symlink('folder', join(cwd, 'dirlink'))
    await symlink('missing', join(cwd, 'broken'))
    expect((await service.inspect('link')).preview?.text).toBe('contents')
    expect((await service.inspect('dirlink')).entries).toEqual([{ name: 'target', path: join(cwd, 'dirlink/target'), kind: 'file', size: 8 }])
    const entries = (await service.inspect('.')).entries!
    expect(entries.find(entry => entry.name === 'broken')?.kind).toBe('other')
    await expect(service.inspect('broken')).rejects.toMatchObject({ code: 'read-failed' })
  })
})

function serviceRun(calls: Awaited<ReturnType<typeof fixture>>['calls']): WorkspaceRun {
  return async (params, options) => { const result = await execute(params, options); calls.push({ params, options, result }); return result }
}

describe('bounded directory and file previews', () => {
  test('returns at most 500 entries and marks overflow, but not an exactly full directory', async () => {
    const { cwd, service } = await fixture()
    expect(await service.inspect('.')).toMatchObject({ kind: 'directory', entries: [], truncated: false })
    await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(cwd, 'file-' + String(index).padStart(4, '0')), 'x')))
    const exact = await service.inspect('.')
    expect(exact.entries).toHaveLength(500); expect(exact.truncated).toBe(false)
    await mkdir(join(cwd, 'extra-directory'))
    const over = await service.inspect('.')
    expect(over.entries).toHaveLength(500); expect(over.truncated).toBe(true)
    expect(over.entries?.map(entry => entry.name)).toEqual(over.entries?.map(entry => entry.name).toSorted())
  })

  test('also caps serialized directory bytes for deeply nested Unicode paths', async () => {
    const { cwd, service, calls } = await fixture()
    const deep = join(cwd, ...Array.from({ length: 10 }, (_, index) => String(index) + '文'.repeat(60)))
    await mkdir(deep, { recursive: true })
    await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(deep, 'entry-' + index), '')))
    const directory = await service.inspect(deep)
    expect(directory.truncated).toBe(true)
    expect(directory.entries!.length).toBeGreaterThan(0)
    expect(directory.entries!.length).toBeLessThan(500)
    expect(Buffer.byteLength(calls[0]!.result.stdout)).toBeLessThanOrEqual(OUTPUT_BYTES)
  })

  test('omits unsafe entry names and marks the directory incomplete', async () => {
    const { service } = await fixture({ 'safe': 'yes', 'bad\nname': 'no' })
    const result = await service.inspect('.')
    expect(result.entries?.map(entry => entry.name)).toEqual(['safe'])
    expect(result.truncated).toBe(true)
  })

  test('caps text at 128 KiB on a UTF-8 boundary and preserves exact-size text', async () => {
    const prefix = 'a'.repeat(TEXT_BYTES - 1)
    const { service, calls } = await fixture({ 'long.txt': prefix + '😺尾巴', 'exact.txt': 'x'.repeat(TEXT_BYTES), 'escaped.txt': '"\t\\\n'.repeat(TEXT_BYTES / 4) })
    expect((await service.inspect('long.txt')).preview).toEqual({ kind: 'text', text: prefix, mime: 'text/plain', truncated: true })
    expect((await service.inspect('exact.txt')).preview).toEqual({ kind: 'text', text: 'x'.repeat(TEXT_BYTES), mime: 'text/plain', truncated: false })
    const escaped = await service.inspect('escaped.txt')
    expect(Buffer.byteLength(escaped.preview!.text!)).toBe(TEXT_BYTES)
    expect(calls.every(call => Buffer.byteLength(call.result.stdout) <= OUTPUT_BYTES)).toBe(true)
  })

  test('treats invalid UTF-8 and control bytes as binary, HTML as text and SVG as an image source', async () => {
    const files = { 'null.bin': Buffer.from([0, 1, 2]), 'invalid.bin': Buffer.from([255, 254]), 'ansi.txt': '\x1b[31mred', 'unfinished.txt': Buffer.from([0xe2, 0x82]), 'page.html': '<script>alert(1)</script>', 'icon.svg': '<svg onload="alert(1)"></svg>', 'pretend.png': '<html>not an image</html>' }
    const { service } = await fixture(files)
    for (const name of ['null.bin', 'invalid.bin', 'ansi.txt', 'unfinished.txt']) expect((await service.inspect(name)).preview).toEqual({ kind: 'binary' })
    for (const name of ['page.html', 'pretend.png']) expect((await service.inspect(name)).preview).toMatchObject({ kind: 'text', mime: 'text/plain' })
    expect((await service.inspect('icon.svg')).preview).toMatchObject({ kind: 'image', mime: 'image/svg+xml', dataBase64: Buffer.from(files['icon.svg']).toString('base64') })
  })

  test('only admits PNG/JPEG/GIF/WebP raster signatures and assembles their bytes through chunks', async () => {
    const files = { 'png.dat': png, 'jpeg.dat': Buffer.from([255, 216, 255, 224, 0, 0]), 'gif.dat': Buffer.from('GIF89a\0\0'), 'webp.dat': Buffer.from('RIFF\0\0\0\0WEBP\0') }
    const { service, calls } = await fixture(files)
    for (const [name, data] of Object.entries(files)) {
      const file = await service.inspect(name)
      expect(file.preview).toEqual({ kind: 'image', mime: 'image/' + name.split('.')[0], dataBase64: data.toString('base64') })
    }
    expect(calls.filter(call => (call.params.command as string[])[5] === 'chunk')).toHaveLength(4)
  })

  test('an 8 MiB image uses 32 bounded chunks; larger images receive no inline data', async () => {
    const exact = Buffer.alloc(IMAGE_BYTES); png.copy(exact)
    const large = Buffer.alloc(IMAGE_BYTES + 1); png.copy(large)
    const { service, calls } = await fixture({ 'exact.png': exact, 'large.png': large })
    const file = await service.inspect('exact.png')
    expect(Buffer.from(file.preview!.dataBase64!, 'base64')).toEqual(exact)
    expect(calls).toHaveLength(33)
    expect(calls.slice(1).map(call => (call.params.command as string[]).at(-1))).toEqual(Array.from({ length: 32 }, (_, index) => String(index * FILE_CHUNK_BYTES)))
    expect(calls.every(call => Buffer.byteLength(call.result.stdout) < OUTPUT_BYTES)).toBe(true)
    expect((await service.inspect('large.png')).preview).toEqual({ kind: 'binary' })
    expect(calls).toHaveLength(34)
  })
})

describe('exact-sized chunks and file identity', () => {
  test('reconstructs a multi-chunk binary, including the final short chunk and EOF', async () => {
    const bytes = Uint8Array.from({ length: 2 * FILE_CHUNK_BYTES + 17 }, (_, i) => i % 256)
    const { cwd, service } = await fixture({ 'binary.AppImage': bytes, 'empty': '' })
    const file = await service.inspect('binary.AppImage')
    expect(file.preview).toEqual({ kind: 'binary' })
    const s = await stat(join(cwd, 'binary.AppImage'), { bigint: true })
    expect(file.fingerprint).toBe([s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':'))
    const chunks = []
    for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) chunks.push(await service.readChunk(file, offset))
    expect(chunks.map(chunk => chunk.length)).toEqual([FILE_CHUNK_BYTES, FILE_CHUNK_BYTES, 17])
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes))
    expect(await service.readChunk(file, file.size)).toEqual(new Uint8Array())
    expect(await service.readChunk(file, 1)).toEqual(bytes.slice(1, FILE_CHUNK_BYTES + 1))
    const empty = await service.inspect('empty')
    expect(empty.preview).toMatchObject({ kind: 'text', text: '', truncated: false })
    expect(await service.readChunk(empty, 0)).toEqual(new Uint8Array())
  })

  test('supports sparse AppImages above 4 GiB without reading the entire file', async () => {
    const { cwd, service, calls } = await fixture()
    const length = 5 * 1024 ** 3 + 17, handle = await open(join(cwd, 'large.AppImage'), 'w')
    try { await handle.truncate(length); await handle.write(Buffer.from([127, 69, 76, 70, 0]), 0, 5, 0); await handle.write(Buffer.from('END'), 0, 3, length - 3) } finally { await handle.close() }
    const file = await service.inspect('large.AppImage')
    expect(file.size).toBe(length)
    expect(file.preview).toEqual({ kind: 'binary' })
    expect(calls).toHaveLength(1)
    expect(await service.readChunk(file, length - 3)).toEqual(new Uint8Array(Buffer.from('END')))
    expect(await service.readChunk(file, length)).toEqual(new Uint8Array())
  })

  test('rejects invalid offsets/descriptors locally and accepts exact EOF only after checking identity', async () => {
    const { cwd, service, calls } = await fixture({ 'file': 'bytes' })
    const file = await service.inspect('file'), before = calls.length
    for (const offset of [-1, 0.5, NaN, Infinity, file.size + 1, Number.MAX_SAFE_INTEGER + 1]) await expect(service.readChunk(file, offset)).rejects.toMatchObject({ code: 'invalid-offset' })
    for (const extra of [{ path: 'relative' }, { fingerprint: 'invalid' }, { size: -1 }, { size: 100 }]) await expect(service.readChunk({ ...file, ...extra }, 0)).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(service.readChunk({ ...file, kind: 'directory' }, 0)).rejects.toMatchObject({ code: 'not-regular-file' })
    expect(calls).toHaveLength(before)
    await writeFile(join(cwd, 'file'), 'modified')
    await expect(service.readChunk(file, file.size)).rejects.toMatchObject({ code: 'file-changed' })
  })

  test('detects size changes, mtime changes, same-size rewrites and inode replacement', async () => {
    const { cwd, service } = await fixture({ 'file': 'before' })
    for (const change of ['size', 'mtime', 'rewrite', 'replacement']) {
      await writeFile(join(cwd, 'file'), 'before')
      const file = await service.inspect('file')
      if (change === 'size') await writeFile(join(cwd, 'file'), 'longer than before')
      if (change === 'mtime') await utimes(join(cwd, 'file'), 1, 1)
      if (change === 'rewrite') await writeFile(join(cwd, 'file'), 'after!')
      if (change === 'replacement') { await writeFile(join(cwd, 'replacement'), 'before'); await rename(join(cwd, 'replacement'), join(cwd, 'file')) }
      await expect(service.readChunk(file, 0)).rejects.toMatchObject({ code: 'file-changed' })
    }
  })

  test('detects symlink retargeting between chunks', async () => {
    const { cwd, service } = await fixture({ 'one': 'same', 'two': 'same' })
    await symlink('one', join(cwd, 'link'))
    const file = await service.inspect('link')
    await unlink(join(cwd, 'link')); await symlink('two', join(cwd, 'link'))
    await expect(service.readChunk(file, 0)).rejects.toMatchObject({ code: 'file-changed' })
  })

  test('checks the opened descriptor and named path after a deterministic mid-read change', async () => {
    const { cwd, run, service } = await fixture({ 'file': 'original', 'replacement': 'original' })
    const file = await service.inspect('file')
    for (const mutation of ['replace', 'rewrite', 'remove']) {
      await writeFile(join(cwd, 'file'), 'original'); await writeFile(join(cwd, 'replacement'), 'original')
      const current = await service.inspect('file')
      const operation = mutation === 'replace' ? 'os.replace(os.path.join(os.path.dirname(sys.argv[3]), "replacement"), sys.argv[3])' : mutation === 'rewrite' ? 'with open(sys.argv[3], "r+b") as target: target.write(b"modified")' : 'os.unlink(sys.argv[3])'
      const prefix = 'import os, sys\nreal_read = os.read\nfired = False\ndef changed_read(fd, count):\n    global fired\n    data = real_read(fd, count)\n    if not fired:\n        fired = True\n        ' + operation + '\n    return data\nos.read = changed_read'
      await expect(createWorkspaceFiles(instrument(run, prefix), { cwd }).readChunk(current, 0)).rejects.toMatchObject({ code: 'file-changed' })
    }
    expect(file.size).toBe(8)
  })

  test('accumulates short OS reads and rejects unexpected EOF without returning partial chunks', async () => {
    const { cwd, run, service } = await fixture({ 'file': 'some bytes to read' })
    const file = await service.inspect('file')
    const short = instrument(run, 'import os\nreal_read = os.read\nos.read = lambda fd, count: real_read(fd, min(count, 3))')
    expect(await createWorkspaceFiles(short, { cwd }).readChunk(file, 0)).toEqual(new Uint8Array(Buffer.from('some bytes to read')))
    const eof = instrument(run, 'import os\nos.read = lambda fd, count: b""')
    await expect(createWorkspaceFiles(eof, { cwd }).readChunk(file, 0)).rejects.toMatchObject({ code: 'file-changed' })
  })

  test('refuses FIFOs/devices without blocking, including replacement just before open', async () => {
    const { cwd, run, service } = await fixture({ 'file': 'data' })
    const fifo = join(cwd, 'fifo')
    const made = await execute({ command: ['python3', '-I', '-S', '-c', 'import os, sys; os.mkfifo(sys.argv[1])', fifo] })
    expect(made.exitCode).toBe(0)
    expect((await service.inspect('.')).entries?.find(entry => entry.name === 'fifo')?.kind).toBe('other')
    for (const path of [fifo, '/dev/null']) {
      await expect(service.inspect(path)).rejects.toMatchObject({ code: 'not-regular-file' })
      await expect(service.readChunk({ ...descriptor(), path }, 0)).rejects.toMatchObject({ code: 'not-regular-file' })
    }
    const file = await service.inspect('file')
    const prefix = 'import os, sys\nreal_open = os.open\ndef replaced_open(path, flags):\n    if path == sys.argv[3]:\n        os.unlink(path)\n        os.mkfifo(path)\n    return real_open(path, flags)\nos.open = replaced_open'
    await expect(createWorkspaceFiles(instrument(run, prefix), { cwd }).readChunk(file, 0)).rejects.toMatchObject({ code: 'file-changed' })
  })
})

describe('cancellation and remote response validation', () => {
  test('passes the AbortSignal and refuses pre-aborted inspect/chunk without invoking run', async () => {
    const { service, calls } = await fixture({ 'file': 'data' })
    const signal = new AbortController().signal
    const file = await service.inspect('file', { signal })
    await service.readChunk(file, 0, { signal })
    expect(calls.every(call => call.options?.signal === signal)).toBe(true)
    const aborted = AbortSignal.abort(), before = calls.length
    await expect(service.inspect('file', { signal: aborted })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(service.readChunk(file, 0, { signal: aborted })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(before)
  })

  test('cancels promptly even when the transport has not settled, and ignores late responses', async () => {
    for (const operation of ['inspect', 'chunk']) {
      const controller = new AbortController()
      let finish!: (value: unknown) => void
      const service = createWorkspaceFiles(async (_params, options) => { expect(options?.signal).toBe(controller.signal); return new Promise(resolve => { finish = resolve }) }, { cwd: '/remote' })
      const pending = operation === 'inspect' ? service.inspect('/remote/file', { signal: controller.signal }) : service.readChunk(descriptor(), 0, { signal: controller.signal })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      finish(chunkReply(descriptor()))
    }
  })

  test('cancellation or modification during image assembly rejects the whole preview', async () => {
    const data = Buffer.alloc(FILE_CHUNK_BYTES + 1); png.copy(data)
    const { cwd, run } = await fixture({ 'image': data })
    for (const cancel of [true, false]) {
      await writeFile(join(cwd, 'image'), data)
      const controller = new AbortController()
      let chunks = 0
      const wrapped: WorkspaceRun = async (params, options) => {
        const result = await run(params, options)
        if ((params.command as string[])[5] === 'chunk' && ++chunks === 1) {
          if (cancel) controller.abort()
          else await writeFile(join(cwd, 'image'), 'changed')
        }
        return result
      }
      await expect(createWorkspaceFiles(wrapped, { cwd }).inspect('image', { signal: controller.signal })).rejects.toMatchObject(cancel ? { name: 'AbortError' } : { code: 'file-changed' })
      if (cancel) expect(chunks).toBe(1)
    }
  })

  test('rejects malformed command envelopes and JSON', async () => {
    for (const raw of [null, [], {}, { stdout: '' }, { exitCode: '0', stdout: '{}', stderr: '' }, { exitCode: NaN, stdout: '{}', stderr: '' }, { exitCode: 0, stdout: 1, stderr: '' }, { exitCode: 0, stdout: '{}', stderr: 0 }, { exitCode: 0, stdout: '{', stderr: '' }, { ...reply({ ok: true }), stdoutTruncated: 'false' }, ...[null, [], {}, { ok: 'yes' }, { ok: false }, { ok: false, code: 'bad', message: 3 }].map(reply)]) {
      const service = createWorkspaceFiles(async () => raw, { cwd: '/remote' })
      await expect(service.inspect('/remote/file')).rejects.toMatchObject({ code: 'invalid-response' })
    }
  })

  test('rejects truncated/oversized output by UTF-8 byte count, including stderr', async () => {
    for (const extra of [{ stdoutTruncated: true }, { stderrTruncated: true }, { stdout: 'x'.repeat(OUTPUT_BYTES + 1) }, { stdout: 'é'.repeat(OUTPUT_BYTES / 2 + 1) }, { stderr: 'x'.repeat(OUTPUT_BYTES + 1) }, { stdout: 'x'.repeat(OUTPUT_BYTES / 2), stderr: 'y'.repeat(OUTPUT_BYTES / 2 + 1) }]) {
      const service = createWorkspaceFiles(async () => ({ ...reply({ ok: true, file: descriptor() }), ...extra }), { cwd: '/remote' })
      await expect(service.inspect('/remote/file')).rejects.toMatchObject({ code: 'output-limit' })
      await expect(service.readChunk(descriptor(), 0)).rejects.toMatchObject({ code: 'output-limit' })
    }
  })

  test('validates file metadata, directory entry bounds and safe preview types', async () => {
    const directory = { ...descriptor(), kind: 'directory', preview: undefined, entries: [], truncated: false }
    const entry = { name: 'a', path: '/remote/file/a', kind: 'file', size: 1 }
    const bad = [
      { path: 'relative' }, { name: 'wrong' }, { kind: 'symlink' }, { kind: ['file'] }, { size: -1 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { fingerprint: 'wrong' }, { entries: [] },
      { preview: { kind: 'html', text: 'unsafe' } }, { preview: { kind: 'image', mime: 'image/svg+xml' } }, { preview: { kind: 'image', mime: 'text/html' } },
      { preview: { kind: 'binary', dataBase64: '/w==' } }, { preview: { kind: 'text', mime: 'text/plain', text: 'x'.repeat(TEXT_BYTES + 1), truncated: true } },
      { preview: { kind: 'text', mime: 'text/html', text: 'x', truncated: false } },
    ].map(extra => ({ ...descriptor(), ...extra }))
    bad.push(...[
      { entries: Array.from({ length: 501 }, () => entry) }, { entries: [entry, entry] }, { entries: [{ ...entry, path: '/outside' }] },
      { entries: [{ ...entry, name: '..' }] }, { entries: [{ ...entry, name: 'bad\nname' }] }, { truncated: 'false' },
      { entries: [{ ...entry, kind: ['file'] }] },
    ].map(extra => ({ ...directory, ...extra })) as WorkspaceFile[])
    for (const file of bad) await expect(createWorkspaceFiles(async () => reply({ ok: true, file }), { cwd: '/remote' }).inspect('/remote/file')).rejects.toMatchObject({ code: 'invalid-response' })
  })

  test('rejects wrong chunk identity/offset/size, short/long bytes, invalid or noncanonical base64', async () => {
    const file = descriptor()
    for (const extra of [{ path: '/wrong' }, { fingerprint: '1:9:1:3:4' }, { offset: 1 }, { size: 2 }, { dataBase64: '' }, { dataBase64: '//8=' }, { dataBase64: '!!!!' }, { dataBase64: '/x==' }, { dataBase64: null }, { dataBase64: ' /w==' }]) {
      await expect(createWorkspaceFiles(async () => chunkReply(file, extra), { cwd: '/remote' }).readChunk(file, 0)).rejects.toMatchObject({ code: 'invalid-response' })
    }
    expect(await createWorkspaceFiles(async () => chunkReply(file), { cwd: '/remote' }).readChunk(file, 0)).toEqual(new Uint8Array([255]))
  })

  test('keeps stable error codes while showing Chinese messages, including default cancellation', async () => {
    const { service } = await fixture({ 'file': 'data' })
    const file = await service.inspect('file')
    await expect(service.inspect('missing')).rejects.toMatchObject({ code: 'read-failed', message: '远端路径不存在或已被删除。' })
    await expect(service.readChunk(file, -1)).rejects.toMatchObject({ code: 'invalid-offset', message: '读取位置超出了文件范围。' })
    await expect(service.inspect('file', { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError', message: '已取消读取远端文件。' })
    await expect(createWorkspaceFiles(async () => null, { cwd: '' }).inspect('/file')).rejects.toMatchObject({ code: 'invalid-response', message: '远端文件读取命令返回了无效结果。' })
    await expect(createWorkspaceFiles(async () => ({ exitCode: 127, stdout: '', stderr: '' }), { cwd: '' }).inspect('/file')).rejects.toMatchObject({ code: 'dependency-missing', message: '远端设备需要安装可运行的 Python 3 才能读取文件。' })
    const controller = new AbortController(), reason = new Error('caller cancellation')
    controller.abort(reason)
    await expect(service.inspect('file', { signal: controller.signal })).rejects.toBe(reason)
  })

  test('reports missing Python, unsupported command/exec and command failures clearly', async () => {
    for (const code of [126, 127]) await expect(createWorkspaceFiles(async () => ({ exitCode: code, stdout: '', stderr: 'python3 not found' }), { cwd: '' }).inspect('/file')).rejects.toMatchObject({ code: 'dependency-missing' })
    for (const error of [new Error('spawn python3 ENOENT'), new Error('python3: No such file or directory')]) await expect(createWorkspaceFiles(async () => { throw error }, { cwd: '/remote' }).inspect('/file')).rejects.toThrow('Python 3')
    for (const error of [Object.assign(new Error('unavailable'), { code: -32601 }), new Error('Method not found'), new Error('command/exec is not supported')]) await expect(createWorkspaceFiles(async () => { throw error }, { cwd: '/remote' }).inspect('/file')).rejects.toMatchObject({ code: 'unsupported-api' })
    await expect(createWorkspaceFiles(async () => ({ exitCode: 124, stdout: '', stderr: 'timed out' }), { cwd: '/remote' }).inspect('/file')).rejects.toThrow('读取超时')
    const offline = new Error('device disconnected')
    await expect(createWorkspaceFiles(async () => { throw offline }, { cwd: '/remote' }).inspect('/file')).rejects.toBe(offline)
  })
})
