import { describe, expect, test } from 'bun:test'
import { parseAppOrigins } from '../../server/origins'

describe('APP_ORIGIN configuration', () => {
  test('preserves absent and single-origin configuration', () => {
    for (const value of [undefined, '', '  ']) expect(parseAppOrigins(value)).toEqual([])
    expect(parseAppOrigins('https://codex.example')).toEqual(['https://codex.example'])
    expect(parseAppOrigins(' HTTPS://Codex.Example:443/ ')).toEqual(['https://codex.example'])
  })

  test('normalizes a comma-separated LAN and HTTPS allowlist without losing distinct origins', () => {
    expect(parseAppOrigins(' http://192.168.2.71:3000/, https://phone.tailnet.ts.net, HTTPS://PHONE.TAILNET.TS.NET:443/, ')).toEqual([
      'http://192.168.2.71:3000', 'https://phone.tailnet.ts.net',
    ])
    expect(parseAppOrigins('http://localhost:3000, https://localhost:3000, http://localhost:3001, http://[::1]:3000')).toEqual([
      'http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001', 'http://[::1]:3000',
    ])
  })

  test('rejects malformed lists and non-origin URLs instead of broadening the allowlist', () => {
    for (const value of [
      ', ,', 'codex.example', 'null', '*', 'ws://codex.example', 'file:///tmp/app',
      'https://*.example', 'https://user:secret@codex.example', 'https://@codex.example',
      'https://codex.example/path', 'https://codex.example/path/..',
      'https://codex.example?token=secret', 'https://codex.example?', 'https://codex.example#',
      'https://codex.example/#section', 'https://codex.example:99999',
      'http://localhost:3000 https://codex.example', 'https://codex.example,not-a-url',
      'https://codex.example\\', 'https://codex.\nexample',
    ]) expect(() => parseAppOrigins(value)).toThrow('APP_ORIGIN')
  })
})
