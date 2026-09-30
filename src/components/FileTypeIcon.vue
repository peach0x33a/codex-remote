<script setup lang="ts">
import { computed } from 'vue'
import { PhBracketsCurly, PhFileCode, PhFileText } from '@phosphor-icons/vue'
const props = withDefaults(defineProps<{ path: string; size?: number }>(), { size: 16 })
const extension = computed(() => props.path.split('.').at(-1)?.toLowerCase())
</script>
<template>
  <svg v-if="extension === 'vue'" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true"><path fill="#42b883" d="M1 3h5l6 10L18 3h5L12 22Z"/><path fill="#35495e" d="M6 3h4l2 3 2-3h4l-6 10Z"/></svg>
  <svg v-else-if="['ts', 'tsx', 'js', 'jsx'].includes(extension || '')" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true"><rect width="22" height="22" x="1" y="1" rx="4" :fill="extension?.startsWith('t') ? '#3178c6' : '#f0c83c'"/><text x="12" y="17" text-anchor="middle" :fill="extension?.startsWith('t') ? 'white' : '#272727'" font-size="12" font-family="sans-serif" font-weight="700">{{ extension?.startsWith('t') ? 'TS' : 'JS' }}</text></svg>
  <PhBracketsCurly v-else-if="['json', 'jsonc', 'yaml', 'yml'].includes(extension || '')" :size="size" aria-hidden="true" />
  <PhFileText v-else-if="['md', 'txt', 'mdx'].includes(extension || '')" :size="size" aria-hidden="true" />
  <PhFileCode v-else :size="size" aria-hidden="true" />
</template>
