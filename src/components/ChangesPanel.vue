<script setup lang="ts">
import { useStoredChoice, isBoolean, oneOf } from '../composables/useStoredChoice'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PhArrowDown, PhArrowUp, PhArrowUUpLeft, PhArrowsClockwise, PhArrowsInLineVertical, PhCaretDown, PhCaretLeft, PhCaretRight, PhCheck, PhColumns, PhCopy, PhDotsThree, PhFileMagnifyingGlass, PhFolderSimple, PhGitDiff, PhTextAlignLeft, PhX } from '@phosphor-icons/vue'
import ComposerPopover from './ComposerPopover.vue'
import DiffCode from './DiffCode.vue'
import FileTypeIcon from './FileTypeIcon.vue'
import MotionCollapse from './MotionCollapse.vue'
import { createWorktreeChanges, parseGitPatch, undoUnavailableReason, type ChangeScope, type GitBranch, type GitCommit, type Request, type UndoReceipt } from '../lib/worktree-changes'
import type { ChangedFile } from '../lib/thread-insights'

const props = defineProps<{ deviceKey?: string; open: boolean; wide: boolean; cwd: string; turnId: string; turnPatch: string; files: ChangedFile[]; historyFiles: ChangedFile[]; request: Request; connected: boolean; busy: boolean }>()
const emit = defineEmits<{ close: []; state: [state: { undone: boolean; applying: boolean }]; toast: [message: string] }>()
const compactToolbar = ref(false)
const scopePopover = ref<InstanceType<typeof ComposerPopover>>()
let toolbarObserver: ResizeObserver | undefined
const root = ref<HTMLElement>(), body = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
const historyPath = ref('')
const choice = useStoredChoice<{ kind: ChangeScope['kind']; ref: string; title: string }>(() => 'codex-remote.diff-scope.' + (props.deviceKey || '') + '/' + props.cwd, { kind: 'lastTurn', ref: '', title: '' }, (value): value is { kind: ChangeScope['kind']; ref: string; title: string } => !!value && typeof value === 'object' && ['lastTurn', 'uncommitted', 'unstaged', 'staged', 'commit', 'branch'].includes(String((value as any).kind)) && typeof (value as any).ref === 'string' && typeof (value as any).title === 'string')
const scope = computed({ get: () => choice.value.kind, set: kind => { choice.value = { ...choice.value, kind } } }), selectedRef = computed({ get: () => choice.value.ref, set: ref => { choice.value = { ...choice.value, ref } } }), refTitle = computed({ get: () => choice.value.title, set: title => { choice.value = { ...choice.value, title } } })
const files = ref<ChangedFile[]>([]), patch = ref(''), error = ref(''), loading = ref(false)
const refsMenu = ref<'commit' | 'branch' | ''>(''), refsLoading = ref(false), refsError = ref('')
const commits = ref<GitCommit[]>([]), branches = ref<GitBranch[]>([])
const wrap = useStoredChoice('codex-remote.diff-wrap.v1', false, isBoolean), layout = useStoredChoice<'unified' | 'split' | 'auto'>('codex-remote.diff-layout.v1', 'unified', oneOf(['unified', 'split', 'auto'])), tree = useStoredChoice('codex-remote.diff-tree.v1', false, isBoolean), searching = ref(false), query = ref(''), fileQuery = ref('')
const filteredFiles = computed(() => files.value.filter(file => file.path.toLocaleLowerCase().includes(fileQuery.value.toLocaleLowerCase())))
const layoutLabels = { unified: '统一', split: '并排', auto: '自动' }
const confirmation = ref<{ turnId: string; patch: string }>()
const collapsed = ref(new Set<string>()), receipt = ref<UndoReceipt>(), applying = ref(false), confirm = ref(false), uncertain = ref(false)
const allCollapsed = computed(() => files.value.length > 0 && files.value.every(file => collapsed.value.has(file.path)))
watch(() => files.value.map(file => file.path), paths => { const current = new Set(paths); collapsed.value = new Set([...collapsed.value].filter(path => current.has(path))) })
const service = computed(() => createWorktreeChanges(props.request, { cwd: props.cwd }))
let sequence = 0, controller: AbortController | undefined, refsController: AbortController | undefined, returnFocus: HTMLElement | null = null
const scopeLabels = { lastTurn: '上一轮', uncommitted: '未提交', unstaged: '未暂存', staged: '已暂存', commit: '已提交', branch: '分支' }
const title = computed(() => historyPath.value ? '会话记录' : refTitle.value || scopeLabels[scope.value])
const undone = computed(() => !!receipt.value)
const unavailable = computed(() => applying.value || !props.connected)
const undoHint = computed(() => historyPath.value ? '请选择上一轮变更' : !props.connected ? '请先连接设备' : props.busy ? '本轮结束后可撤销' : uncertain.value ? '操作结果待确认，请检查文件' : undoUnavailableReason(props.turnPatch))
const totals = computed(() => files.value.every(file => file.added !== undefined && file.removed !== undefined) ? files.value.reduce((sum, file) => ({ added: sum.added + file.added!, removed: sum.removed + file.removed! }), { added: 0, removed: 0 }) : null)
const directories = computed(() => {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files.value) { const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''; if (!groups.has(directory)) groups.set(directory, []); groups.get(directory)!.push(file) }
  return [...groups].map(([name, items]) => ({ name, items }))
})
const lastFiles = () => {
  const parsed = parseGitPatch(props.turnPatch)
  return props.turnPatch && parsed.complete ? parsed.files.map(file => ({ path: file.path, added: file.added, removed: file.removed, diff: file.patch, kind: file.kind })) : props.files
}
async function refresh() {
  controller?.abort(); controller = new AbortController()
  const ticket = ++sequence
  error.value = ''; confirm.value = false
  if (scope.value === 'lastTurn') { files.value = historyPath.value ? props.historyFiles.filter(file => file.path === historyPath.value) : lastFiles(); patch.value = (!historyPath.value && props.turnPatch) || files.value.map(file => file.diff).join('\n'); loading.value = false; return }
  files.value = []; patch.value = ''; loading.value = true
  try {
    const choice: ChangeScope = scope.value === 'commit' ? { kind: 'commit', oid: selectedRef.value } : scope.value === 'branch' ? { kind: 'branch', ref: selectedRef.value } : { kind: scope.value }
    const result = await service.value.readChanges(choice, { signal: controller.signal })
    if (ticket !== sequence) return
    files.value = result.files.map(file => ({ path: file.path, added: file.added, removed: file.removed, diff: file.patch, kind: file.kind })); patch.value = result.patch
    if (!result.complete) error.value = result.reason || '变更内容不完整'
  } catch (cause) { if (ticket === sequence && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '读取变更失败' }
  finally { if (ticket === sequence) loading.value = false }
}
function choose(kind: ChangeScope['kind'], close: () => void, refValue = '', label = '') {
  historyPath.value = ''; fileQuery.value = ''; scope.value = kind; selectedRef.value = refValue; refTitle.value = label; collapsed.value = new Set(); refsMenu.value = ''; close(); void refresh()
}
async function loadRefs(kind: 'commit' | 'branch') {
  refsController?.abort(); const read = new AbortController(); refsController = read
  refsMenu.value = kind; refsLoading.value = true; refsError.value = ''; await scopePopover.value?.focusInitial()
  try {
    if (kind === 'commit') { const result = await service.value.listCommits({ signal: read.signal }); if (!read.signal.aborted) commits.value = result }
    else { const result = await service.value.listBranches({ signal: read.signal }); if (!read.signal.aborted) branches.value = result }
  } catch (cause) { if (!read.signal.aborted) refsError.value = cause instanceof Error ? cause.message : '读取失败' }
  finally { if (!read.signal.aborted) refsLoading.value = false }
}
async function returnRefs() { refsController?.abort(); refsMenu.value = ''; await scopePopover.value?.focusInitial() }
function toggleFile(path: string) { const next = new Set(collapsed.value); if (next.has(path)) next.delete(path); else next.add(path); collapsed.value = next }
function toggleAll() { collapsed.value = allCollapsed.value ? new Set() : new Set(files.value.map(file => file.path)) }
async function reveal(path: string) {
  collapsed.value.delete(path); await nextTick()
  const row = [...(body.value?.querySelectorAll<HTMLElement>('[data-diff-path]') || [])].find(element => element.dataset.diffPath === path)
  row?.scrollIntoView({ block: 'start', behavior: 'instant' }); row?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}
async function show(path?: string, lastTurn = false) {
  historyPath.value = ''; if (path || lastTurn) { scope.value = 'lastTurn'; selectedRef.value = refTitle.value = '' }; await refresh()
  if (path && !files.value.some(file => file.path === path)) {
    const historic = props.historyFiles.find(file => file.path === path)
    if (historic) { historyPath.value = path; files.value = [historic]; patch.value = historic.diff }
  }
  if (path) await reveal(path)
}
async function requestUndo() {
  await show(undefined, true)
  if (!undoHint.value && !applying.value) { confirmation.value = { turnId: props.turnId, patch: props.turnPatch }; confirm.value = true }
}
async function apply() {
  if (undoHint.value || applying.value || !confirm.value) return
  if (confirmation.value?.turnId !== props.turnId || confirmation.value.patch !== props.turnPatch) { confirm.value = false; error.value = '变更已更新，请重新查看后撤销'; return }
  const startedTurn = props.turnId, saved = receipt.value, patchToApply = props.turnPatch, api = service.value
  applying.value = true; error.value = ''
  try {
    if (saved) await api.redo(saved)
    else {
      const nextReceipt = await api.undo(patchToApply)
      if (startedTurn === props.turnId) receipt.value = nextReceipt
    }
    if (saved && startedTurn === props.turnId) receipt.value = undefined
    emit('toast', saved ? '文件变更已重新应用' : '文件变更已撤销')
    confirm.value = false
    if (scope.value !== 'lastTurn') await refresh()
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'uncertain') uncertain.value = true
    error.value = cause instanceof Error ? cause.message : '文件操作失败'
  } finally { applying.value = false }
}
async function copyPatch(close: () => void) { try { await navigator.clipboard.writeText(patch.value); emit('toast', '补丁已复制'); close() } catch { error.value = '复制失败，请重试' } }
async function toggleSearch() { searching.value = !searching.value; if (!searching.value) query.value = ''; else { await nextTick(); searchInput.value?.focus() } }
function nextMatch(direction: number) {
  const matches = [...(body.value?.querySelectorAll<HTMLElement>('.diff-match') || [])]
  if (!matches.length) return
  const top = body.value!.getBoundingClientRect().top
  const index = matches.findIndex(match => match.getBoundingClientRect().top >= top + 4)
  const target = matches[(Math.max(0, index) + direction + matches.length) % matches.length]
  target?.scrollIntoView({ block: 'center', behavior: 'instant' })
}
function close() { if (!applying.value) emit('close') }
function stopReads() { sequence++; controller?.abort(); refsController?.abort(); loading.value = refsLoading.value = false }
watch([undone, applying], () => emit('state', { undone: undone.value, applying: applying.value }), { immediate: true })
watch(() => props.turnId, () => { historyPath.value = ''; receipt.value = undefined; confirm.value = false; uncertain.value = false; if (props.open && scope.value === 'lastTurn') void refresh() })
watch([() => props.files, () => props.turnPatch], () => { if (props.open && scope.value === 'lastTurn') { files.value = historyPath.value ? props.historyFiles.filter(file => file.path === historyPath.value) : lastFiles(); patch.value = (!historyPath.value && props.turnPatch) || files.value.map(file => file.diff).join('\n') } })
watch(() => props.connected, online => { if (!online) { stopReads(); confirm.value = false } })
watch(() => props.open, async open => {
  if (open) { returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; await refresh(); await nextTick(); if (props.open) root.value?.querySelector<HTMLButtonElement>('.changes-close')?.focus() }
  else { stopReads(); confirm.value = false; if (returnFocus?.isConnected) returnFocus.focus() }
}, { immediate: true })
watch([() => props.open, () => props.wide], async () => { await nextTick(); if (props.open && root.value instanceof HTMLDialogElement && !root.value.open) root.value.showModal() }, { immediate: true, flush: 'post' })
watch(root, element => {
  toolbarObserver?.disconnect()
  if (!element || typeof ResizeObserver === 'undefined') return
  compactToolbar.value = element.clientWidth < 625
  toolbarObserver = new ResizeObserver(entries => { compactToolbar.value = (entries[0]?.contentRect.width || 0) < 625 }); toolbarObserver.observe(element)
})
onBeforeUnmount(() => { stopReads(); toolbarObserver?.disconnect() })
defineExpose({ show, requestUndo })
</script>

