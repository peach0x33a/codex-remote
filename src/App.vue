<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHistoryScroll } from './composables/useHistoryScroll'
import { PhArchive, PhArrowDown, PhArrowRight, PhArrowUp, PhArrowsClockwise, PhCheckCircle, PhChatCircle, PhCode, PhDesktop, PhDownloadSimple, PhImage, PhFolderOpen, PhList, PhMagnifyingGlass, PhNotePencil, PhPlus, PhPlusCircle, PhSidebarSimple, PhListNumbers, PhQuestion, PhSignOut, PhSparkle, PhSquare, PhSquaresFour, PhTerminal, PhWarningCircle, PhWifiSlash, PhX } from '@phosphor-icons/vue'
import BaseDialog from './components/BaseDialog.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import ConnectionDialog from './components/ConnectionDialog.vue'
import MessageItem from './components/MessageItem.vue'
import WorkspaceFilePanel from './components/WorkspaceFilePanel.vue'
import type { FileLinkTarget } from './lib/file-links'
import type { WorkspaceRun } from './lib/workspace-files'
import ToolActivityGroup from './components/ToolActivityGroup.vue'
import ThreadInspector from './components/ThreadInspector.vue'
import SubAgentBadge from './components/SubAgentBadge.vue'
import FileChangeSummary from './components/FileChangeSummary.vue'
import MotionCollapse from './components/MotionCollapse.vue'
import { latestTurnFiles, subAgentIdentity } from './lib/thread-insights'
import { parseGitPatch, undoUnavailableReason, type Request as WorktreeRequest } from './lib/worktree-changes'
import ChangesPanel from './components/ChangesPanel.vue'
import TurnFailure from './components/TurnFailure.vue'
import { buildDocumentActivityRows } from './lib/tool-activity'
import { useThreadInspector } from './composables/useThreadInspector'
import { useGitContext } from './composables/useGitContext'
import MessageRevisionEditor from './components/MessageRevisionEditor.vue'
import ApprovalIsland from './components/ApprovalIsland.vue'
import AsyncQuestionPane from './components/AsyncQuestionPane.vue'
import WorkspaceBackground from './components/WorkspaceBackground.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import PromptEditor from './components/PromptEditor.vue'
import { completionTabs, threadMention, type MentionReference } from './lib/mentions'
import { filterSkills, type RemoteSkill } from './lib/skills'
import GoalPanel from './components/GoalPanel.vue'
import { goalEditPrompt, parseGoalCommand } from './lib/goal-command'
import type { ConfigRequest } from './lib/codex-config'
import { conversationInputs } from './lib/input-history'
import { completedTurnDurations, withStoppedTurnFooters } from './lib/turn-duration'
import QueuePane from './components/QueuePane.vue'
import ProjectSidebar from './components/ProjectSidebar.vue'
import WorkingDirectoryPicker from './components/WorkingDirectoryPicker.vue'
import WorkspaceBadge from './components/WorkspaceBadge.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import { hasPrompt, messageEditError, messageParts, promptText, type PromptPart } from './lib/prompt'
import DevicePicker from './components/DevicePicker.vue'
import ReasoningPicker from './components/ReasoningPicker.vue'
import ContextIndicator from './components/ContextIndicator.vue'
import { useVisualViewport } from './composables/useVisualViewport'
import { copyText } from './lib/clipboard'
import ModelPicker from './components/ModelPicker.vue'
import PermissionPicker from './components/PermissionPicker.vue'
import ComposerPopover from './components/ComposerPopover.vue'
import { useCodexWorkspace } from './composables/useCodexWorkspace'
import { useInputHistory } from './composables/useInputHistory'
import { useSessionUrl } from './composables/useSessionUrl'
import { readSessionTarget, sessionLocation } from './lib/session-url'
import { useTaskNotifications } from './composables/useTaskNotifications'
import type { NoticeTarget } from './lib/task-notifications'
import ThreadActionsMenu from './components/ThreadActionsMenu.vue'
import SideChat from './components/SideChat.vue'
import { useStoredChoice, isBoolean, isStringList, oneOf } from './composables/useStoredChoice'
import { useTypography } from './composables/useTypography'
import { useAppearance } from './composables/useAppearance'
import { exportAppearance, importAppearance } from './lib/appearance-transfer'
import { usePwa } from './composables/usePwa'
import { useComposerEntrance } from './composables/useComposerEntrance'
import type { ConnectionProfile } from '../shared/protocol'
import { COMPOSER_COMMANDS, composerCommands, composerPlaceholder as getComposerPlaceholder, fileMentionText, submittedCommand, type ComposerCommandId } from './lib/composer-commands'

