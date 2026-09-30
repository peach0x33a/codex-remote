type Token = 'command' | 'flag' | 'string' | 'variable' | 'operator' | 'comment' | 'number'
type HereDoc = { delimiter: string; tabs: boolean }
const maxHighlightLength = 32_768, maxShellDepth = 3
const operators = [';;&', '&>>', '<<<', '<<-', '&&', '||', '|&', '>>', '<<', '<&', '>&', '<>', '>|', ';;', ';&', '&>', '|', '&', ';', '(', ')', '<', '>']
const numeric = /^[+-]?(?:0x[\da-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const token = (kind: Token | undefined, text: string) => kind ? '<span class="command-token-' + kind + '">' + escapeHtml(text) + '</span>' : escapeHtml(text)
const operatorAt = (text: string, index: number) => operators.find(operator => text.startsWith(operator, index))

function quoteEnd(text: string, start: number, ansi = false): number {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\' && (quote !== "'" || ansi)) i++
    else if (text[i] === quote) return i + 1
  }
  return text.length
}

// Expansions remain opaque. This is highlighting, never shell evaluation.
function variableEnd(text: string, start: number): number {
  if (text[start] === '`') return quoteEnd(text, start)
  if (text[start] !== '$') return start
  const open = text[start + 1]
  if (open === '{' || open === '(') {
    const close = open === '{' ? '}' : ')'
    let depth = 1
    for (let i = start + 2; i < text.length; i++) {
      if (text[i] === '\\') i++
      else if (text[i] === "'" || text[i] === '"' || text[i] === '`') i = quoteEnd(text, i) - 1
      else if (text[i] === open) depth++
      else if (text[i] === close && --depth === 0) return i + 1
    }
    return text.length
  }
  return start + (text.slice(start).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[?#!$*@-])/)?.[0].length ?? 0)
}

function wordEnd(text: string, start: number): number {
  let i = start
  while (i < text.length && !/\s/.test(text[i]!) && !operatorAt(text, i)) {
    if (text[i] === '\\') i = Math.min(i + 2, text.length)
    else if (text[i] === '$' && text[i + 1] === "'") i = quoteEnd(text, i + 1, true)
    else if (text[i] === "'" || text[i] === '"') i = quoteEnd(text, i)
    else { const end = variableEnd(text, i); i = end > i ? end : i + 1 }
  }
  return i
}

function quoted(text: string): string {
  if (text[0] !== '"') return token('string', text)
  const out: string[] = []
  let plain = 0
  for (let i = 1; i < text.length;) {
    if (text[i] === '\\') { i += 2; continue }
    const end = variableEnd(text, i)
    if (end > i) {
      if (i > plain) out.push(token('string', text.slice(plain, i)))
      out.push(token('variable', text.slice(i, end))); i = end; plain = i
    } else i++
  }
  if (plain < text.length) out.push(token('string', text.slice(plain)))
  return out.join('')
}

function word(text: string, kind?: Token): string {
  const out: string[] = []
  let plain = 0
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') { i += 2; continue }
    let end = i, html: string | undefined
    if (text[i] === '$' && text[i + 1] === "'") { end = quoteEnd(text, i + 1, true); html = token('string', text.slice(i, end)) }
    else if (text[i] === "'" || text[i] === '"') { end = quoteEnd(text, i); html = quoted(text.slice(i, end)) }
    else { end = variableEnd(text, i); if (end > i) html = token('variable', text.slice(i, end)) }
    if (html !== undefined) {
      if (i > plain) out.push(token(kind, text.slice(plain, i)))
      out.push(html); i = end; plain = i
    } else i++
  }
  if (plain < text.length) out.push(token(kind, text.slice(plain)))
  return out.join('')
}

function delimiter(text: string): string {
  let result = '', quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === quote) quote = ''
    else if (!quote && (char === "'" || char === '"')) quote = char
    else if (char === '\\' && quote !== "'" && i + 1 < text.length && (!quote || /[$\x60"\\\n]/.test(text[i + 1]!))) {
      const next = text[++i]!
      if (next !== '\n') result += next
    } else result += char
  }
  return result
}

function shell(text: string, depth: number): string {
  const out: string[] = [], hereDocs: HereDoc[] = []
  let i = 0, command = true, shellCommand = false, script = false, redirect = ''
  while (i < text.length) {
    if (text[i] === '\\' && (text[i + 1] === '\n' || text.slice(i + 1, i + 3) === '\r\n')) {
      const end = i + (text[i + 1] === '\n' ? 2 : 3)
      out.push(escapeHtml(text.slice(i, end))); i = end; continue
    }
    if (/\s/.test(text[i]!)) {
      const char = text[i++]!
      out.push(escapeHtml(char))
      if (char !== '\n') continue
      command = true; shellCommand = false; script = false; redirect = ''
      // No shell tokens inside heredocs, including embedded Python/JS/HTML.
      for (const doc of hereDocs.splice(0)) {
        const start = i
        while (i < text.length) {
          const newline = text.indexOf('\n', i), end = newline < 0 ? text.length : newline
          const line = text.slice(i, end).replace(/\r$/, '')
          const matches = (doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delimiter
          i = newline < 0 ? end : end + 1
          if (matches) break
        }
        out.push(escapeHtml(text.slice(start, i)))
      }
      continue
    }
    if (text[i] === '#') {
      const newline = text.indexOf('\n', i), end = newline < 0 ? text.length : newline
      out.push(token('comment', text.slice(i, end))); i = end; continue
    }
    const operator = operatorAt(text, i)
    if (operator) {
      out.push(token('operator', operator)); i += operator.length
      if (/[<>]/.test(operator)) redirect = operator
      else { command = true; shellCommand = false; script = false; redirect = '' }
      continue
    }
    const end = wordEnd(text, i), raw = text.slice(i, end)
    if (redirect) {
      if (redirect === '<<' || redirect === '<<-') {
        hereDocs.push({ delimiter: delimiter(raw), tabs: redirect === '<<-' }); out.push(token('string', raw))
      } else out.push(word(raw, numeric.test(raw) ? 'number' : undefined))
      redirect = ''
    } else if (script && depth < maxShellDepth) {
      const quote = raw[0]
      if ((quote === "'" || quote === '"') && raw.length >= 2 && raw.endsWith(quote) && quoteEnd(raw, 0) === raw.length) {
        out.push(token('string', quote), shell(raw.slice(1, -1), depth + 1), token('string', quote))
      } else out.push(word(raw, 'command'))
      script = false; shellCommand = false
    } else if (/^\d+$/.test(raw) && /[<>]/.test(text[end] ?? '')) {
      out.push(token('number', raw))
    } else if (command && /^[A-Za-z_][A-Za-z_0-9]*=/.test(raw)) {
      const equal = raw.indexOf('=')
      out.push(token('variable', raw.slice(0, equal)), token('operator', '='), word(raw.slice(equal + 1)))
    } else {
      const kind: Token | undefined = command ? 'command' : numeric.test(raw) ? 'number' : /^--?(?:[A-Za-z_]|$)/.test(raw) ? 'flag' : undefined
      out.push(word(raw, kind))
      if (command) shellCommand = /^(?:.*\/)?(?:ba|da|k|z)?sh$/.test(raw)
      else if (shellCommand && /^-[A-Za-z]*c[A-Za-z]*$/.test(raw)) script = true
      else if (shellCommand && !raw.startsWith('-')) shellCommand = false
      command = false
    }
    i = end
  }
  return out.join('')
}

/** Pure, lossless shell display markup. All input is escaped; class names are fixed. */
export function highlightCommand(command: string): string {
  // Bound work and markup growth for generated scripts; retain all original text.
  return command.length > maxHighlightLength ? escapeHtml(command) : shell(command, 0)
}
