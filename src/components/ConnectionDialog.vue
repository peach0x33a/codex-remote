<script setup lang="ts">
import { ref, watch } from 'vue'
import { PhArrowRight, PhCheck, PhDesktop, PhEye, PhEyeSlash, PhLink, PhPlus, PhTrash, PhWarningCircle } from '@phosphor-icons/vue'
import BaseDialog from './BaseDialog.vue'
import type { ConnectionProfile } from '../../shared/protocol'
import { endpointLabel } from '../../shared/endpoint'
const props = defineProps<{
  open: boolean; profiles: ConnectionProfile[]; editingId?: string;
  save: (input: { id?: string; name: string; endpoint: string; cwd: string; token: string }) => ConnectionProfile;
  tokenFor: (id: string) => string;
}>()
const emit = defineEmits<{ close: []; connect: [profile: ConnectionProfile]; remove: [id: string]; saved: [] }>()
const id = ref<string>()
const name = ref(''), endpoint = ref(''), cwd = ref(''), token = ref(''), error = ref('')
const visibleToken = ref(false), confirmDelete = ref(false)
function edit(profile?: ConnectionProfile) {
  id.value = profile?.id; name.value = profile?.name || ''; endpoint.value = profile?.endpoint || ''; cwd.value = profile?.cwd || ''
  token.value = profile ? props.tokenFor(profile.id) : ''; error.value = ''; visibleToken.value = false; confirmDelete.value = false
}
watch(() => props.open, open => { if (open) edit(props.profiles.find(p => p.id === props.editingId)); else { token.value = ''; visibleToken.value = false } })
function submit(connect: boolean) {
  try {
    const profile = props.save({ id: id.value, name: name.value, endpoint: endpoint.value, cwd: cwd.value, token: token.value })
    emit('close'); token.value = ''
    if (connect) emit('connect', profile); else emit('saved')
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败，请重试。' }
}
function remove() { if (!id.value) return; if (!confirmDelete.value) { confirmDelete.value = true; return }; emit('remove', id.value); edit() }
</script>

<template>
  <BaseDialog :open="open" title="连接你的设备" description="让运行在自己环境中的 Codex，来到眼前。" @close="$emit('close')">
    <div v-if="profiles.length" class="saved-tabs" aria-label="已保存的连接">
      <button v-for="profile in profiles" :key="profile.id" :class="{ selected: id === profile.id }" :title="endpointLabel(profile.endpoint)" @click="edit(profile)"><PhDesktop :size="16" />{{ profile.name }}</button>
      <button :class="{ selected: !id }" @click="edit()"><PhPlus :size="16" />新增</button>
    </div>
    <form class="connection-form" @submit.prevent="submit(true)">
      <label class="field">设备名称<input v-model="name" autofocus required maxlength="48" autocomplete="off" placeholder="例如：我的工作站" /></label>
      <label class="field">App Server 地址<input v-model="endpoint" required maxlength="2048" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ws://127.0.0.1:4500" class="mono-input" /><span class="field-hint">支持 ws://、wss:// 和 unix:///绝对路径。地址由 Bun 服务所在的机器访问。</span></label>
      <label class="field">访问令牌 <span class="optional">可选</span><span class="password-field"><input v-model="token" :type="visibleToken ? 'text' : 'password'" maxlength="8192" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" placeholder="App Server 的 Bearer token" /><button type="button" class="icon-button" :aria-label="visibleToken ? '隐藏令牌' : '显示令牌'" @click="visibleToken = !visibleToken"><PhEyeSlash v-if="visibleToken" :size="18" /><PhEye v-else :size="18" /></button></span><span class="field-hint">仅在当前页面内存中保留，不写入浏览器存储。</span></label>
      <label class="field">默认工作目录 <span class="optional">可选</span><input v-model="cwd" maxlength="2048" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例如：/home/me/projects/my-app" class="mono-input" /><span class="field-hint">填写 Codex 所在机器的目录；留空使用服务器默认值。</span></label>
      <div v-if="error" class="inline-error" role="alert"><PhWarningCircle :size="18" />{{ error }}</div>
      <div class="connection-note"><PhLink :size="18" /><span>设备地址保存在此浏览器。会话与代码由你的 Codex 环境管理。</span></div>
      <div class="dialog-actions">
        <button v-if="id" type="button" class="text-button danger" @click="remove"><PhTrash :size="17" />{{ confirmDelete ? '确认移除？' : '移除' }}</button>
        <span class="spacer" />
        <button type="button" class="button secondary" @click="submit(false)"><PhCheck :size="17" />仅保存</button>
        <button class="button primary" type="submit">保存并连接<PhArrowRight :size="17" /></button>
      </div>
    </form>
  </BaseDialog>
</template>
