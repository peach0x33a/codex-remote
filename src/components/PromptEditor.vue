<script setup lang="ts">
import { randomId } from '../lib/random-id'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { PhArchive, PhAt, PhBrain, PhChatCircle, PhCopy, PhCpu, PhCube, PhFile, PhFolder, PhGearSix, PhGitDiff, PhLightning, PhMagnifyingGlass, PhPencilSimple, PhPlus, PhQuestion, PhRobot, PhShieldCheck, PhTarget, PhTerminal } from '@phosphor-icons/vue'
import ImagePreview from './ImagePreview.vue'
import { captureComposerTrigger, composerSuggestionInsertion, type CapturedComposerToken, type ComposerTrigger } from '../lib/composer-trigger'
import type { PromptPart } from '../lib/prompt'
import { atEditorBoundary, createInputHistory } from '../lib/input-history'
type ImagePart = Extract<PromptPart, { type: 'image' }>
type SkillPart = Extract<PromptPart, { type: 'skill' }>
type MentionPart = Extract<PromptPart, { type: 'mention' }>
type Suggestion = { id: string; label: string; description?: string; insertText?: string; group?: string; source?: string; category?: string; accessibleLabel?: string }
const props = defineProps<{ modelValue: PromptPart[]; disabled?: boolean; id?: string; label?: string; placeholder?: string; suggestions?: Suggestion[]; suggestionsLoading?: boolean; suggestionsError?: string; externalSuggestions?: boolean; suggestionTarget?: HTMLElement | null; suggestionsActive?: boolean; inputHistory?: PromptPart[][]; historyScope?: string }>()
const emit = defineEmits<{ 'update:modelValue': [parts: PromptPart[]]; keydown: [event: KeyboardEvent]; files: [files: File[]]; trigger: [trigger: ComposerTrigger | null]; selectSuggestion: [id: string]; navigateCompletion: [direction: number] }>()
const editor = ref<HTMLDivElement>()
const fallbackId = useId()
const empty = computed(() => !props.modelValue.some(p => p.type !== 'text' || p.text))
let savedRange: Range | undefined, lastFingerprint = ''
const caretMarker = String.fromCharCode(0x200b)
const inputHistory = createInputHistory()
let recalledFingerprint = ''
function resetHistory() { inputHistory.reset(); recalledFingerprint = '' }
watch(() => props.historyScope, resetHistory, { flush: 'sync' })
watch(() => props.modelValue, parts => { if (recalledFingerprint && fingerprint(parts) !== recalledFingerprint) resetHistory() })
const images = new Map<string, ImagePart>()
const skills = new Map<string, SkillPart | MentionPart>()
const preview = ref<{ image: ImagePart; anchor: DOMRect; pinned: boolean }>()
const fingerprint = (parts: PromptPart[]) => parts.map(p => p.type === 'text' ? 't:' + p.text : p.type === 'image' ? 'i:' + p.id : JSON.stringify([p.type, p.id, p.name, p.path])).join('\0')
const trigger = shallowRef<CapturedComposerToken | null>(null)
const menu = ref<HTMLDivElement>(), highlighted = ref(0), composing = ref(false)
const menuId = fallbackId + '-suggestions'
const menuStyle = ref<Record<string, string>>({ visibility: 'hidden' })
const menuOpen = computed(() => !!trigger.value && props.suggestions !== undefined && !props.disabled && !composing.value)
const selectable = computed(() => props.suggestions || [])
const activeOption = computed(() => menuOpen.value && props.suggestionsActive !== false && selectable.value[highlighted.value] ? menuId + '-' + highlighted.value : undefined)
let capturedToken: { token: CapturedComposerToken; text: string } | undefined
let dismissedToken = '', reportedTrigger = '', compositionCommitPending = false
let compositionTimer: ReturnType<typeof setTimeout> | undefined, menuObserver: ResizeObserver | undefined

