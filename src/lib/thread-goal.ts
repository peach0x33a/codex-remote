import { RpcError } from './rpc'

// Experimental App Server v2 bindings (ThreadGoal*.ts). Keep wire status names.
export type ThreadGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
export type ThreadGoal = {
  threadId: string; objective: string; status: ThreadGoalStatus; tokenBudget: number | null
  tokensUsed: number; timeUsedSeconds: number; createdAt: number; updatedAt: number
}
export type ThreadGoalUpdate = { objective?: string | null; status?: ThreadGoalStatus | null; tokenBudget?: number | null }

const statuses: readonly string[] = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function isThreadGoal(value: unknown, threadId: string): value is ThreadGoal {
  return isRecord(value) && value.threadId === threadId && typeof value.objective === 'string' && !!value.objective.trim()
    && typeof value.status === 'string' && statuses.includes(value.status)
    && (value.tokenBudget === null || nonnegative(value.tokenBudget) && value.tokenBudget > 0)
    && nonnegative(value.tokensUsed) && nonnegative(value.timeUsedSeconds) && nonnegative(value.createdAt) && nonnegative(value.updatedAt)
}
export function readGoalResponse(value: unknown, threadId: string, nullable = true): ThreadGoal | null {
  if (isRecord(value) && (nullable && value.goal === null || isThreadGoal(value.goal, threadId))) return value.goal as ThreadGoal | null
  throw new RpcError('目标响应无效，请刷新后重试。')
}
export function validateGoalUpdate(value: ThreadGoalUpdate): void {
  if (!isRecord(value) || !(['objective', 'status', 'tokenBudget'] as const).some(key => value[key] != null)) throw new RpcError('请填写目标或选择要更新的状态、预算。')
  if (value.objective != null && (typeof value.objective !== 'string' || !value.objective.trim())) throw new RpcError('目标不能为空。')
  if (value.status != null && !statuses.includes(value.status)) throw new RpcError('目标状态无效。')
  if (value.tokenBudget != null && (!nonnegative(value.tokenBudget) || value.tokenBudget === 0)) throw new RpcError('Token 预算必须是正整数。')
}
export function goalUnavailable(cause: unknown): boolean {
  return cause instanceof RpcError && (cause.code === -32601 || (
    /goals? feature is disabled|goals? (?:is |are )?(?:disabled|unsupported|not supported|unavailable)/i.test(cause.message)
    || /unknown variant\s+[`'"]thread\/goal\//i.test(cause.message)
    || /thread\/goal\/.*(?:not supported|requires experimentalApi)/i.test(cause.message)
  ))
}
export const GOAL_UNAVAILABLE = '此设备未启用或不支持 Goal 模式，请启用 goals 功能或升级 App Server。'
