<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { PhArchive, PhArrowDown, PhArrowRight, PhArrowUp, PhArrowsClockwise, PhCheckCircle, PhChatCircle, PhCode, PhDesktop, PhDownloadSimple, PhImage, PhList, PhMagnifyingGlass, PhNotePencil, PhPlus, PhPlusCircle, PhSidebarSimple, PhListNumbers, PhQuestion, PhSignOut, PhSparkle, PhSquare, PhSquaresFour, PhTerminal, PhWarningCircle, PhWifiSlash, PhX } from '@phosphor-icons/vue'
import BaseDialog from './components/BaseDialog.vue'
import ConnectionDialog from './components/ConnectionDialog.vue'
import MessageItem from './components/MessageItem.vue'
import ToolActivityGroup from './components/ToolActivityGroup.vue'
import ThreadInspector from './components/ThreadInspector.vue'
import FileChangeSummary from './components/FileChangeSummary.vue'
import MotionCollapse from './components/MotionCollapse.vue'
import { latestTurnFiles } from './lib/thread-insights'
import { parseGitPatch, undoUnavailableReason, type Request as WorktreeRequest } from './lib/worktree-changes'
import ChangesPanel from './components/ChangesPanel.vue'
import TurnFailure from './components/TurnFailure.vue'
import { buildActivityRows } from './lib/tool-activity'
import { useThreadInspector } from './composables/useThreadInspector'
import MessageRevisionEditor from './components/MessageRevisionEditor.vue'
import ApprovalIsland from './components/ApprovalIsland.vue'
import WorkspaceBackground from './components/WorkspaceBackground.vue'
import UpdateToast from './components/UpdateToast.vue'
import PromptEditor from './components/PromptEditor.vue'
import GoalPanel from './components/GoalPanel.vue'
import QueuePane from './components/QueuePane.vue'
import ProjectSidebar from './components/ProjectSidebar.vue'
import WorkingDirectoryPicker from './components/WorkingDirectoryPicker.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import { hasPrompt, messageEditError, messageParts, promptText, readImages, type PromptPart } from './lib/prompt'
import DevicePicker from './components/DevicePicker.vue'
import ReasoningPicker from './components/ReasoningPicker.vue'
import ContextIndicator from './components/ContextIndicator.vue'
import ModelPicker from './components/ModelPicker.vue'
import PermissionPicker from './components/PermissionPicker.vue'
import ComposerPopover from './components/ComposerPopover.vue'
import { useCodex } from './composables/useCodex'
import { useAppearance } from './composables/useAppearance'
import { usePwa } from './composables/usePwa'
import { useComposerEntrance } from './composables/useComposerEntrance'
import type { ConnectionProfile } from '../shared/protocol'
import { COMPOSER_COMMANDS, composerCommands, fileMentionText, submittedCommand, type ComposerCommandId } from './lib/composer-commands'

