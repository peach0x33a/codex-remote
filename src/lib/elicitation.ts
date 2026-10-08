export type ElicitationField = { key: string; title: string; description: string; type: 'string' | 'number' | 'integer' | 'boolean' | 'array'; required: boolean; options?: { value: string; label: string }[]; default?: unknown; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; format?: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function options(schema: Record<string, unknown>) {
  if (Array.isArray(schema.enum)) {
    if (schema.enum.length > 100 || !schema.enum.every(v => typeof v === 'string')) throw new Error('表单选项无效。')
    return schema.enum.map((value, index) => ({ value: value as string, label: Array.isArray(schema.enumNames) && typeof schema.enumNames[index] === 'string' ? schema.enumNames[index] as string : value as string }))
  }
  const variants = schema.oneOf ?? schema.anyOf
  if (Array.isArray(variants)) {
    if (variants.length > 100 || !variants.every(v => record(v) && typeof v.const === 'string')) throw new Error('表单选项无效。')
    return variants.map(v => ({ value: (v as Record<string, unknown>).const as string, label: String((v as Record<string, unknown>).title ?? (v as Record<string, unknown>).const) }))
  }
}
export function elicitationFields(schema: unknown): ElicitationField[] {
  if (!record(schema) || schema.type !== 'object' || !record(schema.properties) || Object.keys(schema.properties).length > 64) throw new Error('此表单结构无法显示，请拒绝或取消本次请求。')
  const rootKeywords = new Set(['$schema', 'type', 'properties', 'required', 'title', 'description', 'additionalProperties'])
  if (Object.keys(schema).some(key => !rootKeywords.has(key))) throw new Error('此表单包含尚不支持的整体校验规则。')
  const required = schema.required ?? []
  if (!Array.isArray(required) || !required.every(v => typeof v === 'string' && Object.hasOwn(schema.properties!, v))) throw new Error('表单必填字段无效。')
  return Object.entries(schema.properties).map(([key, value]) => {
    if (!record(value) || !['string', 'number', 'integer', 'boolean', 'array'].includes(String(value.type))) throw new Error('此表单包含尚不支持的嵌套字段：' + key)
    // Do not silently accept a schema whose validation requirements we cannot enforce.
    const supported = new Set(['type', 'title', 'description', 'default', 'enum', 'enumNames', 'oneOf', 'items', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'format'])
    if (Object.keys(value).some(k => !supported.has(k))) throw new Error('此表单包含尚不支持的校验规则：' + key)
    const choices = value.type === 'array' ? record(value.items) && (value.items.type === 'string' || value.items.type === undefined) ? options(value.items) : undefined : options(value)
    if (value.type === 'array' && !choices?.length) throw new Error('多选字段缺少选项：' + key)
    if (value.format !== undefined && !['email', 'uri', 'date', 'date-time'].includes(String(value.format))) throw new Error('不支持的字段格式：' + key)
    const field: ElicitationField = { key, title: typeof value.title === 'string' ? value.title : key, description: typeof value.description === 'string' ? value.description : '', type: value.type as ElicitationField['type'], required: required.includes(key), options: choices, default: value.default, format: value.format as string | undefined }
    for (const name of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'] as const) {
      if (value[name] !== undefined) {
        if (typeof value[name] !== 'number' || !Number.isFinite(value[name])) throw new Error('表单限制无效：' + key)
        if (['minLength', 'maxLength', 'minItems', 'maxItems'].includes(name) && (!Number.isSafeInteger(value[name]) || (value[name] as number) < 0)) throw new Error('表单长度限制无效：' + key)
        field[name] = value[name] as number
      }
    }
    return field
  })
}
export function elicitationContent(fields: ElicitationField[], values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  for (const field of fields) {
    const raw = values[field.key]
    if (raw === undefined || raw === '') { if (field.required) throw new Error('请填写“' + field.title + '”。'); continue }
    let value: unknown = raw
    if (field.type === 'boolean') { if (!['true', 'false', true, false].includes(raw as string | boolean)) throw new Error('请选择“' + field.title + '”。'); value = raw === true || raw === 'true' }
    else if (field.type === 'number' || field.type === 'integer') {
      if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) throw new Error(field.title + '需要数字。')
      const number = Number(raw)
      if (!Number.isFinite(number) || field.type === 'integer' && !Number.isSafeInteger(number) || field.minimum !== undefined && number < field.minimum || field.maximum !== undefined && number > field.maximum) throw new Error(field.title + '超出允许的数字范围。')
      value = number
    } else if (field.type === 'array') {
      if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string' && field.options?.some(o => o.value === v)) || new Set(raw).size !== raw.length || field.minItems !== undefined && raw.length < field.minItems || field.maxItems !== undefined && raw.length > field.maxItems) throw new Error('请检查“' + field.title + '”的多选项。')
      value = [...raw]
    } else {
      if (typeof raw !== 'string' || raw.length > 16384 || field.minLength !== undefined && [...raw].length < field.minLength || field.maxLength !== undefined && [...raw].length > field.maxLength || field.options && !field.options.some(o => o.value === raw)) throw new Error('请检查“' + field.title + '”的内容。')
      if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || field.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) || field.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw)))) throw new Error(field.title + '格式不正确。')
      if (field.format === 'uri') { try { new URL(raw) } catch { throw new Error(field.title + '需要完整网址。') } }
    }
    result[field.key] = value
  }
  return result
}
