<script setup lang="ts">
import { computed } from 'vue'
import { PhGitBranch, PhGitFork } from '@phosphor-icons/vue'
import { describeGitContext, type GitContext } from '../lib/git-context'
const props = defineProps<{ context: GitContext | null }>()
const info = computed(() => props.context ? describeGitContext(props.context) : null)
</script>
<template>
  <span v-if="info" class="workspace-badge" :class="{ 'is-linked': info.linked }" role="status" :aria-label="info.title" :title="info.title">
    <PhGitFork v-if="info.linked" :size="15" aria-hidden="true" /><PhGitBranch v-else :size="15" aria-hidden="true" />
    <span class="workspace-badge-text">{{ info.text }}</span>
  </span>
</template>
<style scoped>
.workspace-badge { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; height: 36px; padding: 0 8px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); white-space: nowrap; }
.workspace-badge svg { flex-shrink: 0; }
.workspace-badge.is-linked { color: var(--accent); }
.workspace-badge-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 600px) { .workspace-badge { padding: 0 4px; font-size: calc(12px * var(--ui-font-scale, 1)); } }
</style>
