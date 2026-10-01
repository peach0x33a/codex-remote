import { expect, test } from 'bun:test'
import { deviceDirectory, prepareDeviceDirectory } from '../../src/lib/working-directory'
import { RpcError } from '../../src/lib/rpc'

test('defaults a missing/blank device directory to ~/codex-remote', () => {
  for (const value of [undefined, '', '  ']) expect(deviceDirectory(value)).toBe('~/codex-remote')
  expect(deviceDirectory(' /projects/example ')).toBe('/projects/example')
})
test('resolves home from an existing root and creates the directory through the remote filesystem API', async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  expect(await prepareDeviceDirectory('', async (method, params) => {
    calls.push({ method, params })
    return method === 'command/exec' ? { exitCode: 0, stdout: '/remote-user/codex-remote' } : {}
  })).toBe('/remote-user/codex-remote')
  expect(calls[0]!.params.cwd).toBe('/')
  expect((calls[0]!.params.command as string[]).at(-1)).toBe('~/codex-remote')
  expect(calls[1]).toEqual({ method: 'fs/createDirectory', params: { path: '/remote-user/codex-remote', recursive: true } })
  const absoluteCalls: unknown[] = []
  expect(await prepareDeviceDirectory('/work', async (method, params) => { absoluteCalls.push({ method, params }); return {} })).toBe('/work')
  expect(absoluteCalls).toEqual([{ method: 'fs/createDirectory', params: { path: '/work', recursive: true } }])
})
test('falls back for old POSIX servers without evaluating path text or using the missing directory as cwd', async () => {
  const literal = '/folder $(touch /tmp/unwanted)'
  expect(await prepareDeviceDirectory(literal, async (method, params) => {
    if (method === 'fs/createDirectory') throw new RpcError('Unknown method', -32601)
    expect(params.cwd).toBe('/')
    const command = params.command as string[]
    expect(command.at(-1)).toBe(literal); expect(command[2]).not.toContain(literal)
    expect(command[2]).toContain('mkdir -p')
    return { exitCode: 0, stdout: literal }
  })).toBe(literal)
})
test('propagates permission failures without a bypass and rejects invalid home resolution', async () => {
  const denied = new RpcError('Permission denied', -32603), methods: string[] = []
  await expect(prepareDeviceDirectory('/protected', async method => { methods.push(method); throw denied })).rejects.toBe(denied)
  expect(methods).toEqual(['fs/createDirectory'])
  await expect(prepareDeviceDirectory('/work', async () => null)).rejects.toThrow('未确认')
  for (const result of [{ exitCode: 1, stdout: '' }, { exitCode: 0, stdout: 'relative' }, { exitCode: 0, stdout: '/path\nextra' }]) {
    await expect(prepareDeviceDirectory('', async () => result)).rejects.toThrow('默认工作目录')
  }
})
