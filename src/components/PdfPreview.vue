<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
const props = defineProps<{ dataBase64: string; name: string }>()
const canvas = ref<HTMLCanvasElement>(), root = ref<HTMLElement>(), pageNumber = ref(1), count = ref(0), loading = ref(false), error = ref('')
const document = shallowRef<PDFDocumentProxy>()
let task: PDFDocumentLoadingTask | undefined, render: RenderTask | undefined, generation = 0, resize: ResizeObserver | undefined
async function draw() {
  const pdf = document.value, target = canvas.value
  if (!pdf || !target) return
  const mine = ++generation
  const previous = render
  previous?.cancel(); loading.value = true; error.value = ''
  try {
    if (previous) await previous.promise.catch(() => {})
    if (mine !== generation) return
    const page = await pdf.getPage(pageNumber.value)
    if (mine !== generation) return
    const original = page.getViewport({ scale: 1 })
    const width = Math.max(120, (root.value?.clientWidth || 600) - 16)
    const scale = Math.min(2, window.devicePixelRatio || 1) * Math.min(2, width / original.width)
    const viewport = page.getViewport({ scale })
    // Bound hostile page dimensions and total canvas memory.
    if (viewport.width * viewport.height > 16_000_000 || viewport.height > 16_000 || viewport.width > 16_000) throw new Error('页面尺寸过大，请下载原文件查看。')
    target.width = viewport.width; target.height = viewport.height
    render = page.render({ canvas: target, viewport })
    await render.promise
  } catch (cause) { if (mine === generation && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) error.value = cause instanceof Error ? cause.message : 'PDF 页面绘制失败。' }
  finally { if (mine === generation) loading.value = false }
}
function stop() { generation++; render?.cancel(); void task?.destroy().catch(() => {}); task = undefined; document.value = undefined }
watch(() => props.dataBase64, async data => {
  stop(); pageNumber.value = 1; count.value = 0; error.value = ''; loading.value = true
  const mine = generation
  try {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    if (mine !== generation) return
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
    const assets = import.meta.env.BASE_URL + 'vendor/pdfjs/'
    const pending = task = pdfjs.getDocument({ data: bytes, cMapUrl: assets + 'cmaps/', cMapPacked: true, standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', useSystemFonts: true, disableAutoFetch: true, enableXfa: false })
    pending.onPassword = () => { if (mine === generation) error.value = '此 PDF 需要密码，请下载原文件查看。'; void pending.destroy().catch(() => {}) }
    const pdf = await pending.promise
    if (mine !== generation) { return }
    document.value = pdf; count.value = pdf.numPages
    await nextTick(); await draw()
  } catch (cause) { if (mine === generation && !error.value) error.value = cause instanceof Error ? cause.message : 'PDF 无法打开。' }
  finally { if (mine === generation) loading.value = false }
}, { immediate: true })
watch(pageNumber, () => { void draw() })
onMounted(() => { resize = new ResizeObserver(() => { void draw() }); if (root.value) resize.observe(root.value) })
onBeforeUnmount(() => { resize?.disconnect(); stop() })
</script>
<template>
  <div ref="root" class="pdf-preview"><nav v-if="count" aria-label="PDF 翻页"><button type="button" class="text-button" :disabled="pageNumber <= 1" @click="pageNumber--">上一页</button><span>{{ pageNumber }} / {{ count }}</span><button type="button" class="text-button" :disabled="pageNumber >= count" @click="pageNumber++">下一页</button></nav><p v-if="error" role="alert">{{ error }}</p><p v-else-if="loading" role="status">正在加载 PDF…</p><canvas v-show="count && !error" ref="canvas" role="img" :aria-label="name + '，第 ' + pageNumber + ' 页'" /></div>
</template>
<style scoped>
.pdf-preview { min-width: 0; }
nav { display: flex; align-items: center; justify-content: center; gap: var(--space-3); margin-bottom: var(--space-3); }
canvas { display: block; max-width: 100%; height: auto; margin-inline: auto; background: white; }
p { color: var(--muted); overflow-wrap: anywhere; }
</style>
