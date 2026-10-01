<script setup lang="ts">
import { ref } from 'vue'
import { PhArchive, PhArrowSquareOut, PhCaretLeft, PhCaretRight, PhChats, PhClock, PhCopy, PhDotsThree, PhGitBranch, PhPencilSimple, PhPushPin } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
const props = defineProps<{ disabled?: boolean; connected: boolean; pinned: boolean; canCopy: boolean; hasCompletedTurn: boolean }>()
const emit = defineEmits<{ rename: []; pin: []; side: []; fork: [completedOnly: boolean]; copy: [all: boolean]; openWindow: []; archive: [] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>(), page = ref<'main' | 'copy' | 'fork'>('main')
function run(action: 'rename' | 'pin' | 'side' | 'openWindow' | 'archive') {
  if (props.disabled) return
  popover.value?.hide()
  const actions = { rename: () => emit('rename'), pin: () => emit('pin'), side: () => emit('side'), openWindow: () => emit('openWindow'), archive: () => emit('archive') }
  actions[action]()
}
async function submenu(value: 'main' | 'copy' | 'fork') { page.value = value; await popover.value?.focusInitial() }

</script>
<template>
  <ComposerPopover ref="popover" label="会话操作" trigger-class="conversation-actions-trigger" placement="bottom" align="end" :width="268" :disabled="disabled" @change="page = 'main'">
    <template #trigger><PhDotsThree :size="21" /></template>
    <div v-if="page === 'main'" role="menu" aria-label="会话操作">
      <button type="button" class="composer-menu-item" role="menuitem" :disabled="!connected" @click="run('rename')"><PhPencilSimple :size="18" /><span>重命名</span></button>
      <button type="button" class="composer-menu-item" role="menuitem" @click="run('pin')"><PhPushPin :size="18" /><span>{{ pinned ? '取消置顶' : '置顶' }}</span></button>
      <div class="menu-separator" />
      <button type="button" class="composer-menu-item" role="menuitem" :disabled="!connected" @click="run('side')"><PhChats :size="18" /><span>新建侧边聊天</span></button>
      <button type="button" class="composer-menu-item" role="menuitem" :disabled="!connected" @click="submenu('fork')"><PhGitBranch :size="18" /><span>分叉</span><PhCaretRight :size="14" /></button>
      <button type="button" class="composer-menu-item" role="menuitem" disabled title="当前 Codex App Server 未提供计划任务接口"><PhClock :size="18" /><span>添加计划任务…</span></button>
      <div class="menu-separator" />
      <button type="button" class="composer-menu-item" role="menuitem" :disabled="!canCopy" @click="submenu('copy')"><PhCopy :size="18" /><span>复制</span><PhCaretRight :size="14" /></button>
      <div class="menu-separator" />
      <button type="button" class="composer-menu-item" role="menuitem" @click="run('openWindow')"><PhArrowSquareOut :size="18" /><span>在新窗口中打开</span></button>
      <div class="menu-separator" />
      <button type="button" class="composer-menu-item" role="menuitem" :disabled="!connected" @click="run('archive')"><PhArchive :size="18" /><span>归档</span></button>
    </div>
    <div v-else role="menu" :aria-label="page === 'copy' ? '复制对话' : '分叉对话'">
      <button type="button" class="composer-menu-item" role="menuitem" @click="submenu('main')"><PhCaretLeft :size="17" /><span>返回</span></button>
      <template v-if="page === 'copy'"><button type="button" class="composer-menu-item" role="menuitem" :disabled="!canCopy" @click="popover?.hide(); emit('copy', false)">复制最近一条回复</button><button type="button" class="composer-menu-item" role="menuitem" :disabled="!canCopy" @click="popover?.hide(); emit('copy', true)">复制已加载的对话</button></template>
      <template v-else><button type="button" class="composer-menu-item" role="menuitem" @click="popover?.hide(); emit('fork', false)">从最新位置分叉</button><button type="button" class="composer-menu-item" role="menuitem" :disabled="!hasCompletedTurn" @click="popover?.hide(); emit('fork', true)">从上一轮完成处分叉</button></template>
    </div>
  </ComposerPopover>
</template>
<style scoped>
:global(.conversation-actions-trigger) { padding: 0; width: 34px; height: 34px; border-radius: var(--radius-round); }
.composer-menu-item { font-size: calc(14px * var(--ui-font-scale, 1)); }
.composer-menu-item > span { flex: 1; }
@media (max-width: 760px), (pointer: coarse) { :global(.conversation-actions-trigger) { width: 44px; height: 44px; } }
</style>