const AgentCommandCenter = defineAsyncComponent(() => import('./components/AgentCommandCenter.vue'))
const ArchiveDialog = defineAsyncComponent(() => import('./components/ArchiveDialog.vue'))
const archiveOpen = ref(false), archiveTrigger = ref<HTMLButtonElement>()
const agentCenterOpen = ref(false)
const initialSessionTarget = readSessionTarget(new URL(location.href))
const codex = useCodexWorkspace({ autoConnect: !initialSessionTarget })
const typography = useTypography(codex.toast)
const pendingNoticeTarget = ref<NoticeTarget>(), openingNotice = ref(false)
const notifications = useTaskNotifications(target => { sessionUrl.cancelRestore(); pendingNoticeTarget.value = target; void openNoticeTarget() })
const unsubscribeNotices = codex.onTaskNotice(notice => { void notifications.notify(notice) })
onUnmounted(unsubscribeNotices)
async function openNoticeTarget() {
  const target = pendingNoticeTarget.value
  if (!target || openingNotice.value || !codex.authenticated.value || !codex.profilesLoaded.value) return
  if (codex.revising.value || changesState.value.applying || codex.goalSaving.value) { codex.toast('当前操作完成后，请再次点击通知打开会话。'); pendingNoticeTarget.value = undefined; return }
  const profile = codex.profiles.value.find(profile => profile.id === target.deviceId)
  if (!profile) { codex.toast('通知对应的设备已不在设备列表中。'); pendingNoticeTarget.value = undefined; return }
  openingNotice.value = true
  try {
    if (codex.selectedId.value !== target.deviceId || !codex.connected.value) await codex.connect(profile)
    if (pendingNoticeTarget.value === target && codex.selectedId.value === target.deviceId && codex.connected.value) {
      if (target.threadId) await codex.openThread(target.threadId)
      pendingNoticeTarget.value = undefined
    }
  } finally { openingNotice.value = false }
}
watch([codex.authenticated, codex.profilesLoaded], () => { void openNoticeTarget() })
const { profiles, selectedId, selected, status, error, notice, online, bridgeReachable, authenticated, requiresKey, threads, projectThreads, workingDirectory, projectPaths, projectsLoading, threadCursor, active, models, model, effort, serviceTier, permission, permissionUnavailable, approvals, loading, loadingThread, pendingThreadId, threadLoadError, loadingEarlier, historyCursor, connected, activeTurn, busy, items, displayTurns, contextUsage, compacting, liveReasoning, reconnectStatus, thinkingElapsed, workingElapsed, clockNow, activeApprovals, asyncQuestions, modelInfo, currentQueue, queuePaused, serverQueueSupported, revising } = codex
const deviceConfigRequest = computed<ConfigRequest>(() => {
  const device = selectedId.value
  return async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (selectedId.value !== device) throw new Error('设备已切换，请重新打开配置。')
    const result = await codex.requestConfig<T>(method, params)
    if (selectedId.value !== device) throw new Error('设备已切换，原设备的配置结果未应用到当前界面。')
    return result
  }
})
const pwa = usePwa()
const { installed, installing, needRefresh, registrationError } = pwa
const connectionOpen = ref(false), helpOpen = ref(false), installOpen = ref(false), editingId = ref<string>()
const editingMessage = ref<{ id: string; threadId: string; parts: PromptPart[]; error?: string }>()
const withdrawingMessage = ref<{ id: string; threadId: string; preview: string; error?: string }>()
const draft = ref<PromptPart[]>([]), search = ref(''), loginKey = ref(''), loginError = ref(''), loggingIn = ref(false)
const rememberLogin = useStoredChoice('codex-remote.remember-login.v1', true, isBoolean)
const menuOpen = ref(false), collapsed = useStoredChoice('codex-remote.sidebar-collapsed.v1', false, isBoolean), isMobile = ref(window.innerWidth <= 760)
const promptEditor = ref<InstanceType<typeof PromptEditor>>(), searchInput = ref<HTMLInputElement>(), searchButton = ref<HTMLButtonElement>(), scrollArea = ref<HTMLElement>(), sidebar = ref<HTMLElement>(), menuButton = ref<HTMLButtonElement>()
const atBottom = ref(true), queueDraftThread = ref('')
const inspectorWide = ref(window.innerWidth >= 1280), inspectorOpen = ref(window.innerWidth >= 1280)
const changesWide = ref(window.innerWidth >= 1100)
const inspectorRequested = ref(false)
const sideChatBusy = ref(false)
const sideChat = ref<{ threadId: string; profile: ConnectionProfile; token: string }>(), forking = ref(false)
const pinnedThreads = useStoredChoice(() => 'codex-remote.pinned-threads.' + selectedId.value, [] as string[], isStringList)
const isPinned = computed(() => !!active.value && pinnedThreads.value.includes(active.value.id))
function togglePin() { if (!active.value) return; const id = active.value.id; pinnedThreads.value = isPinned.value ? pinnedThreads.value.filter(value => value !== id) : [...pinnedThreads.value, id] }
async function forkConversation(completedOnly = false, side = false) {
  const source = active.value, profile = selected.value
  if (!source || !profile || forking.value || revising.value || changesState.value.applying) return
  const lastTurnId = completedOnly ? source.turns.findLast(turn => turn.status === 'completed')?.id : undefined
  if (completedOnly && !lastTurnId) return
  forking.value = true
  try {
    const fork = await codex.forkThread(source.id, lastTurnId)
    if (selectedId.value !== profile.id || active.value?.id !== source.id) return
    if (side) { changesOpen.value = false; inspectorOpen.value = false; sideChat.value = { threadId: fork.id, profile: { ...profile }, token: codex.tokenFor(profile.id) } }
    else await codex.openThread(fork.id)
  } catch (cause) { codex.toast(cause instanceof Error ? cause.message : '分叉失败') }
  finally { forking.value = false }
}
function copyConversation(all = false) {
  const text = all ? items.value.filter(item => item.type === 'userMessage' || item.type === 'agentMessage').map(item => (item.type === 'userMessage' ? '## 你\n\n' + promptText(messageParts(item.content)) : '## Codex\n\n' + (item.text || ''))).join('\n\n') : items.value.findLast(item => item.type === 'agentMessage' && item.text)?.text || ''
  if (text) void copy(text)
}
function openConversationWindow() {
  if (!active.value) return
  const url = sessionLocation(location.href, { deviceId: selectedId.value, threadId: active.value.id })
  window.open(url.href, '_blank', 'noopener,noreferrer,popup,width=1100,height=850')
}
watch(profiles, rows => { if (sideChat.value && !rows.some(profile => profile.id === sideChat.value!.profile.id)) sideChat.value = undefined })
const changesOpen = ref(false), changesPanel = ref<InstanceType<typeof ChangesPanel>>()
const changesState = ref({ undone: false, applying: false })
const sessionUrl = useSessionUrl(codex, initialSessionTarget, () => revising.value || changesState.value.applying || codex.goalSaving.value)
const workspaceFileTarget = ref<FileLinkTarget | null>(null)
function toggleFileBrowser() {
  if (!connected.value || loadingThread.value || changesState.value.applying) return
  if (workspaceFileTarget.value) { workspaceFileTarget.value = null; return }
  inspectorOpen.value = false
  workspaceFileTarget.value = { path: active.value?.cwd || workingDirectory.value || '~' }
}
const workspaceFileRun = computed<WorkspaceRun>(() => {
  const device = selectedId.value, thread = active.value?.id, cwd = active.value?.cwd || workingDirectory.value
  const current = () => device === selectedId.value && thread === active.value?.id && cwd === (active.value?.cwd || workingDirectory.value)
  return async (params, options) => {
    if (!current()) throw new Error('设备或会话已切换，请重新打开文件。')
    const result = await codex.runWorkspaceCommand(params, options)
    if (!current()) throw new Error('设备或会话已切换，请重新打开文件。')
    return result
  }
})
watch([selectedId, () => active.value?.id, () => active.value?.cwd || workingDirectory.value], () => { workspaceFileTarget.value = null }, { flush: 'sync' })
watch(workspaceFileTarget, target => { if (target) changesOpen.value = false })
const retryingFailure = ref(false)
const turnFailure = codex.currentTurnFailureInfo
async function retryFailedTurn() {
  if (!turnFailure.value || !active.value || composerBlocked.value || busy.value || retryingFailure.value || activeApprovals.value.length) return
  retryingFailure.value = true; codex.cancelAutoRetry()
  try { if (await codex.send([{ type: 'text', text: '继续' }])) { atBottom.value = true; await nextTick(); scrollBottom() } }
  finally { retryingFailure.value = false }
}
const workspaceRequest = computed<WorktreeRequest>(() => {
  const device = selectedId.value, thread = active.value?.id, cwd = active.value?.cwd
  return (method, params, options) => {
    if (method !== 'command/exec') return Promise.reject(new Error('不支持的工作目录操作'))
    if (device !== selectedId.value || thread !== active.value?.id || cwd !== active.value?.cwd) return Promise.reject(new Error('设备或工作目录已变化，请重新打开变更'))
    return codex.runWorkspaceCommand(params as Record<string, unknown>, options)
  }
})
const turnPatch = computed(() => codex.currentTurnDiff.value || '')
const undoHint = computed(() => !connected.value ? '请先连接设备' : busy.value || revising.value ? '本轮结束后可撤销' : undoUnavailableReason(turnPatch.value))
async function openChanges(path?: string) {
  workspaceFileTarget.value = null
  if (!active.value || changesState.value.applying) return
  if (!changesWide.value) inspectorOpen.value = false
  changesOpen.value = true; await nextTick(); await changesPanel.value?.show(path)
}
async function undoChanges() { await openChanges(); await changesPanel.value?.requestUndo() }
const inspectorTrigger = ref<HTMLButtonElement>(), fileSummary = ref<InstanceType<typeof FileChangeSummary>>()
const threadInspector = useThreadInspector({ thread: active, deviceId: selectedId, connected, knownThreads: threads, request: codex.readAgentCenter })
const threadInsights = threadInspector.insights
const currentTurnFiles = computed(() => {
  const parsed = turnPatch.value ? parseGitPatch(turnPatch.value) : null
  return parsed?.complete ? parsed.files.map(file => ({ path: file.path, diff: file.patch, added: file.added, removed: file.removed, kind: file.kind })) : latestTurnFiles(active.value)
})
const showCurrentTurnFiles = computed(() => !busy.value && active.value?.turns.at(-1)?.status === 'completed' && currentTurnFiles.value.length > 0)
const hasInspectorContent = computed(() => !!threadInsights.value.agents.length || !!threadInsights.value.files.length)
const inspectorDocked = computed(() => inspectorWide.value && (hasInspectorContent.value || inspectorRequested.value) && inspectorOpen.value && !loadingThread.value && !changesOpen.value && !sideChat.value && !workspaceFileTarget.value)
const activityRows = computed(() => withStoppedTurnFooters(displayTurns.value, turn => buildDocumentActivityRows([turn])))
watch([selectedId, () => active.value?.id], () => { inspectorOpen.value = inspectorWide.value; inspectorRequested.value = false; changesOpen.value = false; changesState.value = { undone: false, applying: false } })
function toggleInspector() { workspaceFileTarget.value = null; if (changesState.value.applying) return; const visible = inspectorDocked.value || !inspectorWide.value && inspectorOpen.value; changesOpen.value = false; inspectorRequested.value = !visible; inspectorOpen.value = !visible }
async function createOutput(kind: string) {
  const prompts: Record<string, string> = { document: '请帮我创建一份文档，先向我确认主题和具体要求。', presentation: '请帮我创建一份演示文稿，先向我确认主题、受众和页数。', spreadsheet: '请帮我创建一个电子表格，先向我确认用途和数据要求。', website: '请帮我创建一个站点，先向我确认主题、内容和功能。' }
  const text = prompts[kind]
  if (!text || !connected.value || revising.value || codex.goalSaving.value || attaching.value || editingMessage.value) return
  if (!inspectorWide.value) await closeInspector()
  draftEpoch++; draft.value = [...draft.value, { type: 'text', text: (hasPrompt(draft.value) ? '\n' : '') + text }]
  await nextTick(); promptEditor.value?.focus(true)
}
async function closeInspector() { inspectorOpen.value = false; await nextTick(); inspectorTrigger.value?.focus() }
async function inspectFile(path: string) {
  await openChanges(path)
}
function openAgentThread(id: string) { if (!inspectorWide.value) inspectorOpen.value = false; selectThread(id) }
const statusText = computed(() => ({ disconnected: '未连接', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', error: '连接失败' })[status.value])
const composerEngaged = ref(false), composerArea = ref<HTMLElement>()
const welcome = computed(() => !composerEngaged.value && !active.value && !loadingThread.value && !threadLoadError.value)
const { moving: composerMoving } = useComposerEntrance(welcome, composerArea)
function engageComposer() { composerEngaged.value = true }
function onComposerFocus(event: FocusEvent) { if ((event.target as HTMLElement)?.getAttribute('role') === 'textbox') engageComposer() }
function onComposerClick(event: MouseEvent) { if (event.target === event.currentTarget) { engageComposer(); promptEditor.value?.focus() } }
watch(selectedId, () => { composerEngaged.value = false })
const modelPicker = ref<InstanceType<typeof ModelPicker>>()
const permissionPicker = ref<InstanceType<typeof PermissionPicker>>(), reasoningPicker = ref<InstanceType<typeof ReasoningPicker>>()
const directoryPicker = ref<InstanceType<typeof WorkingDirectoryPicker>>(), settingsDialog = ref<InstanceType<typeof DisplaySettings>>()
const goalPanel = ref<InstanceType<typeof GoalPanel>>()
const gitContext = useGitContext({ cwd: computed(() => active.value?.cwd || workingDirectory.value || ''), deviceId: selectedId, connected, busy, run: (params, options) => codex.runWorkspaceCommand(params, options) }).context
type ComposerTrigger = { kind: 'command' | 'file' | 'skill'; query: string }
type ComposerSuggestion = { id: string; label: string; description?: string; insertText?: string; skill?: RemoteSkill; mention?: MentionReference; group?: string; source?: string; category: string; accessibleLabel?: string }
const renameTarget = ref<{ id: string; deviceId: string }>(), renameDraft = ref(''), renameError = ref(''), renaming = ref(false)
function showRename(name = '') {
  if (!active.value) { codex.toast('请先打开一个会话'); return false }
  renameTarget.value = { id: active.value.id, deviceId: selectedId.value }; renameDraft.value = name || active.value.name || active.value.preview; renameError.value = ''; return true
}
async function saveRename() {
  const target = renameTarget.value
  if (!target || renaming.value) return
  if (target.deviceId !== selectedId.value) { renameError.value = '设备已切换，请重新打开重命名。'; return }
  renaming.value = true; renameError.value = ''
  try { await codex.renameThread(target.id, renameDraft.value); if (renameTarget.value === target) renameTarget.value = undefined }
  catch (cause) { if (renameTarget.value === target) renameError.value = cause instanceof Error ? cause.message : '重命名失败' }
  finally { renaming.value = false }
}
const contextIndicator = ref<InstanceType<typeof ContextIndicator>>(), island = ref<InstanceType<typeof ApprovalIsland>>(), questionPane = ref<InstanceType<typeof AsyncQuestionPane>>()
const currentSessionId = computed(() => { const id = active.value?.id; return typeof id === 'string' && !id.startsWith('pending-thread-') ? id : undefined })
const composerTrigger = ref<ComposerTrigger | null>(null)
const completionHost = ref<HTMLElement | null>(null), completionActive = ref(false)
const completionTab = useStoredChoice(() => 'codex-remote.completion-tab.' + (composerTrigger.value?.kind || 'command'), 'all', oneOf(['all', 'commands', 'files', 'agents', 'threads', 'plugins', 'skills'] as const))
const catalogSkills = ref<RemoteSkill[]>([]), catalogPlugins = ref<MentionReference[]>([]), mentionSearchThreads = ref<import('../shared/protocol').Thread[]>([])
const fileSuggestions = ref<ComposerSuggestion[]>([]), completionErrors = ref<Record<string, string>>({}), completionLoading = ref<string[]>([])
let skillScope = '', pluginScope = '', fileSearchTimer: ReturnType<typeof setTimeout> | undefined, fileSearchController: AbortController | undefined, fileSearchSequence = 0
const composerServiceTiers = computed(() => modelInfo.value?.serviceTiers?.length ? modelInfo.value.serviceTiers : (modelInfo.value?.additionalSpeedTiers || []).map(id => ({ id, name: id, description: '切换服务速度' })))
const composerPlaceholder = computed(() => getComposerPlaceholder(model.value || modelInfo.value?.model, effort.value || modelInfo.value?.defaultReasoningEffort))
const menuTabs = computed(() => completionTabs(composerTrigger.value?.kind || 'command'))
const scopeKey = computed(() => [selectedId.value, active.value?.id || '', active.value?.cwd || workingDirectory.value, codex.skillsRevision.value].join('\0'))
const sourceNames: Record<string, string> = { user: '个人', repo: '项目', system: '系统', admin: '组织' }
const commandNames: Record<string, string> = { 'service-tier:priority': '快速模式', 'service-tier:fast': '快速模式', compact: '压缩上下文', goal: '目标', new: '新对话', model: '模型', effort: '思考强度', permissions: '权限', skills: '技能', rename: '重命名', archive: '归档对话', resume: '打开对话', agents: '任务中心', diff: '文件变更', mention: '提及', status: '上下文用量', cd: '工作目录', pwd: '当前目录', copy: '复制回复', project: '项目', tasks: '任务中心', settings: '设置', help: '帮助' }
const skillRows = computed<ComposerSuggestion[]>(() => catalogSkills.value.filter(skill => skill.enabled).map(skill => ({ id: 'skill:' + skill.path, label: skill.displayName || skill.name.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, value => value.toUpperCase()), description: skill.description, category: 'skills', group: '技能', source: sourceNames[skill.scope] || skill.scope, skill })))
const mentionRows = computed<ComposerSuggestion[]>(() => {
  const known = new Map([...projectThreads.value, ...threads.value, ...mentionSearchThreads.value].map(thread => [thread.id, thread]))
  const refs = new Map<string, MentionReference>()
  for (const thread of known.values()) { if (thread.id === active.value?.id) continue; const mention = threadMention(thread); if (mention) refs.set(mention.path, mention) }
  for (const agent of threadInsights.value.agents) if (/^[a-z0-9_-]{1,64}$/i.test(agent.id)) refs.set('thread://' + agent.id, { name: agent.name, path: 'thread://' + agent.id, kind: 'agent', description: agent.role || agent.status })
  return [...catalogPlugins.value, ...refs.values()].map(mention => ({ id: 'mention:' + mention.path, label: mention.name, description: mention.description, category: mention.kind === 'plugin' ? 'plugins' : mention.kind === 'agent' ? 'agents' : 'threads', group: mention.kind === 'plugin' ? '插件' : mention.kind === 'agent' ? '智能体' : '对话', source: mention.kind === 'plugin' ? '已安装' : mention.kind === 'agent' ? '智能体' : '对话', mention }))
})
const composerSuggestions = computed<ComposerSuggestion[]>(() => {
  const trigger = composerTrigger.value; if (!trigger) return []
  const query = trigger.query.trim().toLocaleLowerCase()
  const matches = (row: ComposerSuggestion) => !query || [row.label, row.description, row.skill?.name].some(value => value?.toLocaleLowerCase().includes(query)) || !!row.mention && mentionSearchThreads.value.some(thread => 'thread://' + thread.id === row.mention?.path)
  const commands: ComposerSuggestion[] = composerCommands(trigger.query, connected.value, composerServiceTiers.value).map(command => ({ ...command, id: 'command:' + command.id, description: command.label === '/fast' ? '切换 Priority，更快响应、更多额度消耗' : command.description, label: commandNames[command.id] || command.label, accessibleLabel: command.label + ' ' + (commandNames[command.id] || '') + ' ' + command.description, category: 'commands', group: '命令' }))
  const rows = trigger.kind === 'command' ? [...commands, ...(connected.value ? skillRows.value.filter(matches) : [])] : trigger.kind === 'skill' ? skillRows.value.filter(matches) : [...fileSuggestions.value, ...mentionRows.value.filter(matches), ...skillRows.value.filter(matches)]
  const selected = completionTab.value === 'all' ? rows : rows.filter(row => row.category === completionTab.value)
  const order = ['commands', 'files', 'plugins', 'skills', 'agents', 'threads']
  return selected.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
})
const suggestionsLoading = computed(() => completionTab.value === 'all' ? !!completionLoading.value.length : completionLoading.value.includes(completionTab.value))
const suggestionsError = computed(() => completionTab.value === 'all' ? Object.values(completionErrors.value).join(' · ') : completionErrors.value[completionTab.value] || '')
function triggerComposer(trigger: ComposerTrigger | null) { composerTrigger.value = trigger }
watch(() => composerTrigger.value?.kind, kind => { if (kind && !completionTabs(kind).some(tab => tab.id === completionTab.value)) completionTab.value = kind === 'skill' ? 'skills' : 'all'; if (kind) island.value?.showCompletion() })
function cancelFileSearch() { clearTimeout(fileSearchTimer); fileSearchController?.abort(); fileSearchController = undefined; fileSearchSequence++; fileSuggestions.value = []; mentionSearchThreads.value = []; completionLoading.value = []; completionErrors.value = {} }
watch([composerTrigger, scopeKey, connected], () => {
  cancelFileSearch()
  const trigger = composerTrigger.value, scope = scopeKey.value
  if (skillScope !== scope || !connected.value) { catalogSkills.value = []; skillScope = '' }
  if (pluginScope !== scope || !connected.value) { catalogPlugins.value = []; pluginScope = '' }
  if (!trigger || !connected.value) return
  const sequence = fileSearchSequence, query = trigger.query
  fileSearchTimer = setTimeout(async () => {
    const controller = new AbortController(); fileSearchController = controller
    const valid = () => sequence === fileSearchSequence && !controller.signal.aborted && scope === scopeKey.value
    const jobs: { key: string; run: () => Promise<void> }[] = []
    if (skillScope !== scope) jobs.push({ key: 'skills', run: async () => { const result = await codex.listSkills({ signal: controller.signal }); if (valid()) { catalogSkills.value = result.skills; skillScope = scope; if (result.errors.length) completionErrors.value.skills = result.errors.join(' · ') } } })
    if (trigger.kind === 'file') {
      if (pluginScope !== scope) jobs.push({ key: 'plugins', run: async () => { const result = await codex.listMentionPlugins(controller.signal); if (valid()) { catalogPlugins.value = result; pluginScope = scope } } })
      if (query.trim() && (active.value?.cwd || workingDirectory.value)) jobs.push({ key: 'files', run: async () => { const files = await codex.searchFiles(query, { signal: controller.signal }); if (valid()) fileSuggestions.value = files.map((file, index) => ({ id: 'file:' + index, label: file.file_name, description: file.path, category: 'files', group: '文件与目录', source: file.match_type === 'directory' ? '目录' : '文件', insertText: fileMentionText(file.path) })) } })
      if (query.trim()) jobs.push({ key: 'threads', run: async () => { const result = await codex.searchMentionThreads(query, controller.signal); if (valid()) mentionSearchThreads.value = result } })
    }
    completionLoading.value = jobs.map(job => job.key)
    await Promise.allSettled(jobs.map(async job => {
      try { await job.run() } catch (cause) { if (valid()) completionErrors.value[job.key] = (cause instanceof Error ? cause.message : '读取失败') }
      finally { if (valid()) completionLoading.value = completionLoading.value.filter(key => key !== job.key) }
    }))
  }, 140)
})
async function runComposerCommand(id: ComposerCommandId, argument = '', rawText?: string) {
  if (changesState.value.applying || revising.value || loadingThread.value || codex.goalSaving.value || editingMessage.value || attaching.value) return false
  const command = COMPOSER_COMMANDS.find(command => command.id === id)
  if (!command) return false
  if ('requiresConnection' in command && !connected.value) { codex.toast('请先连接设备'); return false }
  if (argument && id !== 'goal' && id !== 'rename') { codex.toast(command.label + ' 请通过面板选择'); return false }
  if (id === 'new') startNew()
  else if (id === 'model') void modelPicker.value?.show()
  else if (id === 'effort') void reasoningPicker.value?.show()
  else if (id === 'permissions') void permissionPicker.value?.show()
  else if (id === 'project') void directoryPicker.value?.show()
  else if (id === 'settings') settingsDialog.value?.show()
  else if (id === 'tasks' || id === 'agents') agentCenterOpen.value = true
  else if (id === 'skills') { suggest(String.fromCharCode(36)); return false }
  else if (id === 'rename') return showRename(argument)
  else if (id === 'archive') { if (!active.value) { codex.toast('请先打开一个会话'); return false }; void codex.archive(active.value.id) }
  else if (id === 'resume') openSearch()
  else if (id === 'diff') { if (!active.value) { codex.toast('请先打开一个会话'); return false }; void openChanges() }
  else if (id === 'mention') { suggest('@'); return false }
  else if (id === 'compact') return codex.compactContext()
  else if (id === 'status') void contextIndicator.value?.show()
  else if (id === 'cd') void directoryPicker.value?.show()
  else if (id === 'pwd') codex.toast(active.value?.cwd || workingDirectory.value || '使用服务器默认工作目录')
  else if (id === 'copy') { const reply = items.value.findLast(item => item.type === 'agentMessage' && item.text)?.text; if (!reply) { codex.toast('当前没有可复制的回复'); return false }; void copy(reply) }
  else if (id === 'help') helpOpen.value = true
  else if (id === 'goal') {
    const action = parseGoalCommand(rawText ?? ('/goal' + (argument ? ' ' + argument : '')))
    if (!action) return false
    if (action.kind === 'open') void goalPanel.value?.show()
    else if (action.kind === 'edit') {
      if (!codex.goal.value) { codex.toast('当前会话没有目标。'); return false }
      suggest(goalEditPrompt(codex.goal.value.objective)); return false
    } else if (action.kind === 'status') {
      goalPanel.value?.showStatus()
    } else {
      const started = await codex.setGoal({ objective: action.objective, status: 'active' })
      if (!started) codex.toast(codex.goalError.value || '目标未启动，请重试。')
      return started
    }
  }
  return true
}
function runComposerServiceTier(id: string, argument = '') {
  if (!connected.value || settingsBlocked.value) return false
  const tier = composerServiceTiers.value.find(candidate => candidate.id === id)
  if (!tier) return false
  const action = argument.trim().toLowerCase()
  if (action && action !== 'on' && action !== 'off') { codex.toast('/' + id.toLowerCase() + ' 支持 on 或 off'); return false }
  const current = serviceTier.value === undefined ? modelInfo.value?.defaultServiceTier : serviceTier.value
  serviceTier.value = action === 'on' ? tier.id : action === 'off' || current === tier.id ? null : tier.id
  return true
}
function selectComposerSuggestion(id: string) {
  if (id.startsWith('skill:')) {
    const skill = catalogSkills.value.find(skill => 'skill:' + skill.path === id)
    if (skill?.enabled && connected.value) promptEditor.value?.insertSkill(skill, true)
    return
  }
  if (id.startsWith('mention:')) { const mention = mentionRows.value.find(row => row.id === id)?.mention; if (mention && connected.value) promptEditor.value?.insertMention(mention, true); return }
  if (!id.startsWith('command:')) return
  const command = id.slice('command:'.length)
  promptEditor.value?.applySuggestion('')
  void nextTick(() => command.startsWith('service-tier:') ? runComposerServiceTier(command.slice('service-tier:'.length)) : runComposerCommand(command as ComposerCommandId))
}
const composerInputHistory = computed(() => conversationInputs(displayTurns.value))
const inputHistory = useInputHistory(selectedId, codex.authenticated, composerInputHistory, codex.toast)
const workDurations = computed(() => completedTurnDurations(displayTurns.value))
const imageInput = ref<HTMLInputElement>()
const attachmentError = ref(''), attachmentProgress = ref(''), attaching = ref(false), loadSlow = ref(false)
let loadTimer: ReturnType<typeof setTimeout> | undefined
watch(loadingThread, value => { clearTimeout(loadTimer); loadSlow.value = false; if (value) loadTimer = setTimeout(() => { loadSlow.value = true }, 5000) })
const composerBlocked = computed(() => codex.autoRetryStarting.value || codex.interrupting.value || codex.steering.value || codex.sending.value || changesState.value.applying || codex.goalSaving.value || revising.value || !!editingMessage.value || !connected.value || loadingThread.value || !!threadLoadError.value)
const settingsBlocked = computed(() => codex.goalSaving.value || revising.value || !connected.value || loadingThread.value)
const appearance = useAppearance(codex.toast)
const { displayContentWidth, displayImageBackground, setWidthPreview, setImagePreview, contentWidth, theme, resolvedTheme, autoConnect, autoWrap, backgroundMode, imageBackground, backgroundUrl, backgroundRemoteUrl, backgroundName, backgroundBusy, backgroundError, uploadBackground, setBackgroundUrl, removeBackground } = appearance
async function exportAppearanceSettings() {
  await appearance.ready
  return exportAppearance({ appearance: { contentWidth: contentWidth.value, theme: theme.value, autoWrap: autoWrap.value, backgroundMode: backgroundMode.value, imageBackground: { ...imageBackground.value } }, typography: { ...typography.preferences.value }, background: appearance.backgroundSource.value })
}
async function importAppearanceSettings(file: File) {
  const settings = await importAppearance(file)
  await appearance.applySettings(settings.appearance, settings.background)
  typography.update(settings.typography)
}
const searchOpen = ref(false)
const sidebarThreads = computed(() => { const rows = search.value.trim() ? threads.value.slice() : [...new Map([...projectThreads.value, ...threads.value].map(thread => [thread.id, thread])).values()]; return rows.sort((a, b) => Number(pinnedThreads.value.includes(b.id)) - Number(pinnedThreads.value.includes(a.id))) })
const queueCounts = computed(() => Object.fromEntries(sidebarThreads.value.map(thread => [thread.id, queueCount(thread.id)])))
const busyThreadIds = computed(() => [...new Set([...sidebarThreads.value.filter(thread => thread.status?.type === 'active').map(thread => thread.id), ...((busy.value || revising.value) && active.value ? [active.value.id] : [])])])
const approvalThreadIds = computed(() => approvals.value.map(approval => approval.params.threadId).filter((id): id is string => !!id))
const directoryChoice = computed({ get: () => { const cwd = active.value?.cwd ?? workingDirectory.value; return cwd === codex.defaultWorkingDirectory.value ? '' : cwd }, set: chooseDirectory })
function chooseDirectory(path: string) { path = path || codex.defaultWorkingDirectory.value; if (revising.value || codex.goalSaving.value || changesState.value.applying) return; engageComposer(); if (active.value && active.value.cwd !== path) { draftEpoch++; codex.newThread() }; workingDirectory.value = path; menuOpen.value = false; promptEditor.value?.focus(true) }
function chooseFileDirectory(path: string) {
  if (settingsBlocked.value || changesState.value.applying) return
  chooseDirectory(path); workspaceFileTarget.value = null
  codex.toast('工作目录已设置为 ' + path)
}
function startProject(cwd: string) { if (revising.value || codex.goalSaving.value || changesState.value.applying) return; startNew(); engageComposer(); workingDirectory.value = cwd; void nextTick(() => promptEditor.value?.focus(true)) }
function elapsedLabel(seconds: number) { return seconds < 60 ? Math.floor(seconds) + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + Math.floor(seconds % 60) + ' 秒' }
let draftEpoch = 0
let attachmentController: AbortController | undefined
const deviceDrafts = new Map<string, PromptPart[]>()
watch(selectedId, (id, previous) => {
  attachmentController?.abort()
  if (previous) deviceDrafts.set(previous, draft.value.map(part => ({ ...part })))
  draftEpoch++
  draft.value = deviceDrafts.get(id)?.map(part => ({ ...part })) || []
  composerTrigger.value = null
  attachmentError.value = ''
}, { flush: 'sync' })
function disconnectDevice(id?: string) {
  if (revising.value || changesState.value.applying) return
  if (id) codex.disconnectDevice(id)
  else codex.disconnect()
}
async function openSearch() { searchOpen.value = true; if (isMobile.value) menuOpen.value = true; else collapsed.value = false; await nextTick(); searchInput.value?.focus() }
async function closeSearch() { search.value = ''; searchOpen.value = false; await nextTick(); searchButton.value?.focus() }
function queueCount(id: string) { return codex.queuedMessages.value.filter(job => job.deviceId === selectedId.value && job.threadId === id).length }
const titleThread = computed(() => threads.value.find(t => t.id === pendingThreadId.value) || active.value)
const activeAgentIdentity = computed(() => subAgentIdentity(titleThread.value))
const threadTitle = computed(() => titleThread.value?.name || titleThread.value?.preview || activeAgentIdentity.value?.name || (activeAgentIdentity.value ? '子代理对话' : '新对话'))
async function attach(files: File[]) {
  if (attaching.value || !files.length) return
  const epoch = draftEpoch, insertion = promptEditor.value?.reserveInsertion(), controller = new AbortController()
  attachmentController = controller; attaching.value = true; attachmentError.value = ''; attachmentProgress.value = '正在添加附件…'
  try {
    const parts = await codex.readAttachments(files, draft.value, text => { if (epoch === draftEpoch) attachmentProgress.value = text }, controller.signal)
    if (epoch === draftEpoch) parts.forEach((part, index) => promptEditor.value?.insertAttachment(part, index === 0 ? insertion : undefined))
  } catch (cause) { if (epoch === draftEpoch && !controller.signal.aborted) attachmentError.value = cause instanceof Error ? cause.message : '添加附件失败。' }
  finally { if (attachmentController === controller) { attaching.value = false; attachmentProgress.value = ''; attachmentController = undefined; if (imageInput.value) imageInput.value.value = '' } }
}
function shortcut(event: KeyboardEvent) { if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); void modelPicker.value?.show() } }
const canLoadHistory = computed(() => !!historyCursor.value && connected.value && !loadingEarlier.value && !loadingThread.value && !revising.value)
const historyScroll = useHistoryScroll(scrollArea, canLoadHistory, earlier)
watch(() => [selectedId.value, active.value?.id], historyScroll.reset, { flush: 'sync' })
async function earlier() {
  if (!canLoadHistory.value) return
  const el = scrollArea.value, thread = active.value, device = selectedId.value
  if (!el || !thread) return
  const height = el.scrollHeight, top = el.scrollTop, viewportTop = el.getBoundingClientRect().top
  const anchor = [...el.querySelectorAll<HTMLElement>('.message-list > :not(.history-more)')].find(node => node.getBoundingClientRect().bottom > viewportTop)
  const anchorTop = anchor?.getBoundingClientRect().top
  historyScroll.reset(); atBottom.value = false
  await codex.loadEarlier(); await nextTick()
  if (selectedId.value !== device || active.value !== thread || scrollArea.value !== el || loadingThread.value) return
  if (anchor?.isConnected && anchorTop !== undefined) el.scrollTop += anchor.getBoundingClientRect().top - anchorTop
  else el.scrollTop = top + el.scrollHeight - height
}
const suggestions = [
  { title: '认识项目', icon: PhCode, text: '帮我梳理这个项目的目录结构、核心模块和运行方式。' },
  { title: '排查问题', icon: PhMagnifyingGlass, text: '帮我检查项目中潜在的问题，先分析原因，再给出修复建议。' },
  { title: '实现功能', icon: PhSparkle, text: '我想在这个项目中实现一个新功能，请先了解现有代码，再和我一起制定方案。' },
]
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void codex.refreshThreads(value), 200) })
function selectModel(value: string) { model.value = value; effort.value = ''; serviceTier.value = undefined }
const scrollSignal = computed(() => items.value.map(i => i.id + ((i.text?.length || i.aggregatedOutput?.length || 0) + (i.summary?.join('').length || 0) + (i.type === 'reasoning' ? i.content?.filter(s => typeof s === 'string').join('').length || 0 : 0))).join('|') + busy.value + activeApprovals.value.length)
watch(scrollSignal, async () => { if (atBottom.value) { await nextTick(); scrollBottom() } })
watch(() => active.value?.id, async () => { atBottom.value = true; await nextTick(); scrollBottom() })
watch(menuOpen, async open => { if (open && isMobile.value) { await nextTick(); sidebar.value?.querySelector<HTMLButtonElement>('button')?.focus() } })
useVisualViewport(() => { if (atBottom.value) void nextTick(scrollBottom) })
function scrollBottom() { if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight }
function trackScroll() { historyScroll.scroll(); const el = scrollArea.value; if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }
function openConnections(id?: string) { if (revising.value || changesState.value.applying) return; editingId.value = id; connectionOpen.value = true; menuOpen.value = false }
function closeMenu() { menuOpen.value = false; menuButton.value?.focus() }
function toggleMenu() { if (isMobile.value) menuOpen.value = !menuOpen.value; else collapsed.value = !collapsed.value }
function trapMenu(event: KeyboardEvent) {
  if (!isMobile.value || !menuOpen.value) return
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return }
  if (event.key !== 'Tab') return
  const elements = [...(sidebar.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]') || [])].filter(el => el.offsetParent !== null)
  const first = elements[0], last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
const awaitingDevice = computed(() => status.value === 'disconnected' || status.value === 'error')
const connectLabel = computed(() => selected.value ? '连接 ' + selected.value.name : '添加设备')
function connectSelected() { if (selected.value) connectProfile(selected.value); else openConnections() }
function connectProfile(profile: ConnectionProfile) { if (revising.value || codex.goalSaving.value || changesState.value.applying || editingMessage.value || queueDraftThread.value) return; sessionUrl.cancelRestore(); menuOpen.value = false; search.value = ''; if (connected.value && selectedId.value === profile.id) return; void codex.connect(profile) }
function startNew() { if (revising.value || codex.goalSaving.value || changesState.value.applying) return; sessionUrl.cancelRestore(); draftEpoch++; composerEngaged.value = false; codex.newThread(); draft.value = []; attachmentError.value = ''; menuOpen.value = false; sessionUrl.sync() }
async function closeArchives() {
  archiveOpen.value = false; await nextTick(); await nextTick()
  if (isMobile.value || collapsed.value) menuButton.value?.focus()
  else archiveTrigger.value?.focus()
}
async function restoreArchived(id: string) {
  if (changesState.value.applying) throw new Error('请等待文件操作完成')
  const success = await codex.unarchive(id)
  if (!success) throw new Error(codex.error.value || '恢复会话失败，请重试。')
  return success
}
async function archiveThread(id: string) { if (!changesState.value.applying) await codex.archive(id) }
function selectThread(id: string) { if (revising.value || changesState.value.applying) return; sessionUrl.cancelRestore(); menuOpen.value = false; void codex.openThread(id) }
async function send(queueOnly = false) {
  if (draft.value.every(part => part.type === 'text')) {
    const parts = draft.value, epoch = draftEpoch, text = promptText(parts)
    const command = submittedCommand(text)
    if (command) {
      const tier = composerServiceTiers.value.find(item => item.id.toLocaleLowerCase() === command.name || item.name.toLocaleLowerCase() === command.name || (command.name === 'fast' && item.id.toLowerCase() === 'priority'))
      if (tier) {
        if (runComposerServiceTier(tier.id, command.argument)) { draftEpoch++; draft.value = [] }
        return
      }
      if (!COMPOSER_COMMANDS.some(item => item.id === command.name)) { codex.toast('未知命令：/' + command.name); return }
      if (await runComposerCommand(command.name as ComposerCommandId, command.argument, text) && draft.value === parts && epoch === draftEpoch) { draftEpoch++; draft.value = [] }
      return
    }
  }
  if (attaching.value || composerBlocked.value || !hasPrompt(draft.value)) return
  const parts = draft.value, epoch = draftEpoch, deviceId = selectedId.value
  if (await (busy.value && !queueOnly ? codex.steer(parts) : codex.send(parts))) {
    void inputHistory.remember(parts, deviceId)
    if (draft.value === parts && epoch === draftEpoch) { draftEpoch++; draft.value = []; attachmentError.value = '' }
    atBottom.value = true; await nextTick(); scrollBottom(); promptEditor.value?.focus(true)
  }
}
function onComposerKey(event: KeyboardEvent) {
  if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'ArrowLeft' && asyncQuestions.value.length) {
    event.preventDefault(); event.stopPropagation(); island.value?.showQuestions(); void questionPane.value?.open(); return
  }
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Tab' && busy.value && hasPrompt(draft.value)) { event.preventDefault(); if (!composerBlocked.value) void send(true) }
  else if (event.key === 'Enter') { event.preventDefault(); if (!composerBlocked.value) void send() }
}
function returnFromQuestion() { if (composerTrigger.value) island.value?.showCompletion(); void promptEditor.value?.focus() }
function restoreSteerDraft(id: string) { const parts = codex.takePendingSteer(id); if (!parts) return; draftEpoch++; draft.value = [...draft.value, ...(hasPrompt(draft.value) ? [{ type: 'text' as const, text: '\n' }] : []), ...parts]; promptEditor.value?.focus(true) }
function restoreQueuedDraft(parts: PromptPart[]) { draftEpoch++; draft.value = [...draft.value, ...(hasPrompt(draft.value) ? [{ type: 'text' as const, text: '\n' }] : []), ...parts]; codex.toast('排队消息的编辑草稿已放回输入框。'); promptEditor.value?.focus(true) }
function suggest(text: string) { draftEpoch++; draft.value = [{ type: 'text', text }]; void nextTick(async () => { await nextTick(); await promptEditor.value?.focus(true) }) }
function beginEdit(id: string) {
  if (changesState.value.applying || !connected.value || loadingThread.value || revising.value || !active.value) return
  const target = codex.messageTarget(id)
  if (!target) return
  const unavailable = messageEditError(target.item)
  if (unavailable) { codex.toast(unavailable); return }
  editingMessage.value = { id, threadId: active.value.id, parts: messageParts(target.item.content) }
}
function requestWithdraw(id: string) {
  if (changesState.value.applying || !connected.value || loadingThread.value || revising.value || !active.value) return
  const target = codex.messageTarget(id)
  if (target) withdrawingMessage.value = { id, threadId: active.value.id, preview: promptText(messageParts(target.item.content)).slice(0, 240) }
}
async function saveEdited(parts: PromptPart[]) {
  const editing = editingMessage.value
  if (changesState.value.applying || !editing || editing.threadId !== active.value?.id) return
  editing.parts = parts.map(part => ({ ...part })); editing.error = ''
  const result = await codex.editMessage(editing.id, parts)
  if (result.ok) { editingMessage.value = undefined; promptEditor.value?.focus() }
  else if (result.reverted || result.uncertain || !codex.messageTarget(editing.id)) {
    draftEpoch++; draft.value = parts.map(part => ({ ...part })); editingMessage.value = undefined
    codex.error.value = (result.error || '编辑未完成。') + ' 编辑内容已保留在输入框中，未自动重发。'
    promptEditor.value?.focus(true)
  } else editing.error = result.error
}
async function confirmWithdraw() {
  const withdrawing = withdrawingMessage.value
  if (changesState.value.applying || !withdrawing || withdrawing.threadId !== active.value?.id) return
  withdrawing.error = ''
  const result = await codex.withdrawMessage(withdrawing.id)
  if (result.ok) { withdrawingMessage.value = undefined; editingMessage.value = undefined; codex.toast('消息及其后续回复已撤回。') }
  else if (result.reverted || result.uncertain) { withdrawingMessage.value = undefined; codex.error.value = result.error || '请重新加载会话确认撤回结果。' }
  else withdrawing.error = result.error
}
watch(() => active.value?.id, id => { if (!revising.value) { if (editingMessage.value?.threadId !== id) editingMessage.value = undefined; if (withdrawingMessage.value?.threadId !== id) withdrawingMessage.value = undefined } })
async function copy(text: string) { codex.toast(await copyText(text) ? '已复制到剪贴板。' : '复制失败，请手动选择文字复制。') }

