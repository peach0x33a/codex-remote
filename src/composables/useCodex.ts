import { computed, getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { Approval, ConnectionProfile, Item, MessageContent, Model, RpcId, RpcMessage, Thread, ThreadItemsPage, ThreadResult, ThreadTokenUsage, Turn } from '../../shared/protocol'
import { normalizeEndpoint } from '../../shared/endpoint'
import { loadProfiles, saveProfiles } from '../lib/profiles'
import { deleteCredential, storeCredential } from '../lib/credentials'
import { readUiPreferences } from '../lib/ui-preferences'
import { RpcClient, RpcError } from '../lib/rpc'
import { retryStatusMessage } from '../lib/turn-failure'
import { parseSkills, type SkillCatalog } from '../lib/skills'
import { parsePluginMentions, type MentionReference } from '../lib/mentions'
import { taskNoticeFromMessage, type TaskNotice } from '../lib/task-notifications'
import { ServerQueueClient } from '../lib/server-queue'
import { activityTime, fetchRecentThreads, recentWindow, withinRecentWindow, type RecentWindow } from '../lib/recent-window'
import { hasPrompt, mergeItem, messageEditError, messageParts, promptText, reasoningPreview, textFragment, toInputs, type PromptPart } from '../lib/prompt'
import { permissionParams, restoredPermission, type PermissionMode } from '../lib/permissions'
import { GOAL_UNAVAILABLE, goalUnavailable, isRecord, isThreadGoal, readGoalResponse, validateGoalUpdate, type ThreadGoal, type ThreadGoalUpdate } from '../lib/thread-goal'

export type FuzzyFileSearchResult = { root: string; path: string; match_type: 'file' | 'directory'; file_name: string; score: number; indices: number[] | null }

export type ComposerSettings = { model: string; effort: string; permission: PermissionMode; serviceTier?: string | null }
export type QueuedMessage = { id: string; deviceId: string; threadId: string; parts: PromptPart[]; settings: ComposerSettings; state: 'queued' | 'sending' | 'failed'; source?: 'server'; editError?: string; error?: string }
type PendingUserMessage = { id: string; clientId: string; threadId: string; input: MessageContent[]; priorUserIds: string[]; placement: 'conversation' | 'island'; accepted: boolean; cancelable: boolean }

function isThreadSummary(value: unknown): value is Thread {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const thread = value as Partial<Thread>
  return typeof thread.id === 'string' && !!thread.id.trim() && typeof thread.cwd === 'string' && typeof thread.preview === 'string'
    && typeof thread.createdAt === 'number' && Number.isFinite(thread.createdAt)
    && typeof thread.updatedAt === 'number' && Number.isFinite(thread.updatedAt) && Array.isArray(thread.turns)
}

export function useCodex(options: { autoConnect?: boolean; persistConnection?: boolean; deferLifecycle?: boolean } = {}) {
  const skillsRevision = ref(0)
  const noticeListeners = new Set<(notice: TaskNotice) => void>()
  function onTaskNotice(listener: (notice: TaskNotice) => void) { noticeListeners.add(listener); return () => { noticeListeners.delete(listener) } }
  function emitTaskNotice(notice: TaskNotice) { for (const listener of noticeListeners) { try { listener(notice) } catch { /* Notification delivery cannot interrupt the conversation. */ } } }
  function noticeThreadName(id: string) { const thread = active.value?.id === id ? active.value : threads.value.find(thread => thread.id === id) || projectThreads.value.find(thread => thread.id === id); return (thread?.name || thread?.preview || 'Codex 对话').slice(0, 80) }
  let storage: Storage | undefined
  try { storage = localStorage } catch { /* Browser privacy mode may disallow storage. */ }
  const stored = storage ? loadProfiles(storage) : { profiles: [], selectedId: '', error: '此浏览器禁止本地存储，连接仅在当前页面保留。' }
  const profiles = ref<ConnectionProfile[]>(stored.profiles)
  const selectedId = ref(stored.selectedId)
  const selected = computed(() => profiles.value.find(p => p.id === selectedId.value))
  const workingDirectory = ref(selected.value?.cwd || '')
  watch([() => selected.value?.id, () => selected.value?.cwd], () => { workingDirectory.value = selected.value?.cwd || '' }, { flush: 'sync' })
  const status = ref<'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'>('disconnected')
  const error = ref(stored.error)
  const notice = ref('')
  const online = ref(navigator.onLine)
  const bridgeReachable = ref(true)
  const authenticated = ref(true)
  const requiresKey = ref(false)
  const threads = ref<Thread[]>([])
  const projectThreads = ref<Thread[]>([])
  const projectFilter = ref(''), projectPaths = ref<string[]>([]), projectsLoading = ref(false)
  const projectUpdates = new Map<string, Partial<Thread> | null>()
  const archivedThreads = new Set<string>()
  const archiveRevisions = new Map<string, number>()
  let currentSearch = ''
  let listWindow: RecentWindow | null = null, listSort: 'recency_at' | 'updated_at' = 'recency_at'
  let listController: AbortController | undefined, listLoaded = false
  const threadCursor = ref<string | null>(null)
  const active = ref<Thread | null>(null)
  const turnDiffs = ref(new Map<string, string>())
  const turnDiffKey = (threadId: string, turnId: string) => JSON.stringify([selectedId.value, threadId, turnId])
  const currentTurnDiff = computed(() => {
    const thread = active.value, turn = thread?.turns.at(-1)
    return thread && turn ? turnDiffs.value.get(turnDiffKey(thread.id, turn.id)) ?? '' : ''
  })
  const turnFailures = ref(new Map<string, { message: string }>())
  const submissionFailures = ref(new Map<string, { turnId: string | null; message: string }>())
  const currentTurnFailure = computed(() => {
    const thread = active.value, turn = thread?.turns.at(-1)
    const submission = submissionFailures.value.get(turnDiffKey(thread?.id || '', ''))
    if (submission?.turnId === (turn?.id ?? null)) return submission.message
    if (!thread || !turn) return ''
    return turnFailures.value.get(turnDiffKey(thread.id, turn.id))?.message
      || (turn.status === 'failed' ? turn.error?.message || '本轮任务失败。' : '')
  })
  function rememberTurnFailure(threadId: string, turnId: string, failure: unknown) {
    if (!threadId || !turnId || !isRecord(failure) || typeof failure.message !== 'string' || !failure.message.trim()) return
    const key = turnDiffKey(threadId, turnId), value = { ...failure, message: failure.message }
    turnFailures.value.delete(key); turnFailures.value.set(key, value)
    if (turnFailures.value.size > 128) turnFailures.value.delete(turnFailures.value.keys().next().value!)
    const turn = active.value?.id === threadId ? active.value.turns.find(turn => turn.id === turnId) : undefined
    if (turn) turn.error = value
  }
  function notifyRequestFailure(threadId: string) {
    emitTaskNotice({ id: crypto.randomUUID(), kind: 'failed', deviceId: selectedId.value, deviceName: selected.value?.name || '当前设备', threadId, threadName: noticeThreadName(threadId) })
  }
  function submissionFailed(threadId: string, message: string) {
    notifyRequestFailure(threadId)
    const turnId = active.value?.id === threadId ? active.value.turns.at(-1)?.id ?? null : null
    const key = turnDiffKey(threadId, '')
    submissionFailures.value.delete(key); submissionFailures.value.set(key, { turnId, message })
    if (submissionFailures.value.size > 128) submissionFailures.value.delete(submissionFailures.value.keys().next().value!)
  }
  const goals = ref(new Map<string, ThreadGoal | null>())
  const goalErrors = ref(new Map<string, string>())
  const goalReads = ref(new Map<string, symbol>()), goalWrites = ref(new Map<string, symbol>())
  const goalVersions = new Map<string, number>()
  const goalSupported = ref<boolean | null>(null)
  const goalKey = (id = active.value?.id || '') => JSON.stringify([selectedId.value, id])
  const goal = computed(() => active.value ? goals.value.get(goalKey()) ?? null : null)
  const goalLoading = computed(() => !!active.value && goalReads.value.has(goalKey()))
  const goalSaving = computed(() => goalWrites.value.has(goalKey()))
  const goalError = computed(() => goalErrors.value.get(goalKey()) || (goalSupported.value === false ? GOAL_UNAVAILABLE : ''))
  const nextGoalVersion = (key: string) => { const version = (goalVersions.get(key) || 0) + 1; goalVersions.set(key, version); return version }
  function resetGoals() { goals.value.clear(); goalErrors.value.clear(); goalReads.value.clear(); goalWrites.value.clear(); goalVersions.clear(); goalSupported.value = null }
  const models = ref<Model[]>([])
  const model = ref('')
  const effort = ref('')
  const serviceTier = ref<string | null | undefined>(undefined)
  const tokenUsageByThread = ref(new Map<string, ThreadTokenUsage>())
  const contextUsage = computed(() => active.value ? tokenUsageByThread.value.get(selectedId.value + '/' + active.value.id) : undefined)
  // Composer permission mode, mapped onto the App Server's approval policy and sandbox.
  const permission = ref<PermissionMode>('ask')
  const supportsAutoReview = ref(false)
  const permissionRequirements = ref<{ allowedApprovalPolicies?: unknown[] | null; allowedSandboxModes?: string[] | null; autoReview?: { requiredOnModels?: string[] | null } | null } | null>(null)
  const permissionUnavailable = computed(() => {
    const result: Partial<Record<PermissionMode, string>> = {}
    if (!supportsAutoReview.value) result.auto = '此服务器尚未开放自动审批'
    for (const mode of ['ask', 'auto', 'full', 'readOnly'] as const) {
      const params = permissionParams(mode), requirements = permissionRequirements.value
      if ((requirements?.allowedApprovalPolicies && !requirements.allowedApprovalPolicies.includes(params.approvalPolicy)) || (requirements?.allowedSandboxModes && !requirements.allowedSandboxModes.includes(params.sandbox!))) result[mode] = '已被服务器的管理策略禁用'
      if (requirements?.autoReview?.requiredOnModels?.includes(model.value || modelInfo.value?.model || '') && mode !== 'auto') result[mode] = '此模型要求自动审批'
    }
    return result
  })
  const approvals = ref<Approval[]>([])
  const loading = ref(false)
  const loadingThread = ref(false)
  const pendingThreadId = ref(''), threadLoadError = ref(''), loadingEarlier = ref(false)
  const historyCursor = ref<string | null>(null)
  const sending = ref(false)
  const steering = ref(false)
  const revisionThreadId = ref<string | null>(null)
  const revising = computed(() => revisionThreadId.value !== null)
  const queuedMessages = ref<QueuedMessage[]>([])
  const pendingUserMessages = ref<PendingUserMessage[]>([])
  const steerWithdrawals = new Map<string, () => void>()
  function withdrawPendingSteer(id: string) {
    const withdraw = steerWithdrawals.get(id)
    if (!withdraw) { toast('当前服务端不支持撤回已提交的插话。'); return false }
    steerWithdrawals.delete(id); withdraw(); return true
  }
  const serverQueueSupported = ref(false)
  let serverQueue: ServerQueueClient | undefined, queueAdding = false
  let queueRefreshTimer: ReturnType<typeof setInterval> | undefined, settingsTimer: ReturnType<typeof setTimeout> | undefined
  const settingsWrites = new Map<string, Promise<void>>()
  const pendingSettings = new Map<string, ComposerSettings>()
  const pausedQueues = ref(new Set<string>()), runningTurns = ref(new Map<string, string>())
  const drainingQueues = new Set<string>(), terminalTurns = new Set<string>()
  const pendingTurnStarts = new Set<string>()
  const settingsByThread = new Map<string, ComposerSettings>()
  const settingsVersions = new Map<string, number>()
  const unsavedSettings = new Map<string, ComposerSettings>()
  function rememberSettings(key: string, settings: ComposerSettings, local = false) {
    settingsByThread.set(key, settings)
    settingsVersions.set(key, (settingsVersions.get(key) || 0) + 1)
    if (local) unsavedSettings.set(key, settings)
  }
  function acknowledgeSettings(key: string, settings: ComposerSettings) {
    if (settingsByThread.get(key) !== settings) return
    if (unsavedSettings.get(key) === settings) unsavedSettings.delete(key)
    // An ack received during resume is newer evidence than its pending snapshot.
    settingsVersions.set(key, (settingsVersions.get(key) || 0) + 1)
  }
  let restoringSettings = false
  const queueKey = (threadId: string, deviceId = selectedId.value) => deviceId + '/' + threadId
  const retries = ref(new Map<string, { turnId: string; message: string }>())
  const reconnectStatus = computed(() => active.value ? retries.value.get(queueKey(active.value.id))?.message || '' : '')
  const reasoningTimings = new Map<string, Map<string, { startedAtMs?: number; completedAtMs?: number }>>()
  const clockNow = ref(Date.now())
  const turnStartedAt = ref(new Map<string, number>())
  const currentQueue = computed(() => queuedMessages.value.filter(job => job.deviceId === selectedId.value && job.threadId === active.value?.id))
  const queuePaused = computed(() => !!active.value && pausedQueues.value.has(queueKey(active.value.id)))
  const settingsSnapshot = (): ComposerSettings => ({ model: model.value, effort: effort.value, permission: permission.value, serviceTier: serviceTier.value })
  watch([model, effort, permission, serviceTier], () => {
    if (restoringSettings || !active.value) return
    const settings = settingsSnapshot(); rememberSettings(queueKey(active.value.id), settings, true)
    for (const job of currentQueue.value) if (job.source !== 'server' && job.state !== 'sending') job.settings = { ...settings }
    if (serverQueueSupported.value && client && connected.value) {
      const threadId = active.value.id, rpc = client
      pendingSettings.set(threadId, settings)
      clearTimeout(settingsTimer)
      settingsTimer = setTimeout(() => {
        for (const [id, value] of pendingSettings) { pendingSettings.delete(id); void persistServerSettings(rpc, id, value).catch(cause => { if (rpc === client) error.value = '设置未同步：' + messageOf(cause) }) }
      }, 120)
    }
  }, { flush: 'sync' })
  const connected = computed(() => status.value === 'connected')
  const activeTurn = computed(() => active.value?.turns.findLast(t => t.status === 'inProgress'))
  const busy = computed(() => sending.value || !!activeTurn.value || active.value?.status?.type === 'active' || (active.value ? runningTurns.value.has(active.value.id) : false) || currentQueue.value.some(job => job.state === 'sending'))
  function inputFingerprint(input: (MessageContent | string)[]) {
    return JSON.stringify(input.map(part => typeof part === 'string' ? { type: 'string', text: part } : {
      type: part.type, text: part.text, url: part.url, path: part.path, fileId: part.fileId, name: part.name,
      text_elements: part.text_elements,
    }))
  }
  function addPendingUserMessage(threadId: string, input: MessageContent[], placement: PendingUserMessage['placement'] = 'conversation') {
    const priorUserIds = active.value?.id === threadId ? active.value.turns.flatMap(turn => turn.items.filter(item => item.type === 'userMessage').map(item => item.id)) : []
    const clientId = crypto.randomUUID()
    const pending = { id: 'pending-' + clientId, clientId, threadId, input, priorUserIds, placement, accepted: false, cancelable: false }
    pendingUserMessages.value.push(pending)
    return pending
  }
  function removePendingUserMessage(id: string) {
    pendingUserMessages.value = pendingUserMessages.value.filter(message => message.id !== id)
  }
  function reconcilePendingUserMessage(threadId: string, itemId: string, input?: (MessageContent | string)[], clientId?: string | null) {
    if (!input?.length && !clientId) return
    const fingerprint = inputFingerprint(input || [])
    const pending = pendingUserMessages.value.find(message => message.threadId === threadId && (clientId ? message.clientId === clientId : !message.priorUserIds.includes(itemId) && inputFingerprint(message.input) === fingerprint))
    if (pending) {
      removePendingUserMessage(pending.id)
      for (const message of pendingUserMessages.value) if (message.threadId === threadId && !message.priorUserIds.includes(itemId)) message.priorUserIds.push(itemId)
    }
  }
  const pendingSteers = computed(() => pendingUserMessages.value.filter(message => message.threadId === active.value?.id && message.placement === 'island').map(message => ({ id: message.id, accepted: message.accepted, cancelable: message.cancelable, parts: messageParts(message.input) })))
  const displayTurns = computed(() => {
    const thread = active.value
    if (!thread) return [] as Turn[]
    const turns = thread.turns.map(turn => ({ ...turn, items: [...turn.items] }))
    const pending = pendingUserMessages.value
      .filter(message => message.threadId === thread.id && message.placement === 'conversation')
      .map(message => ({ id: message.id, type: 'userMessage', content: message.input } as Item))
    if (pending.length) {
      const last = turns.at(-1)
      if (last) last.items.push(...pending)
      else turns.push({ id: 'pending-' + thread.id, status: 'inProgress', items: pending })
    }
    return turns
  })
  const items = computed(() => displayTurns.value.flatMap(turn => turn.items))
  const compacting = computed(() => !!activeTurn.value?.items.some(item => item.type === 'contextCompaction' && item.status === 'inProgress' && item.completedAtMs == null))
  const liveThinking = computed(() => activeTurn.value?.items.findLast(i => i.type === 'reasoning' && i.status === 'inProgress' && i.completedAtMs == null))
  const liveReasoning = computed(() => busy.value ? reasoningPreview(liveThinking.value) : '')
  const thinkingElapsed = computed(() => {
    const start = liveThinking.value?.startedAtMs
    return typeof start === 'number' && Number.isFinite(start) ? Math.max(0, Math.floor((clockNow.value - start) / 1000)) : undefined
  })
  const workingElapsed = computed(() => {
    const turn = activeTurn.value, thread = active.value
    if (!turn || !thread) return undefined
    const serverStart = typeof turn.startedAt === 'number' && Number.isFinite(turn.startedAt) && turn.startedAt >= 0 ? turn.startedAt * 1000 : undefined
    const start = serverStart ?? turnStartedAt.value.get(queueKey(thread.id) + '/' + turn.id)
    return start === undefined ? undefined : Math.max(0, Math.floor((clockNow.value - start) / 1000))
  })
  const activeApprovals = computed(() => approvals.value.filter(p => p.params.threadId === active.value?.id))
  const modelInfo = computed(() => models.value.find(m => m.model === model.value) || (model.value ? undefined : models.value.find(m => m.isDefault)))
  const tokens = new Map<string, string>()
  let client: RpcClient | null = null
  let generation = 0
  let listGeneration = 0
  let threadGeneration = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectCount = 0
  let disposed = false
  let openingThread = ''
  let bufferedEvents: RpcMessage[] = []
  let threadLoadController: AbortController | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let clockTimer: ReturnType<typeof setInterval> | undefined
  const messageOf = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试。'
  const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  function rememberReasoning(threadId: string, turnId: string, item: Item, event?: 'started' | 'completed' | 'delta'): Item {
    if (item.type !== 'reasoning') return item
    const key = queueKey(threadId) + '/' + turnId
    let timings = reasoningTimings.get(key)
    if (!timings) { timings = new Map(); reasoningTimings.set(key, timings) }
    const previous = timings.get(item.id)
    const startedAtMs = timestamp(item.startedAtMs) ?? previous?.startedAtMs ?? (event === 'started' || event === 'delta' ? Date.now() : undefined)
    const completedAtMs = timestamp(item.completedAtMs) ?? previous?.completedAtMs ?? (event === 'completed' ? Date.now() : undefined)
    timings.set(item.id, { startedAtMs, completedAtMs })
    return { ...item, startedAtMs, completedAtMs, ...(completedAtMs !== undefined ? { status: 'completed' } : event === 'started' || event === 'delta' ? { status: 'inProgress' } : {}) }
  }
  function completeReasoning(threadId: string, turnId: string) {
    const now = Date.now()
    for (const timing of reasoningTimings.get(queueKey(threadId) + '/' + turnId)?.values() || []) {
      if (timing.startedAtMs !== undefined && timing.completedAtMs === undefined) timing.completedAtMs = now
    }
    clockNow.value = now
  }
  function filterRecentThreads() {
    projectThreads.value = projectThreads.value.filter(thread => withinRecentWindow(thread, listWindow))
    const query = currentSearch.trim().toLocaleLowerCase()
    threads.value = projectThreads.value.filter(thread => (!projectFilter.value || thread.cwd === projectFilter.value) && (!query || [thread.name, thread.preview, thread.cwd].some(value => value?.toLocaleLowerCase().includes(query))))
    syncProjectPaths()
  }
  function syncProjectPaths() { projectPaths.value = [...new Set(projectThreads.value.map(thread => thread.cwd).filter(Boolean))].sort((a, b) => a.localeCompare(b)) }
  function rememberProjects(incoming: Thread[], discovery = false) {
    const all = new Map(projectThreads.value.map(thread => [thread.id, thread]))
    for (const thread of incoming) {
      if (archivedThreads.has(thread.id)) continue
      const update = projectUpdates.get(thread.id)
      if (update === null) continue
      const merged = { ...all.get(thread.id), ...thread, ...update }
      all.set(thread.id, merged)
      if (!discovery && projectsLoading.value) projectUpdates.set(thread.id, merged)
    }
    const latest = Math.max(...[...all.values()].map(thread => activityTime(thread) ?? 0))
    if (Number.isFinite(latest) && (!listWindow || latest > listWindow.latest)) listWindow = recentWindow(latest)
    projectThreads.value = [...all.values()].sort((a, b) => (activityTime(b) ?? 0) - (activityTime(a) ?? 0))
    filterRecentThreads()
  }
  function updateThreadMetadata(id: string, patch: Partial<Thread>) {
    if (projectsLoading.value && projectUpdates.get(id) !== null) projectUpdates.set(id, { ...projectUpdates.get(id), ...patch })
    for (const collection of [threads.value, projectThreads.value]) {
      const thread = collection.find(thread => thread.id === id)
      if (thread) Object.assign(thread, patch)
      collection.sort((a, b) => b.updatedAt - a.updatedAt)
    }
    if (active.value?.id === id) Object.assign(active.value, patch)
    const updated = projectThreads.value.find(thread => thread.id === id) || (active.value?.id === id ? active.value : undefined)
    if (updated) rememberProjects([updated])
  }
  function removeThreadMetadata(id: string) {
    archiveRevisions.set(id, (archiveRevisions.get(id) || 0) + 1)
    archivedThreads.add(id)
    if (projectsLoading.value) projectUpdates.set(id, null)
    threads.value = threads.value.filter(thread => thread.id !== id)
    projectThreads.value = projectThreads.value.filter(thread => thread.id !== id)
    retries.value.delete(queueKey(id))
    for (const key of reasoningTimings.keys()) if (key.startsWith(queueKey(id) + '/')) reasoningTimings.delete(key)
    syncProjectPaths()
  }
  function updateThreadPreview(id: string, item?: Item) {
    if (item?.type !== 'userMessage') return
    const thread = projectThreads.value.find(thread => thread.id === id) || threads.value.find(thread => thread.id === id) || (active.value?.id === id ? active.value : undefined)
    if (thread && !thread.preview) updateThreadMetadata(id, { preview: promptText(messageParts(item.content)).trim().slice(0, 200) })
  }
  function toast(text: string) { notice.value = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 4500) }
  function persist() {
    if (options.persistConnection === false) return
    try { if (!storage) throw new Error(); saveProfiles(storage, profiles.value, selectedId.value) }
    catch { error.value = '保存失败：浏览器存储不可用或已满。连接仍可用于当前页面。' }
  }
  let profileWriting = false
  async function saveProfile(input: { id?: string; name: string; endpoint: string; cwd: string; token: string; rememberToken?: boolean; clearToken?: boolean }) {
    if (profileWriting) throw new Error('正在保存连接，请稍候。')
    const endpoint = normalizeEndpoint(input.endpoint)
    if (!input.name.trim()) throw new Error('请为这台设备填写名称。')
    if (input.token.length > 8192 || /[\r\n]/.test(input.token)) throw new Error('访问令牌格式无效。')
    if (profiles.value.some(p => p.id !== input.id && p.endpoint === endpoint)) throw new Error('这个地址已保存，请直接连接已有设备。')
    const old = profiles.value.find(p => p.id === input.id)
    const token = input.token.trim(), remember = input.rememberToken ?? !!old?.credentialId
    if (old?.credentialId && old.endpoint !== endpoint && !token && remember && !input.clearToken) throw new Error('地址已更改，请填写新令牌，或清除已保存的令牌。')
    const profile: ConnectionProfile = { id: old?.id || crypto.randomUUID(), name: input.name.trim(), endpoint, cwd: input.cwd.trim(), createdAt: old?.createdAt || Date.now() }
    if (remember && !input.clearToken && old?.endpoint === endpoint && old.credentialId) profile.credentialId = old.credentialId
    const previousProfiles = [...profiles.value], previousSelected = selectedId.value
    let createdCredential: string | undefined, savedLocally = false
    profileWriting = true
    try {
      if (!storage) throw new Error('连接未保存：浏览器存储不可用。')
      // Check storage before sending any credential, and keep the old reference
      // until both the new record and removal of the old secret succeed.
      saveProfiles(storage, previousProfiles, previousSelected)
      if (remember && token) { createdCredential = await storeCredential(endpoint, token); profile.credentialId = createdCredential }
      const nextProfiles = old ? profiles.value.map(p => p.id === old.id ? profile : p) : [...profiles.value, profile]
      saveProfiles(storage, nextProfiles, selectedId.value || profile.id)
      savedLocally = true
      if (old?.credentialId && old.credentialId !== profile.credentialId) await deleteCredential(old.credentialId)
      if (old?.id === selectedId.value && (old.endpoint !== endpoint || old.credentialId !== profile.credentialId || (!profile.credentialId && tokenFor(old.id) !== token))) disconnect()
      profiles.value = nextProfiles
      if (profile.credentialId) tokens.delete(profile.id); else tokens.set(profile.id, token)
      if (!selectedId.value) selectedId.value = profile.id
      return profile
    } catch (cause) {
      if (savedLocally && storage) { try { saveProfiles(storage, previousProfiles, previousSelected) } catch { /* Report failure without claiming success. */ } }
      if (createdCredential) { try { await deleteCredential(createdCredential) } catch { toast('保存未完成，服务器可能保留了未使用的令牌记录。') } }
      throw cause instanceof Error ? cause : new Error('连接未保存，请重试。')
    } finally { profileWriting = false }
  }
  async function removeProfile(id: string) {
    if (profileWriting) throw new Error('正在保存连接，请稍候。')
    if (queuedMessages.value.some(job => job.deviceId === id)) throw new Error('该设备还有待发送消息，请先发送或移除队列。')
    const profile = profiles.value.find(p => p.id === id)
    if (!profile) return true
    const previous = [...profiles.value], previousSelected = selectedId.value
    const next = previous.filter(p => p.id !== id), nextSelected = selectedId.value === id ? next[0]?.id || '' : selectedId.value
    profileWriting = true
    try {
      if (!storage) throw new Error('无法更新浏览器中的连接记录。')
      saveProfiles(storage, next, nextSelected)
      try { if (profile.credentialId) await deleteCredential(profile.credentialId) }
      catch (cause) { saveProfiles(storage, previous, previousSelected); throw cause }
      if (id === selectedId.value) disconnect()
      profiles.value = next; selectedId.value = nextSelected; tokens.delete(id)
      toast('已移除连接及保存的令牌，服务器上的会话不受影响。'); return true
    } finally { profileWriting = false }
  }
  function tokenFor(id: string) { return tokens.get(id) || '' }
  let startupConnectionPending = options.autoConnect !== false
  function connectOnStartup() {
    if (!startupConnectionPending || disposed || !readUiPreferences(storage).autoConnect) return
    if (!authenticated.value || !bridgeReachable.value || !online.value || status.value !== 'disconnected' || !selected.value) return
    startupConnectionPending = false
    void connect(selected.value)
  }
  async function checkSession() {
    try {
      const response = await fetch('/api/session', { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error()
      const result = await response.json()
      if (disposed) return
      bridgeReachable.value = true
      authenticated.value = result.authenticated; requiresKey.value = result.requiresKey
      connectOnStartup()
    } catch { if (!disposed) bridgeReachable.value = false }
  }
  async function login(key: string) {
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '登录失败。')
    authenticated.value = true; error.value = ''
    connectOnStartup()
  }
  async function logout() {
    disconnect()
    const response = await fetch('/api/session', { method: 'DELETE' })
    if (!response.ok) throw new Error('退出失败，请重试。')
    tokens.clear(); authenticated.value = false
  }
  function disconnect(keepThread = false) {
    startupConnectionPending = false
    resetGoals()
    archiveRevisions.clear()
    serverQueue?.dispose(); serverQueue = undefined; serverQueueSupported.value = false; queueAdding = false
    clearInterval(queueRefreshTimer); clearTimeout(settingsTimer); pendingSettings.clear(); settingsWrites.clear()
    queuedMessages.value = queuedMessages.value.filter(job => job.source !== 'server' || job.deviceId !== selectedId.value)
    for (const job of queuedMessages.value) if (job.deviceId === selectedId.value) { pausedQueues.value.add(queueKey(job.threadId)); if (job.state === 'sending') { job.state = 'failed'; job.error = '连接中断，发送结果未确认。请查看会话后重试。' } }
    runningTurns.value.clear(); pendingTurnStarts.clear(); terminalTurns.clear(); turnDiffs.value.clear(); turnFailures.value.clear(); submissionFailures.value.clear(); steering.value = false
    retries.value.clear()
    clearInterval(clockTimer); clockTimer = undefined
    generation++; threadGeneration++; listGeneration++
    listController?.abort(); listController = undefined; listLoaded = false; projectsLoading.value = false
    threadLoadController?.abort(); threadLoadController = undefined
    clearTimeout(reconnectTimer); reconnectTimer = undefined; reconnectCount = 0
    client?.disconnect(); client = null
    status.value = 'disconnected'; sending.value = false; loading.value = false; loadingThread.value = false
    approvals.value = []; openingThread = ''; bufferedEvents = []
    pendingUserMessages.value = []
    pendingThreadId.value = ''; threadLoadError.value = ''; loadingEarlier.value = false; historyCursor.value = null
    if (!keepThread) { listWindow = null; listSort = 'recency_at'; active.value = null; threads.value = []; projectThreads.value = []; projectUpdates.clear(); archivedThreads.clear(); reasoningTimings.clear(); workingDirectory.value = selected.value?.cwd || ''; threadCursor.value = null; models.value = []; model.value = ''; effort.value = ''; permission.value = 'ask'; projectFilter.value = ''; projectPaths.value = []; projectsLoading.value = false; currentSearch = ''; supportsAutoReview.value = false; permissionRequirements.value = null }
  }
  function scheduleReconnect() {
    if (disposed || reconnectTimer || !online.value || !selected.value) return
    if (reconnectCount >= 5) { status.value = 'error'; error.value = '自动重连未成功。请检查服务状态，然后手动重连。'; return }
    status.value = 'reconnecting'
    const delay = Math.min(1000 * 2 ** reconnectCount++, 15000) + Math.random() * 250
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; if (selected.value) void connect(selected.value, true) }, delay)
  }
  async function connect(profile: ConnectionProfile, reconnecting = false) {
    if (disposed) return
    const resumeId = reconnecting ? pendingThreadId.value || active.value?.id : undefined
    if (!reconnecting) disconnect()
    else { resetGoals(); serverQueue?.dispose(); clearInterval(queueRefreshTimer); clearTimeout(settingsTimer); pendingSettings.clear(); settingsWrites.clear(); client?.disconnect(); approvals.value = [] }
    // A reconnect may have missed patch notifications. Do not offer an older
    // snapshot as the current net patch until this connection observes it.
    turnDiffs.value.clear(); pendingTurnStarts.clear(); steering.value = false
    const epoch = ++generation
    selectedId.value = profile.id; persist()
    if (!reconnecting) workingDirectory.value = profile.cwd
    status.value = reconnecting ? 'reconnecting' : 'connecting'; error.value = ''
    let initialized = false
    const rpc = new RpcClient({
      message: msg => { if (epoch === generation) handleMessage(msg) },
      close: reason => {
        if (epoch !== generation || !initialized) return
        threadLoadController?.abort()
        for (const job of queuedMessages.value) if (job.source !== 'server' && job.deviceId === selectedId.value) pausedQueues.value.add(queueKey(job.threadId))
        status.value = 'reconnecting'; error.value = reason; sending.value = false; loadingThread.value = false; approvals.value = []
        if (reason.includes('访问已过期')) { authenticated.value = false; status.value = 'error'; return }
        scheduleReconnect()
      },
    })
    client = rpc
    queueAdding = false
    serverQueueSupported.value = false
    serverQueue = new ServerQueueClient(rpc, (threadId, submissions) => {
      if (epoch !== generation) return
      serverQueueSupported.value = true
      queuedMessages.value = [
        ...queuedMessages.value.filter(job => job.source !== 'server' || job.deviceId !== profile.id || job.threadId !== threadId),
        ...submissions.map(job => ({ id: job.id, deviceId: profile.id, threadId, parts: messageParts(job.input), editError: messageEditError({ id: job.id, type: 'userMessage', content: job.input }), settings: settingsByThread.get(queueKey(threadId)) || settingsSnapshot(), state: 'queued' as const, source: 'server' as const })),
      ]
    }, message => { if (epoch === generation) toast(message) })
    try {
      if (!online.value) throw new Error('当前处于离线状态，联网后可连接 App Server。')
      await rpc.connect(profile.endpoint, tokens.get(profile.id) || '', profile.credentialId)
      if (epoch !== generation) return
      initialized = true; status.value = 'connected'; reconnectCount = 0; authenticated.value = true; bridgeReachable.value = true
      // A slow model listing must not hold the conversation behind a loading screen.
      void refreshThreads(); void loadModels(rpc, epoch); void loadPermissionCapabilities(rpc, epoch, profile.cwd)
      if (epoch !== generation) return
      if (resumeId) await openThread(resumeId)
      if (epoch === generation) queueRefreshTimer = setInterval(() => { if (connected.value && active.value) void refreshServerQueue(active.value.id).catch(() => {}) }, 15_000)
    } catch (e) {
      if (epoch !== generation) return
      rpc.disconnect(); error.value = messageOf(e)
      if (e instanceof RpcError && e.code === 401) { authenticated.value = false; status.value = 'error'; return }
      if (reconnecting) scheduleReconnect(); else status.value = 'error'
    }
  }
  async function loadModels(rpc: RpcClient, epoch: number) {
    try {
      const result: Model[] = []
      let cursor: string | null = null
      do {
        const page: { data: Model[]; nextCursor: string | null } = await rpc.request('model/list', { cursor })
        result.push(...page.data.filter(m => !m.hidden)); cursor = page.nextCursor
      } while (cursor && epoch === generation)
      if (epoch === generation) models.value = result
    } catch (e) { if (epoch === generation) error.value = '模型列表加载失败：' + messageOf(e) }
  }
  async function loadPermissionCapabilities(rpc: RpcClient, epoch: number, cwd?: string) {
    await Promise.allSettled([
      rpc.request<{ config: Record<string, unknown> }>('config/read', { includeLayers: false, ...(cwd ? { cwd } : {}) }).then(result => {
        if (epoch !== generation) return
        const features = result.config.features as Record<string, unknown> | undefined
        if (features?.goals === false && goalSupported.value === null) goalSupported.value = false
        supportsAutoReview.value = 'approvals_reviewer' in result.config && features?.auto_review !== false && features?.guardian_approval !== false
      }),
      rpc.request<{ requirements: typeof permissionRequirements.value }>('configRequirements/read').then(result => { if (epoch === generation) permissionRequirements.value = result.requirements }),
    ])
  }
  async function refreshThreads(search = currentSearch, more = false) {
    if (!client || !connected.value) return
    const changedSearch = search !== currentSearch
    currentSearch = search
    // Search only the current date window; a rare keyword must not scan old history.
    if (changedSearch && (listLoaded || projectsLoading.value)) { filterRecentThreads(); return }
    if (more && !threadCursor.value) return
    listController?.abort()
    const controller = new AbortController(), rpc = client
    listController = controller
    const epoch = generation, requestId = ++listGeneration
    const current = () => !controller.signal.aborted && epoch === generation && requestId === listGeneration
    const existing = more ? [...projectThreads.value] : []
    projectUpdates.clear(); loading.value = true; projectsLoading.value = true
    try {
      const result = await fetchRecentThreads<Thread>((method, params, options) => rpc.request(method, params, options), {
        signal: controller.signal, cursor: more ? threadCursor.value : null,
        window: more ? listWindow : null, sortKey: more ? listSort : 'recency_at',
        onPage: page => {
          if (!current()) return
          listWindow = page.window; listSort = page.sortKey
          projectThreads.value = existing
          // Preserve notifications received while the paginated snapshot is loading.
          rememberProjects([...page.data, ...[...projectUpdates.values()].filter((thread): thread is Thread => !!thread && typeof thread.id === 'string')], true)
          threadCursor.value = page.nextCursor
        },
      })
      if (!current()) return
      listLoaded = true; threadCursor.value = result.nextCursor
    } catch (e) {
      if (current()) error.value = '会话列表加载失败：' + messageOf(e)
    } finally {
      if (current()) { loading.value = false; projectsLoading.value = false; projectUpdates.clear(); listController = undefined }
    }
  }
  async function openThread(id: string, duringRevision = false) {
    if (revising.value && !duringRevision) return
    if (!client || !connected.value) return
    threadLoadController?.abort()
    const controller = new AbortController()
    threadLoadController = controller
    const epoch = generation, requestId = ++threadGeneration
    const settingsKey = queueKey(id), settingsVersion = settingsVersions.get(settingsKey) || 0
    const rpc = client, options = { signal: controller.signal, timeoutMs: 15_000 }
    loadingThread.value = true; pendingThreadId.value = id; threadLoadError.value = ''; loadingEarlier.value = false
    openingThread = id; bufferedEvents = []; error.value = ''
    // Resume notifications must supersede any in-flight goal snapshot.
    void refreshThreadGoal(id)
    try {
      const result = await rpc.request<ThreadResult>('thread/resume', { threadId: id, excludeTurns: true }, options)
      let resumedSettings = result
      let turns: Turn[], cursor: string | null = null
      try {
        const [metadata, page] = await Promise.all([
          rpc.request<{ data: Turn[] }>('thread/turns/list', { threadId: id, limit: 20, sortDirection: 'desc', itemsView: 'notLoaded' }, options),
          rpc.request<ThreadItemsPage>('thread/items/list', { threadId: id, limit: 60, sortDirection: 'desc' }, options),
        ])
        if (epoch !== generation || requestId !== threadGeneration) return
        turns = hydrateItems(page, metadata.data, id); cursor = page.nextCursor
      } catch (e) {
        // Older servers have no pagination. Only fall back on an explicit method-not-found.
        if (!(e instanceof RpcError) || e.code !== -32601) throw e
        const legacy = result.thread.turns?.length ? result : await rpc.request<ThreadResult>('thread/resume', { threadId: id }, options)
        resumedSettings = legacy
        if (epoch !== generation || requestId !== threadGeneration) return
        turns = (legacy.thread.turns || []).map(turn => ({ ...turn, items: turn.items.map(item => rememberReasoning(id, turn.id, item.type === 'reasoning' ? { ...item, status: turn.status === 'inProgress' ? item.status || 'inProgress' : 'completed' } : item)) }))
        if (legacy.turnsBackwardsCursor || legacy.itemsBackwardsCursor) toast('服务器仅返回了部分历史，请升级 App Server 以加载更早消息。')
      }
      if (epoch !== generation || requestId !== threadGeneration) return
      active.value = { ...result.thread, turns }; historyCursor.value = cursor
      for (const turn of turns) for (const item of turn.items) if (item.type === 'userMessage') reconcilePendingUserMessage(id, item.id, item.content, item.clientId)
      workingDirectory.value = result.thread.cwd
      rememberProjects([active.value])
      const savedSettings = settingsByThread.get(settingsKey)
      const retained = unsavedSettings.get(settingsKey) || ((settingsVersions.get(settingsKey) || 0) !== settingsVersion || pendingSettings.has(id) || settingsWrites.has(id) ? savedSettings : undefined)
      const restored: ComposerSettings = retained || {
        model: resumedSettings.model ?? savedSettings?.model ?? '',
        effort: resumedSettings.reasoningEffort !== undefined ? resumedSettings.reasoningEffort ?? '' : savedSettings?.effort ?? '',
        permission: restoredPermission(resumedSettings) ?? savedSettings?.permission ?? 'custom',
        serviceTier: resumedSettings.serviceTier !== undefined ? resumedSettings.serviceTier : savedSettings?.serviceTier,
      }
      if (!retained) rememberSettings(settingsKey, restored)
      restoringSettings = true
      model.value = restored.model; effort.value = restored.effort; permission.value = restored.permission; serviceTier.value = restored.serviceTier
      restoringSettings = false
      const running = turns.find(t => t.status === 'inProgress')
      if (running) runningTurns.value.set(id, running.id); else runningTurns.value.delete(id)
      if (!running || retries.value.get(queueKey(id))?.turnId !== running.id) retries.value.delete(queueKey(id))
      openingThread = ''
      for (const event of bufferedEvents) handleMessage(event)
      bufferedEvents = []
      pendingThreadId.value = ''
      void refreshServerQueue(id).then(() => drainQueue(id)).catch(cause => { if (epoch === generation) toast('队列同步失败：' + messageOf(cause)) })
    } catch (e) {
      if (epoch === generation && requestId === threadGeneration && !controller.signal.aborted) {
        controller.abort()
        threadLoadError.value = '无法打开会话：' + messageOf(e)
      }
    }
    finally { if (epoch === generation && requestId === threadGeneration) { loadingThread.value = false; openingThread = ''; bufferedEvents = [] } }
  }
  function hydrateItems(page: ThreadItemsPage, metadata: Turn[], threadId: string): Turn[] {
    const byId = new Map(metadata.map(t => [t.id, t]))
    const ordered = new Map<string, Turn>()
    for (const { turnId, item, startedAtMs, completedAtMs } of [...page.data].reverse()) {
      if (!ordered.has(turnId)) ordered.set(turnId, { ...byId.get(turnId), id: turnId, status: byId.get(turnId)?.status || 'completed', items: [] })
      const turn = ordered.get(turnId)!
      const hydrated = rememberReasoning(threadId, turnId, { ...item, startedAtMs: timestamp(startedAtMs) ?? item.startedAtMs, completedAtMs: timestamp(completedAtMs) ?? item.completedAtMs })
      if (hydrated.type === 'reasoning' || hydrated.type === 'contextCompaction') hydrated.status = hydrated.completedAtMs != null || turn.status !== 'inProgress' ? 'completed' : hydrated.status || 'inProgress'
      turn.items.push(hydrated)
    }
    // Empty live turns still need a Stop control, even before their first item.
    for (const turn of [...metadata].reverse()) if (turn.status === 'inProgress' && !ordered.has(turn.id)) ordered.set(turn.id, { ...turn, items: [] })
    return [...ordered.values()]
  }
  async function loadEarlier() {
    if (revising.value || !client || !active.value || !historyCursor.value || loadingEarlier.value) return
    const epoch = generation, view = threadGeneration, id = active.value.id
    loadingEarlier.value = true
    try {
      const page = await client.request<ThreadItemsPage>('thread/items/list', { threadId: id, cursor: historyCursor.value, limit: 60, sortDirection: 'desc' }, { signal: threadLoadController?.signal, timeoutMs: 15_000 })
      if (epoch !== generation || view !== threadGeneration || active.value?.id !== id) return
      const all = new Map(hydrateItems(page, active.value.turns, id).map(t => [t.id, t]))
      for (const turn of active.value.turns) {
        const older = all.get(turn.id)?.items || []
        all.set(turn.id, { ...turn, items: [...new Map([...older, ...turn.items].map(i => [i.id, i])).values()] })
      }
      active.value.turns = [...all.values()]; historyCursor.value = page.nextCursor
    } catch (e) { if (epoch === generation && view === threadGeneration && !(e instanceof DOMException && e.name === 'AbortError')) error.value = '加载更早消息失败：' + messageOf(e) }
    finally { if (epoch === generation && view === threadGeneration) loadingEarlier.value = false }
  }
  function cancelThreadLoad() { threadGeneration++; threadLoadController?.abort(); openingThread = ''; bufferedEvents = []; loadingThread.value = false; pendingThreadId.value = ''; threadLoadError.value = ''; loadingEarlier.value = false }
  function newThread() { cancelThreadLoad(); submissionFailures.value.delete(turnDiffKey('', '')); pendingUserMessages.value = []; active.value = null; workingDirectory.value = selected.value?.cwd || ''; historyCursor.value = null; error.value = '' }
  function ensureTurn(id: string): Turn | undefined {
    if (!active.value) return
    let turn = active.value.turns.find(t => t.id === id)
    if (!turn) { turn = { id, items: [], status: 'inProgress' }; active.value.turns.push(turn); return active.value.turns[active.value.turns.length - 1] }
    return turn
  }
  function mergeTurn(incoming: Turn, responseSnapshot = false) {
    for (const item of incoming.items || []) if (item.type === 'userMessage') reconcilePendingUserMessage(active.value?.id || '', item.id, item.content, item.clientId)
    const turn = ensureTurn(incoming.id)
    if (!turn) return
    const items = new Map(turn.items.map(item => [item.id, item]))
    for (const item of incoming.items || []) items.set(item.id, responseSnapshot ? mergeItem(item, items.get(item.id) || item) : mergeItem(items.get(item.id), item))
    const finalStatus = responseSnapshot && turn.status !== 'inProgress' ? turn.status : incoming.status
    const timing: Partial<Turn> = {}
    for (const field of ['startedAt', 'completedAt', 'durationMs'] as const) {
      // Completion snapshots may omit the start. Preserve native metadata, never
      // derive a historical work duration from when this client joined a turn.
      const next = responseSnapshot && turn.status !== 'inProgress' ? turn[field] ?? incoming[field] : incoming[field] ?? turn[field]
      if (typeof next === 'number' && Number.isFinite(next) && next >= 0) timing[field] = next
    }
    Object.assign(turn, incoming, timing, { status: finalStatus, items: [...items.values()].map(item => rememberReasoning(active.value!.id, incoming.id, (item.type === 'reasoning' || item.type === 'contextCompaction') && finalStatus !== 'inProgress' ? { ...item, status: item.type === 'contextCompaction' && finalStatus !== 'completed' ? 'failed' : 'completed' } : item)) })
  }
  function wireSettings(settings: ComposerSettings, start = false) {
    const access = permissionParams(settings.permission)
    const selectedModel = models.value.find(model => model.model === settings.model) || (!settings.model ? models.value.find(model => model.isDefault) : undefined)
    const effectiveModel = settings.model || selectedModel?.model
    const effectiveEffort = settings.effort || selectedModel?.defaultReasoningEffort
    return { ...(effectiveModel ? { model: effectiveModel } : {}), ...(effectiveEffort && !start ? { effort: effectiveEffort } : {}), ...(settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}), approvalPolicy: access.approvalPolicy, approvalsReviewer: access.approvalsReviewer, ...(start ? { sandbox: access.sandbox } : { sandboxPolicy: access.sandboxPolicy }) }
  }
  async function refreshThreadGoal(threadId: string, retryUnavailable = false): Promise<boolean> {
    const key = goalKey(threadId)
    if (goalSupported.value === false && !retryUnavailable || goalWrites.value.has(key)) return false
    if (!client || !connected.value) { goalErrors.value.set(key, '设备未连接，无法读取目标。'); return false }
    const rpc = client, epoch = generation, deviceId = selectedId.value, version = nextGoalVersion(key), read = Symbol()
    goalReads.value.set(key, read); goalErrors.value.delete(key)
    try {
      const response = await rpc.request('thread/goal/get', { threadId }, { timeoutMs: 8000 })
      if (rpc !== client || epoch !== generation || deviceId !== selectedId.value) return false
      if (goalVersions.get(key) !== version) return true
      goals.value.set(key, readGoalResponse(response, threadId)); goalSupported.value = true
      return true
    } catch (cause) {
      if (rpc === client && epoch === generation && deviceId === selectedId.value && goalVersions.get(key) === version) {
        if (goalUnavailable(cause)) goalSupported.value = false
        goalErrors.value.set(key, goalUnavailable(cause) ? GOAL_UNAVAILABLE : '目标读取失败：' + messageOf(cause))
      }
      return false
    } finally { if (goalReads.value.get(key) === read) goalReads.value.delete(key) }
  }
  async function refreshGoal(): Promise<boolean> { return active.value ? refreshThreadGoal(active.value.id, true) : false }
  async function mutateGoal(update?: ThreadGoalUpdate): Promise<boolean> {
    let key = goalKey(), threadId = active.value?.id
    if (goalWrites.value.has(key)) return false
    if (!client || !connected.value || loadingThread.value || revising.value || sending.value) { goalErrors.value.set(key, '会话当前无法修改目标，请连接设备并等待会话加载完成。'); return false }
    if (goalSupported.value === false) { goalErrors.value.set(key, GOAL_UNAVAILABLE); return false }
    const rpc = client, epoch = generation, deviceId = selectedId.value, viewEpoch = threadGeneration, write = Symbol(), initialKey = key
    const currentConnection = () => rpc === client && epoch === generation && deviceId === selectedId.value && connected.value
    const currentView = () => currentConnection() && viewEpoch === threadGeneration && active.value?.id === threadId
    goalWrites.value.set(key, write); goalErrors.value.delete(key); nextGoalVersion(key)
    let goalRequest = false, created = false
    try {
      if (update) validateGoalUpdate(update)
      if (!threadId) {
        if (!update?.objective?.trim()) throw new Error('请先填写新对话的目标。')
        if (permission.value === 'custom') throw new Error('新对话请选择明确的权限模式。')
        if (permissionUnavailable.value[permission.value]) throw new Error(permissionUnavailable.value[permission.value])
        const settings = settingsSnapshot(), cwd = workingDirectory.value, effort = wireSettings(settings).effort
        const result = await rpc.request<ThreadResult>('thread/start', { ...wireSettings(settings, true), ...(cwd ? { cwd } : {}), ...(effort ? { config: { model_reasoning_effort: effort } } : {}) })
        if (!currentView()) return false
        if (!isThreadSummary(result.thread)) throw new Error('新对话响应无效，目标未提交。')
        threadId = result.thread.id; key = goalKey(threadId)
        goalWrites.value.set(key, write); nextGoalVersion(key); goalErrors.value.delete(key)
        active.value = result.thread; workingDirectory.value = result.thread.cwd
        created = true
        rememberProjects([result.thread])
      }
      // Rust goal/set can start work immediately. Wait for the latest settings,
      // including edits made while thread/start or the settings acknowledgment waited.
      // Stopping/clearing stays available even after managed permissions change.
      if (update && (created || update.status === 'active' || update.status == null)) {
        if (permissionUnavailable.value[permission.value]) throw new Error(permissionUnavailable.value[permission.value])
        const settings = settingsSnapshot()
        rememberSettings(queueKey(threadId), settings, true)
        await persistServerSettings(rpc, threadId, settings, { cwd: active.value!.cwd || workingDirectory.value, isCurrent: currentView })
        if (!currentView()) return false
        if (permissionUnavailable.value[permission.value]) throw new Error(permissionUnavailable.value[permission.value])
      }
      if (!currentView()) return false
      const version = nextGoalVersion(key)
      goalRequest = true
      const response = await rpc.request(update ? 'thread/goal/set' : 'thread/goal/clear', update ? { threadId, objective: update.objective, status: update.status, tokenBudget: update.tokenBudget } : { threadId }, { timeoutMs: 10_000 })
      if (!currentConnection()) return false
      let confirmed: ThreadGoal | null
      if (update) confirmed = readGoalResponse(response, threadId, false)
      else {
        if (!isRecord(response) || typeof response.cleared !== 'boolean') throw new Error('清除目标的响应无效，请刷新确认。')
        confirmed = null // cleared:false confirms that no goal exists, too.
      }
      if (goalVersions.get(key) === version) { goals.value.set(key, confirmed); nextGoalVersion(key); goalErrors.value.delete(key) }
      goalSupported.value = true
      return currentView()
    } catch (cause) {
      if (currentConnection()) {
        if (goalRequest && goalUnavailable(cause)) goalSupported.value = false
        goalErrors.value.set(key, goalRequest && goalUnavailable(cause) ? GOAL_UNAVAILABLE : (goalRequest ? '目标操作失败：' : '目标未提交，无法确认设置或请求：') + messageOf(cause))
      }
      return false
    } finally {
      for (const ownedKey of [initialKey, key]) if (goalWrites.value.get(ownedKey) === write) goalWrites.value.delete(ownedKey)
    }
  }
  async function setGoal(update: ThreadGoalUpdate): Promise<boolean> { return mutateGoal(update) }
  async function clearGoal(): Promise<boolean> {
    if (!active.value) { goalErrors.value.set(goalKey(), '请先打开要清除目标的会话。'); return false }
    return mutateGoal()
  }
  async function searchFiles(query: string, options: { signal?: AbortSignal } = {}): Promise<FuzzyFileSearchResult[]> {
    const cancelled = () => new DOMException('文件搜索已取消或会话已切换。', 'AbortError')
    if (options.signal?.aborted) throw cancelled()
    if (!query.trim()) return []
    if (!client || !connected.value) throw new RpcError('设备未连接，无法搜索文件。')
    const root = active.value?.cwd || workingDirectory.value
    if (!root.trim()) throw new RpcError('请先选择当前设备的工作目录。')
    const rpc = client, epoch = generation, deviceId = selectedId.value, viewEpoch = threadGeneration
    const current = () => rpc === client && epoch === generation && deviceId === selectedId.value && viewEpoch === threadGeneration && root === (active.value?.cwd || workingDirectory.value)
    let response: unknown
    try { response = await rpc.request('fuzzyFileSearch', { query, roots: [root], cancellationToken: crypto.randomUUID() }, { signal: options.signal, timeoutMs: 8000 }) }
    catch (cause) { if (!current() || options.signal?.aborted) throw cancelled(); throw cause }
    if (!current() || options.signal?.aborted) throw cancelled()
    if (!isRecord(response) || !Array.isArray(response.files)) throw new RpcError('文件搜索响应无效。')
    const normalized = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
    return response.files.slice(0, 50).map((file: unknown) => {
      if (!isRecord(file) || typeof file.root !== 'string' || normalized(file.root) !== normalized(root)
        || typeof file.path !== 'string' || !file.path || file.path.length > 4096 || /[\x00-\x1f]/.test(file.path)
        || /^(?:[\\/]|[a-z]:)/i.test(file.path) || file.path.split(/[\\/]/).includes('..')
        || !['file', 'directory'].includes(String(file.match_type)) || typeof file.file_name !== 'string' || !file.file_name
        || typeof file.score !== 'number' || !Number.isFinite(file.score)
        || !(file.indices === null || Array.isArray(file.indices) && file.indices.length <= 4096 && file.indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < (file.path as string).length))) throw new RpcError('文件搜索响应无效或包含当前工作目录以外的路径。')
      return { root: file.root, path: file.path, match_type: file.match_type, file_name: file.file_name, score: file.score, indices: file.indices } as FuzzyFileSearchResult
    })
  }
  async function dispatchInput(parts: PromptPart[], settings: ComposerSettings, targetId?: string) {
    if (!client || !connected.value) throw new Error('设备未连接。')
    const input = toInputs(parts)
    const rpc = client, epoch = generation, viewEpoch = threadGeneration
    const foreground = !targetId || targetId === active.value?.id
    if (foreground) sending.value = true
    let threadId = targetId || active.value?.id
    let pending: PendingUserMessage | undefined
    let startConfirmed = false
    let optimisticThreadId = ''
    try {
      if (!threadId) {
        if (foreground) {
          optimisticThreadId = 'pending-thread-' + crypto.randomUUID()
          active.value = { id: optimisticThreadId, name: null, preview: promptText(parts).trim().slice(0, 200), cwd: workingDirectory.value, createdAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000), status: { type: 'active' }, turns: [] }
          threadId = optimisticThreadId
          pending = addPendingUserMessage(threadId, input)
        }
        const cwd = workingDirectory.value
        const result = await rpc.request<ThreadResult>('thread/start', { ...wireSettings(settings, true), ...(cwd ? { cwd } : {}) })
        if (epoch !== generation || viewEpoch !== threadGeneration) throw new Error('对话已切换，消息未发送。')
        if (pending) pending.threadId = result.thread.id
        active.value = result.thread; threadId = result.thread.id
        if (!threads.value.some(t => t.id === threadId)) threads.value.unshift(result.thread)
        rememberProjects([result.thread])
      }
      const settingsKey = queueKey(threadId)
      if (foreground && active.value?.id === threadId && !pending) pending = addPendingUserMessage(threadId, input)
      rememberSettings(settingsKey, settings, true)
      pendingTurnStarts.add(settingsKey)
      const result = await rpc.request<{ turn: Turn }>('turn/start', { threadId, input, ...wireSettings(settings) })
      startConfirmed = true
      if (epoch !== generation) throw new Error('连接已变化，发送结果未确认。请查看会话后重试。')
      // This submission already applied the selected settings. Do not replay an
      // older debounce later; edits made after dispatch must still be synced.
      if (settingsByThread.get(settingsKey) === settings) pendingSettings.delete(threadId)
      acknowledgeSettings(settingsKey, settings)
      if (result.turn.status === 'inProgress' && !terminalTurns.has(result.turn.id)) runningTurns.value.set(threadId, result.turn.id)
      const preview = promptText(parts).trim().slice(0, 200)
      if (active.value?.id === threadId) { mergeTurn(result.turn, true); if (!active.value.preview) active.value.preview = preview }
      const listed = threads.value.find(thread => thread.id === threadId)
      const project = projectThreads.value.find(thread => thread.id === threadId)
      updateThreadMetadata(threadId, { preview: active.value?.id === threadId ? active.value.preview : listed?.preview || project?.preview || preview, updatedAt: Math.floor(Date.now() / 1000), recencyAt: Math.floor(Date.now() / 1000) })
    } finally {
      if (epoch === generation) {
        if (foreground) sending.value = false
        if (threadId) {
          // No acknowledgement is different from an observed failed turn: its
          // start may already have committed. Hold later work for reconciliation.
          if (!startConfirmed && pending) removePendingUserMessage(pending.id)
          if (!startConfirmed && optimisticThreadId && active.value?.id === optimisticThreadId) active.value = null
          if (!startConfirmed && pendingTurnStarts.has(queueKey(threadId))) pausedQueues.value.add(queueKey(threadId))
          pendingTurnStarts.delete(queueKey(threadId))
          // Completion can arrive before the RPC ack; it must not strand the
          // queued follow-up behind the pending-start/sending guard.
          const completedThreadId = threadId
          if (startConfirmed) queueMicrotask(() => { if (epoch === generation) void drainQueue(completedThreadId) })
        }
      }
    }
  }
  async function refreshServerQueue(threadId: string) {
    const queue = serverQueue
    if (!queue || !connected.value) return false
    const supported = await queue.refresh(threadId)
    if (queue === serverQueue) serverQueueSupported.value = supported
    return supported
  }
  function persistServerSettings(rpc: RpcClient, threadId: string, settings: ComposerSettings, options: { cwd?: string; isCurrent?: () => boolean } = {}) {
    const previous = settingsWrites.get(threadId) || Promise.resolve()
    const key = queueKey(threadId)
    const write = previous.catch(() => {}).then(async () => {
      // Resolve the latest thread settings at dispatch time, then wait for any
      // changes made during the ack. Never enqueue with an older permission snapshot.
      for (;;) {
        if (rpc !== client || !connected.value) throw new Error('连接已变化，设置未同步。')
        if (options.isCurrent && !options.isCurrent()) throw new Error('会话已切换，目标未提交。')
        const latest = settingsByThread.get(key) || settings
        if (pendingSettings.get(threadId) === latest) pendingSettings.delete(threadId)
        await rpc.request('thread/settings/update', { threadId, ...wireSettings(latest), ...(options.cwd ? { cwd: options.cwd } : {}) }, { timeoutMs: 10_000 })
        if (rpc !== client) throw new Error('连接已变化，设置未同步。')
        acknowledgeSettings(key, latest)
        if (!settingsByThread.has(key) || settingsByThread.get(key) === latest) return
      }
    })
    settingsWrites.set(threadId, write)
    void write.finally(() => { if (settingsWrites.get(threadId) === write) settingsWrites.delete(threadId) }).catch(() => {})
    return write
  }
  async function send(parts: PromptPart[]) {
    if (!active.value && goalSaving.value) return false
    if (queueAdding || revising.value || !connected.value || loadingThread.value || threadLoadError.value || !hasPrompt(parts)) return false
    if (permissionUnavailable.value[permission.value]) { error.value = permissionUnavailable.value[permission.value]!; return false }
    if (busy.value || currentQueue.value.length) {
      if (!active.value) return false
      const threadId = active.value.id, queue = serverQueue, rpc = client, epoch = generation, settings = settingsSnapshot()
      queueAdding = true
      let submitted = false
      try {
        if (await refreshServerQueue(threadId)) {
          if (!queue || !rpc || rpc !== client) throw new Error('连接已变化，消息未排队。')
          pendingSettings.delete(threadId)
          await persistServerSettings(rpc, threadId, settings)
          if (rpc !== client) throw new Error('连接已变化，消息未排队。')
          submitted = true
          await queue.add(threadId, toInputs(parts), crypto.randomUUID())
          return true
        }
        if (epoch !== generation) return false
        if (queuedMessages.value.some(job => job.deviceId === selectedId.value && job.threadId === threadId && job.source === 'server')) throw new Error('服务端队列暂不可用，请重新连接后确认待发消息。')
        queuedMessages.value.push({ id: crypto.randomUUID(), deviceId: selectedId.value, threadId, parts: parts.map(part => ({ ...part })), settings: settingsByThread.get(queueKey(threadId)) || settings, state: 'queued' })
        void drainQueue(threadId); return true
      } catch (cause) {
        if (epoch === generation) error.value = submitted && (!(cause instanceof RpcError) || cause.code === undefined) ? '排队结果尚未确认，请先检查共享队列和会话，未自动重发。' : '无法加入队列：' + messageOf(cause)
        if (epoch === generation) notifyRequestFailure(threadId)
        return false
      } finally { if (epoch === generation) queueAdding = false }
    }
    error.value = ''
    if (active.value) pausedQueues.value.delete(queueKey(active.value.id))
    const epoch = generation, viewEpoch = threadGeneration
    submissionFailures.value.delete(turnDiffKey(active.value?.id || '', ''))
    try { await dispatchInput(parts, settingsSnapshot()); return true }
    catch (e) { if (epoch === generation && viewEpoch === threadGeneration) submissionFailed(active.value?.id || '', messageOf(e)); return false }
  }
  async function steer(parts: PromptPart[]): Promise<boolean> {
    const threadId = active.value?.id, turnId = activeTurn.value?.id || (threadId ? runningTurns.value.get(threadId) : undefined)
    if (!threadId || !turnId || !client || !connected.value || !hasPrompt(parts) || steering.value || sending.value || queueAdding || revising.value || loadingThread.value || threadLoadError.value) return false
    const rpc = client, epoch = generation, viewEpoch = threadGeneration, device = selectedId.value
    const current = () => rpc === client && epoch === generation && device === selectedId.value && connected.value
    const currentView = () => current() && viewEpoch === threadGeneration && active.value?.id === threadId
    const key = queueKey(threadId)
    if (permissionUnavailable.value[permission.value]) { submissionFailed(threadId, permissionUnavailable.value[permission.value]!); return false }
    let input: MessageContent[]
    try { input = toInputs(parts) }
    catch (cause) { submissionFailed(threadId, messageOf(cause)); return false }
    steering.value = true
    submissionFailures.value.delete(turnDiffKey(threadId, ''))
    const pending = addPendingUserMessage(threadId, input, 'island')
    let cancelled = false
    const local = pendingUserMessages.value.find(message => message.id === pending.id)!
    local.cancelable = true
    steerWithdrawals.set(pending.id, () => { cancelled = true; removePendingUserMessage(pending.id) })
    let accepted = false
    let attempted = false
    try {
      // Settings are a separate acknowledged update. turn/steer itself has no
      // model/effort/permission fields and must not pretend to apply those.
      if (serverQueueSupported.value && (unsavedSettings.has(key) || pendingSettings.has(threadId) || settingsWrites.has(threadId))) {
        await persistServerSettings(rpc, threadId, settingsSnapshot(), { isCurrent: currentView })
      }
      if (!currentView() || cancelled) return false
      if (permissionUnavailable.value[permission.value]) throw new Error(permissionUnavailable.value[permission.value])
      const running = activeTurn.value?.id || runningTurns.value.get(threadId)
      if (running !== turnId || terminalTurns.has(turnId)) { submissionFailed(threadId, '当前回合已变化，请重新发送。'); return false }
      attempted = true
      local.cancelable = false; steerWithdrawals.delete(pending.id)
      const response = await rpc.request<{ turnId: string }>('turn/steer', { threadId, expectedTurnId: turnId, input, clientUserMessageId: pending.clientId })
      if (!currentView()) return false
      if (!isRecord(response) || response.turnId !== turnId) throw new RpcError('插话响应无效，发送结果尚未确认。')
      accepted = true
      const row = pendingUserMessages.value.find(message => message.id === pending.id)
      if (row) row.accepted = true
      return true
    } catch (cause) {
      if (!currentView()) return false
      const data = cause instanceof RpcError && isRecord(cause.data) ? cause.data : undefined
      const info = data && isRecord(data.codexErrorInfo) ? data.codexErrorInfo : undefined
      const notSteerable = info && isRecord(info.activeTurnNotSteerable) ? info.activeTurnNotSteerable : undefined
      // This is the installed TUI's structured rejection, not a string match.
      // An uncertain timeout/malformed acknowledgement must never enqueue again.
      if (attempted && cause instanceof RpcError && cause.code === -32602 && notSteerable && ['review', 'compact'].includes(String(notSteerable.turnKind))) {
        removePendingUserMessage(pending.id)
        return await send(parts)
      }
      submissionFailed(threadId, attempted && (!(cause instanceof RpcError) || cause.code === undefined)
        ? '插话结果尚未确认，请先查看会话。' : messageOf(cause))
      return false
    } finally {
      steerWithdrawals.delete(pending.id)
      if (!accepted) removePendingUserMessage(pending.id)
      if (epoch === generation) steering.value = false
    }
  }
  async function drainQueue(threadId: string) {
    const key = queueKey(threadId)
    if (revisionThreadId.value === threadId) return
    if (!connected.value || drainingQueues.has(key) || pendingTurnStarts.has(key) || pausedQueues.value.has(key) || runningTurns.value.has(threadId)) return
    const thread = active.value?.id === threadId ? active.value : threads.value.find(thread => thread.id === threadId)
    if (thread?.status?.type === 'active' || approvals.value.some(approval => approval.params.threadId === threadId)) return
    if (pendingThreadId.value === threadId && loadingThread.value) return
    if (active.value?.id === threadId && (sending.value || activeTurn.value)) return
    const job = queuedMessages.value.find(job => job.deviceId === selectedId.value && job.threadId === threadId)
    if (!job || job.source === 'server' || job.state !== 'queued') return
    const epoch = generation
    drainingQueues.add(key); job.state = 'sending'; job.error = undefined
    try {
      if (serverQueueSupported.value && serverQueue && client) {
        const queue = serverQueue, rpc = client
        await persistServerSettings(rpc, threadId, job.settings)
        if (epoch !== generation || rpc !== client || queue !== serverQueue) throw new Error('连接已变化，消息未排队。')
        await queue.add(threadId, toInputs(job.parts), crypto.randomUUID())
      } else await dispatchInput(job.parts, job.settings, job.threadId)
      queuedMessages.value = queuedMessages.value.filter(message => message.id !== job.id)
    }
    catch (e) { job.state = 'failed'; job.error = messageOf(e); pausedQueues.value.add(key); if (epoch === generation) notifyRequestFailure(threadId) }
    finally { drainingQueues.delete(key); if (epoch === generation) queueMicrotask(() => void drainQueue(threadId)) }
  }
  async function removeQueued(id: string) {
    const job = queuedMessages.value.find(job => job.id === id && job.deviceId === selectedId.value)
    if (!job || job.state === 'sending') return
    if (job.source === 'server') {
      if (!serverQueue || !connected.value) return
      const epoch = generation
      try { await serverQueue.remove(job.threadId, id) } catch (cause) { if (epoch === generation) error.value = '移除队列消息失败：' + messageOf(cause) }
    } else queuedMessages.value = queuedMessages.value.filter(message => message !== job)
  }
  async function updateQueued(id: string, parts: PromptPart[]) {
    const job = queuedMessages.value.find(job => job.id === id && job.deviceId === selectedId.value)
    if (!job || job.state === 'sending' || job.editError || !hasPrompt(parts)) return false
    if (job.source === 'server') {
      if (!serverQueue || !connected.value) return false
      const epoch = generation
      try { await serverQueue.update(job.threadId, id, toInputs(parts)); return true }
      catch (cause) { if (epoch === generation) error.value = '修改队列消息失败：' + messageOf(cause); return false }
    }
    job.parts = parts.map(part => ({ ...part })); job.error = undefined; job.state = 'queued'; return true
  }
  async function resumeQueue() {
    if (!active.value || !currentQueue.value.length) return
    if (serverQueueSupported.value && currentQueue.value.every(job => job.source === 'server')) {
      if (!client || !serverQueue || !connected.value || busy.value) return
      const rpc = client, queue = serverQueue, threadId = active.value.id, epoch = generation
      sending.value = true
      try {
        pendingSettings.delete(threadId)
        await persistServerSettings(rpc, threadId, settingsSnapshot())
        if (epoch !== generation || rpc !== client) return
        const turn = await queue.start(threadId)
        if (epoch !== generation) return
        if (turn.status === 'inProgress' && !terminalTurns.has(turn.id)) runningTurns.value.set(threadId, turn.id)
        if (active.value?.id === threadId) mergeTurn(turn, true)
      } catch (cause) { if (epoch === generation) error.value = '启动队列失败：' + messageOf(cause) }
      finally { if (epoch === generation) sending.value = false }
      return
    }
    pausedQueues.value.delete(queueKey(active.value.id))
    for (const job of currentQueue.value) if (job.state === 'failed') { job.state = 'queued'; job.error = undefined }
    void drainQueue(active.value.id)
  }
  function pauseQueue() { if (active.value && currentQueue.value.some(job => job.source !== 'server')) pausedQueues.value.add(queueKey(active.value.id)) }
  function messageTarget(itemId: string) {
    if (!active.value) return undefined
    const turnIndex = active.value.turns.findIndex(turn => turn.items.some(item => item.id === itemId && item.type === 'userMessage'))
    if (turnIndex < 0) return undefined
    const turn = active.value.turns[turnIndex], item = turn.items.find(item => item.id === itemId)!
    return { turnId: turn.id, item, laterTurns: active.value.turns.length - turnIndex - 1 }
  }
  async function reviseMessage(itemId: string, replacement?: PromptPart[]): Promise<{ ok: boolean; reverted: boolean; uncertain?: boolean; error?: string }> {
    const target = messageTarget(itemId), threadId = active.value?.id
    if (!client || !connected.value || !target || !threadId || revising.value || loadingThread.value || sending.value) return { ok: false, reverted: false, error: '会话当前无法修改，请稍后重试。' }
    if (replacement && (!hasPrompt(replacement) || messageEditError(target.item))) return { ok: false, reverted: false, error: messageEditError(target.item) || '消息不能为空。' }
    if (replacement) {
      try { toInputs(replacement) }
      catch (cause) { return { ok: false, reverted: false, error: messageOf(cause) } }
    }
    const rpc = client, epoch = generation, settings = settingsSnapshot(), key = queueKey(threadId)
    const wasPaused = pausedQueues.value.has(key)
    let reverted = false, attempted = false, stopped = false, completed = false
    revisionThreadId.value = threadId; pausedQueues.value.add(key)
    const same = () => { if (generation !== epoch || active.value?.id !== threadId) throw new Error('连接或会话已变化，操作已停止。') }
    try {
      if (await refreshServerQueue(threadId)) {
        same()
        if (currentQueue.value.some(job => job.source === 'server')) throw new Error('请先移除服务端待发送消息，再编辑或撤回会话。')
      }
      // A steer can add multiple user messages to one turn. Never silently remove
      // an earlier user input when the server only supports whole-turn reverts.
      const first = await rpc.request<ThreadItemsPage>('thread/items/list', { threadId, turnId: target.turnId, limit: 20, sortDirection: 'asc' }, { timeoutMs: 10_000 })
      same()
      if (first.data.find(entry => entry.item.type === 'userMessage')?.item.id !== itemId) throw new Error('服务端只支持按整轮回退，请从本轮首条消息操作。')
      const running = activeTurn.value?.id || runningTurns.value.get(threadId)
      if (running) {
        stopped = true
        await rpc.request('turn/interrupt', { threadId, turnId: running }, { timeoutMs: 10_000 })
        for (let attempt = 0; ; attempt++) {
          same()
          const page = await rpc.request<{ data: Turn[] }>('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }, { timeoutMs: 5000 })
          if (!page.data.some(turn => turn.status === 'inProgress')) break
          if (attempt >= 15) throw new Error('任务仍在停止中，请稍后重试。')
          await new Promise(resolve => setTimeout(resolve, 150))
        }
      }
      same(); threadLoadController?.abort(); threadLoadController = new AbortController(); threadGeneration++; loadingEarlier.value = false
      attempted = true
      const result = await rpc.request<{ thread: Thread }>('thread/revert', { threadId, beforeTurnId: target.turnId }, { timeoutMs: 15_000 })
      reverted = true; same()
      if (result.thread?.id !== threadId) throw new Error('撤回后返回的会话信息异常，请重新加载会话。')
      const index = active.value!.turns.findIndex(turn => turn.id === target.turnId)
      const retained = index < 0 ? [] : active.value!.turns.slice(0, index)
      active.value = { ...result.thread, turns: retained }; historyCursor.value = null
      runningTurns.value.delete(threadId); retries.value.delete(key); tokenUsageByThread.value.delete(key)
      approvals.value = approvals.value.filter(approval => approval.params.threadId !== threadId)
      updateThreadMetadata(threadId, { ...result.thread, turns: retained })
      for (const timingKey of reasoningTimings.keys()) if (timingKey.startsWith(key + '/')) reasoningTimings.delete(timingKey)
      await openThread(threadId, true); same()
      if (threadLoadError.value) throw new Error('消息已撤回，但历史刷新失败。请重新加载会话。')
      if (replacement) await dispatchInput(replacement, settings, threadId)
      completed = true
      return { ok: true, reverted: true }
    } catch (cause) {
      const unavailable = cause instanceof RpcError && cause.code === -32601
      const uncertain = attempted && !reverted && (!(cause instanceof RpcError) || cause.code === undefined)
      const message = unavailable ? '此 App Server 不支持消息撤回或编辑，请升级服务端。' : uncertain ? '撤回结果尚未确认，请刷新会话后再操作。' : messageOf(cause)
      if (uncertain && generation === epoch && active.value?.id === threadId) { pendingThreadId.value = threadId; threadLoadError.value = message }
      return { ok: false, reverted, uncertain, error: message }
    } finally {
      revisionThreadId.value = null
      if (completed && !wasPaused && !queuedMessages.value.some(job => job.deviceId === selectedId.value && job.threadId === threadId)) pausedQueues.value.delete(key)
      if (!attempted && !stopped && !wasPaused) { pausedQueues.value.delete(key); if (generation === epoch) void drainQueue(threadId) }
    }
  }
  async function readAgentCenter<T>(method: string, params: Record<string, unknown> = {}, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    if (!['thread/loaded/list', 'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list', 'account/usage/read'].includes(method)) throw new Error('任务中心仅支持只读查询。')
    if (!client || !connected.value) throw new Error('请先连接设备。')
    const rpc = client, epoch = generation
    const result = await rpc.request<T>(method, params, { timeoutMs: 10_000, ...options })
    if (epoch !== generation) throw new Error('设备连接已变化，请重新刷新任务中心。')
    return result
  }
  async function readMentions<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (!['plugin/installed', 'plugin/list', 'thread/search'].includes(method)) throw new RpcError('不支持的提及查询。')
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation, view = threadGeneration, cwd = active.value?.cwd || workingDirectory.value
    const result = await rpc.request<T>(method, params, { signal, timeoutMs: 10_000 })
    if (rpc !== client || epoch !== generation || view !== threadGeneration || cwd !== (active.value?.cwd || workingDirectory.value) || disposed) throw new RpcError('设备或工作目录已变化，请重新查询。')
    return result
  }
  async function listMentionPlugins(signal?: AbortSignal): Promise<MentionReference[]> {
    const cwd = active.value?.cwd || workingDirectory.value, params = cwd ? { cwds: [cwd] } : {}
    try { return parsePluginMentions(await readMentions('plugin/installed', params, signal)) }
    catch (cause) { if (!(cause instanceof RpcError) || cause.code !== -32601) throw cause; return parsePluginMentions(await readMentions('plugin/list', { ...params, marketplaceKinds: ['local'] }, signal)) }
  }
  async function searchMentionThreads(query: string, signal?: AbortSignal): Promise<Thread[]> {
    if (!query.trim()) return []
    const result = await readMentions<{ data: { thread: Thread }[] }>('thread/search', { searchTerm: query.trim(), limit: 30, sortKey: 'recency_at', sortDirection: 'desc', archived: false, sourceKinds: [] }, signal)
    if (!result || !Array.isArray(result.data) || result.data.length > 30 || result.data.some(row => !isThreadSummary(row.thread))) throw new RpcError('会话搜索响应无效。')
    return result.data.map(row => row.thread)
  }
  async function listSkills(options: { signal?: AbortSignal; forceReload?: boolean } = {}): Promise<SkillCatalog> {
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation, view = threadGeneration, cwd = active.value?.cwd || workingDirectory.value
    const result = await rpc.request('skills/list', { cwds: cwd ? [cwd] : [], ...(options.forceReload ? { forceReload: true } : {}) }, { signal: options.signal, timeoutMs: 10_000 })
    if (rpc !== client || epoch !== generation || view !== threadGeneration || cwd !== (active.value?.cwd || workingDirectory.value) || disposed) throw new RpcError('设备或工作目录已变化，请重新读取技能。')
    return parseSkills(result, cwd)
  }
  async function runWorkspaceCommand<T>(params: Record<string, unknown>, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation, device = selectedId.value
    const result = await rpc.request<T>('command/exec', params, options)
    if (rpc !== client || epoch !== generation || device !== selectedId.value || !connected.value || disposed) throw new RpcError('设备连接已变化，命令结果未确认。')
    return result
  }
  async function requestConfig<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!['config/read', 'configRequirements/read', 'config/batchWrite'].includes(method)) throw new RpcError('不支持的配置操作。')
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation
    const result = await rpc.request<T>(method, params, { timeoutMs: 10_000 })
    if (rpc !== client || epoch !== generation || !connected.value || disposed) throw new RpcError('设备连接已变化，请重新读取配置。')
    return result
  }
  const withdrawMessage = (itemId: string) => reviseMessage(itemId)
  const editMessage = (itemId: string, parts: PromptPart[]) => reviseMessage(itemId, parts)
  async function interrupt() {
    if (!client || !active.value || !activeTurn.value) return
    pauseQueue()
    try { await client.request('turn/interrupt', { threadId: active.value.id, turnId: activeTurn.value.id }) }
    catch (e) { error.value = messageOf(e) }
  }
  async function readArchivedThreads(params: { cursor?: string | null; searchTerm?: string } = {}, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ data: Thread[]; nextCursor: string | null }> {
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation, device = selectedId.value, cursor = params.cursor ?? null
    const current = () => !disposed && rpc === client && epoch === generation && device === selectedId.value && connected.value
    try {
      if (cursor !== null && (typeof cursor !== 'string' || !cursor.trim())) throw new RpcError('归档列表分页标记无效。')
      const timeoutMs = options.timeoutMs ?? 10_000
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RpcError('归档列表超时设置无效。')
      const searchTerm = params.searchTerm?.trim()
      const page = await rpc.request<{ data: Thread[]; nextCursor: string | null }>('thread/list', { archived: true, limit: 30, cursor, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], ...(searchTerm ? { searchTerm } : {}) }, { signal: options.signal, timeoutMs: Math.min(timeoutMs, 30_000) })
      if (!current() || options.signal?.aborted) throw new DOMException('归档列表读取已取消。', 'AbortError')
      if (!page || !Array.isArray(page.data) || page.data.length > 30 || !page.data.every(isThreadSummary)
        || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor.trim() || page.nextCursor === cursor))) throw new RpcError('归档列表响应格式或分页标记无效。')
      return { data: page.data, nextCursor: page.nextCursor }
    } catch (cause) {
      if (!current() || options.signal?.aborted) throw new DOMException('归档列表读取已取消。', 'AbortError')
      error.value = '归档列表加载失败：' + messageOf(cause)
      throw cause
    }
  }
  async function unarchive(id: string): Promise<boolean> {
    if (!client || !connected.value || disposed) { if (!disposed) error.value = '请先连接设备。'; return false }
    if (revising.value || !id.trim()) { error.value = revising.value ? '请等待会话更新完成后再恢复归档。' : '会话 ID 无效。'; return false }
    const rpc = client, epoch = generation, device = selectedId.value
    const current = () => !disposed && rpc === client && epoch === generation && device === selectedId.value && connected.value
    error.value = ''
    try {
      const result = await rpc.request<{ thread: Thread }>('thread/unarchive', { threadId: id }, { timeoutMs: 10_000 })
      if (!current()) return false
      archivedThreads.delete(id)
      if (projectUpdates.get(id) === null) projectUpdates.delete(id)
      if (isThreadSummary(result?.thread) && result.thread.id === id) rememberProjects([result.thread])
      else toast('服务端已确认恢复归档，但返回的会话数据无效，请重新打开确认。')
      return true
    } catch (cause) {
      if (current()) error.value = (cause instanceof RpcError && cause.code === undefined ? '恢复结果未确认，请刷新归档列表后确认：' : '恢复归档失败：') + messageOf(cause)
      return false
    }
  }
  async function refreshUnarchivedThread(id: string) {
    if (!client || !connected.value || disposed) return
    const rpc = client, epoch = generation, device = selectedId.value, revision = archiveRevisions.get(id) || 0
    const current = () => !disposed && rpc === client && epoch === generation && device === selectedId.value && connected.value && (archiveRevisions.get(id) || 0) === revision
    // The notification confirms restoration; metadata failure must not restore its tombstone.
    archivedThreads.delete(id)
    if (projectUpdates.get(id) === null) projectUpdates.delete(id)
    try {
      const result = await rpc.request<{ thread: Thread }>('thread/read', { threadId: id, includeTurns: false }, { timeoutMs: 10_000 })
      if (!current()) return
      if (!isThreadSummary(result?.thread) || result.thread.id !== id) throw new RpcError('会话数据无效。')
      rememberProjects([result.thread])
    } catch (cause) { if (current()) toast('归档已恢复，但近期列表同步失败：' + messageOf(cause)) }
  }
  async function connectWithToken(profile: ConnectionProfile, token: string) { tokens.set(profile.id, token); await connect(profile) }
  async function forkThread(id: string, lastTurnId?: string) {
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation
    const result = await rpc.request<ThreadResult>('thread/fork', { threadId: id, excludeTurns: true, deferGoalContinuation: true, ...(lastTurnId ? { lastTurnId } : {}) }, { timeoutMs: 15_000 })
    if (rpc !== client || epoch !== generation || disposed) throw new RpcError('连接已变化，请刷新会话列表确认分叉结果。')
    if (!isThreadSummary(result?.thread)) throw new RpcError('分叉响应无效，请刷新会话列表后确认。')
    rememberProjects([result.thread]); return result.thread
  }
  async function renameThread(id: string, value: string) {
    const name = value.trim()
    if (!name || name.length > 200) throw new RpcError('名称需要包含 1–200 个字符。')
    if (!client || !connected.value || disposed) throw new RpcError('请先连接设备。')
    const rpc = client, epoch = generation
    await rpc.request('thread/name/set', { threadId: id, name }, { timeoutMs: 10_000 })
    if (rpc !== client || epoch !== generation || disposed) throw new RpcError('连接已变化，请刷新后确认名称。')
    updateThreadMetadata(id, { name })
  }
  async function archive(id: string) {
    if (revising.value) return
    if (queuedMessages.value.some(job => job.deviceId === selectedId.value && job.threadId === id)) { toast('此会话仍有待发送消息，请先处理队列。'); return }
    if (!client || !connected.value) return
    const epoch = generation
    try {
      await client.request('thread/archive', { threadId: id })
      if (epoch !== generation) return
      removeThreadMetadata(id)
      approvals.value = approvals.value.filter(a => a.params.threadId !== id)
      if (active.value?.id === id) newThread()
      toast('会话已在服务器归档。')
    } catch (e) { if (epoch === generation) error.value = messageOf(e) }
  }
  function respond(id: RpcId, result: unknown) {
    try { if (!client || !connected.value) throw new Error('请重新连接后处理请求。'); client.respond(id, result); approvals.value = approvals.value.filter(a => a.id !== id) }
    catch (e) { error.value = messageOf(e) }
  }
  function handleMessage(message: RpcMessage) {
    if (message.method === 'skills/changed') { skillsRevision.value++; return }
    const taskNotice = taskNoticeFromMessage(message, { id: selectedId.value, name: selected.value?.name || '当前设备' }, noticeThreadName)
    if (taskNotice) emitTaskNotice(taskNotice)
    const method = message.method || '', p = message.params || {}
    if (message.id !== undefined && method) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'tool/requestUserInput'].includes(method)) {
        if (!approvals.value.some(a => a.id === message.id)) approvals.value.push({ id: message.id, method, params: p as Approval['params'] })
      } else if (method === 'mcpServer/elicitation/request') {
        client?.respond(message.id, { action: 'decline', content: null }); toast('此客户端暂不支持 MCP 表单，该请求已拒绝。')
      } else { client?.unsupported(message.id); toast('收到暂不支持的请求：' + method) }
      return
    }
    if (method === 'thread/queue/changed') { if (typeof p.threadId === 'string') serverQueue?.notification(p.threadId); return }
    if (method === 'thread/goal/updated' || method === 'thread/goal/cleared') {
      if (typeof p.threadId !== 'string' || !p.threadId.trim() || method === 'thread/goal/updated' && !isThreadGoal(p.goal, p.threadId)) return
      const key = goalKey(p.threadId)
      nextGoalVersion(key); goals.value.set(key, method === 'thread/goal/cleared' ? null : p.goal as ThreadGoal)
      goalErrors.value.delete(key); goalSupported.value = true
      return
    }
    if (method === 'thread/unarchived') { if (typeof p.threadId === 'string' && p.threadId.trim()) void refreshUnarchivedThread(p.threadId); return }
    if (method === 'thread/settings/updated') {
      const id = String(p.threadId), settings = p.threadSettings as Record<string, any> | undefined
      if (settings && !pendingSettings.has(id) && !settingsWrites.has(id) && !unsavedSettings.has(queueKey(id))) {
        const snapshot: ComposerSettings = { model: settings.model || '', effort: settings.effort || '', permission: restoredPermission({ thread: { cwd: typeof settings.cwd === 'string' ? settings.cwd : '' }, approvalPolicy: settings.approvalPolicy, approvalsReviewer: settings.approvalsReviewer, sandbox: settings.sandboxPolicy }) || 'custom' }
        rememberSettings(queueKey(id), snapshot)
        if (active.value?.id === id) { restoringSettings = true; model.value = snapshot.model; effort.value = snapshot.effort; permission.value = snapshot.permission; restoringSettings = false }
      }
      return
    }
    if (method === 'thread/tokenUsage/updated') { tokenUsageByThread.value.set(selectedId.value + '/' + String(p.threadId), p.tokenUsage as ThreadTokenUsage); return }
    if (method === 'turn/diff/updated') {
      if (typeof p.threadId === 'string' && p.threadId && typeof p.turnId === 'string' && p.turnId && typeof p.diff === 'string') {
        const key = turnDiffKey(p.threadId, p.turnId)
        turnDiffs.value.delete(key); turnDiffs.value.set(key, p.diff)
        if (turnDiffs.value.size > 128) turnDiffs.value.delete(turnDiffs.value.keys().next().value!)
      }
      return
    }
    if (method === 'serverRequest/resolved') {
      const threadId = approvals.value.find(a => a.id === p.requestId)?.params.threadId
      approvals.value = approvals.value.filter(a => a.id !== p.requestId)
      if (threadId) void drainQueue(threadId)
      return
    }
    // Capture live observation times before buffering or filtering by the visible thread.
    const itemEvent = method === 'item/started' || method === 'item/completed'
    const reasoningDelta = (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') && typeof p.delta === 'string'
    let receivedItem = itemEvent ? p.item as Item : undefined
    if (p.threadId && p.turnId && (receivedItem || reasoningDelta)) {
      if (receivedItem) receivedItem = rememberReasoning(String(p.threadId), String(p.turnId), { ...receivedItem, startedAtMs: timestamp(p.startedAtMs) ?? receivedItem.startedAtMs, completedAtMs: timestamp(p.completedAtMs) ?? receivedItem.completedAtMs }, method === 'item/started' ? 'started' : 'completed')
      else if (!terminalTurns.has(String(p.turnId))) rememberReasoning(String(p.threadId), String(p.turnId), { id: String(p.itemId), type: 'reasoning' }, 'delta')
    }
    if (method === 'turn/started' || method === 'turn/completed') {
      const turn = p.turn as Turn, id = String(p.threadId || '')
      if (method === 'turn/started' && terminalTurns.has(turn.id)) return
      if (method === 'turn/completed' && turn.status === 'failed') rememberTurnFailure(id, turn.id, turn.error)
      updateThreadPreview(id, turn.items?.find(item => item.type === 'userMessage'))
      if (method === 'turn/started') {
        const activity = timestamp(turn.startedAt) ?? Math.floor(Date.now() / 1000)
        updateThreadMetadata(id, { updatedAt: activity, recencyAt: activity })
        const key = queueKey(id) + '/' + turn.id
        if (!turnStartedAt.value.has(key)) turnStartedAt.value.set(key, Date.now())
        if (!terminalTurns.has(turn.id)) runningTurns.value.set(id, turn.id)
      }
      else {
        completeReasoning(id, turn.id)
        turnStartedAt.value.delete(queueKey(id) + '/' + turn.id)
        const completesCurrentTurn = !runningTurns.value.has(id) || runningTurns.value.get(id) === turn.id
        if (completesCurrentTurn) runningTurns.value.delete(id)
        terminalTurns.add(turn.id)
        if (terminalTurns.size > 500) terminalTurns.delete(terminalTurns.values().next().value!)
        // Ordinary errors drain just like successful completions in the TUI.
        // Interrupted queues require explicit recovery, including when the
        // pending queue capability read has not yet installed the local row.
        if (completesCurrentTurn && turn.status === 'interrupted' && !serverQueueSupported.value) pausedQueues.value.add(queueKey(id))
        else { const epoch = generation; queueMicrotask(() => { if (epoch === generation) void drainQueue(id) }) }
      }
      if (serverQueueSupported.value) serverQueue?.notification(id)
      updateThreadMetadata(id, { status: { type: runningTurns.value.has(id) ? 'active' : 'idle' } })
    }
    if (receivedItem?.type === 'userMessage' && typeof p.threadId === 'string') reconcilePendingUserMessage(p.threadId, receivedItem.id, receivedItem.content, receivedItem.clientId)
    if (openingThread && p.threadId === openingThread) { bufferedEvents.push(message); return }
    if (p.threadId) {
      const key = queueKey(String(p.threadId)), retry = retries.value.get(key)
      if (method === 'error') {
        if (p.willRetry === true) {
          if (!terminalTurns.has(String(p.turnId))) retries.value.set(key, { turnId: String(p.turnId), message: retryStatusMessage(p.error) })
        } else {
          if (retry?.turnId === p.turnId) retries.value.delete(key)
          if (typeof p.turnId === 'string') rememberTurnFailure(String(p.threadId), p.turnId, p.error)
        }
        return
      }
      const resumes = itemEvent || method.startsWith('item/') && (method.endsWith('/delta') || method.endsWith('Delta'))
      if (method === 'turn/started' || retry && retry.turnId === (p.turnId || (p.turn as Turn | undefined)?.id) && (resumes || method === 'turn/completed')) retries.value.delete(key)
    }
    if (method === 'thread/started') {
      const thread = p.thread as Thread
      if (thread && !threads.value.some(t => t.id === thread.id)) threads.value.unshift(thread)
      if (thread) rememberProjects([thread])
      return
    }
    if (method === 'item/completed') updateThreadPreview(String(p.threadId), receivedItem)
    if (method === 'thread/name/updated') {
      updateThreadMetadata(String(p.threadId), { name: p.threadName as string })
      return
    }
    if (method === 'thread/status/changed') {
      updateThreadMetadata(String(p.threadId), { status: p.status as Thread['status'] })
      if ((p.status as Thread['status'])?.type === 'idle') void drainQueue(String(p.threadId))
    }
    if (method === 'thread/archived' || method === 'thread/deleted') {
      removeThreadMetadata(String(p.threadId))
      approvals.value = approvals.value.filter(a => a.params.threadId !== p.threadId)
      if (active.value?.id === p.threadId) newThread()
      return
    }
    if (!active.value || p.threadId !== active.value.id) return
    if (method === 'turn/started' || method === 'turn/completed') {
      const turn = p.turn as Turn
      mergeTurn(turn)
      if (method === 'turn/completed') {
        approvals.value = approvals.value.filter(a => a.params.turnId !== turn.id)
      }
      return
    }
    if (!p.turnId) return
    const turn = ensureTurn(String(p.turnId))
    if (!turn) return
    if (method === 'item/started' || method === 'item/completed') {
      const item = receivedItem!
      const index = turn.items.findIndex(i => i.id === item.id)
      const incoming = { ...item, ...(item.type === 'reasoning' || item.type === 'contextCompaction' ? { status: item.completedAtMs != null || method === 'item/completed' ? 'completed' : 'inProgress' } : {}) }
      if (index < 0) turn.items.push(incoming)
      else turn.items[index] = mergeItem(turn.items[index], incoming)
      return
    }
    const deltaKinds: Record<string, string> = { 'item/agentMessage/delta': 'agentMessage', 'item/plan/delta': 'plan', 'item/commandExecution/outputDelta': 'commandExecution', 'item/reasoning/summaryTextDelta': 'reasoning', 'item/reasoning/textDelta': 'reasoning' }
    const type = deltaKinds[method]
    if (type && typeof p.delta === 'string') {
      let item = turn.items.find(i => i.id === p.itemId)
      if (!item) { turn.items.push({ id: String(p.itemId), type, text: '' }); item = turn.items[turn.items.length - 1] }
      if (type === 'commandExecution') item.aggregatedOutput = (item.aggregatedOutput || '') + p.delta
      else if (type === 'reasoning') {
        Object.assign(item, rememberReasoning(String(p.threadId), String(p.turnId), item, 'delta'))
        if (method === 'item/reasoning/textDelta') { const index = Number(p.contentIndex || 0); item.content ||= []; item.content[index] = textFragment(item.content[index]) + p.delta }
        else { const index = Number(p.summaryIndex || 0); item.summary ||= []; item.summary[index] = textFragment(item.summary[index]) + p.delta }
      }
      else item.text = (item.text || '') + p.delta
    }
  }
  const wentOffline = () => { online.value = false; clearTimeout(reconnectTimer); reconnectTimer = undefined; if (connected.value) { client?.disconnect(); status.value = 'reconnecting'; error.value = '网络已断开，联网后会重新连接；不会自动重发消息。' } }
  let checksSession = true
  const wentOnline = () => { online.value = true; if (checksSession) void checkSession(); if (status.value === 'reconnecting') { reconnectCount = 0; scheduleReconnect() } }
  watch([connected, () => active.value && activeTurn.value ? queueKey(active.value.id) + '/' + activeTurn.value.id : ''], ([online, key]) => {
    clearInterval(clockTimer); clockTimer = undefined
    clockNow.value = Date.now()
    if (key && !turnStartedAt.value.has(key)) turnStartedAt.value.set(key, clockNow.value)
    if (online && key) clockTimer = setInterval(() => { clockNow.value = Date.now() }, 1000)
  }, { flush: 'sync' })
  let starting: Promise<void> | undefined
  function start(lifecycle: { checkSession?: boolean } = {}) {
    if (disposed) return Promise.resolve()
    if (!starting) {
      checksSession = lifecycle.checkSession !== false
      window.addEventListener('offline', wentOffline); window.addEventListener('online', wentOnline)
      starting = checksSession ? checkSession() : Promise.resolve()
    }
    return starting
  }
  function dispose() {
    if (disposed) return
    disposed = true; disconnect(); clearInterval(clockTimer); clearTimeout(noticeTimer); noticeListeners.clear()
    window.removeEventListener('offline', wentOffline); window.removeEventListener('online', wentOnline)
  }
  if (getCurrentScope()) onScopeDispose(dispose)
  if (!options.deferLifecycle) {
    if (getCurrentInstance()) onMounted(() => { void start() })
    else void start()
  }
  return { start, dispose, connectWithToken, forkThread, withdrawPendingSteer, listMentionPlugins, searchMentionThreads, renameThread, listSkills, skillsRevision, pendingSteers, onTaskNotice, requestConfig, steer, steering, currentTurnFailure, runWorkspaceCommand, currentTurnDiff, goal, currentGoal: goal, goalLoading, goalSaving, goalError, goalSupported, refreshGoal, setGoal, clearGoal, searchFiles, profiles, selectedId, selected, status, error, notice, online, bridgeReachable, authenticated, requiresKey, threads, projectThreads, workingDirectory, projectFilter, projectPaths, projectsLoading, threadCursor, active, models, model, effort, serviceTier, permission, permissionUnavailable, approvals, loading, loadingThread, pendingThreadId, threadLoadError, loadingEarlier, historyCursor, sending, connected, activeTurn, busy, items, displayTurns, contextUsage, compacting, liveReasoning, reconnectStatus, thinkingElapsed, workingElapsed, clockNow, activeApprovals, modelInfo, tokenFor, saveProfile, removeProfile, connect, disconnect, refreshThreads, readArchivedThreads, unarchive, openThread, loadEarlier, cancelThreadLoad, newThread, send, queuedMessages, currentQueue, queuePaused, serverQueueSupported, removeQueued, updateQueued, resumeQueue, pauseQueue, interrupt, archive, respond, revising, readAgentCenter, messageTarget, withdrawMessage, editMessage, login, logout, toast }
}