const AgentCommandCenter = defineAsyncComponent(() => import('./components/AgentCommandCenter.vue'))
const ArchiveDialog = defineAsyncComponent(() => import('./components/ArchiveDialog.vue'))
const archiveOpen = ref(false), archiveTrigger = ref<HTMLButtonElement>()
const agentCenterOpen = ref(false)
const codex = useCodex()
const { profiles, selectedId, selected, status, error, notice, online, bridgeReachable, authenticated, requiresKey, threads, projectThreads, workingDirectory, projectPaths, projectsLoading, threadCursor, active, models, model, effort, permission, permissionUnavailable, approvals, loading, loadingThread, pendingThreadId, threadLoadError, loadingEarlier, historyCursor, connected, activeTurn, busy, items, displayTurns, contextUsage, compacting, liveReasoning, reconnectStatus, thinkingElapsed, workingElapsed, clockNow, activeApprovals, modelInfo, currentQueue, queuePaused, serverQueueSupported, revising } = codex
const pwa = usePwa()
const { installed, installing, needRefresh, registrationError } = pwa
const connectionOpen = ref(false), helpOpen = ref(false), installOpen = ref(false), editingId = ref<string>()
const editingMessage = ref<{ id: string; threadId: string; parts: PromptPart[]; error?: string }>()
const withdrawingMessage = ref<{ id: string; threadId: string; preview: string; error?: string }>()
const draft = ref<PromptPart[]>([]), search = ref(''), loginKey = ref(''), loginError = ref(''), loggingIn = ref(false)
const menuOpen = ref(false), collapsed = ref(false), isMobile = ref(window.innerWidth <= 760)
const promptEditor = ref<InstanceType<typeof PromptEditor>>(), searchInput = ref<HTMLInputElement>(), searchButton = ref<HTMLButtonElement>(), scrollArea = ref<HTMLElement>(), sidebar = ref<HTMLElement>(), menuButton = ref<HTMLButtonElement>()
const atBottom = ref(true), queueDraftThread = ref('')
const inspectorWide = ref(window.innerWidth >= 1280), inspectorOpen = ref(window.innerWidth >= 1280)
const changesWide = ref(window.innerWidth >= 1100)
const inspectorRequested = ref(false)
const changesOpen = ref(false), changesPanel = ref<InstanceType<typeof ChangesPanel>>()
const changesState = ref({ undone: false, applying: false })
const retryingFailure = ref(false)
const turnFailure = computed(() => codex.currentTurnFailure.value ? { message: codex.currentTurnFailure.value } : null)
async function retryFailedTurn() {
  if (!turnFailure.value || !active.value || composerBlocked.value || busy.value || retryingFailure.value || activeApprovals.value.length) return
  retryingFailure.value = true
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
const showCurrentTurnFiles = computed(() => active.value?.turns.at(-1)?.status === 'completed' && currentTurnFiles.value.length > 0)
const hasInspectorContent = computed(() => !!threadInsights.value.agents.length || !!threadInsights.value.files.length)
const inspectorDocked = computed(() => inspectorWide.value && (hasInspectorContent.value || inspectorRequested.value) && inspectorOpen.value && !loadingThread.value && !changesOpen.value)
const activityRows = computed(() => buildActivityRows(displayTurns.value))
watch([selectedId, () => active.value?.id], () => { inspectorOpen.value = inspectorWide.value; inspectorRequested.value = false; changesOpen.value = false; changesState.value = { undone: false, applying: false } })
function toggleInspector() { if (changesState.value.applying) return; const visible = inspectorDocked.value || !inspectorWide.value && inspectorOpen.value; changesOpen.value = false; inspectorRequested.value = !visible; inspectorOpen.value = !visible }
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
type ComposerTrigger = { kind: 'command' | 'file'; query: string }
type ComposerSuggestion = { id: string; label: string; description?: string; insertText?: string }
const composerTrigger = ref<ComposerTrigger | null>(null), fileSuggestions = ref<ComposerSuggestion[]>([])
const suggestionsLoading = ref(false), suggestionsError = ref('')
let fileSearchTimer: ReturnType<typeof setTimeout> | undefined, fileSearchController: AbortController | undefined, fileSearchSequence = 0
const composerSuggestions = computed<ComposerSuggestion[]>(() => composerTrigger.value?.kind === 'command'
  ? composerCommands(composerTrigger.value.query, connected.value).map(command => ({ ...command, id: 'command:' + command.id }))
  : fileSuggestions.value)
function triggerComposer(trigger: ComposerTrigger | null) { composerTrigger.value = trigger }
function cancelFileSearch() {
  clearTimeout(fileSearchTimer); fileSearchController?.abort(); fileSearchController = undefined
  fileSearchSequence++; fileSuggestions.value = []; suggestionsLoading.value = false; suggestionsError.value = ''
}
watch([composerTrigger, selectedId, () => active.value?.id, workingDirectory, connected], () => {
  cancelFileSearch()
  const trigger = composerTrigger.value
  if (trigger?.kind !== 'file') return
  if (!connected.value) { suggestionsError.value = '连接设备后搜索文件'; return }
  if (!(active.value?.cwd || workingDirectory.value)) { suggestionsError.value = '请先选择工作目录'; return }
  const sequence = fileSearchSequence, query = trigger.query
  suggestionsLoading.value = true
  fileSearchTimer = setTimeout(async () => {
    const controller = new AbortController(); fileSearchController = controller
    try {
      const files = await codex.searchFiles(query, { signal: controller.signal })
      if (sequence !== fileSearchSequence || controller.signal.aborted) return
      fileSuggestions.value = files.map((file, index) => ({ id: 'file:' + index, label: file.file_name, description: file.path, insertText: fileMentionText(file.path) }))
    } catch (cause) {
      if (sequence === fileSearchSequence && !controller.signal.aborted) suggestionsError.value = '搜索文件失败：' + (cause instanceof Error ? cause.message : '请重试')
    } finally { if (sequence === fileSearchSequence) suggestionsLoading.value = false }
  }, 140)
})
function runComposerCommand(id: ComposerCommandId, argument = '') {
  if (changesState.value.applying || revising.value || loadingThread.value || codex.goalSaving.value || editingMessage.value || attaching.value) return false
  const command = COMPOSER_COMMANDS.find(command => command.id === id)
  if (!command) return false
  if ('requiresConnection' in command && !connected.value) { codex.toast('请先连接设备'); return false }
  if (argument && id !== 'goal') { codex.toast(command.label + ' 请通过面板选择'); return false }
  if (id === 'new') startNew()
  else if (id === 'model') void modelPicker.value?.show()
  else if (id === 'effort') void reasoningPicker.value?.show()
  else if (id === 'permissions') void permissionPicker.value?.show()
  else if (id === 'project') void directoryPicker.value?.show()
  else if (id === 'settings') settingsDialog.value?.show()
  else if (id === 'tasks') agentCenterOpen.value = true
  else if (id === 'help') helpOpen.value = true
  else if (id === 'goal') void goalPanel.value?.show(argument)
  return true
}
function selectComposerSuggestion(id: string) {
  if (!id.startsWith('command:')) return
  const command = id.slice('command:'.length) as ComposerCommandId
  promptEditor.value?.applySuggestion('')
  void nextTick(() => runComposerCommand(command))
}
const imageInput = ref<HTMLInputElement>()
const attachmentError = ref(''), attaching = ref(false), loadSlow = ref(false)
let loadTimer: ReturnType<typeof setTimeout> | undefined
watch(loadingThread, value => { clearTimeout(loadTimer); loadSlow.value = false; if (value) loadTimer = setTimeout(() => { loadSlow.value = true }, 5000) })
const updateBlocked = computed(() => changesState.value.applying || codex.goalSaving.value || revising.value || !!editingMessage.value || !!queueDraftThread.value || busy.value || codex.queuedMessages.value.some(job => job.source !== 'server'))
const composerBlocked = computed(() => codex.steering.value || codex.sending.value || changesState.value.applying || codex.goalSaving.value || revising.value || !!editingMessage.value || !connected.value || loadingThread.value || !!threadLoadError.value)
const settingsBlocked = computed(() => codex.goalSaving.value || revising.value || !connected.value || loadingThread.value)
const { contentWidth, theme, resolvedTheme, autoConnect, backgroundMode, imageBackground, backgroundUrl, backgroundName, backgroundBusy, backgroundError, uploadBackground, removeBackground } = useAppearance(codex.toast)
const searchOpen = ref(false)
const sidebarThreads = computed(() => search.value.trim() ? threads.value : [...new Map([...projectThreads.value, ...threads.value].map(thread => [thread.id, thread])).values()])
const queueCounts = computed(() => Object.fromEntries(sidebarThreads.value.map(thread => [thread.id, queueCount(thread.id)])))
const busyThreadIds = computed(() => [...new Set([...sidebarThreads.value.filter(thread => thread.status?.type === 'active').map(thread => thread.id), ...((busy.value || revising.value) && active.value ? [active.value.id] : [])])])
const approvalThreadIds = computed(() => approvals.value.map(approval => approval.params.threadId).filter((id): id is string => !!id))
const directoryChoice = computed({ get: () => active.value?.cwd ?? workingDirectory.value ?? '', set: chooseDirectory })
function chooseDirectory(path: string) { if (revising.value || codex.goalSaving.value || changesState.value.applying) return; engageComposer(); if (active.value && active.value.cwd !== path) { draftEpoch++; codex.newThread() }; workingDirectory.value = path; menuOpen.value = false; promptEditor.value?.focus(true) }
function startProject(cwd: string) { if (revising.value || codex.goalSaving.value || changesState.value.applying) return; startNew(); engageComposer(); workingDirectory.value = cwd; void nextTick(() => promptEditor.value?.focus(true)) }
function elapsedLabel(seconds: number) { return seconds < 60 ? Math.floor(seconds) + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + Math.floor(seconds % 60) + ' 秒' }
let draftEpoch = 0
async function openSearch() { searchOpen.value = true; if (isMobile.value) menuOpen.value = true; else collapsed.value = false; await nextTick(); searchInput.value?.focus() }
async function closeSearch() { search.value = ''; searchOpen.value = false; await nextTick(); searchButton.value?.focus() }
function queueCount(id: string) { return codex.queuedMessages.value.filter(job => job.deviceId === selectedId.value && job.threadId === id).length }
const threadTitle = computed(() => { const thread = threads.value.find(t => t.id === pendingThreadId.value) || active.value; return thread?.name || thread?.preview || '新对话' })
async function attach(files: File[]) {
  if (attaching.value) return
  const epoch = draftEpoch, insertion = promptEditor.value?.reserveInsertion(); attaching.value = true; attachmentError.value = ''
  try { const images = await readImages(files, draft.value); if (epoch === draftEpoch) images.forEach((image, index) => promptEditor.value?.insertImage(image, index === 0 ? insertion : undefined)) }
  catch (e) { attachmentError.value = e instanceof Error ? e.message : '添加图片失败。' }
  finally { attaching.value = false; if (imageInput.value) imageInput.value.value = '' }
}
function shortcut(event: KeyboardEvent) { if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); void modelPicker.value?.show() } }
async function earlier() { const el = scrollArea.value, height = el?.scrollHeight || 0, top = el?.scrollTop || 0; atBottom.value = false; await codex.loadEarlier(); await nextTick(); if (el) el.scrollTop = top + el.scrollHeight - height }
const suggestions = [
  { title: '认识项目', icon: PhCode, text: '帮我梳理这个项目的目录结构、核心模块和运行方式。' },
  { title: '排查问题', icon: PhMagnifyingGlass, text: '帮我检查项目中潜在的问题，先分析原因，再给出修复建议。' },
  { title: '实现功能', icon: PhSparkle, text: '我想在这个项目中实现一个新功能，请先了解现有代码，再和我一起制定方案。' },
]
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void codex.refreshThreads(value), 200) })
watch(model, () => { effort.value = '' }, { flush: 'sync' })
const scrollSignal = computed(() => items.value.map(i => i.id + ((i.text?.length || i.aggregatedOutput?.length || 0) + (i.summary?.join('').length || 0) + (i.type === 'reasoning' ? i.content?.filter(s => typeof s === 'string').join('').length || 0 : 0))).join('|') + busy.value + activeApprovals.value.length)
watch(scrollSignal, async () => { if (atBottom.value) { await nextTick(); scrollBottom() } })
watch(() => active.value?.id, async () => { atBottom.value = true; await nextTick(); scrollBottom() })
watch(menuOpen, async open => { if (open && isMobile.value) { await nextTick(); sidebar.value?.querySelector<HTMLButtonElement>('button')?.focus() } })
function scrollBottom() { if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight }
function trackScroll() { const el = scrollArea.value; if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }
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
function connectProfile(profile: ConnectionProfile) { if (revising.value || changesState.value.applying) return; menuOpen.value = false; search.value = ''; if (connected.value && selectedId.value === profile.id) return; void codex.connect(profile) }
function startNew() { if (revising.value || codex.goalSaving.value || changesState.value.applying) return; draftEpoch++; composerEngaged.value = false; codex.newThread(); draft.value = []; attachmentError.value = ''; menuOpen.value = false }
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
function selectThread(id: string) { if (revising.value || changesState.value.applying) return; menuOpen.value = false; void codex.openThread(id) }
async function send(queueOnly = false) {
  if (draft.value.every(part => part.type === 'text')) {
    const command = submittedCommand(promptText(draft.value))
    if (command) {
      if (!COMPOSER_COMMANDS.some(item => item.id === command.name)) { codex.toast('未知命令：/' + command.name); return }
      if (runComposerCommand(command.name as ComposerCommandId, command.argument)) { draftEpoch++; draft.value = [] }
      return
    }
  }
  if (attaching.value || composerBlocked.value || !hasPrompt(draft.value)) return
  const parts = draft.value, epoch = draftEpoch
  if (await (busy.value && !queueOnly ? codex.steer(parts) : codex.send(parts))) {
    if (draft.value === parts && epoch === draftEpoch) { draftEpoch++; draft.value = []; attachmentError.value = '' }
    atBottom.value = true; await nextTick(); scrollBottom(); promptEditor.value?.focus(true)
  }
}
function onComposerKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Tab' && busy.value && hasPrompt(draft.value)) { event.preventDefault(); if (!composerBlocked.value) void send(true) }
  else if (event.key === 'Enter') { event.preventDefault(); if (!composerBlocked.value) void send() }
}
function restoreQueuedDraft(parts: PromptPart[]) { draftEpoch++; draft.value = [...draft.value, ...(hasPrompt(draft.value) ? [{ type: 'text' as const, text: '\n' }] : []), ...parts]; codex.toast('排队消息的编辑草稿已放回输入框。'); promptEditor.value?.focus(true) }
function suggest(text: string) { draftEpoch++; draft.value = [{ type: 'text', text }]; promptEditor.value?.focus(true) }
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
async function copy(text: string) { try { await navigator.clipboard.writeText(text); codex.toast('已复制到剪贴板。') } catch { codex.toast('无法访问剪贴板，请手动选择文字复制。') } }
async function install() { try { if (!(await pwa.install())) installOpen.value = true } catch { installOpen.value = true } }
async function login() { loggingIn.value = true; loginError.value = ''; try { await codex.login(loginKey.value); loginKey.value = '' } catch (e) { loginError.value = e instanceof Error ? e.message : '登录失败。' } finally { loggingIn.value = false } }
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
onUnmounted(() => { cancelFileSearch(); clearTimeout(searchTimer); clearTimeout(loadTimer); window.removeEventListener('resize', resize); window.removeEventListener('keydown', shortcut) })
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed }" :style="{ '--content-width': contentWidth ? contentWidth + 'px' : '100%' }">
    <button v-if="menuOpen && isMobile" class="drawer-backdrop" aria-label="关闭导航" tabindex="-1" @click="closeMenu" />
    <aside ref="sidebar" class="sidebar" :class="{ 'is-open': menuOpen }" :inert="(isMobile && !menuOpen) || (!isMobile && collapsed)" :role="isMobile ? 'dialog' : undefined" :aria-modal="isMobile && menuOpen ? true : undefined" aria-label="工作空间导航" @keydown="trapMenu">
      <div class="sidebar-brand"><button class="brand" aria-label="Codex Remote 首页" @click="startNew"><span class="brand-icon"><PhTerminal :size="23" weight="bold" /></span><span>codex<span class="brand-remote">remote</span></span></button><div class="sidebar-brand-actions"><button ref="searchButton" class="icon-button small" aria-label="搜索对话" title="搜索对话" :aria-expanded="searchOpen || !!search" @click="openSearch"><PhMagnifyingGlass :size="19" /></button><button class="icon-button small" :aria-label="isMobile ? '关闭导航' : '收起侧栏'" title="收起侧栏" @click="isMobile ? closeMenu() : toggleMenu()"><PhSidebarSimple :size="19" /></button></div></div>
      <button class="new-chat" @click="startNew"><PhNotePencil :size="18" />开启新对话</button>
      <div class="history-section">
        <div class="section-label"><span>项目</span><button class="icon-button small" aria-label="刷新会话列表" :disabled="!connected || loading" @click="codex.refreshThreads(search)"><PhArrowsClockwise :size="15" :class="{ spinning: loading }" /></button></div>
        <label v-if="searchOpen || search" class="search-field"><PhMagnifyingGlass :size="16" /><input ref="searchInput" v-model="search" aria-label="搜索会话" placeholder="搜索对话" @keydown.esc.prevent.stop="closeSearch" /><button class="icon-button small" aria-label="关闭搜索" @click="closeSearch"><PhX :size="14" /></button></label>
        <div v-if="loading && !sidebarThreads.length" class="sidebar-empty"><span class="spinner" />正在读取会话…</div>
        <p v-else-if="search && !sidebarThreads.length" class="sidebar-empty">没有找到匹配的对话</p>
        <nav v-else class="thread-list" aria-label="最近会话"><ProjectSidebar :threads="sidebarThreads" :active-id="active?.id" :busy-thread-ids="busyThreadIds" :approval-thread-ids="approvalThreadIds" :queue-counts="queueCounts" @select="selectThread" @archive="archiveThread" @new-chat="startProject" /><button v-if="threadCursor" class="text-button load-more" :disabled="loading" @click="codex.refreshThreads(search, true)">{{ loading ? '正在加载…' : '加载更多' }}</button><p v-if="projectsLoading && !search" class="sidebar-empty">正在读取项目…</p></nav>
      </div>
      <button ref="archiveTrigger" type="button" class="sidebar-archive" :disabled="revising" @click="archiveOpen = true; menuOpen = false"><PhArchive :size="17" />归档会话</button>
      <div class="sidebar-footer"><button class="text-button" @click="helpOpen = true; menuOpen = false"><PhQuestion :size="17" />使用指南</button><span class="spacer" /><button v-if="!installed" class="icon-button small" aria-label="安装应用" title="安装应用" :disabled="installing" @click="install"><PhDownloadSimple :size="17" /></button><button v-if="requiresKey && authenticated" class="icon-button small" aria-label="退出登录" title="退出登录" @click="logout"><PhSignOut :size="17" /></button></div>
    </aside>

    <main class="workspace" :data-background="backgroundMode" :class="{ 'has-image-background': backgroundMode === 'image' && !!backgroundUrl }">
      <WorkspaceBackground :mode="backgroundMode" :theme="resolvedTheme" :image-url="backgroundUrl" :image-settings="imageBackground" :welcome="welcome" />
      <header class="workspace-header"><div class="header-left"><div v-if="collapsed || isMobile" class="collapsed-controls"><button ref="menuButton" class="icon-button" :aria-label="isMobile ? '打开导航' : '展开侧栏'" :aria-expanded="isMobile ? menuOpen : !collapsed" @click="toggleMenu"><PhSidebarSimple :size="20" /></button><button class="icon-button" aria-label="搜索对话" @click="openSearch"><PhMagnifyingGlass :size="20" /></button><button class="icon-button" aria-label="开启新对话" @click="startNew"><PhPlusCircle :size="20" /></button></div><span class="conversation-title">{{ threadTitle }}</span></div><div class="header-right"><button v-if="active" ref="inspectorTrigger" class="icon-button small" type="button" aria-label="对话详情" title="对话详情" :aria-expanded="inspectorDocked || !inspectorWide && inspectorOpen" :class="{ 'is-active': inspectorDocked || !inspectorWide && inspectorOpen }" @click="toggleInspector"><PhSidebarSimple :size="19" /></button><button class="icon-button small" type="button" aria-label="任务中心" title="任务中心" @click="agentCenterOpen = true"><PhSquaresFour :size="19" /></button><DisplaySettings ref="settingsDialog" v-model:auto-connect="autoConnect" v-model="contentWidth" v-model:theme="theme" v-model:background-mode="backgroundMode" v-model:image-background="imageBackground" :background-url="backgroundUrl" :background-name="backgroundName" :background-busy="backgroundBusy" :background-error="backgroundError" @upload-background="uploadBackground" @remove-background="removeBackground" /><DevicePicker :disabled="revising || changesState.applying" :profiles="profiles" :selected-id="selectedId" :status="status" :status-text="statusText" :online="online" @select="connectProfile" @edit="openConnections($event)" @add="openConnections()" @disconnect="!revising && codex.disconnect()" /></div></header>
      <div v-if="!online || !bridgeReachable" class="top-notice offline" role="status"><PhWifiSlash :size="17" /><span>{{ !online ? '当前离线。你仍可查看保存的地址，联网后再继续工作。' : '连接服务不可达。你仍可查看保存的地址，请检查网络或服务状态。' }}</span></div>
      <div v-if="error" class="error-banner" role="alert"><PhWarningCircle :size="18" /><span>{{ error }}</span><button class="icon-button small" aria-label="关闭错误提示" @click="error = ''"><PhX :size="16" /></button></div>
      <div class="workspace-content">
      <div class="chat-body" :class="{ 'is-welcome': welcome }">
        <section ref="scrollArea" class="conversation" aria-label="对话内容" @scroll.passive="trackScroll">
          <div v-if="welcome" class="welcome"><h1>有什么需要帮忙？</h1></div>
          <div v-else-if="loadingThread" class="loading-conversation" role="status"><span class="spinner" /><span>{{ loadSlow ? '这个会话较长，正在读取最近消息…' : '正在打开对话…' }}</span><button class="text-button" @click="codex.cancelThreadLoad()">取消加载</button></div>
          <div v-else-if="threadLoadError" class="thread-load-error" role="alert"><PhWarningCircle :size="24" /><h2>会话未能加载</h2><p>{{ threadLoadError }}</p><div><button class="button primary" :disabled="!connected" @click="codex.openThread(pendingThreadId)">重新加载</button><button class="button secondary" @click="codex.cancelThreadLoad()">返回</button></div></div>
          <div v-else class="message-list"><button v-if="historyCursor" class="text-button history-more" :disabled="loadingEarlier || revising" @click="earlier"><PhArrowsClockwise :size="15" :class="{ spinning: loadingEarlier }" />{{ loadingEarlier ? '正在加载…' : '加载更早消息' }}</button><p v-if="active && !items.length && !busy" class="empty-thread">这个对话还没有消息。写下你想做的事。</p><template v-for="row in activityRows" :key="row.key"><ToolActivityGroup v-if="'group' in row" :items="row.group" :now="clockNow" /><template v-else><MessageRevisionEditor v-if="editingMessage?.id === row.item.id" :parts="editingMessage.parts" :saving="revising" :error="editingMessage.error" @save="saveEdited" @cancel="editingMessage = undefined" /><MessageItem v-else :item="row.item" :now="clockNow" :actions-disabled="changesState.applying || !connected || loadingThread || revising || codex.sending.value" :edit-disabled="!!messageEditError(row.item)" :action-hint="messageEditError(row.item)" @copy="copy" @edit="beginEdit" @withdraw="requestWithdraw" /></template></template><MotionCollapse :open="showCurrentTurnFiles"><FileChangeSummary ref="fileSummary" :key="selectedId + '/' + active?.id + '/' + active?.turns.at(-1)?.id" :files="currentTurnFiles" :disabled="changesState.applying" :undo-disabled="!!undoHint" :undo-hint="undoHint" :undone="changesState.undone" :undoing="changesState.applying" @view="openChanges" @undo="undoChanges" /></MotionCollapse><TurnFailure :failure="turnFailure" :retryable="active?.turns.at(-1)?.status === 'failed'" :loading="retryingFailure" :disabled="composerBlocked || busy || !!activeApprovals.length" @retry="retryFailedTurn" /><div v-if="(busy || reconnectStatus) && !activeApprovals.length" class="working-status" :class="{ reconnecting: !!reconnectStatus }" role="status"><span class="working-dots"><i /><i /><i /></span><span v-if="reconnectStatus" class="runtime-status">{{ reconnectStatus }}</span><span v-else-if="compacting" class="runtime-status">压缩上下文中</span><template v-else><span v-if="thinkingElapsed !== undefined" class="thinking-elapsed">思考中 {{ elapsedLabel(thinkingElapsed) }}</span><span v-if="liveReasoning" class="working-preview" :title="liveReasoning">{{ liveReasoning }}</span><span v-else-if="thinkingElapsed === undefined">Codex 正在工作<span v-if="workingElapsed !== undefined" class="working-elapsed" aria-live="off"> · {{ elapsedLabel(workingElapsed) }}</span></span></template></div></div>
        </section>
        <div ref="composerArea" class="composer-area" :class="{ 'is-moving': composerMoving }"><button v-if="!atBottom && !welcome" class="scroll-bottom icon-button" aria-label="滚动到最新消息" @click="atBottom = true; scrollBottom()"><PhArrowDown :size="19" /></button>
          <p v-if="revising" class="revision-progress" role="status">正在更新会话…</p><ApprovalIsland :approvals="activeApprovals" :has-queue="!!currentQueue.length || (!!active && queueDraftThread === active.id)" :disabled="!connected || revising" @respond="codex.respond"><template #goal><GoalPanel :key="selectedId" ref="goalPanel" :scope-key="active?.id || 'new'" :goal="codex.goal.value" :loading="codex.goalLoading.value" :saving="codex.goalSaving.value" :error="codex.goalError.value" :supported="codex.goalSupported.value" :disabled="changesState.applying || !connected || revising || loadingThread" :show-summary="!activeApprovals.length" @refresh="codex.refreshGoal()" @save="codex.setGoal($event)" @clear="codex.clearGoal()" /></template><template #queue><QueuePane :key="selectedId + '/' + active?.id" @editing="queueDraftThread = $event ? active?.id || '' : ''" :messages="currentQueue" :working="busy" :paused="queuePaused" :server-managed="(serverQueueSupported || currentQueue.some(job => job.source === 'server')) && !currentQueue.some(job => job.source !== 'server')" :save="codex.updateQueued" :disabled="!connected || revising" @remove="codex.removeQueued" @restore="restoreQueuedDraft" @resume="codex.resumeQueue" @pause="codex.pauseQueue" /></template><div class="composer-directory"><WorkingDirectoryPicker ref="directoryPicker" v-model="directoryChoice" :directories="projectPaths" :disabled="changesState.applying || !connected || loadingThread || codex.goalSaving.value" /></div></ApprovalIsland>
          <form class="composer" :class="{ 'has-text': hasPrompt(draft) }" @submit.prevent="send()" @focusin="onComposerFocus" @input="engageComposer" @click="onComposerClick">
            <PromptEditor id="message-input" ref="promptEditor" v-model="draft" :disabled="loadingThread || revising || !!editingMessage || codex.goalSaving.value" :suggestions="composerSuggestions" :suggestions-loading="suggestionsLoading" :suggestions-error="suggestionsError" @trigger="triggerComposer" @select-suggestion="selectComposerSuggestion" @keydown="onComposerKey" @files="attach" />
            <p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
            <div class="composer-toolbar">
              <div class="composer-options"><ComposerPopover label="添加附件" trigger-class="attachment-trigger" :width="220" :disabled="attaching || loadingThread || revising || !!editingMessage"><template #trigger><PhPlus :size="22" /></template><template #default="{ close }"><div role="menu" aria-label="附件"><button class="composer-menu-item" type="button" role="menuitem" @click="close(); imageInput?.click()"><PhImage :size="19" /><span>添加图片</span></button></div></template></ComposerPopover><input ref="imageInput" class="sr-only" tabindex="-1" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" aria-label="选择图片" @change="attach([...(imageInput?.files || [])])" /><PermissionPicker ref="permissionPicker" v-model="permission" :disabled="settingsBlocked" :unavailable="permissionUnavailable" /></div>
              <div class="composer-actions"><ContextIndicator :usage="contextUsage" /><ModelPicker ref="modelPicker" v-model="model" :models="models" :disabled="settingsBlocked" /><ReasoningPicker ref="reasoningPicker" v-model="effort" :model="modelInfo" :disabled="settingsBlocked" /><button v-if="activeTurn && connected" class="send-button stop-button" type="button" aria-label="停止生成" :disabled="revising" @click="codex.interrupt()"><PhSquare :size="16" weight="fill" /></button><button v-if="busy && hasPrompt(draft)" type="button" class="icon-button queue-send" aria-label="加入消息队列" title="加入队列（Tab）" :disabled="composerBlocked || attaching" @click="send(true)"><PhListNumbers :size="20" /></button><button v-if="!busy || hasPrompt(draft)" class="send-button" type="submit" :disabled="composerBlocked || !hasPrompt(draft) || attaching || (busy && !active)" :aria-label="busy ? '发送到当前任务' : '发送消息'" :title="busy ? '发送到当前任务（Enter）' : '发送消息'"><span v-if="attaching" class="spinner" /><PhArrowUp v-else :size="22" weight="bold" /></button></div>
            </div>
          </form>
          <div v-if="welcome" class="suggestions"><button v-for="suggestion in suggestions" :key="suggestion.title" @click="suggest(suggestion.text)"><component :is="suggestion.icon" :size="17" />{{ suggestion.title }}</button></div>

        </div>
      </div>
      <Transition name="inspector-reveal"><aside v-if="inspectorDocked" class="inspector-dock" aria-label="对话详情"><div class="inspector-dock-inner"><ThreadInspector :key="selectedId + '/' + active?.id" :agents="threadInsights.agents" :files="threadInsights.files" :loading="threadInspector.loading.value" :error="threadInspector.error.value" :disabled="!connected || revising" @inspect="threadInspector.inspect($event, true)" @refresh="threadInspector.refresh()" @open-thread="openAgentThread" @inspect-file="inspectFile" @create-output="createOutput" @close="closeInspector" /></div></aside></Transition>
      <ChangesPanel v-if="active" ref="changesPanel" :key="selectedId + '/' + active.id" :open="changesOpen" :wide="changesWide" :cwd="active.cwd" :turn-id="active.turns.at(-1)?.id || ''" :turn-patch="turnPatch" :files="currentTurnFiles" :history-files="threadInsights.files" :request="workspaceRequest" :connected="connected" :busy="busy || revising" @close="changesOpen = false" @state="changesState = $event" @toast="codex.toast" />
      </div>
    </main>
    <BaseDialog :open="!inspectorWide && inspectorOpen && !!active && !loadingThread" title="对话详情" @close="closeInspector"><ThreadInspector v-if="!inspectorWide && inspectorOpen && !!active && !loadingThread" :key="selectedId + '/' + active?.id" :agents="threadInsights.agents" :files="threadInsights.files" :loading="threadInspector.loading.value" :error="threadInspector.error.value" :disabled="!connected || revising" @inspect="threadInspector.inspect($event, true)" @refresh="threadInspector.refresh()" @open-thread="openAgentThread" @inspect-file="inspectFile" @create-output="createOutput" @close="closeInspector" /></BaseDialog>
    <ArchiveDialog v-if="archiveOpen" :open="archiveOpen" :connected="connected" :device-key="selectedId" :request="codex.readArchivedThreads" :restore="restoreArchived" @close="closeArchives" @select="archiveOpen = false; selectThread($event)" />
    <AgentCommandCenter v-if="agentCenterOpen" :open="agentCenterOpen" :connected="connected" :device-key="selectedId" :request="codex.readAgentCenter" @close="agentCenterOpen = false" @select="agentCenterOpen = false; selectThread($event)" />
    <UpdateToast :available="needRefresh" :blocked="updateBlocked" :update="() => pwa.updateServiceWorker(true)" @error="codex.toast" />
    <Transition name="toast"><div v-if="notice" class="toast" role="status"><PhCheckCircle :size="18" />{{ notice }}</div></Transition>

    <BaseDialog :open="!!withdrawingMessage" title="撤回这条消息？" description="这条消息、本轮回复和之后的对话会从会话记录中移除。已执行的命令与文件修改不会还原。" :dismissible="!revising" @close="withdrawingMessage = undefined"><p class="withdraw-preview">{{ withdrawingMessage?.preview }}</p><p v-if="withdrawingMessage?.error" class="inline-error" role="alert">{{ withdrawingMessage.error }}</p><div class="dialog-actions"><span class="spacer" /><button type="button" class="button secondary" :disabled="revising" @click="withdrawingMessage = undefined">取消</button><button type="button" class="button primary" :disabled="revising" @click="confirmWithdraw">{{ revising ? '正在撤回…' : busy ? '停止并撤回' : '确认撤回' }}</button></div></BaseDialog>
    <ConnectionDialog :open="connectionOpen" :profiles="profiles" :editing-id="editingId" :save="codex.saveProfile" :token-for="codex.tokenFor" @close="connectionOpen = false" @connect="connectProfile" @remove="codex.removeProfile" @saved="codex.toast('连接已保存到此浏览器。')" />
    <BaseDialog :open="helpOpen" title="连接指南" description="连接本机或远端的 Codex App Server。" wide @close="helpOpen = false"><div class="guide"><h3>连接本机 daemon</h3><p>在运行 Bun 服务的机器上启动 daemon，然后填写它的 Unix control socket 绝对路径。</p><pre><code>codex app-server daemon start</code></pre><p class="field-hint">通常位于 $CODEX_HOME/app-server-control/app-server-control.sock；默认 CODEX_HOME 是 ~/.codex。地址示例：</p><pre><code>unix:///home/me/.codex/app-server-control/app-server-control.sock</code></pre><h3>连接 WebSocket 服务</h3><p>也可以启动独立的 TCP App Server，再保存下面的 ws 地址。</p><pre><code>codex app-server --listen ws://127.0.0.1:4500</code></pre><p>跨机器访问请使用 TLS 代理提供的 wss:// 地址，并在 App Server 配置传输认证。访问令牌是该服务的 Bearer token，和 OpenAI API key 是两种凭据。</p><h3>地址从哪里访问？</h3><p>连接由 Bun 桥接服务发起。因此 127.0.0.1 指向 Bun 服务所在机器，Unix 路径也属于该机器。前端和 Bun 请部署在同一站点。</p><h3>重新连接与离线</h3><p>网络中断后会自动重连并恢复当前会话；不会自动重发任务。离线时可打开已缓存的应用外壳、查看和编辑设备地址，执行任务仍需联网。</p><a href="https://developers.openai.com/codex/app-server/" target="_blank" rel="noopener noreferrer" class="text-link">查看官方 App Server 文档<PhArrowRight :size="16" /></a></div></BaseDialog>
    <BaseDialog :open="installOpen" title="安装 Codex Remote" description="安装后，可以像普通应用一样从桌面打开。" @close="installOpen = false"><div class="guide"><div class="install-illustration"><span class="brand-icon"><PhTerminal :size="35" weight="bold" /></span><span>Codex Remote</span></div><h3>Chrome / Edge</h3><p>使用地址栏的安装按钮，或浏览器菜单中的“安装应用”。若当前窗口没有显示安装入口，请在浏览器中直接打开本站。</p><h3>iPhone / iPad</h3><p>在 Safari 中打开本站，轻点“分享”，选择“添加到主屏幕”。</p><h3>安全连接</h3><p>安装与离线缓存需要 HTTPS；本机 localhost 开发例外。首次联网打开后，应用外壳可离线使用。</p><p v-if="registrationError" class="inline-error">{{ registrationError }}</p></div></BaseDialog>
    <BaseDialog :open="!authenticated" title="欢迎回来" description="输入部署者设置的访问密码，连接你的工作空间。" :dismissible="false"><form class="login-form" @submit.prevent="login"><label class="field">应用访问密码<input v-model="loginKey" autofocus type="password" autocomplete="current-password" required placeholder="APP_ACCESS_KEY 对应的密码" /></label><p v-if="loginError" role="alert" class="inline-error">{{ loginError }}</p><button class="button primary" :disabled="loggingIn" type="submit">{{ loggingIn ? '正在验证…' : '进入工作空间' }}<PhArrowRight :size="17" /></button><p class="field-hint">此密码用于访问 Bun 服务，与设备的 App Server 令牌分开。</p></form></BaseDialog>
  </div>
</template>
