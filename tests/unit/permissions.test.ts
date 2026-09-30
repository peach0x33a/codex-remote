import { describe, expect, test } from 'bun:test'
import { permissionParams, restoredPermission } from '../../src/lib/permissions'
import type { ThreadResult } from '../../shared/protocol'
const base: ThreadResult = { thread: { id: 'a', preview: '', cwd: '/project', createdAt: 0, updatedAt: 0, turns: [] }, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite', networkAccess: false, writableRoots: ['/project'] } }
describe('composer permissions', () => {
  test('auto-review changes reviewer without broadening sandbox or disabling approvals', () => {
    expect(permissionParams('auto').approvalsReviewer).toBe('auto_review')
    expect(permissionParams('auto').sandboxPolicy).toEqual(permissionParams('ask').sandboxPolicy)
    expect(permissionParams('auto').approvalPolicy).toBe(permissionParams('ask').approvalPolicy)
    expect(permissionParams('full').approvalPolicy).toBe('never')
    expect(permissionParams('full').sandboxPolicy?.type).toBe('dangerFullAccess')
  })
  test('restores exact server state, including legacy guardian reviewer', () => {
    expect(restoredPermission(base)).toBe('ask')
    expect(restoredPermission({ ...base, approvalsReviewer: 'guardian_subagent' })).toBe('auto')
    expect(restoredPermission({ ...base, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } })).toBe('full')
    expect(restoredPermission({ ...base, sandbox: { type: 'readOnly', networkAccess: false } })).toBe('readOnly')
  })
  test('does not silently normalize custom permissions into a standard mode', () => {
    expect(restoredPermission({ ...base, sandbox: { ...base.sandbox!, networkAccess: true } })).toBe('custom')
    expect(restoredPermission({ ...base, sandbox: { ...base.sandbox!, writableRoots: ['/other'] } })).toBe('custom')
    expect(restoredPermission({ ...base, approvalPolicy: { granular: {} } })).toBe('custom')
    expect(permissionParams('custom')).toEqual({})
  })
})
