// Mirrors the local experimental v2 CollabAgentTool/State and ThreadItem schemas.
// Keep this projection separate from shared Item: incomplete live items are valid input.
type ToolDescription = { title: string; promptLabel: string }
const tools: Record<string, ToolDescription> = {
  spawnAgent: { title: '创建子代理', promptLabel: '任务说明' },
  sendInput: { title: '向子代理发送指令', promptLabel: '指令内容' },
  resumeAgent: { title: '恢复子代理', promptLabel: '补充说明' },
  wait: { title: '等待子代理', promptLabel: '补充说明' },
  closeAgent: { title: '关闭子代理', promptLabel: '补充说明' },
  sendMessage: { title: '向子代理发送消息', promptLabel: '消息内容' },
  followupTask: { title: '分配后续任务', promptLabel: '后续任务' },
  interruptAgent: { title: '中断子代理', promptLabel: '补充说明' },
  listAgents: { title: '查看子代理列表', promptLabel: '补充说明' },
}
const callStatuses: Record<string, string> = { inProgress: '进行中', completed: '已完成', failed: '失败', interrupted: '已中断' }
const agentStatuses: Record<string, string> = { pendingInit: '初始化中', running: '执行中', interrupted: '已中断', completed: '任务完成', errored: '执行出错', shutdown: '已关闭', notFound: '未找到代理' }
const efforts: Record<string, string> = { none: '不启用', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高' }

export type CollabToolPresentation = {
  title: string; status: string; failed: boolean; completed: boolean
  promptLabel: string; prompt?: string; sender?: string; model?: string; effort?: string
  agents: { id: string; path?: string; status: string; failed: boolean; message?: string; messageLabel: string }[]
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function label(labels: Record<string, string>, key: unknown, fallback: string): string {
  return typeof key === 'string' && Object.hasOwn(labels, key) ? labels[key] : fallback
}

/** A safe, human-readable projection; unknown tools never fall back to a JSON dump. */
export function parseCollabTool(item: unknown): CollabToolPresentation | undefined {
  if (!record(item)) return undefined
  if (item.type === 'subAgentActivity') {
    const kinds: Record<string, string> = { started: '启动子代理', interacted: '与子代理交互', interrupted: '中断子代理', completed: '子代理任务完成' }
    const states: Record<string, string> = { started: '执行中', interrupted: '已中断', completed: '任务完成' }
    const kind = text(item.kind), id = text(item.agentThreadId), path = text(item.agentPath)
    return {
      title: label(kinds, kind, kind ? '子代理活动 · ' + kind : '子代理活动'),
      status: item.status === 'failed' ? '失败' : '已记录', failed: item.status === 'failed',
      completed: item.status !== 'failed' && (item.kind === 'completed' || typeof item.completedAtMs === 'number' && Number.isFinite(item.completedAtMs)),
      promptLabel: '补充说明',
      // An interaction/completedAtMs records this activity, not the agent's completion.
      agents: id || path ? [{ id: id || '', ...(path ? { path } : {}), status: label(states, kind, ''), failed: false, messageLabel: '消息' }] : [],
    }
  }
  if (item.type !== 'collabAgentToolCall') return undefined
  const tool = typeof item.tool === 'string' && Object.hasOwn(tools, item.tool) ? tools[item.tool] : {
    title: text(item.tool) ? `子代理协作 · ${item.tool}` : '子代理协作', promptLabel: '请求内容',
  }
  const states = record(item.agentsStates) ? item.agentsStates : {}
  const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((id): id is string => !!text(id)) : []
  // History may only contain states, while a started event may only contain receivers.
  const ids = [...new Set([...receivers, ...Object.keys(states).filter(id => !!text(id))])]
  const agents = ids.map(id => {
    const value = Object.hasOwn(states, id) ? states[id] : undefined
    const state = record(value) ? value : {}
    return {
      id, status: label(agentStatuses, state.status, text(state.status) ? '状态未知' : ''),
      failed: state.status === 'errored' || state.status === 'notFound',
      message: text(state.message), messageLabel: state.status === 'errored' ? '错误说明' : state.status === 'completed' ? '执行结果' : '消息',
    }
  })
  return {
    ...tool, status: label(callStatuses, item.status, text(item.status) ? '状态未知' : ''),
    failed: item.status === 'failed', completed: item.status === 'completed',
    prompt: text(item.prompt), sender: text(item.senderThreadId), model: text(item.model),
    effort: text(item.reasoningEffort) ? label(efforts, item.reasoningEffort, '未识别的强度') : undefined,
    agents,
  }
}
