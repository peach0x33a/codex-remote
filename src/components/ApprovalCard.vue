<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowRight, PhShieldCheck } from '@phosphor-icons/vue'
import { approvalTitle, type ApprovalDraft } from '../lib/approvals'
import type { Approval } from '../../shared/protocol'
const props = defineProps<{ approval: Approval; disabled: boolean; compact?: boolean; draft?: ApprovalDraft }>()
const emit = defineEmits<{ respond: [result: unknown] }>()
const ownDraft = ref<ApprovalDraft>({ answers: {}, other: {} })
const answers = computed(() => (props.draft || ownDraft.value).answers)
const other = computed(() => (props.draft || ownDraft.value).other)
const isQuestion = computed(() => props.approval.method.endsWith('requestUserInput'))
const isPermissions = computed(() => props.approval.method === 'item/permissions/requestApproval')
const title = computed(() => approvalTitle(props.approval))
const decisions = computed(() => props.approval.params.availableDecisions?.filter(d => typeof d === 'string') || ['accept', 'decline', 'cancel'])
const canAnswer = computed(() => props.approval.params.questions?.every(q => !!(answers.value[q.id] === '__other' ? other.value[q.id]?.trim() : answers.value[q.id]?.trim())))
function submit() {
  const result: Record<string, { answers: string[] }> = {}
  for (const q of props.approval.params.questions || []) result[q.id] = { answers: [answers.value[q.id] === '__other' ? other.value[q.id] : answers.value[q.id]] }
  emit('respond', { answers: result })
}
</script>

<template>
  <section class="approval-card" :aria-label="title">
    <h3 v-if="!compact"><PhShieldCheck :size="21" />{{ title }}</h3>
    <p v-if="approval.params.reason">{{ approval.params.reason }}</p>
    <p v-if="approval.params.cwd" class="activity-path">{{ approval.params.cwd }}</p>
    <pre v-if="approval.params.command"><code>{{ approval.params.command }}</code></pre>
    <form v-if="isQuestion" @submit.prevent="submit">
      <div class="question-fields">
      <fieldset v-for="q in approval.params.questions" :key="q.id" :disabled="disabled"><legend>{{ q.question }}</legend>
        <template v-if="q.options?.length"><label v-for="option in q.options" :key="option.label" class="answer-option"><input v-model="answers[q.id]" type="radio" :name="String(approval.id) + q.id" :value="option.label" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></label><label v-if="q.isOther" class="answer-option"><input v-model="answers[q.id]" type="radio" :name="String(approval.id) + q.id" value="__other" />其他回答</label><input v-if="answers[q.id] === '__other'" v-model="other[q.id]" :aria-label="q.header + '，其他回答'" :type="q.isSecret ? 'password' : 'text'" placeholder="输入你的回答" autocomplete="off" /></template>
        <input v-else v-model="answers[q.id]" :aria-label="q.header" :type="q.isSecret ? 'password' : 'text'" placeholder="输入你的回答" autocomplete="off" />
      </fieldset>
      </div>
      <div class="question-submit"><button class="button primary" type="submit" :disabled="disabled || !canAnswer">提交回答<PhArrowRight :size="16" /></button></div>
    </form>
    <template v-else>
      <details><summary>查看请求详情</summary><pre><code>{{ JSON.stringify(approval.params, null, 2) }}</code></pre></details>
      <div v-if="isPermissions" class="approval-actions"><button class="button secondary" :disabled="disabled" @click="emit('respond', { permissions: {}, scope: 'turn' })">拒绝</button><button class="button primary" :disabled="disabled" @click="emit('respond', { permissions: approval.params.permissions, scope: 'turn' })">允许本次权限</button></div>
      <div v-else class="approval-actions"><button v-if="decisions.includes('cancel')" class="button secondary" :disabled="disabled" @click="emit('respond', { decision: 'cancel' })">取消本次任务</button><button v-if="decisions.includes('decline')" class="button secondary" :disabled="disabled" @click="emit('respond', { decision: 'decline' })">拒绝</button><button v-if="decisions.includes('accept')" class="button primary" :disabled="disabled" @click="emit('respond', { decision: 'accept' })">允许这一次</button><button v-else-if="decisions.includes('acceptForSession')" class="button primary" :disabled="disabled" @click="emit('respond', { decision: 'acceptForSession' })">允许此会话</button></div>
    </template>
  </section>
</template>
