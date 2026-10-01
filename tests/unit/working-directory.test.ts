import { expect, test } from 'bun:test'
import { deviceDirectory, resolveDeviceDirectory } from '../../src/lib/working-directory'

test('defaults a missing/blank device directory to ~/codex-remote', () => {
  for (const value of [undefined, '', '  ']) expect(deviceDirectory(value)).toBe('~/codex-remote')
  expect(deviceDirectory(' /projects/example ')).toBe('/projects/example')
})
test('keeps absolute directories and resolves home on the connected device', async () => {
  expect(await resolveDeviceDirectory('/work', async () => { throw new Error('unexpected command') })).toBe('/work')
  const calls: Record<string, unknown>[] = []
  expect(await resolveDeviceDirectory('', async params => { calls.push(params); return { exitCode: 0, stdout: '/remote-user/codex-remote' } })).toBe('/remote-user/codex-remote')
  expect((calls[0]!.command as string[]).at(-1)).toBe('~/codex-remote')
  expect(calls[0]).not.toHaveProperty('cwd')
  const literal = '~/folder $(touch /tmp/unwanted)'
  await resolveDeviceDirectory(literal, async params => {
    expect((params.command as string[]).at(-1)).toBe(literal)
    expect((params.command as string[])[2]).not.toContain(literal)
    return { exitCode: 0, stdout: '/remote-user/folder $(touch /tmp/unwanted)' }
  })
})
test('reports directory preparation failures rather than silently using a different directory', async () => {
  for (const result of [{ exitCode: 1, stdout: '' }, { exitCode: 0, stdout: 'relative' }, { exitCode: 0, stdout: '/path\nextra' }]) {
    await expect(resolveDeviceDirectory('', async () => result)).rejects.toThrow('默认工作目录')
  }
})
