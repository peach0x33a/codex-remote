<script setup lang="ts">
import { ref } from 'vue'
import { PhSparkle, PhImage, PhSquare } from '@phosphor-icons/vue'
import { defaultImageBackground, type BackgroundMode, type ImageBackgroundSettings } from '../lib/ui-preferences'
const props = defineProps<{ modelValue: BackgroundMode; imageSettings: ImageBackgroundSettings; src: string; name: string; busy: boolean; error: string }>()
const emit = defineEmits<{ 'update:modelValue': [mode: BackgroundMode]; 'update:imageSettings': [value: ImageBackgroundSettings]; upload: [file: File]; remove: [] }>()
const input = ref<HTMLInputElement>()
const options = [{ value: 'animated' as const, label: '动效', icon: PhSparkle }, { value: 'image' as const, label: '图片', icon: PhImage }, { value: 'none' as const, label: '纯色', icon: PhSquare }]
function select(mode: BackgroundMode) { if (mode === 'image' && !props.src) input.value?.click(); else emit('update:modelValue', mode) }
function picked(event: Event) { const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''; if (file) emit('upload', file) }
function adjust(key: 'opacity' | 'blur' | 'colorOpacity', event: Event) { emit('update:imageSettings', { ...props.imageSettings, [key]: Number((event.target as HTMLInputElement).value) }) }
function tint(event: Event) { emit('update:imageSettings', { ...props.imageSettings, color: (event.target as HTMLInputElement).value }) }
</script>
<template>
  <div class="background-settings">
    <div class="display-heading"><strong>背景</strong></div>
    <div class="background-options" role="menu" aria-label="背景类型"><button v-for="option in options" :key="option.value" type="button" class="background-option" role="menuitemradio" :aria-label="option.label + '背景'" :aria-checked="modelValue === option.value" :disabled="busy" @click="select(option.value)"><component :is="option.icon" :size="19" /><span>{{ option.label }}</span></button></div>
    <input ref="input" class="sr-only" type="file" tabindex="-1" aria-label="上传背景图片" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="picked" />
    <div v-if="src" class="background-preview"><img :src="src" alt="背景缩略图" /><span :title="name">{{ name }}</span><button type="button" class="text-button" :disabled="busy" @click="emit('remove')">移除</button></div>
    <button type="button" class="text-button background-upload" :disabled="busy" @click="input?.click()"><PhImage :size="16" />{{ busy ? '正在处理…' : src ? '更换背景图片' : '上传背景图片' }}</button>
    <div v-if="modelValue === 'image' && src" class="background-adjustments" role="group" aria-label="图片背景设置">
      <label class="background-range"><span>不透明度<output>{{ imageSettings.opacity }}%</output></span><input type="range" min="0" max="100" step="1" :value="imageSettings.opacity" aria-label="图片不透明度" :aria-valuetext="imageSettings.opacity + '%'" @input="adjust('opacity', $event)" /></label>
      <label class="background-range"><span>模糊<output>{{ imageSettings.blur }} px</output></span><input type="range" min="0" max="32" step="1" :value="imageSettings.blur" aria-label="图片模糊度" :aria-valuetext="imageSettings.blur + ' px'" @input="adjust('blur', $event)" /></label>
      <label class="background-color"><span>叠加颜色</span><code>{{ imageSettings.color }}</code><input type="color" :value="imageSettings.color" aria-label="背景叠加颜色" @input="tint" /></label>
      <label class="background-range"><span>颜色强度<output>{{ imageSettings.colorOpacity }}%</output></span><input type="range" min="0" max="100" step="1" :value="imageSettings.colorOpacity" aria-label="背景颜色强度" :aria-valuetext="imageSettings.colorOpacity + '%'" @input="adjust('colorOpacity', $event)" /></label>
      <button type="button" class="text-button background-reset" @click="emit('update:imageSettings', defaultImageBackground())">重置图片效果</button>
    </div>
    <p v-if="error" class="background-error" role="alert">{{ error }}</p>
    <p class="background-note">JPG、PNG、WebP · 最大 20 MB<br />图片仅保存在当前浏览器。</p>
  </div>
</template>
<style scoped>
.background-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0 6px; }
.background-option { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px; min-height: 60px; border-radius: var(--radius-md); color: var(--muted); font-size: 12px; transition: background-color 160ms ease, color 160ms ease; }
.background-option:hover:not(:disabled) { background: var(--hover); }
.background-option[aria-checked="true"] { background: var(--accent-soft); color: var(--accent); }
.background-preview { display: flex; align-items: center; gap: 8px; margin: 10px 8px 0; min-width: 0; }
.background-preview img { width: 48px; height: 36px; object-fit: cover; border-radius: var(--radius-sm); }
.background-preview > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.background-preview .text-button { flex-shrink: 0; font-size: 12px; }
.background-upload { margin: 8px 10px 2px; font-size: 12px; }
.background-note, .background-error { margin: 4px 12px 10px; color: var(--muted); font-size: 11px; line-height: 1.7; }
.background-error { color: var(--danger); }
.background-adjustments { margin: 8px 10px 12px; padding-top: 10px; border-top: 1px solid var(--line-soft); display: grid; gap: 10px; }
.background-range { display: grid; gap: 2px; color: var(--muted); font-size: 12px; }
.background-range > span { display: flex; align-items: center; justify-content: space-between; }
.background-range output { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.background-range input { width: 100%; height: 28px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.background-color { display: flex; gap: 8px; align-items: center; min-height: 32px; color: var(--muted); font-size: 12px; }
.background-color > span { margin-right: auto; }
.background-color code { color: var(--ink-soft); font-size: 11px; }
.background-color input { width: 34px; height: 30px; padding: 3px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; }
.background-color input::-webkit-color-swatch-wrapper { padding: 0; }
.background-color input::-webkit-color-swatch { border: 0; border-radius: var(--radius-xs); }
.background-color input::-moz-color-swatch { border: 0; border-radius: var(--radius-xs); }
.background-reset { justify-self: start; font-size: 12px; }
</style>
