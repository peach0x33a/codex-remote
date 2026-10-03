<script setup lang="ts">
import ValueSlider from './ValueSlider.vue'
import CustomSelect from './CustomSelect.vue'
import { ref, useId, watch } from 'vue'
import { PhImage } from '@phosphor-icons/vue'
import { defaultImageBackground, type BackgroundMode, type ImageBackgroundSettings } from '../lib/ui-preferences'
const props = defineProps<{ modelValue: BackgroundMode; imageSettings: ImageBackgroundSettings; src: string; remoteUrl: string; name: string; busy: boolean; error: string }>()
const emit = defineEmits<{ 'update:modelValue': [mode: BackgroundMode]; 'update:imageSettings': [value: ImageBackgroundSettings]; previewImageSettings: [value: ImageBackgroundSettings | null]; upload: [file: File]; useUrl: [url: string]; remove: [] }>()
const input = ref<HTMLInputElement>(), urlDraft = ref(''), urlId = useId()
watch(() => props.remoteUrl, value => { urlDraft.value = value }, { immediate: true })
const options: { value: BackgroundMode; label: string }[] = [{ value: 'animated', label: '动效背景' }, { value: 'image', label: '图片背景' }, { value: 'none', label: '纯色背景' }]
function select(mode: BackgroundMode) { emit('update:modelValue', mode) }
function picked(event: Event) { const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''; if (file) emit('upload', file) }
function adjust(key: 'opacity' | 'blur' | 'colorOpacity', value: number) { emit('update:imageSettings', { ...props.imageSettings, [key]: value }) }
function preview(key: 'opacity' | 'blur' | 'colorOpacity', value: number | null) { emit('previewImageSettings', value === null ? null : { ...props.imageSettings, [key]: value }) }
function tint(event: Event) { emit('update:imageSettings', { ...props.imageSettings, color: (event.target as HTMLInputElement).value }) }
</script>
<template>
  <div class="background-settings">
    <div class="display-heading"><strong>背景</strong><CustomSelect label="背景类型" :model-value="modelValue" :options="options" :disabled="busy" @update:model-value="select" /></div>
    <input ref="input" class="sr-only" type="file" tabindex="-1" aria-label="上传背景图片" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="picked" />
    <div v-if="modelValue === 'image' && src" class="background-preview"><img :src="src" alt="背景缩略图" referrerpolicy="no-referrer" /><span :title="name">{{ name }}</span><button type="button" class="text-button" :disabled="busy" @click="emit('remove')">移除</button></div>
    <button v-if="modelValue === 'image'" type="button" class="text-button background-upload" :disabled="busy" @click="input?.click()"><PhImage :size="16" />{{ busy ? '正在处理…' : src ? '更换背景图片' : '上传背景图片' }}</button>
    <form v-if="modelValue === 'image'" class="background-url" @submit.prevent="emit('useUrl', urlDraft)">
      <label :for="urlId">网络图片地址</label>
      <div><input :id="urlId" v-model="urlDraft" type="url" placeholder="https://example.com/background.jpg" maxlength="8192" autocomplete="off" spellcheck="false" :disabled="busy" /><button type="submit" class="button secondary" :disabled="busy || !urlDraft.trim()">使用图片地址</button></div>
    </form>
    <div v-if="modelValue === 'image' && src" class="background-adjustments" role="group" aria-label="图片背景设置">
      <ValueSlider label="图片不透明度" :min="0" :max="100" unit="%" :model-value="imageSettings.opacity" :disabled="busy" @preview="preview('opacity', $event)" @update:model-value="adjust('opacity', $event)" />
      <ValueSlider label="图片模糊度" :min="0" :max="32" unit="px" :model-value="imageSettings.blur" :disabled="busy" @preview="preview('blur', $event)" @update:model-value="adjust('blur', $event)" />
      <label class="background-color"><span>叠加颜色</span><code>{{ imageSettings.color }}</code><input type="color" :value="imageSettings.color" aria-label="背景叠加颜色" @input="tint" /></label>
      <ValueSlider label="背景颜色强度" :min="0" :max="100" unit="%" :model-value="imageSettings.colorOpacity" :disabled="busy" @preview="preview('colorOpacity', $event)" @update:model-value="adjust('colorOpacity', $event)" />
      <button type="button" class="text-button background-reset" @click="emit('update:imageSettings', defaultImageBackground())">重置图片效果</button>
    </div>
    <p v-if="modelValue === 'image' && error" class="background-error" role="alert">{{ error }}</p>
    <p v-if="modelValue === 'image'" class="background-note">上传 JPG、PNG、WebP，最大 20 MB；或填写 HTTP / HTTPS 图片地址。</p>
  </div>
</template>
<style scoped>
.background-preview { display: flex; align-items: center; gap: 8px; margin: 10px 8px 0; min-width: 0; }
.background-preview img { width: 48px; height: 36px; object-fit: cover; border-radius: var(--radius-sm); }
.background-preview > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.background-preview .text-button { flex-shrink: 0; font-size: calc(12px * var(--ui-font-scale, 1)); }
.background-upload { margin: 8px 10px 2px; font-size: calc(12px * var(--ui-font-scale, 1)); }
.background-url { display: grid; gap: 6px; margin: 12px 0; }
.background-url label { color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.background-url > div { display: flex; align-items: center; gap: 8px; }
.background-url input { min-width: 0; flex: 1; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); }
.background-url .button { flex-shrink: 0; min-height: 44px; padding-inline: 12px; }
@media (max-width: 560px) { .background-url > div { flex-wrap: wrap; }.background-url input { flex-basis: 100%; font-size: 16px; } }
.background-note, .background-error { margin: 4px 12px 10px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.7; }
.background-error { color: var(--danger); }
.background-adjustments { margin: 8px 10px 12px; padding-top: 10px; border-top: 1px solid var(--line-soft); display: grid; gap: 10px; }
.background-color { display: flex; gap: 8px; align-items: center; min-height: 32px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.background-color > span { margin-right: auto; }
.background-color code { color: var(--ink-soft); font-size: calc(11px * var(--ui-font-scale, 1)); }
.background-color input { width: 34px; height: 30px; padding: 3px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; }
.background-color input::-webkit-color-swatch-wrapper { padding: 0; }
.background-color input::-webkit-color-swatch { border: 0; border-radius: var(--radius-xs); }
.background-color input::-moz-color-swatch { border: 0; border-radius: var(--radius-xs); }
.background-reset { justify-self: start; font-size: calc(12px * var(--ui-font-scale, 1)); }
</style>
