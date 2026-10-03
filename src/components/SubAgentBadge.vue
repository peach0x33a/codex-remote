<script setup lang="ts">
import { PhRobot } from '@phosphor-icons/vue'
defineProps<{ name?: string; role?: string; compact?: boolean }>()
</script>
<template><span class="subagent-badge" :class="{ compact }" :title="['子代理会话', name, role].filter(Boolean).join(' · ')"><PhRobot :size="compact ? 13 : 15" aria-hidden="true" /><span>子代理</span></span></template>
<style scoped>
.subagent-badge { display: inline-flex; align-items: center; flex-shrink: 0; gap: 4px; min-height: 24px; padding: 2px 7px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.4; font-weight: 500; white-space: nowrap; }
.subagent-badge.compact { min-height: 20px; padding: 1px 4px; gap: 3px; font-size: calc(11px * var(--ui-font-scale, 1)); }
</style>
