import { hasPrompt, type PromptPart } from './prompt'
import type { Turn } from '../../shared/protocol'
import { messageParts } from './prompt'

export function conversationInputs(turns: Turn[]): PromptPart[][] {
  return turns.flatMap(turn => turn.items.filter(item => item.type === 'userMessage').map(item => messageParts(item.content))).filter(hasPrompt).slice(-100)
}
const copy = (parts: PromptPart[]) => parts.map(part => part.type === 'image' && part.source ? { ...part, source: { ...part.source } } : { ...part })

/** A navigation session snapshots history and the unsubmitted draft. */
export function createInputHistory() {
  let entries: PromptPart[][] = [], draft: PromptPart[] = [], index = -1
  return {
    get active() { return index >= 0 },
    reset() { entries = []; draft = []; index = -1 },
    previous(current: PromptPart[], history: PromptPart[][]): PromptPart[] | undefined {
      if (index < 0) {
        entries = history.filter(hasPrompt).slice(-100).map(copy)
        if (!entries.length) return
        draft = copy(current); index = entries.length
      }
      index = Math.max(0, index - 1)
      return copy(entries[index]!)
    },
    next(): PromptPart[] | undefined {
      if (index < 0) return
      if (index < entries.length - 1) return copy(entries[++index]!)
      const restored = copy(draft)
      entries = []; draft = []; index = -1
      return restored
    },
  }
}

/** Unlike Range.toString(), this also treats attachment chips and newlines as content. */
export function atEditorBoundary(root: HTMLElement, range: Range, edge: 'start' | 'end'): boolean {
  if (!range.collapsed || !root.contains(range.startContainer)) return false
  const part = range.cloneRange()
  part.selectNodeContents(root)
  if (edge === 'start') part.setEnd(range.startContainer, range.startOffset)
  else part.setStart(range.endContainer, range.endOffset)
  const contents = part.cloneContents()
  return !(contents.textContent || '').replaceAll('​', '').length && !contents.querySelector('[data-attachment-id], img, br')
}
