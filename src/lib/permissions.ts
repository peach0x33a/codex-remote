import type { ThreadResult } from '../../shared/protocol'
export type PermissionMode = 'ask' | 'auto' | 'readOnly' | 'full' | 'custom'
const workspace = { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
export function permissionParams(mode: PermissionMode) {
  switch (mode) {
    case 'ask': return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', sandboxPolicy: workspace }
    case 'auto': return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write', sandboxPolicy: workspace }
    case 'readOnly': return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly', networkAccess: false } }
    case 'full': return { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } }
    case 'custom': return {}
  }
}
export function restoredPermission(result: Omit<ThreadResult, 'thread'> & { thread: { cwd: string } }): PermissionMode | undefined {
  if (!result.sandbox || !result.approvalPolicy) return undefined
  if (result.sandbox.type === 'dangerFullAccess' && result.approvalPolicy === 'never') return 'full'
  if (result.approvalPolicy !== 'on-request') return 'custom'
  if (result.sandbox.networkAccess !== false || result.sandbox.writableRoots?.some(root => root !== result.thread.cwd) || result.sandbox.excludeTmpdirEnvVar || result.sandbox.excludeSlashTmp) return 'custom'
  if (result.approvalsReviewer && !['user', 'auto_review', 'guardian_subagent'].includes(result.approvalsReviewer)) return 'custom'
  if (result.sandbox.type === 'workspaceWrite') return ['auto_review', 'guardian_subagent'].includes(result.approvalsReviewer || '') ? 'auto' : 'ask'
  if (result.sandbox.type === 'readOnly' && (!result.approvalsReviewer || result.approvalsReviewer === 'user')) return 'readOnly'
  return 'custom'
}
