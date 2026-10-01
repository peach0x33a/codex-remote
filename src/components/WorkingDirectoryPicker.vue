<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowLeft, PhCheck, PhFolder, PhMagnifyingGlass, PhPlus, PhX } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
const props = defineProps<{ modelValue: string; directories: string[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [path: string] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>()
defineExpose({ show: () => popover.value?.show() })
const query = ref(''), path = ref(''), adding = ref(false)
const basename = (value: string) => value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value
function isAbsolute(value: string) { return !!value && ![...value].some(c => c.charCodeAt(0) < 32) && (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)) }
const known = computed(() => [...new Set([props.modelValue, ...props.directories].filter(Boolean))].filter(value => value.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
function opened(value: boolean) { if (value) { adding.value = false; query.value = ''; path.value = '' } }
function choose(value: string) { if (props.disabled || value && !isAbsolute(value)) return; emit('update:modelValue', value); popover.value?.hide() }
async function showAdd() { adding.value = true; await popover.value?.focusInitial() }
async function back() { adding.value = false; await popover.value?.focusInitial() }
</script>
<template>
  <ComposerPopover ref="popover" label="工作目录" trigger-class="working-directory-trigger" panel-class="project-picker-menu" :width="320" :disabled="disabled" @change="opened">
    <template #trigger><span class="directory-trigger-content" :title="modelValue || '不在项目中工作'"><PhFolder :size="16" role="img" :aria-label="modelValue || '不在项目中工作'" /><span class="directory-trigger-name">{{ modelValue ? basename(modelValue) : '不在项目中工作' }}</span></span></template>
    <template v-if="!adding"><label class="project-search"><PhMagnifyingGlass :size="16" /><input v-model="query" data-initial-focus aria-label="搜索项目" placeholder="搜索项目" autocomplete="off" /></label><div class="project-options" role="menu" aria-label="项目列表"><button v-for="directory in known" :key="directory" type="button" class="composer-menu-item project-option" role="menuitemradio" :aria-checked="modelValue === directory" :title="directory" @click="choose(directory)"><PhFolder :size="17" /><span>{{ basename(directory) }}</span><PhCheck v-if="modelValue === directory" :size="17" /></button><p v-if="!known.length" class="picker-empty">{{ query ? '没有匹配的项目' : '暂无项目' }}</p></div><div class="menu-separator" /><div role="menu" aria-label="项目操作"><button type="button" class="composer-menu-item" role="menuitem" @click="showAdd"><PhPlus :size="18" /><span>添加项目</span></button><button type="button" class="composer-menu-item" role="menuitem" title="不指定项目，使用服务器默认工作目录" @click="choose('')"><PhX :size="17" /><span>不在项目中工作</span></button></div></template>
    <form v-else class="project-add-form" @submit.prevent="choose(path.trim())"><div class="project-add-heading"><button type="button" class="icon-button small" aria-label="返回项目列表" @click="back"><PhArrowLeft :size="17" /></button><span>添加项目</span></div><label>工作目录路径<input v-model="path" data-initial-focus aria-label="工作目录路径" placeholder="/home/me/project" autocomplete="off" spellcheck="false" /></label><button type="submit" class="button primary" :disabled="!isAbsolute(path.trim())">使用此目录</button></form>
  </ComposerPopover>
</template>
<style scoped>
.directory-trigger-content { display: inline-flex; align-items: center; gap: inherit; min-width: 0; max-width: 100%; }
.directory-trigger-content > svg { flex-shrink: 0; }
.directory-trigger-name { max-width: min(240px, 55vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-search { margin: 0 6px 7px; padding: 9px 4px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; }
.project-search input { border: 0; padding: 0; box-shadow: none; min-height: 26px; background: transparent; color: var(--ink); outline: none; }
.project-option { min-height: 36px; padding: 7px 9px; border-radius: var(--radius-md); font-size: calc(14px * var(--ui-font-scale, 1)); }
.project-option > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-option[aria-checked="true"] { background: var(--hover); }
.project-options { max-height: min(280px, 40dvh); }
.project-add-form { display: grid; gap: 14px; padding: 5px 8px 8px; }
.project-add-heading { display: flex; align-items: center; gap: 6px; font-size: calc(14px * var(--ui-font-scale, 1)); }
.project-add-form label { display: grid; gap: 8px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.project-add-form input { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--canvas); color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); }
@media (pointer: coarse) { .project-option { min-height: 42px; }.project-add-form input { font-size: calc(16px * var(--ui-font-scale, 1)); } }
</style>