<template>
  <Transition name="changes-reveal">
    <component :is="wide ? 'aside' : 'dialog'" v-if="open" ref="root" class="changes-panel" :class="{ 'changes-modal': !wide }" :role="wide ? 'region' : undefined" aria-label="变更" @cancel.prevent="close" @keydown.esc="close">
      <header class="diff-heading"><span><PhGitDiff :size="18" />变更</span><button class="icon-button changes-close" type="button" aria-label="关闭变更" :disabled="applying" @click="close"><PhX :size="18" /></button></header>
      <div class="diff-toolbar">
        <ComposerPopover ref="scopePopover" panel-class="diff-scope-popover" :teleport-to="wide ? 'body' : root || 'body'" label="变更范围" placement="bottom" :width="250" :disabled="unavailable" @change="refsMenu = ''"><template #trigger><span class="diff-scope-title">{{ title }}</span><PhCaretDown :size="13" /><span v-if="totals && files.length" class="diff-counts"><span class="added">+{{ totals.added }}</span><span class="removed">−{{ totals.removed }}</span></span></template><template #default="{ close: closeMenu }"><div role="menu" aria-label="变更范围">
          <template v-if="!refsMenu"><button v-for="kind in (['lastTurn', 'uncommitted', 'unstaged', 'staged'] as const)" :key="kind" type="button" class="composer-menu-item" role="menuitemradio" :aria-checked="scope === kind" @click="choose(kind, closeMenu)"><span>{{ scopeLabels[kind] }}</span><PhCheck v-if="scope === kind" :size="16" /></button><div class="diff-menu-divider"/><button type="button" class="composer-menu-item" role="menuitem" @click="loadRefs('commit')"><span>已提交</span><PhCaretRight :size="14" /></button><button type="button" class="composer-menu-item" role="menuitem" @click="loadRefs('branch')"><span>分支</span><PhCaretRight :size="14" /></button></template>
          <template v-else><button type="button" class="composer-menu-item" role="menuitem" @click="returnRefs"><PhCaretLeft :size="14" /><span>返回</span></button><p v-if="refsLoading" class="diff-note" role="status">正在读取…</p><p v-else-if="refsError" class="diff-note" role="alert">{{ refsError }}</p><div v-else class="diff-ref-list"><template v-if="refsMenu === 'commit'"><button v-for="commit in commits" :key="commit.oid" type="button" role="menuitem" class="composer-menu-item" @click="choose('commit', closeMenu, commit.oid, commit.oid.slice(0, 7))"><span>{{ commit.subject }}<small>{{ commit.oid.slice(0, 7) }}</small></span></button><p v-if="!commits.length" class="diff-note">暂无提交</p></template><template v-else><button v-for="branch in branches" :key="branch.ref" type="button" role="menuitem" class="composer-menu-item" @click="choose('branch', closeMenu, branch.ref, branch.name)"><span>{{ branch.name }}</span><PhCheck v-if="branch.current" :size="15" /></button><p v-if="!branches.length" class="diff-note">暂无分支</p></template></div></template>
        </div></template></ComposerPopover>
        <div class="diff-toolbar-actions">
          <ComposerPopover :teleport-to="wide ? 'body' : root || 'body'" label="更多变更操作" placement="bottom" align="end" :width="190" :disabled="applying"><template #trigger><PhDotsThree :size="20" /></template><template #default="{ close: closeMenu }"><div role="menu" aria-label="更多变更操作"><template v-if="compactToolbar"><button type="button" role="menuitem" class="composer-menu-item" :disabled="unavailable || loading" @click="closeMenu(); refresh()"><PhArrowsClockwise :size="16" /><span>刷新变更</span></button><button type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="wrap" @click="wrap = !wrap; closeMenu()"><PhTextAlignLeft :size="16" /><span>自动换行</span><PhCheck v-if="wrap" :size="15" /></button><button type="button" role="menuitem" class="composer-menu-item" @click="toggleAll(); closeMenu()"><PhArrowsInLineVertical :size="16" /><span>{{ allCollapsed ? '展开全部变更' : '折叠全部变更' }}</span></button><div class="diff-menu-divider" /><button v-for="mode in (['unified', 'split', 'auto'] as const)" :key="mode" type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="layout === mode" @click="layout = mode; closeMenu()"><span>{{ layoutLabels[mode] }}布局</span><PhCheck v-if="layout === mode" :size="15" /></button><div class="diff-menu-divider" /></template><button type="button" role="menuitem" class="composer-menu-item" @click="closeMenu(); toggleSearch()"><PhFileMagnifyingGlass :size="16" /><span>搜索变更内容</span></button><button type="button" role="menuitem" class="composer-menu-item" :disabled="!patch" @click="copyPatch(closeMenu)"><PhCopy :size="16" /><span>复制补丁</span></button><button type="button" role="menuitem" class="composer-menu-item" :disabled="!!undoHint" :title="undoHint" @click="closeMenu(); requestUndo()"><PhArrowUUpLeft :size="16" /><span>{{ undone ? '重新应用' : '撤销本轮修改' }}</span></button></div></template></ComposerPopover>
          <ComposerPopover :teleport-to="wide ? 'body' : root || 'body'" label="跳转到文件" placement="bottom" align="end" :width="320" @change="fileQuery = ''"><template #trigger><PhFileMagnifyingGlass :size="17" /></template><template #default="{ close: closeMenu }"><div class="diff-jump"><input v-model="fileQuery" type="search" aria-label="搜索变更文件" placeholder="搜索文件" data-initial-focus /><div role="menu" aria-label="变更文件"><button v-for="file in filteredFiles" :key="file.path" type="button" role="menuitem" class="composer-menu-item" @click="closeMenu(); reveal(file.path)"><FileTypeIcon :path="file.path" :size="16" /><span>{{ file.path }}</span></button><p v-if="!filteredFiles.length" class="diff-note">没有匹配文件</p></div></div></template></ComposerPopover>
          <button v-if="!compactToolbar" type="button" class="icon-button" aria-label="刷新变更" title="刷新" :disabled="unavailable || loading" @click="refresh"><PhArrowsClockwise :size="17" :class="{ spinning: loading }" /></button>
          <button v-if="!compactToolbar" type="button" class="icon-button" aria-label="自动换行" title="自动换行" :aria-pressed="wrap" @click="wrap = !wrap"><PhTextAlignLeft :size="17" /></button>
          <button v-if="!compactToolbar" type="button" class="icon-button" :aria-label="allCollapsed ? '展开全部变更' : '折叠全部变更'" :title="allCollapsed ? '展开全部' : '折叠全部'" @click="toggleAll"><PhArrowsInLineVertical :size="17" /></button>
          <ComposerPopover v-if="!compactToolbar" :teleport-to="wide ? 'body' : root || 'body'" label="差异布局" placement="bottom" align="end" :width="180"><template #trigger><PhColumns :size="17" /></template><template #default="{ close: closeMenu }"><div role="menu" aria-label="差异布局"><button v-for="mode in (['unified', 'split', 'auto'] as const)" :key="mode" type="button" role="menuitemradio" class="composer-menu-item" :aria-checked="layout === mode" @click="layout = mode; closeMenu()"><span>{{ layoutLabels[mode] }}</span><PhCheck v-if="layout === mode" :size="15" /></button></div></template></ComposerPopover>
          <button type="button" class="icon-button" aria-label="文件目录" title="文件目录" :aria-pressed="tree" @click="tree = !tree"><PhFolderSimple :size="17" /></button>
        </div>
      </div>
      <MotionCollapse :open="searching"><div class="diff-search"><input ref="searchInput" v-model="query" type="search" placeholder="搜索变更" aria-label="搜索变更内容" @keydown.enter.prevent="nextMatch(1)" /><button type="button" class="icon-button" title="上一处" aria-label="上一处匹配" @click="nextMatch(-1)"><PhArrowUp :size="15" /></button><button type="button" class="icon-button" title="下一处" aria-label="下一处匹配" @click="nextMatch(1)"><PhArrowDown :size="15" /></button></div></MotionCollapse>
      <MotionCollapse :open="confirm"><div class="diff-confirm"><p>{{ undone ? '重新应用本轮文件修改？' : '撤销本轮文件修改？' }}</p><div><button type="button" class="text-button" :disabled="applying" @click="confirm = false">取消</button><button type="button" class="text-button" :disabled="applying || !!undoHint" @click="apply">{{ applying ? '处理中…' : undone ? '确认重新应用' : '确认撤销' }}</button></div></div></MotionCollapse>
      <p v-if="error" class="diff-error" role="alert">{{ error }}</p>
      <p v-if="loading" class="diff-note" role="status">正在读取变更…</p>
      <div class="diff-content">
        <nav v-if="tree && files.length" class="diff-file-tree" aria-label="变更文件目录"><section v-for="directory in directories" :key="directory.name"><p v-if="directory.name"><PhFolderSimple :size="14" />{{ directory.name }}</p><button v-for="file in directory.items" :key="file.path" type="button" :title="file.path" @click="reveal(file.path)"><FileTypeIcon :path="file.path" :size="15" /><span>{{ file.path.split('/').at(-1) }}</span></button></section></nav>
        <div ref="body" class="diff-body" :aria-busy="loading"><p v-if="!loading && !files.length && !error" class="diff-note">没有文件变更</p><section v-for="file in files" :key="file.path" class="diff-file" :data-diff-path="file.path">
          <button type="button" class="diff-file-heading" :aria-expanded="!collapsed.has(file.path)" @click="toggleFile(file.path)"><FileTypeIcon :path="file.path" :size="17" /><span class="diff-file-path" :title="file.path">{{ file.path }}</span><span class="diff-counts"><span v-if="file.added !== undefined" class="added">+{{ file.added }}</span><span v-if="file.removed !== undefined" class="removed">−{{ file.removed }}</span></span><PhCaretDown :size="13" :class="{ rotated: collapsed.has(file.path) }" /></button>
          <MotionCollapse :open="!collapsed.has(file.path)"><DiffCode v-if="file.diff" :diff="file.diff" :path="file.path" :wrap="wrap" :split="layout === 'split' || layout === 'auto' && !!file.added && !!file.removed" :query="query" /><p v-else class="diff-note">此文件没有可显示的文本差异</p></MotionCollapse>
        </section></div>
      </div>
    </component>
  </Transition>
