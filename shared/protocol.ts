// Structural fields used by this client; checked against Codex CLI 0.159.0 bindings.
export type RpcId = string | number
export type RpcMessage = { id?: RpcId; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string; data?: unknown } }
export type ConnectionProfile = { id: string; name: string; endpoint: string; cwd: string; createdAt: number; credentialId?: string }
export type ModelServiceTier = { id: string; name: string; description?: string }
export type Model = { id: string; model: string; displayName: string; description?: string; hidden?: boolean; isDefault?: boolean; supportedReasoningEfforts?: { reasoningEffort: string; description: string }[]; defaultReasoningEffort?: string; additionalSpeedTiers?: string[]; serviceTiers?: ModelServiceTier[]; defaultServiceTier?: string }
export type MessageContent = { type: string; text?: string; url?: string; path?: string; fileId?: string; name?: string; text_elements?: { byteRange: { start: number; end: number }; placeholder: string | null }[] }
export type CommandAction = { type: 'read'; command: string; name: string; path: string } | { type: 'listFiles'; command: string; path: string | null } | { type: 'search'; command: string; query: string | null; path: string | null } | { type: 'unknown'; command: string }
export type Item = {
  id: string; type: string; clientId?: string | null; text?: string; phase?: string; status?: string;
  startedAtMs?: number | null; completedAtMs?: number | null;
  content?: (MessageContent | string)[];
  summary?: string[]; command?: string; cwd?: string; aggregatedOutput?: string;
  commandActions?: CommandAction[];
  changes?: { path: string; diff?: string; kind?: unknown }[];
  tool?: string; server?: string; query?: string; result?: unknown; error?: unknown;
}
// Turn timestamps are Unix seconds; item timestamps use milliseconds.
export type Turn = { id: string; status: string; items: Item[]; startedAt?: number | null; completedAt?: number | null; durationMs?: number | null; error?: { message: string } | null }
export type Thread = { id: string; name?: string | null; preview: string; cwd: string; model?: string | null; createdAt: number; updatedAt: number; recencyAt?: number | null; status?: { type: string }; turns: Turn[]; parentThreadId?: string | null; agentNickname?: string | null; agentRole?: string | null; source?: unknown }
export type ThreadResult = { thread: Thread; model?: string; reasoningEffort?: string | null; serviceTier?: string | null; approvalPolicy?: string | object; approvalsReviewer?: string; sandbox?: { type: string; networkAccess?: boolean | string; writableRoots?: string[]; excludeTmpdirEnvVar?: boolean; excludeSlashTmp?: boolean }; turnsBackwardsCursor?: string | null; itemsBackwardsCursor?: string | null }
export type ThreadItemsPage = { data: { turnId: string; item: Item; startedAtMs?: number | null; completedAtMs?: number | null }[]; nextCursor: string | null }
export type Question = { id: string; header: string; question: string; isOther?: boolean; isSecret?: boolean; options?: { label: string; description: string }[] | null }
export type Approval = { id: RpcId; method: string; params: Record<string, unknown> & { threadId?: string; turnId?: string; reason?: string; command?: string; cwd?: string; questions?: Question[]; permissions?: Record<string, unknown>; availableDecisions?: unknown[] } }

export type TokenUsageBreakdown = { totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number; outputTokens: number; reasoningOutputTokens: number }
export type ThreadTokenUsage = { total: TokenUsageBreakdown; last: TokenUsageBreakdown; modelContextWindow: number | null }
