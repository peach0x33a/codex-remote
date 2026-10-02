export const sampleCode = 'if (value < 3 && ready) {\n\tconsole.log("你好", "<script>literal</script>");  \n}\n// ' + 'long-line-'.repeat(24) + '\n'
export const samplePlainCode = 'printf "第二段 & <文本>"\n'
export const sampleIndentedCode = 'indented code\n  keep spaces\n'
export const codeMarkdown = '行内 `inlineOnly`。\n\n```typescript\n' + sampleCode + '```\n\n~~~\n' + samplePlainCode + '~~~\n\n    indented code\n      keep spaces\n\n```text\n```\n'
