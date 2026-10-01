<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue'
import ValueSlider from './ValueSlider.vue'
import { computed } from 'vue'
import { PhBell, PhSpeakerHigh } from '@phosphor-icons/vue'
import type { TaskNotifications } from '../composables/useTaskNotifications'
const props = defineProps<{ notifications: TaskNotifications }>()
const preferences = computed(() => props.notifications.preferences.value)
const events = [{ key: 'attention', label: '需要人工介入', detail: '权限审批、提问与选项确认' }, { key: 'completed', label: '对话完成', detail: '一轮任务正常完成' }, { key: 'failed', label: '请求失败', detail: '任务失败或消息发送失败' }] as const
function setSound() { props.notifications.update({ sound: !preferences.value.sound }); void props.notifications.unlockAudio() }
</script>
<template>
  <section class="notification-settings" aria-label="通知与音效">
    <h3>通知与音效</h3>
    <div class="notification-row"><div><span><PhBell :size="17" /> 浏览器通知</span><p>{{ notifications.permissionLabel.value }}</p></div><ToggleSwitch class="notification-switch" label="浏览器通知" :model-value="preferences.desktop && notifications.permission.value === 'granted'" :disabled="notifications.permission.value === 'unsupported' || notifications.requesting.value" @update:model-value="notifications.setDesktop($event)" /></div>
    <div class="notification-row"><div><span><PhSpeakerHigh :size="17" /> 通知音效</span><p>{{ !notifications.soundSupported ? '当前浏览器不支持音频' : '不同事件使用不同提示音' }}</p></div><ToggleSwitch class="notification-switch" label="通知音效" :model-value="preferences.sound" :disabled="!notifications.soundSupported" @update:model-value="setSound" /></div>
    <ValueSlider @preview="notifications.previewVolume" class="notification-volume" label="通知音量" :min="0" :max="100" :step="5" unit="%" :model-value="preferences.volume" :disabled="!preferences.sound" @update:model-value="notifications.update({ volume: $event })" />
    <div class="notification-row"><div><span>仅在后台提醒</span><p>切换到其他标签页或应用后再提示</p></div><ToggleSwitch class="notification-switch" label="仅在后台提醒" :model-value="preferences.backgroundOnly" @update:model-value="notifications.update({ backgroundOnly: $event })" /></div>
    <h4>提醒事件</h4>
    <div v-for="event in events" :key="event.key" class="notification-row"><div><span>{{ event.label }}</span><p>{{ event.detail }}</p></div><ToggleSwitch class="notification-switch" :label="event.label" :model-value="preferences[event.key]" @update:model-value="notifications.update({ [event.key]: $event })" /></div>
    <div class="notification-test"><button type="button" class="button secondary" @click="notifications.test()">测试通知和音效</button><p>保持页面打开并连接设备即可接收提醒；关闭页面后暂不支持推送。</p></div>
    <p v-if="notifications.error.value" class="notification-error" role="alert">{{ notifications.error.value }}</p>
  </section>
</template>
<style scoped>
.notification-settings { padding: 24px 0; }
.notification-settings h3 { margin: 0 0 20px; color: var(--ink); font-size: calc(20px * var(--ui-font-scale, 1)); font-weight: 600; }
.notification-settings h4 { margin: 24px 0 8px; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 500; }
.notification-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 72px; padding: 12px 0; border-bottom: 1px solid var(--line-soft); }
.notification-row span { color: var(--ink); font-size: calc(14px * var(--ui-font-scale, 1)); }
.notification-row p, .notification-test p { margin: 4px 0 0; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
.notification-volume { padding: 16px 0; }
.notification-test { display: grid; gap: 8px; justify-items: start; margin-top: 24px; }
.notification-error { margin: 12px 0 0; color: var(--danger); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.7; }

</style>
