import type { InjectionKey, Ref } from 'vue'
import type { WorkspaceRun } from './workspace-files'

export type MarkdownImageContext = { cwd: string; connected: boolean; run: WorkspaceRun; resolveFileId?: (id: string) => string | undefined }
export const markdownImageContext: InjectionKey<Ref<MarkdownImageContext>> = Symbol('markdown-image-context')
