import DOMPurify from 'dompurify'
import { markdownEngine } from './markdown-engine'

export const renderMarkdown = (text: string) => DOMPurify.sanitize(markdownEngine.render(text), { ADD_ATTR: ['target'], FORBID_TAGS: ['img', 'iframe', 'form', 'style'] })