function tokenKey(token: CapturedComposerToken) { return JSON.stringify([token.kind, token.start, token.end, token.query, token.range.toString()]) }
function reportTrigger(value: ComposerTrigger | null) {
  const key = value ? JSON.stringify([value.kind, value.query]) : ''
  if (key === reportedTrigger) return
  reportedTrigger = key; emit('trigger', value ? { kind: value.kind, query: value.query } : null)
}
function closeSuggestions(preserveToken = false) {
  trigger.value = null
  if (!preserveToken) capturedToken = undefined
  reportTrigger(null)
}
function dismissSuggestions(preserveToken = false) {
  if (trigger.value) dismissedToken = tokenKey(trigger.value)
  closeSuggestions(preserveToken)
}
function refreshTrigger() {
  const root = editor.value
  if (!root || document.activeElement !== root || props.disabled || composing.value || compositionCommitPending) return
  const selection = window.getSelection()
  const token = selection?.rangeCount ? captureComposerTrigger(root, selection.getRangeAt(0)) : null
  if (!token) { dismissedToken = ''; closeSuggestions(); return }
  if (tokenKey(token) === dismissedToken) return
  dismissedToken = ''
  if (!trigger.value || tokenKey(token) !== tokenKey(trigger.value)) highlighted.value = 0
  capturedToken = { token, text: token.range.toString() }
  trigger.value = token; reportTrigger(token)
}
function selectionChanged() { captureSelection(); refreshTrigger() }
function focused() { void nextTick(refreshTrigger) }
function blur(event: FocusEvent) { captureSelection(); if (props.externalSuggestions && (event.relatedTarget as HTMLElement | null)?.closest?.('.composer-island')) return; dismissSuggestions(true) }
function compositionStart() {
  clearTimeout(compositionTimer); composing.value = true; compositionCommitPending = false
  dismissedToken = ''
  closeSuggestions()
}
function compositionEnd() {
  composing.value = false; compositionCommitPending = true
  // Some IMEs dispatch their confirming Enter after compositionend, with
  // isComposing=false. Keep that keystroke out of both selection and sending.
  clearTimeout(compositionTimer)
  compositionTimer = setTimeout(() => { compositionCommitPending = false; refreshTrigger() }, 50)
}
function keyup(event: KeyboardEvent) {
  if (compositionCommitPending && event.key === 'Enter') {
    clearTimeout(compositionTimer); compositionCommitPending = false
  }
  selectionChanged()
}
function placeMenu() {
  if (props.externalSuggestions) return
  if (!menuOpen.value || !editor.value) return
  const anchor = editor.value.getBoundingClientRect(), viewport = window.visualViewport
  const leftEdge = (viewport?.offsetLeft || 0) + 8, topEdge = (viewport?.offsetTop || 0) + 8
  const width = Math.min(anchor.width, 640, (viewport?.width || window.innerWidth) - 16)
  const top = Math.max(topEdge, anchor.top - 6)
  menuStyle.value = {
    left: Math.max(leftEdge, Math.min(anchor.left, leftEdge + (viewport?.width || window.innerWidth) - 16 - width)) + 'px',
    top: top + 'px', width: width + 'px', maxHeight: Math.max(0, Math.min(300, top - topEdge)) + 'px',
  }
}
async function revealHighlighted() {
  await nextTick()
  menu.value?.querySelectorAll<HTMLElement>('[role="option"]')[highlighted.value]?.scrollIntoView({ block: 'nearest' })
}
watch(menuOpen, async open => {
  menuObserver?.disconnect()
  if (open) {
    await nextTick(); placeMenu()
    if (editor.value) menuObserver?.observe(editor.value)
  }
})
watch(() => props.suggestions?.map(item => item.id), (ids, previous) => {
  const selectedId = previous?.[highlighted.value]
  highlighted.value = Math.max(0, ids?.findIndex(id => id === selectedId) ?? 0)
  if (menuOpen.value) void revealHighlighted()
})
watch(highlighted, () => { if (menuOpen.value) void revealHighlighted() })
watch(() => props.disabled, disabled => { if (disabled) { dismissedToken = ''; closeSuggestions() } })
onMounted(() => {
  menuObserver = new ResizeObserver(placeMenu)
  document.addEventListener('selectionchange', selectionChanged)
  window.addEventListener('resize', placeMenu)
  window.addEventListener('scroll', placeMenu, true)
  window.visualViewport?.addEventListener('resize', placeMenu)
  window.visualViewport?.addEventListener('scroll', placeMenu)
})
onBeforeUnmount(() => {
  clearTimeout(compositionTimer); menuObserver?.disconnect()
  document.removeEventListener('selectionchange', selectionChanged)
  window.removeEventListener('resize', placeMenu)
  window.removeEventListener('scroll', placeMenu, true)
  window.visualViewport?.removeEventListener('resize', placeMenu)
  window.visualViewport?.removeEventListener('scroll', placeMenu)
})
function captureSelection() {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0), container = range.startContainer
  const element = container instanceof Element ? container : container.parentElement
  if (editor.value?.contains(range.commonAncestorContainer) && !element?.closest('[data-attachment-id]')) savedRange = range.cloneRange()
}
function makeCaretAnchor() {
  const anchor = document.createElement('span'); anchor.dataset.editorCaret = ''
  anchor.append(document.createTextNode(caretMarker)); return anchor
}
function ensureImageCarets(chip: HTMLElement) {
  const previous = chip.previousSibling
  if (!previous || previous instanceof HTMLElement && previous.dataset.attachmentId || previous.nodeType === Node.TEXT_NODE && !previous.textContent) chip.before(makeCaretAnchor())
  let after = chip.nextSibling
  if (!(after instanceof HTMLElement && after.hasAttribute('data-editor-caret'))) { after = makeCaretAnchor(); chip.after(after) }
  return after as HTMLElement
}
function placeCaretInside(anchor: HTMLElement) {
  const range = document.createRange()
  const text = anchor.firstChild
  if (text?.nodeType === Node.TEXT_NODE) range.setStart(text, text.textContent?.startsWith(caretMarker) ? 1 : 0)
  else range.selectNodeContents(anchor)
  range.collapse(true); savedRange = range.cloneRange()
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
}
function restoreSelection() {
  const root = editor.value; if (!root) return undefined
  root.focus(); const selection = window.getSelection()
  const range = savedRange && root.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : document.createRange()
  if (!savedRange || !root.contains(range.commonAncestorContainer)) { range.selectNodeContents(root); range.collapse(false) }
  selection?.removeAllRanges(); selection?.addRange(range); return range
}
function makeSkillChip(skill: SkillPart | MentionPart) {
  const chip = document.createElement('span'); chip.className = 'inline-skill editor-skill-chip'; chip.contentEditable = 'false'; chip.dataset.attachmentId = skill.id; chip.dataset.skillId = skill.id; chip.title = skill.path
  const label = document.createElement('span'); label.textContent = skill.name
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '16'); icon.setAttribute('height', '16'); icon.setAttribute('aria-hidden', 'true')
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path'); outline.setAttribute('d', 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z'); outline.setAttribute('fill', 'none'); outline.setAttribute('stroke', 'currentColor'); outline.setAttribute('stroke-width', '1.5'); outline.setAttribute('stroke-linejoin', 'round'); icon.append(outline)
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'image-chip-remove'; remove.dataset.imageRemove = skill.id; remove.tabIndex = -1; remove.setAttribute('aria-label', '移除技能 ' + skill.name)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M6 6l12 12M18 6L6 18'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); svg.append(path); remove.append(svg)
  chip.append(icon, label, remove); return chip
}
function makeChip(image: ImagePart) {
  const chip = document.createElement('span'); chip.className = 'inline-image editor-image-chip'; chip.contentEditable = 'false'; chip.dataset.attachmentId = image.id; chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.setAttribute('aria-label', '预览图片 ' + image.name)
  let thumb: HTMLElement | SVGElement
  if (image.url) { const picture = document.createElement('img'); picture.src = image.url; picture.alt = ''; picture.draggable = false; thumb = picture }
  else { const placeholder = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); placeholder.setAttribute('viewBox', '0 0 24 24'); placeholder.setAttribute('width', '24'); placeholder.setAttribute('height', '24'); placeholder.setAttribute('aria-hidden', 'true'); const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path'); outline.setAttribute('d', 'M4 4h16v16H4z M4 17l6-6 4 4 3-3 3 3'); outline.setAttribute('fill', 'none'); outline.setAttribute('stroke', 'currentColor'); outline.setAttribute('stroke-width', '1.5'); placeholder.append(outline); thumb = placeholder; chip.title = '远端图片附件，将原样保留' }
  const label = document.createElement('span'); label.textContent = image.name
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'image-chip-remove'; remove.dataset.imageRemove = image.id; remove.tabIndex = -1; remove.setAttribute('aria-label', '移除图片 ' + image.name)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M6 6l12 12M18 6L6 18'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); svg.append(path); remove.append(svg)
  chip.append(thumb, label, remove); return chip
}
function read(): PromptPart[] {
  const parts: PromptPart[] = []
  function text(value: string) { if (!value) return; const last = parts.at(-1); if (last?.type === 'text') last.text += value; else parts.push({ type: 'text', text: value }) }
  function walk(node: Node, marker?: { pending: boolean }) {
    if (node.nodeType === Node.TEXT_NODE) {
      let value = node.textContent || ''
      if (marker?.pending && value.includes(caretMarker)) { value = value.replace(caretMarker, ''); marker.pending = false }
      text(value); return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.attachmentId) { const part = images.get(node.dataset.attachmentId) || skills.get(node.dataset.attachmentId); if (part) parts.push(part); return }
    if (node.tagName === 'BR') { text('\n'); return }
    const block = ['DIV', 'P'].includes(node.tagName) && node !== editor.value
    const last = parts.at(-1)
    if (block && parts.length && !(last?.type === 'text' && last.text.endsWith('\n'))) text('\n')
    const childMarker = node.hasAttribute('data-editor-caret') ? { pending: true } : marker
    node.childNodes.forEach(child => walk(child, childMarker))
    if (block && node.nextSibling) text('\n')
  }
  if (editor.value) walk(editor.value)
  return parts
}
function publish(updateTrigger = true) { const parts = read(); lastFingerprint = fingerprint(parts); emit('update:modelValue', parts); captureSelection(); if (updateTrigger) refreshTrigger() }
function input(event: Event) { if ((event as InputEvent).isComposing && !composing.value) compositionStart(); publish() }
function render(parts: PromptPart[]) {
  if (!editor.value) return
  dismissedToken = ''; closeSuggestions()
  images.clear(); skills.clear(); editor.value.replaceChildren(); savedRange = undefined
  for (const part of parts) {
    if (part.type === 'text') editor.value.append(document.createTextNode(part.text))
    else {
      if (part.type === 'image') images.set(part.id, part); else skills.set(part.id, part)
      const chip = part.type === 'image' ? makeChip(part) : makeSkillChip(part); editor.value.append(chip); ensureImageCarets(chip)
    }
  }
  lastFingerprint = fingerprint(parts)
}
watch(() => props.modelValue, async parts => { await nextTick(); if (fingerprint(parts) !== lastFingerprint) render(parts) }, { immediate: true })
function insertNode(node: Node) {
  const range = restoreSelection(); if (!range) return
  range.deleteContents(); range.insertNode(node)
  if (node instanceof HTMLElement && node.dataset.attachmentId) placeCaretInside(ensureImageCarets(node))
  else {
    if (node.nodeType === Node.TEXT_NODE) range.setStart(node, node.textContent?.length || 0)
    else range.setStartAfter(node)
    range.collapse(true); savedRange = range.cloneRange()
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
  }
  publish()
}
function reserveInsertion() { captureSelection(); return savedRange?.cloneRange() }
function insertLineBreak() {
  captureSelection()
  const range = restoreSelection(); if (!range) return
  range.deleteContents()
  const fragment = document.createDocumentFragment(), anchor = makeCaretAnchor()
  fragment.append(document.createTextNode('\n'), anchor)
  range.insertNode(fragment)
  placeCaretInside(anchor)
  publish()
}
function insertImage(image: ImagePart, insertion?: Range) { if (insertion && editor.value?.contains(insertion.commonAncestorContainer)) savedRange = insertion.cloneRange(); images.set(image.id, image); insertNode(makeChip(image)) }
function insertSkill(skill: { name: string; path: string }, replaceToken = false) {
  if (props.disabled || replaceToken && !applySuggestion('')) return false
  const part: SkillPart = { type: 'skill', id: 'skill-' + randomId(), name: skill.name, path: skill.path }
  skills.set(part.id, part); insertNode(makeSkillChip(part)); return true
}
function insertMention(mention: { name: string; path: string; kind: MentionPart['kind'] }, replaceToken = false) {
  if (props.disabled || replaceToken && !applySuggestion('')) return false
  const part: MentionPart = { type: 'mention', id: 'mention-' + randomId(), ...mention }
  skills.set(part.id, part); insertNode(makeSkillChip(part)); return true
}
function insertText(text: string) { if (!props.disabled) insertNode(document.createTextNode(text)) }
function applySuggestion(text: string) {
  const root = editor.value, captured = capturedToken
  if (!root || !captured || props.disabled || composing.value || compositionCommitPending) return false
  const range = captured.token.range.cloneRange()
  // Never fall back to the saved caret: an async response may outlive its token.
  if (!root.contains(range.commonAncestorContainer) || range.toString() !== captured.text) { closeSuggestions(); return false }
  const trailingSpace = captured.token.trailingSpace?.cloneRange()
  const insertion = composerSuggestionInsertion(captured.token.kind, text, trailingSpace?.toString())
  closeSuggestions(); dismissedToken = ''
  root.focus()
  range.deleteContents()
  const node = document.createTextNode(insertion.text)
  range.insertNode(node)
  if (insertion.reuseTrailingSpace && trailingSpace) range.setStart(trailingSpace.endContainer, trailingSpace.endOffset)
  else range.setStart(node, insertion.text.length)
  range.collapse(true)
  savedRange = range.cloneRange()
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
  publish(false)
  // An insertion may itself start with @ or /. Do not reopen until the user
  // changes the token or moves the caret, including delayed selectionchange.
  const replacement = captureComposerTrigger(root, range)
  dismissedToken = replacement ? tokenKey(replacement) : ''
  return true
}
function selectSuggestion(index: number) {
  if (!menuOpen.value || composing.value || compositionCommitPending) return
  const suggestion = selectable.value[index]
  if (!suggestion) return
  if (suggestion.insertText !== undefined) {
    if (!applySuggestion(suggestion.insertText)) return
  } else dismissSuggestions(true)
  emit('selectSuggestion', suggestion.id)
}
function paste(event: ClipboardEvent) {
  event.preventDefault(); captureSelection()
  const files = [...(event.clipboardData?.files || [])]
  if (files.length) emit('files', files)
  else insertNode(document.createTextNode(event.clipboardData?.getData('text/plain') || ''))
}
function drop(event: DragEvent) {
  event.preventDefault()
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (range && editor.value?.contains(range.commonAncestorContainer)) savedRange = range
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length) emit('files', files)
  else insertNode(document.createTextNode(event.dataTransfer?.getData('text/plain') || ''))
}
function chipAt(event: Event) { return (event.target as HTMLElement).closest<HTMLElement>('[data-attachment-id]') }
function showImage(chip: HTMLElement, pinned: boolean) { const image = images.get(chip.dataset.attachmentId!); if (image?.url) preview.value = { image, anchor: chip.getBoundingClientRect(), pinned } }
function click(event: MouseEvent) {
  const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-image-remove]')
  if (remove) { event.preventDefault(); chipAt(event)?.remove(); preview.value = undefined; publish(); void focus(); return }
  const chip = chipAt(event); if (chip) { event.preventDefault(); showImage(chip, true) }
}
function deleteAdjacentImage(event: KeyboardEvent) {
  if (!['Backspace', 'Delete'].includes(event.key) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return false
  const range = selection.getRangeAt(0), node = range.startContainer
  const element = node instanceof HTMLElement ? node : node.parentElement
  const anchor = element?.closest<HTMLElement>('[data-editor-caret]')
  if (!anchor || !editor.value?.contains(anchor)) return false
  const boundary = document.createRange(); boundary.selectNodeContents(anchor)
  if (event.key === 'Backspace') boundary.setEnd(range.startContainer, range.startOffset)
  else boundary.setStart(range.startContainer, range.startOffset)
  if (boundary.toString().replace(caretMarker, '')) return false
  let adjacent = event.key === 'Backspace' ? anchor.previousSibling : anchor.nextSibling
  while (adjacent?.nodeType === Node.TEXT_NODE && !adjacent.textContent) adjacent = event.key === 'Backspace' ? adjacent.previousSibling : adjacent.nextSibling
  if (!(adjacent instanceof HTMLElement) || !adjacent.dataset.attachmentId) return false
  event.preventDefault(); adjacent.remove(); preview.value = undefined; publish(); return true
}
function key(event: KeyboardEvent) {
  if (composing.value || compositionCommitPending || event.isComposing || event.keyCode === 229) { event.stopPropagation(); return }
  if (event.key === 'Enter' && event.shiftKey && !props.disabled) { event.preventDefault(); event.stopPropagation(); insertLineBreak(); return }
  refreshTrigger()
  if (menuOpen.value && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissSuggestions(); return }
    if (props.externalSuggestions && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); emit('navigateCompletion', event.key === 'ArrowLeft' ? -1 : 1); return }
    if (props.externalSuggestions && props.suggestionsActive === false && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) { event.preventDefault(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation()
      if (selectable.value.length) highlighted.value = (highlighted.value + (event.key === 'ArrowDown' ? 1 : -1) + selectable.value.length) % selectable.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab' && selectable.value.length) {
      event.preventDefault(); event.stopPropagation(); selectSuggestion(highlighted.value); return
    }
  }
  if (recallInput(event)) return
  if (deleteAdjacentImage(event)) return
  const chip = chipAt(event)
  if (chip && ['Enter', ' '].includes(event.key)) { event.preventDefault(); showImage(chip, true); return }
  emit('keydown', event)
}
function recallInput(event: KeyboardEvent) {
  if (props.disabled || !props.inputHistory || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return false
  const root = editor.value, selection = window.getSelection()
  if (!root || document.activeElement !== root || !selection?.rangeCount || !selection.isCollapsed) return false
  const range = selection.getRangeAt(0)
  const atStart = atEditorBoundary(root, range, 'start')
  const browsingEnd = inputHistory.active && atEditorBoundary(root, range, 'end')
  if (!atStart && !empty.value && !browsingEnd) return false
  const parts = event.key === 'ArrowUp' ? inputHistory.previous(props.modelValue, props.inputHistory) : inputHistory.next()
  if (!parts) return false
  event.preventDefault(); event.stopPropagation()
  preview.value = undefined
  recalledFingerprint = fingerprint(parts)
  render(parts)
  const caret = document.createRange(); caret.selectNodeContents(root); caret.collapse(false); savedRange = caret
  restoreSelection()
  const token = captureComposerTrigger(root, caret)
  if (token) dismissedToken = tokenKey(token)
  emit('update:modelValue', parts)
  return true
}
function hover(event: PointerEvent) { if (event.pointerType !== 'mouse' || preview.value?.pinned) return; const chip = chipAt(event); if (chip) showImage(chip, false) }
function leave(event: PointerEvent) { if (!preview.value?.pinned && !chipAt(event)?.contains(event.relatedTarget as Node)) preview.value = undefined }
async function focus(end = false) { await nextTick(); if (end && editor.value) { const range = document.createRange(); range.selectNodeContents(editor.value); range.collapse(false); savedRange = range }; restoreSelection(); refreshTrigger() }
function suggestionIcon(suggestion: Suggestion) {
  if (suggestion.category === 'skills' || suggestion.category === 'plugins') return PhCube
  if (suggestion.category === 'agents') return PhRobot
  if (suggestion.category === 'threads') return PhChatCircle
  if (suggestion.category === 'files') return PhFile
  const command = suggestion.id.replace('command:', '')
  if (command.startsWith('service-tier:')) return PhLightning
  return ({ rename: PhPencilSimple, archive: PhArchive, new: PhPlus, model: PhCpu, effort: PhBrain, permissions: PhShieldCheck, skills: PhCube, goal: PhTarget, agents: PhRobot, tasks: PhRobot, resume: PhMagnifyingGlass, diff: PhGitDiff, mention: PhAt, project: PhFolder, cd: PhFolder, pwd: PhFolder, settings: PhGearSix, help: PhQuestion, copy: PhCopy } as Record<string, unknown>)[command] || PhTerminal
}
defineExpose({ focus, captureSelection, reserveInsertion, insertImage, insertSkill, insertMention, insertText, applySuggestion, dismissSuggestions })
</script>
<template>
  <div :id="id || fallbackId" ref="editor" class="prompt-editor" :class="{ empty }" role="textbox" :aria-label="label || '发送给 Codex 的消息'" aria-multiline="true" :aria-disabled="disabled" :aria-autocomplete="suggestions !== undefined ? 'list' : undefined" :aria-controls="menuOpen ? menuId : undefined" :aria-expanded="suggestions !== undefined ? menuOpen && suggestionsActive !== false : undefined" :aria-activedescendant="activeOption" :contenteditable="!disabled" :data-placeholder="placeholder || '向 Codex 提问，或描述你想完成的任务'" spellcheck="false" @input="input" @keyup="keyup" @mouseup="selectionChanged" @focus="focused" @blur="blur" @compositionstart="compositionStart" @compositionend="compositionEnd" @keydown="key" @paste="paste" @dragover.prevent @drop="drop" @click="click" @pointerover="hover" @pointerout="leave" @pointerdown="($event.target as HTMLElement).closest('[data-image-remove]') && $event.preventDefault()" />
  <Teleport :to="suggestionTarget || 'body'">
    <div v-if="menuOpen && (!externalSuggestions || suggestionTarget)" ref="menu" class="prompt-suggestions" :class="{ 'in-island': externalSuggestions }" :style="externalSuggestions ? undefined : menuStyle" @mousedown.prevent @click.stop>
      <div :id="menuId" role="listbox" :aria-label="trigger?.kind === 'command' ? '命令' : trigger?.kind === 'skill' ? '技能' : '提及'" :aria-busy="suggestionsLoading || undefined">
        <template v-for="(suggestion, index) in selectable" :key="suggestion.id">
          <div v-if="suggestion.group && (index === 0 || selectable[index - 1]?.group !== suggestion.group)" class="prompt-suggestion-group" role="presentation">{{ suggestion.group }}</div>
          <button :id="menuId + '-' + index" type="button" role="option" tabindex="-1" class="prompt-suggestion" :class="{ highlighted: index === highlighted }" :aria-label="suggestion.accessibleLabel" :aria-selected="index === highlighted" @pointermove="$event.pointerType === 'mouse' && (highlighted = index)" @click="selectSuggestion(index)">
            <component :is="suggestionIcon(suggestion)" :size="18" class="prompt-suggestion-icon" aria-hidden="true" />
            <span class="prompt-suggestion-label">{{ suggestion.label }}</span><span v-if="suggestion.description" class="prompt-suggestion-description">{{ suggestion.description }}</span><span v-if="suggestion.source" class="prompt-suggestion-source">{{ suggestion.source }}</span>
          </button>
        </template>
      </div>
      <p v-if="suggestionsLoading" class="prompt-suggestion-status" role="status">正在读取…</p>
      <p v-if="suggestionsError" class="prompt-suggestion-status error" role="status">{{ suggestionsError }}</p>
      <p v-if="!suggestionsLoading && !suggestionsError && !selectable.length" class="prompt-suggestion-status" role="status">没有匹配结果</p>
    </div>
  </Teleport>
  <ImagePreview :open="!!preview" :src="preview?.image.url || ''" :name="preview?.image.name || ''" :anchor="preview?.anchor" :pinned="preview?.pinned" @close="preview = undefined; focus()" />
</template>
<style scoped>
.prompt-suggestions { position: fixed; z-index: 70; transform: translateY(-100%); overflow-y: auto; overscroll-behavior: contain; padding: 5px; border-radius: var(--radius-lg); background: var(--surface); color: var(--ink); box-shadow: var(--shadow-pop); scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
.prompt-suggestions.in-island { position: static; z-index: auto; transform: none; width: 100%; max-height: min(34dvh, 300px); padding: 3px 0 6px; background: transparent; box-shadow: none; border-radius: 0; }
.prompt-suggestion { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 6px 10px; border-radius: var(--radius-round); text-align: left; font-size: calc(14px * var(--ui-font-scale, 1)); line-height: calc(20px * var(--ui-font-scale, 1)); white-space: nowrap; }
.prompt-suggestion.highlighted, .prompt-suggestion:hover { background: var(--hover); }
.prompt-suggestion:active { background: var(--active); }
.prompt-suggestion:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.prompt-suggestion-icon { flex: 0 0 auto; color: var(--muted); }
.prompt-suggestion-label { flex: 0 1 auto; min-width: 60px; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-soft); }
.prompt-suggestion-description { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: calc(13px * var(--ui-font-scale, 1)); text-align: left; }
.prompt-suggestion-source { flex-shrink: 0; margin-left: auto; font-size: calc(12px * var(--ui-font-scale, 1)); color: var(--muted); }
.prompt-suggestion-group { padding: 10px 10px 4px; color: var(--muted); font-size: calc(12px * var(--ui-font-scale, 1)); }
.prompt-suggestion-status { margin: 0; padding: 8px 10px; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.6; color: var(--muted); overflow-wrap: anywhere; }
.prompt-suggestion-status.error { color: var(--danger); }
@media (max-width: 640px), (pointer: coarse) { .prompt-suggestion { min-height: 44px; gap: 7px; } }
</style>
