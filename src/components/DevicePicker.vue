<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretDown, PhCheck, PhDesktop, PhPencilSimple, PhPlus, PhPower } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import type { ConnectionProfile } from '../../shared/protocol'
import { endpointLabel } from '../../shared/endpoint'
const props = defineProps<{ profiles: ConnectionProfile[]; selectedId: string; status: string; statusText: string; online: boolean; disabled?: boolean; connectionStates?: Record<string, { status: string; busy: boolean; approvals: number }> }>()
const emit = defineEmits<{ select: [profile: ConnectionProfile]; edit: [id: string]; add: []; disconnect: [id?: string] }>()
const popover = ref<InstanceType<typeof ComposerPopover>>()
const selected = computed(() => props.profiles.find(p => p.id === props.selectedId))
const connectedCount = computed(() => Object.values(props.connectionStates || {}).filter(device => device.status === 'connected').length)
function deviceStatus(id: string) { return props.connectionStates?.[id]?.status || (id === props.selectedId ? props.status : 'disconnected') }
function deviceStatusText(profile: ConnectionProfile) {
  const state = props.connectionStates?.[profile.id]
  if (state?.approvals) return '待确认 · ' + state.approvals
  if (state?.busy) return '工作中'
  const status = deviceStatus(profile.id)
  return ({ connected: '已连接', connecting: '正在连接', reconnecting: '正在重连', error: '连接失败' } as Record<string, string>)[status] || (profile.id === props.selectedId ? props.statusText : endpointLabel(profile.endpoint))
}
function select(profile: ConnectionProfile) { popover.value?.hide(); emit('select', profile) }
function edit(id: string) { popover.value?.hide(); emit('edit', id) }
function add() { popover.value?.hide(); emit('add') }
function disconnect(id?: string) { popover.value?.hide(); emit('disconnect', id) }
</script>
<template>
  <ComposerPopover ref="popover" label="选择设备" :disabled="disabled" trigger-class="device-trigger" placement="bottom" align="end" :width="300">
    <template #trigger><PhDesktop :size="16" /><span class="device-trigger-name" :data-testid="selected ? 'selected-device' : undefined">{{ selected?.name || '连接设备' }}<span v-if="selected" class="sr-only">{{ statusText }}</span></span><span v-if="selected" class="status-dot" :class="status" :title="statusText" /><PhCaretDown :size="12" /></template>
    <div class="device-menu-heading">设备<span v-if="connectedCount" class="device-connected-count">已连接 {{ connectedCount }}</span></div>
    <div role="menu" aria-label="设备列表">
      <div v-for="profile in profiles" :key="profile.id" class="device-option">
        <button type="button" class="composer-menu-item device-select" role="menuitemradio" :aria-checked="selectedId === profile.id" :disabled="!online" @click="select(profile)"><PhDesktop :size="17" /><span><strong>{{ profile.name }}</strong><small :class="'device-status ' + deviceStatus(profile.id)">{{ deviceStatusText(profile) }}</small></span><PhCheck v-if="selectedId === profile.id" :size="16" /></button>
        <button v-if="profile.id !== selectedId && ['connected', 'connecting', 'reconnecting'].includes(deviceStatus(profile.id))" type="button" role="menuitem" class="icon-button small" :aria-label="'断开设备 ' + profile.name" title="断开此设备" @click="disconnect(profile.id)"><PhPower :size="17" /></button>
        <button type="button" role="menuitem" class="icon-button small device-edit" :aria-label="'编辑设备 ' + profile.name" title="编辑设备" @click="edit(profile.id)"><PhPencilSimple :size="17" /></button>
      </div>
      <template v-if="selected && ['connected', 'connecting', 'reconnecting'].includes(status)"><div class="menu-separator" /><button type="button" class="composer-menu-item device-menu-action" role="menuitem" @click="disconnect()"><PhPower :size="17" /><span>断开连接</span></button></template>
      <div v-if="profiles.length" class="menu-separator" />
      <button type="button" class="composer-menu-item device-menu-action" role="menuitem" @click="add"><PhPlus :size="18" /><span>添加设备</span></button>
    </div>
  </ComposerPopover>
</template>
<style scoped>
.device-menu-heading { display: flex; justify-content: space-between; gap: 12px; }
.device-connected-count { font-size: calc(12px * var(--ui-font-scale, 1)); font-weight: 400; color: var(--muted); }
</style>
