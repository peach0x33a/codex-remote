<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { svgImageUrl } from '../lib/svg-preview'
const props = defineProps<{ code: string }>()
const src = ref(''), error = ref(''), loading = ref(false)
const id = 'mermaid-' + useId().replace(/[^a-z0-9_-]/gi, '')
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined
watch(() => props.code, code => {
  const mine = ++generation
  clearTimeout(timer); src.value = ''; error.value = ''; loading.value = true
  timer = setTimeout(async () => {
    try {
      if (code.length > 20_000) throw new Error('图表内容过长，请查看源码。')
      const { default: mermaid } = await import('mermaid')
      if (mine !== generation) return
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 20_000, maxEdges: 500, theme: 'neutral', htmlLabels: false, flowchart: { htmlLabels: false }, secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels'] })
      // Directives may otherwise change rendering settings or request remote resources.
      const safeCode = code.replace(/%%\{[\s\S]*?\}%%/g, '').replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
      const externalStyle = [...safeCode.matchAll(/url\(([^)]*)\)/gi)].some(match => !/^#[\w:.-]+$/.test(match[1]!.trim().replace(/^['"]|['"]$/g, '')))
      if (/(?:\bimg\s*:|<img\b|<image\b|@import)/i.test(safeCode) || externalStyle) throw new Error('图表包含嵌入图片或外部样式，请移除后重试。')
      const { svg } = await mermaid.render(id + '-' + mine, safeCode)
      if (mine === generation) src.value = svgImageUrl(svg, true)
    } catch (cause) { if (mine === generation) error.value = cause instanceof Error && cause.message.startsWith('图表') ? cause.message : '图表尚未完整或语法有误，可查看源码。' }
    finally { if (mine === generation) loading.value = false }
  }, 250)
}, { immediate: true })
onBeforeUnmount(() => { generation++; clearTimeout(timer) })
</script>
<template>
  <div class="mermaid-diagram"><img v-if="src" :src="src" alt="Mermaid 图表" /><p v-else role="status">{{ loading ? '正在绘制图表…' : error }}</p><details><summary>图表源码</summary><div class="markdown-code-block"><div class="markdown-code-header"><span>mermaid</span><button type="button" class="markdown-code-copy" aria-label="复制代码">复制</button></div><pre><code>{{ code }}</code></pre></div></details></div>
</template>
<style scoped>
.mermaid-diagram { margin-block: var(--space-4); min-width: 0; }
.mermaid-diagram > img { display: block; max-width: 100%; max-height: 70dvh; margin-inline: auto; background: #fff; border-radius: var(--radius-sm); }
.mermaid-diagram > p, summary { color: var(--muted); font-size: .875em; }
details { margin-top: var(--space-2); }
</style>
