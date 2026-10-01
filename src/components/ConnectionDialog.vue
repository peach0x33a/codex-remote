<script setup lang="ts">
import ToggleSwitch from './ToggleSwitch.vue'
import { computed, ref, watch } from 'vue'
import { PhArrowRight, PhCheck, PhDesktop, PhEye, PhEyeSlash, PhLink, PhPlus, PhTrash, PhWarningCircle } from '@phosphor-icons/vue'
import BaseDialog from './BaseDialog.vue'
import type { ConnectionProfile } from '../../shared/protocol'
import { endpointLabel } from '../../shared/endpoint'
const props = defineProps<{
  open: boolean; profiles: ConnectionProfile[]; editingId?: string;
  save: (input: { id?: string; name: string; endpoint: string; cwd: string; token: string; rememberToken: boolean; clearToken: boolean }) => Promise<ConnectionProfile>;
  remove: (id: string) => Promise<boolean>;
  tokenFor: (id: string) => string;
}>()
const emit = defineEmits<{ close: []; connect: [profile: ConnectionProfile]; saved: [] }>()
const id = ref<string>()
const name = ref(''), endpoint = ref(''), cwd = ref(''), token = ref(''), error = ref('')
const visibleToken = ref(false), confirmDelete = ref(false)
const saving = ref(false), rememberToken = ref(true), clearToken = ref(false)
const storedToken = computed(() => !!props.profiles.find(profile => profile.id === id.value)?.credentialId && !clearToken.value)
function edit(profile?: ConnectionProfile) {
  if (saving.value) return
  id.value = profile?.id; name.value = profile?.name || ''; endpoint.value = profile?.endpoint || ''; cwd.value = profile?.cwd || ''
  token.value = profile ? props.tokenFor(profile.id) : ''; error.value = ''; visibleToken.value = false; confirmDelete.value = false
  rememberToken.value = !!profile?.credentialId || !token.value; clearToken.value = false
}
watch(() => props.open, open => { if (open) edit(props.profiles.find(p => p.id === props.editingId)); else { token.value = ''; visibleToken.value = false } })
async function submit(connect: boolean) {
  if (saving.value) return
  saving.value = true; error.value = ''
  try {
    const profile = await props.save({ id: id.value, name: name.value, endpoint: endpoint.value, cwd: cwd.value, token: token.value, rememberToken: rememberToken.value, clearToken: clearToken.value })
    emit('close'); token.value = ''
    if (connect) emit('connect', profile); else emit('saved')
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败，请重试。' }
  finally { saving.value = false }
}
async function remove() {
  if (!id.value || saving.value) return
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  saving.value = true; error.value = ''
  try { if (await props.remove(id.value)) { saving.value = false; edit() } }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移除失败，请重试。' }
  finally { saving.value = false }
}
function clearSavedToken() { clearToken.value = true; token.value = ''; visibleToken.value = false }
</script>

<template>
  <BaseDialog :open="open" :dismissible="!saving" title="连接你的设备" description="配置 App Server 地址与连接认证。" @close="$emit('close')">
    <div v-if="profiles.length" class="saved-tabs" aria-label="已保存的连接">
      <button v-for="profile in profiles" :key="profile.id" :disabled="saving" :class="{ selected: id === profile.id }" :title="endpointLabel(profile.endpoint)" @click="edit(profile)"><PhDesktop :size="16" />{{ profile.name }}</button>
      <button :disabled="saving" :class="{ selected: !id }" @click="edit()"><PhPlus :size="16" />新增</button>
    </div>
    <form class="connection-form" @submit.prevent="submit(true)">
      <fieldset class="connection-fields" :disabled="saving">
      <label class="field">设备名称<input v-model="name" autofocus required maxlength="48" autocomplete="off" placeholder="例如：我的工作站" /></label>
      <label class="field">App Server 地址<input v-model="endpoint" required maxlength="2048" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ws://127.0.0.1:4500" class="mono-input" /><span class="field-hint">支持 ws://、wss:// 和 unix:///绝对路径。地址由 Bun 服务所在的机器访问。</span></label>
      <label class="field">访问令牌 <span class="optional">可选</span><span class="password-field"><input v-model="token" :type="visibleToken ? 'text' : 'password'" maxlength="8192" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other" :placeholder="storedToken ? '已保存在服务器，留空保留' : 'App Server 的 Bearer token'" /><button type="button" class="icon-button" :aria-label="visibleToken ? '隐藏令牌' : '显示令牌'" @click="visibleToken = !visibleToken"><PhEyeSlash v-if="visibleToken" :size="18" /><PhEye v-else :size="18" /></button></span><span class="field-hint">{{ clearToken ? '保存后清除服务器中的令牌；填写新值可替换。' : storedToken ? '已保存的令牌不会回传浏览器。填写新值可替换。' : '令牌用于连接 App Server，不写入浏览器存储。' }}</span></label>
      <div class="remember-row"><div><span>记住令牌</span><p>{{ rememberToken ? '保存在 Bun 服务端，其他客户端可直接连接。' : '仅在当前页面内存中保留。' }}</p></div><ToggleSwitch class="remember-switch" label="记住令牌" :model-value="rememberToken" @update:model-value="rememberToken = $event" /></div>
      <button v-if="storedToken" type="button" class="text-button danger clear-token" @click="clearSavedToken">清除已保存令牌</button>
      <label class="field">默认工作目录 <span class="optional">可选</span><input v-model="cwd" maxlength="2048" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="留空使用 ~/codex-remote" class="mono-input" /><span class="field-hint">填写 Codex 所在机器的目录；留空使用 ~/codex-remote。“不在项目中工作”也使用此目录，首次新建会话时自动创建。</span></label>
      </fieldset>
      <div v-if="error" class="inline-error" role="alert"><PhWarningCircle :size="18" />{{ error }}</div>
      <div class="connection-note"><PhLink :size="18" /><span>设备配置保存在 Bun 服务端，登录同一服务的客户端自动同步。会话与代码由你的 Codex 环境管理。</span></div>
      <div class="dialog-actions">
        <button v-if="id" :disabled="saving" type="button" class="text-button danger" @click="remove"><PhTrash :size="17" />{{ confirmDelete ? '确认移除？' : '移除' }}</button>
        <span class="spacer" />
        <button :disabled="saving" type="button" class="button secondary" @click="submit(false)"><PhCheck :size="17" />仅保存</button>
        <button :disabled="saving" class="button primary" type="submit">{{ saving ? '正在保存…' : '保存并连接' }}<PhArrowRight :size="17" /></button>
      </div>
    </form>
  </BaseDialog>
</template>
<style scoped>
.connection-fields { min-width: 0; border: 0; margin: 0; padding: 0; }
.remember-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 14px; font-size: calc(14px * var(--ui-font-scale, 1)); }
.remember-row p { color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); margin: 4px 0 0; }
.clear-token { margin: -4px 0 16px; }

</style>