</template>

<style scoped>
.changes-panel { display: flex; flex-direction: column; flex: 0 0 min(48%, 720px); width: min(48%, 720px); min-width: 0; min-height: 0; margin: 6px 8px 6px 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--canvas); color: var(--ink-soft); box-shadow: 0 5px 18px -14px rgba(0, 0, 0, .45); }
.diff-heading { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 4px 12px; border-bottom: 1px solid var(--line); }
.diff-heading > span { display: flex; align-items: center; gap: 7px; font-size: calc(13px * var(--ui-font-scale, 1)); }
.diff-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; padding: 8px 12px; }
.diff-toolbar-actions { display: flex; align-items: center; gap: 1px; margin-left: auto; padding: 2px; background: var(--hover); border-radius: var(--radius-round); }
.diff-toolbar-actions .icon-button { width: 29px; height: 29px; border-radius: var(--radius-round); }
.diff-toolbar-actions :deep(.composer-control) { width: 29px; height: 29px; padding: 0; justify-content: center; }
.diff-toolbar-actions [aria-pressed="true"] { background: var(--active); color: var(--ink); }
.diff-toolbar > :deep(.composer-control) { background: var(--hover); max-width: 100%; }
.diff-scope-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.diff-counts { display: inline-flex; flex-shrink: 0; gap: 4px; font-size: calc(12px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.added { color: var(--diff-added); }.removed { color: var(--diff-removed); }
.diff-menu-divider { height: 1px; margin: 6px 10px; background: var(--line); }
.diff-jump input { width: 100%; padding: 9px 10px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 0; }.diff-jump [role="menu"] { max-height: 300px; overflow-y: auto; }.diff-jump .composer-menu-item > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-ref-list { max-height: 300px; overflow-y: auto; }
.diff-ref-list button > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-ref-list small { display: block; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.diff-content { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.diff-body { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; }
.diff-file + .diff-file { border-top: 1px solid var(--line); }
.diff-file-heading { display: flex; align-items: center; gap: 8px; min-height: 38px; width: 100%; padding: 7px 14px; text-align: left; font-size: calc(12px * var(--ui-font-scale, 1)); }
.diff-file-heading:hover { background: var(--hover); }.diff-file-heading > svg { flex-shrink: 0; transition: transform 180ms var(--ease); }.diff-file-heading .rotated { transform: rotate(-90deg); }
.diff-file-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-note { margin: 0; padding: 14px; font-size: calc(13px * var(--ui-font-scale, 1)); color: var(--muted); }.diff-error { padding: 8px 14px; color: var(--danger); font-size: calc(13px * var(--ui-font-scale, 1)); overflow-wrap: anywhere; }
.diff-search { display: flex; align-items: center; padding: 4px 12px 8px; gap: 4px; }.diff-search input { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 7px 10px; }
.diff-confirm { padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--line); font-size: calc(13px * var(--ui-font-scale, 1)); }.diff-confirm > div { display: flex; flex-shrink: 0; }.diff-confirm .text-button { font-size: calc(12px * var(--ui-font-scale, 1)); }
.diff-file-tree { flex: 0 0 170px; min-width: 0; padding: 6px; border-right: 1px solid var(--line); overflow-y: auto; font-size: calc(12px * var(--ui-font-scale, 1)); }.diff-file-tree p { display: flex; gap: 5px; padding: 8px 6px; color: var(--muted); overflow-wrap: anywhere; }.diff-file-tree button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; min-height: 30px; padding: 5px 7px; border-radius: var(--radius-sm); }.diff-file-tree button:hover { background: var(--hover); }.diff-file-tree button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.changes-modal { position: fixed; margin: auto; width: calc(100vw - 24px); height: calc(100dvh - 24px); max-width: none; max-height: none; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-lg); z-index: 70; }.changes-modal::backdrop { background: #0006; }
.changes-reveal-enter-active { transition: opacity 180ms ease, transform 260ms var(--ease); }.changes-reveal-leave-active { transition: opacity 120ms ease, transform 200ms var(--ease); pointer-events: none; }.changes-reveal-enter-from, .changes-reveal-leave-to { opacity: 0; transform: translateX(24px); }
.changes-modal.changes-reveal-enter-active, .changes-modal.changes-reveal-leave-active { transition: opacity 160ms ease, transform 180ms var(--ease); }.changes-modal.changes-reveal-enter-from, .changes-modal.changes-reveal-leave-to { transform: translateY(8px); }
:global(.diff-scope-popover .composer-menu-item) { min-height: 36px; padding: 7px 10px; gap: 9px; }
:global(.diff-scope-popover .diff-note) { padding: 9px 10px; }
:global(.diff-scope-popover .diff-menu-divider) { margin: 4px 8px; }
@media (max-width: 760px) { .diff-toolbar-actions .icon-button, .diff-toolbar-actions :deep(.composer-control) { width: 36px; height: 36px; }.diff-file-tree { flex-basis: 130px; }.diff-file-heading { min-height: 44px; } }
</style>