async function install() { try { if (!(await pwa.install())) installOpen.value = true } catch { installOpen.value = true } }
async function login() { if (loggingIn.value) return; loggingIn.value = true; loginError.value = ''; try { await codex.login(loginKey.value, rememberLogin.value); loginKey.value = '' } catch (e) { loginError.value = e instanceof Error ? e.message : '登录失败。' } finally { loggingIn.value = false } }
async function logout() { if (changesState.value.applying) return; try { await codex.logout() } catch (e) { error.value = e instanceof Error ? e.message : '退出失败。' } }
function resize() {
  isMobile.value = window.innerWidth <= 760
  if (!isMobile.value) menuOpen.value = false
  const wide = window.innerWidth >= 1280
  if (inspectorWide.value && !wide) inspectorOpen.value = false
  inspectorWide.value = wide
  changesWide.value = window.innerWidth >= 1100
}
onMounted(() => { window.addEventListener('resize', resize); window.addEventListener('keydown', shortcut) })
onUnmounted(() => { attachmentController?.abort(); cancelFileSearch(); clearTimeout(searchTimer); clearTimeout(loadTimer); window.removeEventListener('resize', resize); window.removeEventListener('keydown', shortcut) })
</script>

<template>
  <Teleport to="body"><BaseDialog :open="!!renameTarget" title="重命名对话" :dismissible="!renaming" @close="renameTarget = undefined"><form @submit.prevent="saveRename"><label class="field-label">名称<input v-model="renameDraft" class="text-input" aria-label="对话名称" maxlength="200" autofocus :disabled="renaming" /></label><p v-if="renameError" class="attachment-error" role="alert">{{ renameError }}</p><div class="dialog-actions"><button type="button" class="button secondary" :disabled="renaming" @click="renameTarget = undefined">取消</button><button class="button primary" type="submit" :disabled="renaming || !renameDraft.trim()">{{ renaming ? '正在保存…' : '保存名称' }}</button></div></form></BaseDialog></Teleport>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed }" :style="{ '--content-width': displayContentWidth ? displayContentWidth + 'px' : '100%' }">
    <button v-if="menuOpen && isMobile" class="drawer-backdrop" aria-label="关闭导航" tabindex="-1" @click="closeMenu" />
    <aside ref="sidebar" class="sidebar" :class="{ 'is-open': menuOpen }" :inert="(isMobile && !menuOpen) || (!isMobile && collapsed)" :role="isMobile ? 'dialog' : undefined" :aria-modal="isMobile && menuOpen ? true : undefined" aria-label="工作空间导航" @keydown="trapMenu">
      <div class="sidebar-brand"><button class="brand" aria-label="Codex Remote 首页" @click="startNew"><span class="brand-icon"><PhTerminal :size="23" weight="bold" /></span><span>codex<span class="brand-remote">remote</span></span></button><div class="sidebar-brand-actions"><button ref="searchButton" class="icon-button small" aria-label="搜索对话" title="搜索对话" :aria-expanded="searchOpen || !!search" @click="openSearch"><PhMagnifyingGlass :size="19" /></button><button class="icon-button small" :aria-label="isMobile ? '关闭导航' : '收起侧栏'" title="收起侧栏" @click="isMobile ? closeMenu() : toggleMenu()"><PhSidebarSimple :size="19" /></button></div></div>
      <div class="history-section">
        <div class="section-label"><span>项目</span><button class="icon-button small" aria-label="刷新会话列表" :disabled="!connected || loading" @click="codex.refreshThreads(search)"><PhArrowsClockwise :size="15" :class="{ spinning: loading }" /></button></div>
        <label v-if="searchOpen || search" class="search-field"><PhMagnifyingGlass :size="16" /><input ref="searchInput" v-model="search" aria-label="搜索会话" placeholder="搜索对话" @keydown.esc.prevent.stop="closeSearch" /><button class="icon-button small" aria-label="关闭搜索" @click="closeSearch"><PhX :size="14" /></button></label>
        <div v-if="loading && !sidebarThreads.length" class="sidebar-empty"><span class="spinner" />正在读取会话…</div>
        <p v-else-if="search && !sidebarThreads.length" class="sidebar-empty">没有找到匹配的对话</p>
        <div v-else-if="awaitingDevice && !sidebarThreads.length" class="sidebar-connect"><p>尚未连接设备</p><button type="button" class="button secondary" :disabled="!online" @click="connectSelected"><PhDesktop :size="16" />{{ connectLabel }}</button></div>
        <nav v-else class="thread-list" aria-label="最近会话"><ProjectSidebar :device-id="selectedId" :threads="sidebarThreads" :active-id="active?.id" :busy-thread-ids="busyThreadIds" :approval-thread-ids="approvalThreadIds" :queue-counts="queueCounts" @select="selectThread" @archive="archiveThread" @new-chat="startProject" /><button v-if="threadCursor" class="text-button load-more" :disabled="loading" @click="codex.refreshThreads(search, true)">{{ loading ? '正在加载…' : '加载更多' }}</button><p v-if="projectsLoading && !search" class="sidebar-empty">正在读取项目…</p></nav>
      </div>
      <button ref="archiveTrigger" type="button" class="sidebar-archive" :disabled="revising" @click="archiveOpen = true; menuOpen = false"><PhArchive :size="17" />归档会话</button>
      <div class="sidebar-footer"><DisplaySettings :retry-preferences="codex.retryPreferences.value" :retry-settings-error="codex.retrySettingsError.value" @update-retry="codex.updateRetryPreferences" :typography="typography" @preview-width="setWidthPreview" @preview-image-background="setImagePreview" ref="settingsDialog" :notifications="notifications" :config-request="deviceConfigRequest" :models="models" :connected="connected" :device-key="selectedId + status" :device-name="selected?.name" v-model:auto-connect="autoConnect" v-model:auto-wrap="autoWrap" v-model="contentWidth" v-model:theme="theme" v-model:background-mode="backgroundMode" v-model:image-background="imageBackground" :background-url="backgroundUrl" :background-remote-url="backgroundRemoteUrl" :export-appearance="exportAppearanceSettings" :import-appearance="importAppearanceSettings" :background-name="backgroundName" :background-busy="backgroundBusy" :background-error="backgroundError" @use-background-url="setBackgroundUrl" @upload-background="uploadBackground" @remove-background="removeBackground" /><button class="text-button" @click="helpOpen = true; menuOpen = false"><PhQuestion :size="17" />使用指南</button><span class="spacer" /><button v-if="!installed" class="icon-button small" aria-label="安装应用" title="安装应用" :disabled="installing" @click="install"><PhDownloadSimple :size="17" /></button><button v-if="requiresKey && authenticated" class="icon-button small" aria-label="退出登录" title="退出登录" @click="logout"><PhSignOut :size="17" /></button></div>
    </aside>

    <main class="workspace" :data-background="backgroundMode" :class="{ 'has-image-background': backgroundMode === 'image' && !!backgroundUrl, 'wrap-command-output': autoWrap }">
      <WorkspaceBackground :mode="backgroundMode" :theme="resolvedTheme" :image-url="backgroundUrl" :image-settings="displayImageBackground" :welcome="welcome" />
      <div v-if="!online || !bridgeReachable" class="top-notice offline" role="status"><PhWifiSlash :size="17" /><span>{{ !online ? '当前离线。联网后将同步服务端设备配置，联网后再继续工作。' : '连接服务不可达，请检查网络或服务状态。' }}</span></div>
      <header class="workspace-header"><div class="header-left"><div v-if="collapsed || isMobile" class="collapsed-controls"><button ref="menuButton" class="icon-button" :aria-label="isMobile ? '打开导航' : '展开侧栏'" :aria-expanded="isMobile ? menuOpen : !collapsed" @click="toggleMenu"><PhSidebarSimple :size="20" /></button><button class="icon-button" aria-label="搜索对话" @click="openSearch"><PhMagnifyingGlass :size="20" /></button><button class="icon-button" aria-label="开启新对话" @click="startNew"><PhPlusCircle :size="20" /></button></div><SubAgentBadge v-if="activeAgentIdentity" :name="activeAgentIdentity.name" :role="activeAgentIdentity.role" /><span class="conversation-title">{{ threadTitle }}</span></div><div class="header-right"><ThreadActionsMenu v-if="active" :disabled="forking || revising || changesState.applying" :connected="connected" :pinned="isPinned" :can-copy="!!items.length" :has-completed-turn="active.turns.some(turn => turn.status === 'completed')" @rename="showRename()" @pin="togglePin" @side="forkConversation(false, true)" @fork="forkConversation($event)" @copy="copyConversation" @open-window="openConversationWindow" @archive="archiveThread(active.id)" /><button v-if="active" ref="inspectorTrigger" class="icon-button small" type="button" aria-label="对话详情" title="对话详情" :aria-expanded="inspectorDocked || !inspectorWide && inspectorOpen" :class="{ 'is-active': inspectorDocked || !inspectorWide && inspectorOpen }" @click="toggleInspector"><PhSidebarSimple :size="19" /></button><button class="icon-button small" type="button" aria-label="文件浏览器" :title="connected ? '文件浏览器' : '连接设备后浏览文件'" :disabled="!connected || loadingThread || changesState.applying" :aria-expanded="!!workspaceFileTarget" :class="{ 'is-active': !!workspaceFileTarget }" @click="toggleFileBrowser"><PhFolderOpen :size="19" /></button><button class="icon-button small" type="button" aria-label="任务中心" title="任务中心" @click="agentCenterOpen = true"><PhSquaresFour :size="19" /></button><DevicePicker :connection-states="codex.connectionStates.value" :disabled="revising || codex.goalSaving.value || changesState.applying || !!editingMessage || !!queueDraftThread" :profiles="profiles" :selected-id="selectedId" :status="status" :status-text="statusText" :online="online" @select="connectProfile" @edit="openConnections($event)" @add="openConnections()" @disconnect="disconnectDevice" /></div></header>
      <div v-if="error" class="error-banner" role="alert"><PhWarningCircle :size="18" /><span>{{ error }}</span><button class="icon-button small" aria-label="关闭错误提示" @click="error = ''"><PhX :size="16" /></button></div>
      <UpdateBanner :available="needRefresh" :update="() => pwa.updateServiceWorker(true)" @error="codex.toast" />
      <div class="workspace-content">
      <div class="chat-body" :class="{ 'is-welcome': welcome }">
        <section ref="scrollArea" class="conversation" aria-label="对话内容" @scroll.passive="trackScroll" @wheel.passive="historyScroll.wheel" @touchstart.passive="historyScroll.touchstart" @touchmove.passive="historyScroll.touchmove" @touchend.passive="historyScroll.touchend" @touchcancel.passive="historyScroll.reset">
          <div v-if="welcome" class="welcome"><h1>有什么需要帮忙？</h1></div>
          <div v-else-if="loadingThread" class="loading-conversation" role="status"><span class="spinner" /><span>{{ loadSlow ? '这个会话较长，正在读取最近消息…' : '正在打开对话…' }}</span><button class="text-button" @click="sessionUrl.cancelRestore(); codex.cancelThreadLoad(); sessionUrl.sync()">取消加载</button></div>
          <div v-else-if="threadLoadError" class="thread-load-error" role="alert"><PhWarningCircle :size="24" /><h2>会话未能加载</h2><p>{{ threadLoadError }}</p><div><button class="button primary" :disabled="!connected" @click="selectThread(pendingThreadId)">重新加载</button><button class="button secondary" @click="sessionUrl.cancelRestore(); codex.cancelThreadLoad(); sessionUrl.sync()">返回</button></div></div>
          <div v-else class="message-list"><button v-if="historyCursor" class="text-button history-more" :disabled="!canLoadHistory" title="在顶部连续向上滚动两次可自动加载" @click="earlier"><PhArrowsClockwise :size="15" :class="{ spinning: loadingEarlier }" />{{ loadingEarlier ? '正在加载…' : '加载更早消息' }}</button><p v-if="active && !items.length && !busy" class="empty-thread">这个对话还没有消息。写下你想做的事。</p><template v-for="row in activityRows" :key="row.key"><p v-if="'stoppedLabel' in row" class="turn-stopped-duration" :data-turn-id="row.turnId">{{ row.stoppedLabel }}</p><ToolActivityGroup @open-file="workspaceFileTarget = $event" v-else-if="'group' in row" :items="row.group" :document-summary="row.documentSummary" :now="clockNow" /><template v-else><MessageRevisionEditor v-if="editingMessage?.id === row.item.id" :parts="editingMessage.parts" :read-attachments="codex.readAttachments" :saving="revising" :error="editingMessage.error" @save="saveEdited" @cancel="editingMessage = undefined" /><MessageItem v-else @open-file="workspaceFileTarget = $event" :work-duration-seconds="workDurations.get(row.item.id)" :item="row.item" :now="clockNow" :actions-disabled="changesState.applying || !connected || loadingThread || revising || codex.sending.value" :edit-disabled="!!messageEditError(row.item)" :action-hint="messageEditError(row.item)" @copy="copy" @edit="beginEdit" @withdraw="requestWithdraw" /></template></template><MotionCollapse :open="showCurrentTurnFiles"><FileChangeSummary ref="fileSummary" :key="selectedId + '/' + active?.id + '/' + active?.turns.at(-1)?.id" :files="currentTurnFiles" :disabled="changesState.applying" :undo-disabled="!!undoHint" :undo-hint="undoHint" :undone="changesState.undone" :undoing="changesState.applying" @view="openChanges" @undo="undoChanges" /></MotionCollapse><TurnFailure :failure="turnFailure" :retryable="active?.turns.at(-1)?.status === 'failed'" :loading="retryingFailure || codex.autoRetryStarting.value" :auto-retry-status="codex.autoRetryStatus.value" :auto-retry-pending="codex.autoRetryPending.value" @cancel-auto-retry="codex.cancelAutoRetry()" :disabled="composerBlocked || busy || !!activeApprovals.length" @retry="retryFailedTurn" /><div v-if="(busy || reconnectStatus) && !activeApprovals.length && (!liveReasoning || reconnectStatus || compacting)" class="working-status" :class="{ reconnecting: !!reconnectStatus }" role="status"><span class="working-dots"><i /><i /><i /></span><span v-if="reconnectStatus" class="runtime-status">{{ reconnectStatus }}</span><span v-else-if="compacting" class="runtime-status">压缩上下文中</span><template v-else><span>Codex 正在工作<span v-if="workingElapsed !== undefined" class="working-elapsed" aria-live="off"> · {{ elapsedLabel(workingElapsed) }}</span></span></template></div></div>
        </section>
        <div ref="composerArea" class="composer-area" :class="{ 'is-moving': composerMoving }"><button v-if="!atBottom && !welcome" class="scroll-bottom icon-button" aria-label="滚动到最新消息" @click="atBottom = true; scrollBottom()"><PhArrowDown :size="19" /></button>
          <p v-if="revising" class="revision-progress" role="status">正在更新会话…</p><ApprovalIsland @open-file="workspaceFileTarget = $event" @withdraw-steer="codex.withdrawPendingSteer" @restore-steer="restoreSteerDraft" ref="island" :completion-open="!!composerTrigger" :completion-title="composerTrigger?.kind === 'file' ? '提及' : composerTrigger?.kind === 'skill' ? '技能' : '命令'" :completion-tabs="menuTabs" v-model:completion-tab="completionTab" @completion-host="completionHost = $event" @completion-active="completionActive = $event" :steers="codex.pendingSteers.value" :has-questions="!!asyncQuestions.length" :approvals="activeApprovals" :reasoning="reconnectStatus || compacting ? '' : liveReasoning" :thinking-elapsed="thinkingElapsed" :has-queue="!!currentQueue.length || (!!active && queueDraftThread === active.id)" :disabled="!connected || revising" @respond="codex.respond"><template #questions><AsyncQuestionPane :key="selectedId + '/' + active?.id" ref="questionPane" :questions="asyncQuestions" :submit="codex.answerAsyncQuestion" :disabled="!connected || revising || loadingThread" @focus-composer="returnFromQuestion" /></template><template #goal><GoalPanel :key="selectedId" ref="goalPanel" :scope-key="active?.id || 'new'" :goal="codex.goal.value" :now="codex.clockNow.value" :loading="codex.goalLoading.value" :saving="codex.goalSaving.value" :error="codex.goalError.value" :supported="codex.goalSupported.value" :disabled="changesState.applying || !connected || revising || loadingThread" :show-summary="!activeApprovals.length" @refresh="codex.refreshGoal()" @save="codex.setGoal($event)" @clear="codex.clearGoal()" /></template><template #queue><QueuePane @open-file="workspaceFileTarget = $event" :key="selectedId + '/' + active?.id" @editing="queueDraftThread = $event ? active?.id || '' : ''" :messages="currentQueue" :working="busy" :paused="queuePaused" :server-managed="(serverQueueSupported || currentQueue.some(job => job.source === 'server')) && !currentQueue.some(job => job.source !== 'server')" :save="codex.updateQueued" :read-attachments="codex.readAttachments" :disabled="!connected || revising" @remove="codex.removeQueued" @restore="restoreQueuedDraft" @resume="codex.resumeQueue" @pause="codex.pauseQueue" /></template><div class="composer-directory"><WorkingDirectoryPicker ref="directoryPicker" v-model="directoryChoice" :directories="projectPaths" :default-directory="codex.defaultWorkingDirectory.value" :disabled="changesState.applying || !connected || loadingThread || codex.goalSaving.value" /></div><template #workspace><WorkspaceBadge :context="gitContext" /></template></ApprovalIsland>
          <form class="composer" :class="{ 'has-text': hasPrompt(draft) }" @submit.prevent="send()" @focusin="onComposerFocus" @input="engageComposer" @click="onComposerClick">
            <PromptEditor :input-history="inputHistory.entries.value" @refresh-history="inputHistory.refresh()" :history-scope="selectedId + '/' + (active?.id || 'new')" external-suggestions :suggestion-target="completionHost" :suggestions-active="completionActive" @navigate-completion="island?.navigate($event)" id="message-input" ref="promptEditor" v-model="draft" :placeholder="composerPlaceholder" :disabled="loadingThread || revising || !!editingMessage || codex.goalSaving.value" :suggestions="composerSuggestions" :suggestions-loading="suggestionsLoading" :suggestions-error="suggestionsError" @trigger="triggerComposer" @select-suggestion="selectComposerSuggestion" @keydown="onComposerKey" @files="attach" />
            <p v-if="attaching" class="attachment-progress" role="status">{{ attachmentProgress }}<button type="button" class="icon-button small" aria-label="取消添加附件" @click="attachmentController?.abort()"><PhX :size="15" /></button></p><p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
            <div class="composer-toolbar">
              <div class="composer-options"><ComposerPopover label="添加附件" trigger-class="attachment-trigger" :width="220" :disabled="attaching || loadingThread || revising || !!editingMessage"><template #trigger><PhPlus :size="22" /></template><template #default="{ close }"><div role="menu" aria-label="附件"><button class="composer-menu-item" type="button" role="menuitem" @click="close(); imageInput?.click()"><PhFolderOpen :size="19" /><span>添加文件</span></button></div></template></ComposerPopover><input ref="imageInput" class="sr-only" tabindex="-1" type="file" multiple aria-label="选择附件" @change="attach([...(imageInput?.files || [])])" /><PermissionPicker ref="permissionPicker" v-model="permission" :disabled="settingsBlocked" :unavailable="permissionUnavailable" /></div>
              <div class="composer-actions"><button v-if="awaitingDevice" type="button" class="composer-control composer-connect" :disabled="!online" @click.stop="connectSelected"><PhDesktop :size="16" /><span>{{ connectLabel }}</span></button><template v-else><ContextIndicator ref="contextIndicator" :usage="contextUsage" :session-id="currentSessionId" :compact-disabled="!active || !connected || busy || loadingThread || revising || changesState.applying || codex.goalSaving.value" :compacting="compacting" @compact="codex.compactContext()" @copy="copy" /><ModelPicker ref="modelPicker" :model-value="model" @update:model-value="selectModel" :models="models" :disabled="settingsBlocked" /><ReasoningPicker ref="reasoningPicker" v-model="effort" v-model:service-tier="serviceTier" :model="modelInfo" :disabled="settingsBlocked" /></template><button v-if="activeTurn && connected && !hasPrompt(draft)" class="send-button stop-button" type="button" aria-label="停止生成" :disabled="revising || codex.interrupting.value" @click="codex.interrupt()"><PhSquare :size="16" weight="fill" /></button><button v-if="busy && hasPrompt(draft)" type="button" class="icon-button queue-send" aria-label="加入消息队列" title="加入队列（Tab）" :disabled="composerBlocked || attaching" @click="send(true)"><PhListNumbers :size="20" /></button><button v-if="!busy || hasPrompt(draft)" class="send-button" type="submit" :disabled="composerBlocked || !hasPrompt(draft) || attaching || (busy && !active)" :aria-label="busy ? '发送到当前任务' : '发送消息'" :title="busy ? '发送到当前任务（Enter）' : '发送消息'"><span v-if="attaching" class="spinner" /><PhArrowUp v-else :size="22" weight="bold" /></button></div>
            </div>
          </form>
          <div v-if="welcome" class="suggestions"><button v-for="suggestion in suggestions" :key="suggestion.title" @click="suggest(suggestion.text)"><component :is="suggestion.icon" :size="17" />{{ suggestion.title }}</button></div>

        </div>
      </div>
      <SideChat @busy="sideChatBusy = $event" v-if="sideChat" :key="sideChat.threadId" :thread-id="sideChat.threadId" :profile="sideChat.profile" :token="sideChat.token" @close="sideChat = undefined" @copy="copy" @notice="notifications.notify" />
      <Transition name="inspector-reveal"><aside v-if="inspectorDocked" class="inspector-dock" aria-label="对话详情"><div class="inspector-dock-inner"><ThreadInspector :identity="subAgentIdentity(active)" :key="selectedId + '/' + active?.id" :agents="threadInsights.agents" :files="threadInsights.files" :loading="threadInspector.loading.value" :error="threadInspector.error.value" :disabled="!connected || revising" @inspect="threadInspector.inspect($event, true)" @refresh="threadInspector.refresh()" @open-thread="openAgentThread" @inspect-file="inspectFile" @create-output="createOutput" @close="closeInspector" /></div></aside></Transition>
      <ChangesPanel :device-key="selectedId" v-if="active" ref="changesPanel" :key="selectedId + '/' + active.id" :open="changesOpen" :wide="changesWide" :cwd="active.cwd" :turn-id="active.turns.at(-1)?.id || ''" :turn-patch="turnPatch" :files="currentTurnFiles" :history-files="threadInsights.files" :request="workspaceRequest" :connected="connected" :busy="busy || revising" @close="changesOpen = false" @state="changesState = $event" @toast="codex.toast" />
    <WorkspaceFilePanel :target="workspaceFileTarget" :cwd="active?.cwd || workingDirectory || ''" :device-name="selected?.name || '当前设备'" :connected="connected" :run="workspaceFileRun" can-select-directory :actions-disabled="settingsBlocked || changesState.applying" @select-directory="chooseFileDirectory" @close="workspaceFileTarget = null" @copy="copy" />
      </div>
    </main>
    <BaseDialog :open="!inspectorWide && inspectorOpen && !!active && !loadingThread" title="对话详情" @close="closeInspector"><ThreadInspector :identity="subAgentIdentity(active)" v-if="!inspectorWide && inspectorOpen && !!active && !loadingThread" :key="selectedId + '/' + active?.id" :agents="threadInsights.agents" :files="threadInsights.files" :loading="threadInspector.loading.value" :error="threadInspector.error.value" :disabled="!connected || revising" @inspect="threadInspector.inspect($event, true)" @refresh="threadInspector.refresh()" @open-thread="openAgentThread" @inspect-file="inspectFile" @create-output="createOutput" @close="closeInspector" /></BaseDialog>
    <ArchiveDialog v-if="archiveOpen" :open="archiveOpen" :connected="connected" :device-key="selectedId" :request="codex.readArchivedThreads" :restore="restoreArchived" @close="closeArchives" @select="archiveOpen = false; selectThread($event)" />
    <AgentCommandCenter v-if="agentCenterOpen" :open="agentCenterOpen" :connected="connected" :device-key="selectedId" :request="codex.readAgentCenter" @close="agentCenterOpen = false" @select="agentCenterOpen = false; selectThread($event)" />
    <Transition name="toast"><div v-if="notice" class="toast" role="status"><PhCheckCircle :size="18" />{{ notice }}</div></Transition>

    <BaseDialog :open="!!withdrawingMessage" title="撤回这条消息？" description="这条消息、本轮回复和之后的对话会从会话记录中移除。已执行的命令与文件修改不会还原。" :dismissible="!revising" @close="withdrawingMessage = undefined"><p class="withdraw-preview">{{ withdrawingMessage?.preview }}</p><p v-if="withdrawingMessage?.error" class="inline-error" role="alert">{{ withdrawingMessage.error }}</p><div class="dialog-actions"><span class="spacer" /><button type="button" class="button secondary" :disabled="revising" @click="withdrawingMessage = undefined">取消</button><button type="button" class="button primary" :disabled="revising" @click="confirmWithdraw">{{ revising ? '正在撤回…' : busy ? '停止并撤回' : '确认撤回' }}</button></div></BaseDialog>
    <ConnectionDialog :open="connectionOpen" :profiles="profiles" :editing-id="editingId" :save="codex.saveProfile" :token-for="codex.tokenFor" @close="connectionOpen = false" @connect="connectProfile" :remove="codex.removeProfile" @saved="codex.toast('连接已保存到此浏览器。')" />
    <BaseDialog :open="helpOpen" title="连接指南" description="连接本机或远端的 Codex App Server。" wide @close="helpOpen = false"><div class="guide"><h3>连接本机 daemon</h3><p>在运行 Bun 服务的机器上启动 daemon，然后填写它的 Unix control socket 绝对路径。</p><pre><code>codex app-server daemon start</code></pre><p class="field-hint">通常位于 $CODEX_HOME/app-server-control/app-server-control.sock；默认 CODEX_HOME 是 ~/.codex。地址示例：</p><pre><code>unix:///home/me/.codex/app-server-control/app-server-control.sock</code></pre><h3>连接 WebSocket 服务</h3><p>也可以启动独立的 TCP App Server，再保存下面的 ws 地址。</p><pre><code>codex app-server --listen ws://127.0.0.1:4500</code></pre><p>跨机器访问请使用 TLS 代理提供的 wss:// 地址，并在 App Server 配置传输认证。访问令牌是该服务的 Bearer token，和 OpenAI API key 是两种凭据。</p><h3>地址从哪里访问？</h3><p>连接由 Bun 桥接服务发起。因此 127.0.0.1 指向 Bun 服务所在机器，Unix 路径也属于该机器。前端和 Bun 请部署在同一站点。</p><h3>重新连接与离线</h3><p>网络中断后会自动重连并恢复当前会话；不会自动重发任务。离线时可打开已缓存的应用外壳、查看和编辑设备地址，执行任务仍需联网。</p><a href="https://developers.openai.com/codex/app-server/" target="_blank" rel="noopener noreferrer" class="text-link">查看官方 App Server 文档<PhArrowRight :size="16" /></a></div></BaseDialog>
    <BaseDialog :open="installOpen" title="安装 Codex Remote" description="安装后，可以像普通应用一样从桌面打开。" @close="installOpen = false"><div class="guide"><div class="install-illustration"><span class="brand-icon"><PhTerminal :size="35" weight="bold" /></span><span>Codex Remote</span></div><h3>Chrome / Edge</h3><p>使用地址栏的安装按钮，或浏览器菜单中的“安装应用”。若当前窗口没有显示安装入口，请在浏览器中直接打开本站。</p><h3>iPhone / iPad</h3><p>在 Safari 中打开本站，轻点“分享”，选择“添加到主屏幕”。</p><h3>安全连接</h3><p>安装与离线缓存需要 HTTPS；本机 localhost 开发例外。首次联网打开后，应用外壳可离线使用。</p><p v-if="registrationError" class="inline-error">{{ registrationError }}</p></div></BaseDialog>
    <BaseDialog :open="!authenticated" title="欢迎回来" description="输入部署者设置的访问密码，连接你的工作空间。" :dismissible="false">
      <form class="login-form" @submit.prevent="login">
        <label class="field">应用访问密码<input v-model="loginKey" name="password" autofocus type="password" autocomplete="current-password" :disabled="loggingIn" required placeholder="APP_ACCESS_KEY 对应的密码" /></label>
        <div class="login-remember"><div><span>记住密码</span><p id="remember-login-hint">在这台设备保持登录 30 天，退出后清除。</p></div><ToggleSwitch v-model="rememberLogin" label="记住密码" aria-describedby="remember-login-hint" :disabled="loggingIn" /></div>
        <p v-if="loginError" role="alert" class="inline-error">{{ loginError }}</p>
        <button class="button primary" :disabled="loggingIn" type="submit">{{ loggingIn ? '正在验证…' : '进入工作空间' }}<PhArrowRight :size="17" /></button>
        <p class="field-hint">此密码用于访问 Bun 服务，与设备的 App Server 令牌分开。</p>
      </form>
    </BaseDialog>
  </div>
</template>
