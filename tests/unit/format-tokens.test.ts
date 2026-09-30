import { describe, expect, test } from 'bun:test'
import { formatTokenCount } from '../../src/lib/format-tokens'

describe('context token display', () => {
  test('uses K and M without changing the reported capacity', () => {
    expect(formatTokenCount(229_000) + ' / ' + formatTokenCount(258_000)).toBe('229K / 258K')
    expect(formatTokenCount(272_000) + ' / ' + formatTokenCount(1_000_000)).toBe('272K / 1M')
    expect(formatTokenCount(19_100)).toBe('19.1K')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })
  test('keeps small counts and promotes rounded unit boundaries', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1_000)).toBe('1K')
    expect(formatTokenCount(999_950)).toBe('1M')
  })
  test('does not manufacture unknown usage', () => {
    for (const value of [undefined, null, NaN, Infinity, -1]) expect(formatTokenCount(value)).toBe('—')
  })
})
