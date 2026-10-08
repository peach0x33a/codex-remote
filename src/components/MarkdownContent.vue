<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '../lib/markdown'
import MarkdownImage from './MarkdownImage.vue'
import MermaidDiagram from './MermaidDiagram.vue'
import 'katex/dist/katex.min.css'
const props = defineProps<{ text: string; cwd?: string }>()
const html = computed(() => renderMarkdown(props.text))
const body = ref<HTMLElement>()
const images = ref<{ target: HTMLElement; src: string; name: string }[]>([])
const diagrams = ref<{ target: HTMLElement; code: string }[]>([])
watch([html, body], () => {
  images.value = Array.from(body.value?.querySelectorAll<HTMLElement>('[data-markdown-image]') || []).map(target => {
    const src = target.dataset.markdownImage || '', name = target.dataset.imageName || '图片'
    target.textContent = ''
    return { target, src, name }
  })
  diagrams.value = Array.from(body.value?.querySelectorAll<HTMLElement>('[data-markdown-diagram]') || []).map(target => ({ target, code: decodeURIComponent(target.dataset.markdownDiagram || '') }))
}, { flush: 'post' })
onBeforeUnmount(() => { images.value = []; diagrams.value = [] })
</script>
<template>
  <div class="markdown"><div ref="body" class="markdown-body" v-html="html" /><Teleport v-for="(image, index) in images" :key="'image-' + index" :to="image.target"><MarkdownImage :src="image.src" :name="image.name" :cwd="cwd" /></Teleport><Teleport v-for="(diagram, index) in diagrams" :key="'diagram-' + index" :to="diagram.target"><MermaidDiagram :code="diagram.code" /></Teleport></div>
</template>

<style>
.markdown > .markdown-body > :first-child { margin-top: 0; }
.markdown > .markdown-body > :last-child { margin-bottom: 0; }
.markdown .katex-display { max-width: 100%; overflow-x: auto; overflow-y: hidden; padding-block: 4px; }
.markdown .task-list-item { list-style: none; }
.markdown .task-list-item-checkbox { margin-inline-end: 6px; accent-color: var(--accent); }
</style>
