import { describe, expect, test } from 'bun:test'
import { highlightCommand } from '../../src/lib/command-highlight'

const span = (kind: string, text: string) => '<span class="command-token-' + kind + '">' + text + '</span>'
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const stripTokens = (html: string) => html.replace(/<span class="command-token-(?:command|flag|string|variable|operator|comment|number)">|<\/span>/g, '')
function plainText(html: string) {
  return stripTokens(html).replace(/&(amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!)
}

describe('command highlighting without execution or HTML injection', () => {
  test('highlights commands, flags, strings, variables, operators, comments and numbers', () => {
    const command = 'git status --short -b && printf \'%s\\n\' "$HOME" | head -n 2 > out.log 2>&1 # note'
    const html = highlightCommand(command)
    for (const name of ['git', 'printf', 'head']) expect(html).toContain(span('command', name))
    for (const flag of ['--short', '-b', '-n']) expect(html).toContain(span('flag', flag))
    expect(html).toContain(span('string', '&#39;%s\\n&#39;'))
    expect(html).toContain(span('variable', '$HOME'))
    expect(html).toContain(span('operator', '&amp;&amp;'))
    expect(html).toContain(span('operator', '|'))
    expect(html).toContain(span('operator', '&gt;&amp;'))
    expect(html).toContain(span('number', '2'))
    expect(html).toContain(span('comment', '# note'))
    expect(plainText(html)).toBe(command)
  })

  test('does not mistake quoted or escaped operators and hashes within words for syntax', () => {
    const command = 'echo \'git --flag && $HOME # literal\' a\\|b https://host/#anchor \\$HOME "x \\" y"'
    const html = highlightCommand(command)
    expect(html).not.toContain('command-token-operator')
    expect(html).not.toContain('command-token-comment')
    expect(html).not.toContain('command-token-variable')
    expect(html).not.toContain(span('command', 'git'))
    expect(plainText(html)).toBe(command)
  })

  test('leaves heredoc bodies opaque and resumes after the exact delimiter', () => {
    const body = 'if n < 2:\n    print("$HOME && git --flag <script>alert(1)</script>")\n'
    const command = "python <<'PY'\n" + body + 'PY\nprintf done'
    const html = highlightCommand(command)
    expect(html).toContain(span('command', 'python'))
    expect(html).toContain(span('operator', '&lt;&lt;'))
    expect(html).toContain(escape(body) + 'PY\n' + span('command', 'printf'))
    expect(html).not.toContain('command-token-variable')
    expect(html).not.toContain('command-token-flag')
    expect(plainText(html)).toBe(command)
  })

  test('supports multiple, escaped and tab-stripped heredoc delimiters with CRLF', () => {
    const body = 'git --fake && $HOME\r\nONE\r\n\techo --fake | cat\r\n\tTWO\r\n'
    const command = 'cat <<O\\NE <<-"TWO"\r\n' + body + 'pwd'
    const html = highlightCommand(command)
    expect(html).toContain(escape(body) + span('command', 'pwd'))
    expect(html).not.toContain('command-token-flag')
    expect(plainText(html)).toBe(command)
  })

  test('escapes HTML in every context, including wrapper scripts and heredocs', () => {
    const payload = '<img src=x onerror="alert(1)"><script>throw 1</script>&lt;&#39;'
    for (const command of [payload, "echo '" + payload + "'", '# ' + payload, "/bin/zsh -lc 'echo \"" + payload + "\"'", 'cat <<EOF\n' + payload + '\nEOF']) {
      const html = highlightCommand(command)
      expect(stripTokens(html)).not.toMatch(/[<>]/)
      expect(plainText(html)).toBe(command)
      expect(stripTokens(html)).toContain('&amp;lt;&amp;#39;')
    }
  })

  test('preserves unknown or incomplete syntax, whitespace and Unicode exactly', () => {
    for (const command of ['', ' \t\r\n', 'echo 中文🙂', 'echo "unfinished', 'echo $' + '{unfinished', 'echo $(unfinished', 'echo trailing\\', "echo $'one\\'two'", '[[ -v X ]] && { echo hi; }', 'cat <<<"text"', 'echo \x60whoami\x60', 'echo # x\r\npwd']) {
      const html = highlightCommand(command)
      expect(plainText(html)).toBe(command)
      expect(stripTokens(html)).not.toMatch(/[<>]/)
    }
  })

  test('falls back to escaped original text for very large scripts', () => {
    const command = 'echo "<script>&amp;</script>" && '.repeat(4096)
    const html = highlightCommand(command)
    expect(html).toBe(escape(command))
    expect(plainText(html)).toBe(command)
    expect(html).not.toContain('<')
  })

  test('round-trips deterministic mixed syntax without arbitrary markup', () => {
    const alphabet = Array.from('ab09_ -\\\'"$\n\r\t<>&|;#(){}[]🙂')
    let seed = 37
    for (let sample = 0; sample < 100; sample++) {
      let command = ''
      for (let i = 0; i < 80; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; command += alphabet[seed % alphabet.length] }
      const html = highlightCommand(command)
      expect(plainText(html)).toBe(command)
      expect(stripTokens(html)).not.toMatch(/[<>]/)
    }
  })
})
