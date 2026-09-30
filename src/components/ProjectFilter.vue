<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCheck, PhFolderSimple, PhFunnel, PhMagnifyingGlass } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
const props = defineProps<{ modelValue: string; projects: string[]; loading?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const search = ref('')
const choices = computed(() => props.projects.filter(path => path.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
const name = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path
</script>
<template>
  <ComposerPopover label="按项目筛选" placement="bottom" trigger-class="project-filter-trigger" :width="320" :disabled="disabled">
    <template #trigger><PhFunnel :size="16" :weight="modelValue ? 'fill' : 'regular'" /><span v-if="modelValue" class="project-filter-name">{{ name(modelValue) }}</span></template>
    <template #default="{ close }"><div class="device-menu-heading">按项目筛选</div><label class="project-search"><PhMagnifyingGlass :size="16" /><input v-model="search" aria-label="搜索项目" placeholder="搜索项目或路径" /></label><div class="project-options" role="menu" aria-label="项目列表"><button type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="!modelValue" @click="emit('update:modelValue', ''); close()"><PhFolderSimple :size="17" /><span>全部项目</span><PhCheck v-if="!modelValue" :size="16" /></button><div class="menu-separator" /><button v-for="path in choices" :key="path" type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="modelValue === path" @click="emit('update:modelValue', path); close()"><PhFolderSimple :size="17" /><span><strong>{{ name(path) }}</strong><small>{{ path }}</small></span><PhCheck v-if="modelValue === path" :size="16" /></button></div><p v-if="loading" class="picker-empty">正在读取项目…</p><p v-else-if="!choices.length" class="picker-empty">{{ search ? '没有匹配的项目' : '暂无项目记录' }}</p></template>
  </ComposerPopover>
</template>
