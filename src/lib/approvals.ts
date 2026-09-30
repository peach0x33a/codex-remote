import type { Approval, RpcId } from '../../shared/protocol'
export function approvalTitle(approval: Approval) { return approval.method.endsWith('requestUserInput') ? 'Codex 想确认一下' : approval.method === 'item/permissions/requestApproval' ? '需要额外权限' : approval.method.includes('fileChange') ? '确认文件修改' : '确认执行操作' }
export function nextApprovalSelection(previous: RpcId[], current: RpcId[], selected?: RpcId): RpcId | undefined {
  if (!current.length) return undefined
  if (selected !== undefined && current.includes(selected)) return selected
  const index = selected === undefined ? 0 : Math.max(0, previous.indexOf(selected))
  return current[index % current.length]
}
export type ApprovalDraft = { answers: Record<string, string>; other: Record<string, string> }
