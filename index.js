import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PDFParse } from 'pdf-parse'

export const name = 'auracap'
export const inject = ['webServer', 'llm', 'attachments']

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const promptCache = new Map()

function readPrompt(name) {
  const file = join(ROOT, 'prompts', name)
  try {
    const stat = statSync(file)
    const cached = promptCache.get(name)
    if (!cached || cached.mtimeMs !== stat.mtimeMs) {
      promptCache.set(name, { mtimeMs: stat.mtimeMs, text: readFileSync(file, 'utf8') })
    }
    return promptCache.get(name).text
  } catch {
    const cached = promptCache.get(name)
    return cached ? cached.text : ''
  }
}

const BASE = '/auracap'
const MAX_BYTES = 30 * 1024 * 1024
const MAX_IMPORT_BYTES = 40 * 1024 * 1024
const execFileAsync = promisify(execFile)
const MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MODEL = { provider: 'deepseek-account', model: 'deepseek-flash' }
const GITHUB_CLIENT_ID = 'Ov23ligAxNzDh8sXIMES'
const GITHUB_REPO = 'auracap-inbox'
const GITHUB_TAG = 'auracap-inbox'
const GITHUB_KEY = 'auracap/github'
const GITHUB_POLL_MS = 60_000
const DIGEST_REFRESH_MS = 4 * 60 * 60 * 1000
const DIGEST_CHECK_MS = 30 * 60 * 1000

const dataDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'auracap')
const itemsFile = () => join(dataDir(), 'items.json')
const mediaDir = () => join(dataDir(), 'media')

function extensionOf(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

function imageTypeFromName(name) {
  const lower = String(name || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.heic')) return 'image/heic'
  return ''
}

function storeOriginal(item, data) {
  mkdirSync(mediaDir(), { recursive: true })
  const relative = join('media', `${item.id}.${extensionOf(item.image.mediaType)}`)
  writeFileSync(join(dataDir(), relative), data)
  item.imageFile = relative
}

async function addImageItem(ctx, items, data, mediaType, name, source) {
  const image = await ctx.attachments.saveImage({ data, mediaType, name })
  const item = {
    id: randomUUID(),
    kind: 'image',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'summarizing',
    image,
    summary: null,
    error: null,
    model: null,
    source: source || { kind: 'local', name },
  }
  try { storeOriginal(item, data) } catch {}
  items.unshift(item)
  saveItems(items)
  summarize(ctx.llm, items, item).catch((error) => {
    item.status = 'failed'
    item.error = error && error.message ? error.message : String(error)
    saveItems(items)
  })
  return item
}

function addDocumentItem(ctx, items, { data, mediaType, name, text, source }) {
  const content = String(text || '').replace(/\r\n/g, '\n').trim()
  if (content.length < 8) {
    const error = new Error('没有从文件中提取到可用文字')
    error.status = 422
    throw error
  }
  const hash = createHash('sha256').update(content).digest('hex')
  const existing = items.find((entry) => {
    if (!entry || entry.kind !== 'document') return false
    if (entry.document && entry.document.hash === hash) return true
    return Boolean(entry.text) && createHash('sha256').update(String(entry.text).trim()).digest('hex') === hash
  })
  if (existing) return existing
  const item = {
    id: randomUUID(),
    kind: 'document',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'summarizing',
    image: null,
    document: { name: name || '未命名文件', mediaType, bytes: data ? data.length : Buffer.byteLength(content), chars: content.length, hash },
    text: content.slice(0, 240000),
    summary: null,
    error: null,
    model: null,
    source: source || { kind: 'local', name: name || 'document' },
  }
  items.unshift(item)
  saveItems(items)
  summarize(ctx.llm, items, item).catch((error) => {
    item.status = 'failed'
    item.error = error && error.message ? error.message : String(error)
    saveItems(items)
  })
  return item
}

async function extractPdfText(data) {
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText()
    return String(result && result.text ? result.text : '')
  } finally {
    try { await parser.destroy() } catch {}
  }
}

let systemCaptureWatch = null

async function screenshotDirectory() {
  try {
    const result = await execFileAsync('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], { timeout: 3000 })
    const location = String(result.stdout || '').trim()
    if (location) return location.startsWith('~') ? join(homedir(), location.slice(1)) : location
  } catch {}
  return join(homedir(), 'Desktop')
}

async function startSystemCapture(ctx, items) {
  if (systemCaptureWatch) return { watching: true }
  const dir = await screenshotDirectory()
  const baseline = new Set()
  try { for (const name of readdirSync(dir)) baseline.add(name) } catch { return { watching: false, error: '找不到桌面目录' } }
  const startedAt = Date.now()
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "System Events" to set visible of process "DeepSeek Harness" to false'], { timeout: 5000 })
  } catch {}
  const candidates = new Map()
  const timer = setInterval(async () => {
    if (!systemCaptureWatch) return
    if (Date.now() - startedAt > 180_000) {
      clearInterval(timer)
      systemCaptureWatch = null
      return
    }
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      if (baseline.has(name)) continue
      if (!/\.(png|jpe?g)$/i.test(name)) continue
      const file = join(dir, name)
      let info
      try { info = statSync(file) } catch { continue }
      if (!info.isFile() || !info.size || info.mtimeMs < startedAt - 2000) continue
      const last = candidates.get(name)
      if (!last || last.size !== info.size || last.mtimeMs !== info.mtimeMs) {
        candidates.set(name, { size: info.size, mtimeMs: info.mtimeMs })
        continue
      }
      try {
        const data = readFileSync(file)
        const digest = createHash('sha256').update(data).digest('hex')
        if (items.some((item) => item.image && item.image.attachmentId === 'sha256:' + digest)) {
          clearInterval(timer); systemCaptureWatch = null; return
        }
        const mediaType = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
        await addImageItem(ctx, items, data, mediaType, name, { kind: 'screenshot', name })
      } catch {}
      clearInterval(timer)
      systemCaptureWatch = null
      return
    }
  }, 900)
  if (typeof timer.unref === 'function') timer.unref()
  systemCaptureWatch = { timer }
  return { watching: true, dir }
}

async function migrateMedia(ctx, items) {
  let changed = false
  for (const item of items) {
    if (!item.image || item.imageFile) continue
    try {
      const stored = await ctx.attachments.readImage(item.image)
      mkdirSync(mediaDir(), { recursive: true })
      const relative = join('media', `${item.id}.${extensionOf(item.image.mediaType)}`)
      writeFileSync(join(dataDir(), relative), Buffer.from(stored.data))
      item.imageFile = relative
      changed = true
    } catch {
      // Keep the attachment reference; serving falls back to the attachment store.
    }
  }
  if (changed) saveItems(items)
}

function loadItems() {
  try {
    const parsed = JSON.parse(readFileSync(itemsFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveItems(items) {
  mkdirSync(dataDir(), { recursive: true })
  const file = itemsFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(items, null, 2))
  renameSync(tmp, file)
}

function readJsonBody(req, limit) {
  return readBody(req, limit).then((buffer) => {
    const text = buffer.toString('utf8').trim()
    return text ? JSON.parse(text) : {}
  })
}

const digestsDir = () => join(dataDir(), 'digests')
const digestPath = (date) => join(digestsDir(), `${date}.json`)

function loadDigest(date) {
  try {
    return JSON.parse(readFileSync(digestPath(date), 'utf8'))
  } catch {
    return null
  }
}

function saveDigest(digest) {
  mkdirSync(digestsDir(), { recursive: true })
  const file = digestPath(digest.date)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(digest, null, 2))
  renameSync(tmp, file)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function localDateKey(iso) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function todayKey() {
  return localDateKey(new Date().toISOString())
}

function localDateKeyOfDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function localMidday(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

function addDays(dateKey, days) {
  const date = localMidday(dateKey)
  date.setDate(date.getDate() + days)
  return localDateKeyOfDate(date)
}

function isoWeekKey(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round((utc.getTime() - firstThursday.getTime()) / 604800000)
  return `${utc.getUTCFullYear()}-W${pad2(week)}`
}

export function periodInfo(type, anchorISO) {
  const base = anchorISO ? localMidday(localDateKey(anchorISO)) : localMidday(todayKey())
  if (type === 'day') {
    const key = localDateKeyOfDate(base)
    return { type, key, start: key, end: key }
  }
  if (type === 'week') {
    const monday = new Date(base)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    return { type, key: isoWeekKey(monday), start: localDateKeyOfDate(monday), end: localDateKeyOfDate(sunday) }
  }
  if (type === 'month') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 12)
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12)
    return { type, key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`, start: localDateKeyOfDate(start), end: localDateKeyOfDate(end) }
  }
  if (type === 'year') {
    return { type, key: String(base.getFullYear()), start: `${base.getFullYear()}-01-01`, end: `${base.getFullYear()}-12-31` }
  }
  const error = new Error('周期类型应为 day / week / month / year')
  error.status = 400
  throw error
}

function insightPath(type, key) {
  if (type === 'day') return digestPath(key)
  return join(dataDir(), 'insights', type, `${key}.json`)
}

function loadPeriodInsight(type, key) {
  try {
    return JSON.parse(readFileSync(insightPath(type, key), 'utf8'))
  } catch {
    return null
  }
}

function savePeriodInsight(insight) {
  const file = insightPath(insight.type, insight.key)
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(insight, null, 2))
  renameSync(tmp, file)
}

function itemsInRange(items, start, end) {
  return items.filter((item) => {
    const key = localDateKey(item.createdAt)
    return key >= start && key <= end
  })
}

function sourceInsightBlocks(type, start, end) {
  const blocks = []
  const sourceKeys = []
  const seen = new Set()
  const push = (nextType, dateKey) => {
    const info = periodInfo(nextType, dateKey)
    if (seen.has(info.type + info.key)) return
    seen.add(info.type + info.key)
    const insight = loadPeriodInsight(nextType, info.key)
    if (insight && insight.content) {
      blocks.push(`## ${info.key}\n${insight.content}`)
      sourceKeys.push(info.key)
    }
  }
  const dates = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor)
  if (type === 'week') {
    for (const key of dates) push('day', key)
  } else if (type === 'month') {
    for (const key of dates) push('week', key)
    if (blocks.length < 2) for (const key of dates) push('day', key)
  } else if (type === 'year') {
    for (const key of dates) push('month', key)
    if (blocks.length < 3) for (const key of dates) push('week', key)
    if (blocks.length < 3) for (const key of dates) push('day', key)
  }
  return { blocks: blocks.slice(0, 16), keys: sourceKeys.slice(0, 16) }
}

function periodMaterial(type, items, info) {
  const inRange = itemsInRange(items, info.start, info.end).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const sourceData = sourceInsightBlocks(type, info.start, info.end)
  const sources = sourceData.blocks
  const limit = type === 'year' ? 36 : type === 'month' ? 20 : 14
  const itemsText = inRange.slice(-limit).map((item) => {
    const summary = item.summary || {}
    const title = summary.title || '未命名'
    const content = plainTextOfSummary(summary).slice(0, 420)
    return `- ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })} | ${title} | ${content}`
  }).join('\n')
  const parts = []
  parts.push(`周期类型：${type}`, `日期范围：${info.start} ~ ${info.end}`)
  if (sources.length) parts.push('# 已有洞察', sources.join('\n\n'))
  if (itemsText) parts.push('# 原始片段', itemsText)
  return { text: parts.join('\n\n').slice(0, 30_000), itemCount: inRange.length, sourceCount: sources.length, itemIds: inRange.map((item) => item.id), sourceInsightKeys: sourceData.keys }
}

async function generatePeriodInsight(ctx, items, type, anchorISO, force) {
  const info = periodInfo(type, anchorISO)
  const existing = loadPeriodInsight(type, info.key)
  if (existing && !force) return existing
  const material = periodMaterial(type, items, info)
  if (!material.itemCount) {
    const error = new Error('这个周期还没有可用碎片')
    error.status = 409
    throw error
  }
  const prompt = readPrompt('long-insights-zh.md')
  if (!prompt) throw new Error('长洞察提示词缺失')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 240_000)
  try {
    const stream = ctx.llm.stream({
      provider: MODEL.provider,
      model: MODEL.model,
      reasoningEffort: 'low',
      maxTokens: type === 'year' ? 4800 : 3400,
      system: prompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: material.text }] }],
      signal: controller.signal,
    })
    let text = ''
    let usage = null
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
        if (chunk.reason && chunk.reason.kind === 'aborted') throw new Error('生成已取消')
      }
    }
    recordUsage('long-insight', usage)
    const parsed = parseDigest(text)
    const insight = {
      type,
      key: info.key,
      start: info.start,
      end: info.end,
      title: parsed.title || `${info.start} ~ ${info.end}`,
      content: parsed.content,
      itemCount: material.itemCount,
      sourceCount: material.sourceCount,
      sourceItemIds: material.itemIds,
      sourceInsightKeys: material.sourceInsightKeys,
      createdAt: new Date().toISOString(),
      model: MODEL.model,
    }
    savePeriodInsight(insight)
    return insight
  } finally {
    clearTimeout(timer)
  }
}

function searchSnippet(text, terms) {
  const source = String(text || '').replace(/^#{1,6}\s+.*$/gm, ' ').replace(/\s+/g, ' ').trim()
  if (!source) return ''
  const lower = source.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return source.slice(0, 90)
  const start = Math.max(0, index - 34)
  const end = Math.min(source.length, index + 76)
  return (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '')
}

function searchScore(haystack, terms, title) {
  const lower = String(haystack || '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (String(title || '').toLowerCase().includes(term)) score += 4
    if (lower.includes(term)) score += 1
  }
  return score
}

function searchItemsFor(items, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return items.map((item) => {
    const summary = item.summary || {}
    const title = summary.title || '未命名片刻'
    const body = [summary.content, summary.excerpt, summary.summary, (summary.tags || []).join(' '), item.error].filter(Boolean).join(' ')
    const haystack = title + ' ' + body
    if (!terms.every((term) => haystack.toLowerCase().includes(term))) return null
    return {
      kind: 'item',
      id: item.id,
      title,
      snippet: searchSnippet(body || title, terms),
      createdAt: item.createdAt,
      status: item.status,
      score: searchScore(haystack, terms, title),
    }
  }).filter(Boolean).sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
}

function searchInsightsFor(query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const files = []
  const add = (type, file) => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const title = parsed.title || ''
      const content = parsed.content || ''
      const haystack = title + ' ' + content
      if (!terms.every((term) => haystack.toLowerCase().includes(term))) return
      files.push({
        kind: 'insight',
        type: type === 'day' ? 'day' : type,
        key: parsed.key || (type === 'day' ? file.split('/').pop().replace(/\.json$/, '') : ''),
        start: parsed.start || parsed.date || '',
        end: parsed.end || parsed.date || '',
        title,
        snippet: searchSnippet(content || title, terms),
        createdAt: parsed.createdAt || '',
        score: searchScore(haystack, terms, title) + 2,
      })
    } catch {}
  }
  try {
    for (const name of readdirSync(join(dataDir(), 'digests'))) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) add('day', join(dataDir(), 'digests', name))
    }
  } catch {}
  for (const type of ['week', 'month', 'year']) {
    try {
      for (const name of readdirSync(join(dataDir(), 'insights', type))) {
        if (name.endsWith('.json')) add(type, join(dataDir(), 'insights', type, name))
      }
    } catch {}
  }
  return files.sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
}

function latestInsightStatus(type) {
  const files = []
  const push = (file, key) => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && parsed.createdAt) files.push({ key: parsed.key || key, createdAt: parsed.createdAt })
    } catch {}
  }
  if (type === 'day') {
    try {
      for (const name of readdirSync(join(dataDir(), 'digests'))) {
        if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue
        push(join(dataDir(), 'digests', name), name.replace(/\.json$/, ''))
      }
    } catch {}
  } else {
    try {
      for (const name of readdirSync(join(dataDir(), 'insights', type))) {
        if (!name.endsWith('.json')) continue
        push(join(dataDir(), 'insights', type, name), name.replace(/\.json$/, ''))
      }
    } catch {}
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null
}

function previousPeriodAnchors() {
  const today = todayKey()
  const date = localMidday(today)
  const week = new Date(date)
  week.setDate(week.getDate() - 7)
  const month = new Date(date.getFullYear(), date.getMonth(), 0, 12)
  const year = new Date(date.getFullYear() - 1, 11, 31, 12)
  return { week: localDateKeyOfDate(week), month: localDateKeyOfDate(month), year: localDateKeyOfDate(year) }
}

function plainTextOfSummary(summary) {
  if (!summary) return ''
  const source = typeof summary.content === 'string' && summary.content.trim()
    ? summary.content
    : (typeof summary.summary === 'string' ? summary.summary : '')
  return String(source)
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*[-*]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function digestMaterial(items) {
  const lines = items.map((item) => {
    const summary = item.summary || {}
    const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    const type = summary.contentType || 'other'
    const title = summary.title || ''
    const content = plainTextOfSummary(summary)
    return `${time} | ${type} | ${title ? title + '：' : ''}${content}`.slice(0, 800)
  })
  return lines.join('\n').slice(0, 12000)
}

export function parseDigest(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const merged = {}
  for (const raw of balancedJsonObjects(cleaned)) {
    try { Object.assign(merged, JSON.parse(raw)) } catch {}
  }

  let content = typeof merged.content === 'string' ? merged.content.trim() : ''
  let title = typeof merged.title === 'string' ? merged.title.trim() : ''
  if (!content) {
    content = regexField(cleaned, 'content').trim()
    title = title || regexField(cleaned, 'title').trim()
  }
  if (content) return { title, content }
  return { title: '', content: cleaned }
}

async function generateDigest(llm, items, date) {
  const ready = items.filter((item) => item.status === 'ready' && localDateKey(item.createdAt) === date)
  if (!ready.length) {
    const error = new Error('这一天还没有可用的碎片')
    error.status = 409
    throw error
  }
  const material = digestMaterial(ready)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const stream = llm.stream({
      provider: MODEL.provider,
      model: MODEL.model,
      reasoningEffort: 'low',
      maxTokens: 2200,
      system: readPrompt('insights-zh.md'),
      messages: [{ role: 'user', content: [{ type: 'text', text: `日期：${date}\n\n${material}` }] }],
      signal: controller.signal,
    })
    let text = ''
    let usage = null
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'usage') usage = chunk.usage
      else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
        if (chunk.reason && chunk.reason.kind === 'aborted') throw new Error('生成已取消')
      }
    }
    recordUsage('daily-insight', usage)
    const parsed = parseDigest(text)
    let content = parsed.content
    if (content && !/^\s*#{1,6}\s+/m.test(content)) content = '### 今日焦点\n' + content
    const digest = {
      date,
      title: parsed.title || `${date} 洞察`,
      content,
      itemCount: ready.length,
      itemIds: ready.map((item) => item.id),
      createdAt: new Date().toISOString(),
      model: MODEL.model,
    }
    saveDigest(digest)
    return digest
  } finally {
    clearTimeout(timer)
  }
}

async function refreshDigestIfDue(ctx, github) {
  if (github.digestBusy) return
  const date = todayKey()
  const ready = github.items.filter((item) => item.status === 'ready' && localDateKey(item.createdAt) === date)
  if (!ready.length) return
  const existing = loadDigest(date)
  const now = Date.now()
  if (existing && existing.createdAt) {
    const generatedAt = Date.parse(existing.createdAt)
    if (Number.isFinite(generatedAt) && now - generatedAt < DIGEST_REFRESH_MS) return
  }
  const ids = ready.map((item) => item.id)
  if (existing && Array.isArray(existing.itemIds) && ids.every((id) => existing.itemIds.includes(id))) return
  github.digestBusy = true
  try {
    await generateDigest(ctx.llm, github.items, date)
  } finally {
    github.digestBusy = false
  }
}

function startDigestLoop(ctx, github) {
  const check = () => { refreshDigestIfDue(ctx, github).catch(() => {}) }
  const timer = setInterval(check, DIGEST_CHECK_MS)
  if (typeof timer.unref === 'function') timer.unref()
  const startup = setTimeout(check, 30_000)
  if (typeof startup.unref === 'function') startup.unref()
  ctx.effect(() => () => {
    clearInterval(timer)
    clearTimeout(startup)
  })
}

const stateFile = () => join(dataDir(), 'state.json')

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return {
      github: parsed.github && typeof parsed.github === 'object' ? parsed.github : null,
      processed: Array.isArray(parsed.processed) ? parsed.processed : [],
      lastSyncAt: parsed.lastSyncAt || null,
      queueCount: Number.isFinite(parsed.queueCount) ? parsed.queueCount : 0,
      lastError: parsed.lastError || null,
    }
  } catch {
    return { github: null, processed: [], lastSyncAt: null, queueCount: 0, lastError: null }
  }
}

function saveState(state) {
  mkdirSync(dataDir(), { recursive: true })
  const file = stateFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, file)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readGithubToken(ctx, state) {
  const credentials = ctx.get('credentials')
  if (credentials) {
    try {
      const record = await credentials.readRecord(GITHUB_KEY)
      if (record && record.payload && typeof record.payload.token === 'string') return record.payload.token
    } catch {}
  }
  return state.github && typeof state.github.token === 'string' ? state.github.token : null
}

async function writeGithubToken(ctx, state, token, login) {
  const credentials = ctx.get('credentials')
  if (credentials) {
    try {
      await credentials.modifyRecord(GITHUB_KEY, async () => ({ kind: 'grant', payload: { token, login, provider: 'github' } }))
      return
    } catch {}
  }
  state.github = Object.assign({}, state.github, { token })
}

async function clearGithubToken(ctx, state) {
  const credentials = ctx.get('credentials')
  if (credentials) {
    try { await credentials.deleteRecord(GITHUB_KEY) } catch {}
  }
  if (state.github) delete state.github.token
}

async function githubRequest(token, path, options = {}) {
  const response = await fetch('https://api.github.com' + path, {
    method: options.method || 'GET',
    headers: Object.assign({
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-auracap',
    }, options.headers || {}),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'follow',
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: response.status, data }
}

async function githubDownload(token, asset) {
  const response = await fetch(asset.url, {
    headers: {
      accept: 'application/octet-stream',
      authorization: 'Bearer ' + token,
      'user-agent': 'dsh-auracap',
    },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error('下载队列文件失败（HTTP ' + response.status + '）')
  return Buffer.from(await response.arrayBuffer())
}

async function deleteGithubAsset(token, repo, id) {
  const response = await githubRequest(token, `/repos/${repo.owner}/${repo.name}/releases/assets/${id}`, { method: 'DELETE' })
  if (response.status !== 204 && response.status !== 404) throw new Error('删除队列文件失败（HTTP ' + response.status + '）')
}

function githubFailure(response, fallback) {
  const message = response && response.data && typeof response.data.message === 'string' ? response.data.message : fallback
  return new Error(message + '（HTTP ' + response.status + '）')
}

async function provisionGithub(ctx, github) {
  const token = await readGithubToken(ctx, github.state)
  if (!token) throw new Error('GitHub 未连接')
  const user = await githubRequest(token, '/user')
  if (user.status !== 200) throw githubFailure(user, '读取 GitHub 账号失败')
  const login = user.data.login

  let repo = await githubRequest(token, `/repos/${login}/${GITHUB_REPO}`)
  if (repo.status === 404) {
    repo = await githubRequest(token, '/user/repos', {
      method: 'POST',
      body: {
        name: GITHUB_REPO,
        private: true,
        auto_init: true,
        has_issues: false,
        has_wiki: false,
        has_projects: false,
        description: 'AuraCap capture inbox — created by the DeepSeek Harness plugin.',
      },
    })
  }
  if (repo.status !== 200 && repo.status !== 201) throw githubFailure(repo, '创建 GitHub 仓库失败')
  if (repo.data.private !== true) throw new Error('仓库 ' + login + '/' + GITHUB_REPO + ' 不是私有仓库，已停止使用')

  let release = await githubRequest(token, `/repos/${login}/${GITHUB_REPO}/releases/tags/${GITHUB_TAG}`)
  if (release.status === 404) {
    await delay(1200)
    release = await githubRequest(token, `/repos/${login}/${GITHUB_REPO}/releases`, {
      method: 'POST',
      body: {
        tag_name: GITHUB_TAG,
        name: 'AuraCap Inbox',
        body: 'Capture inbox. The DSH AuraCap plugin consumes and removes assets from this release.',
        target_commitish: repo.data.default_branch || 'main',
      },
    })
  }
  if (release.status !== 200 && release.status !== 201) throw githubFailure(release, '创建收件箱 Release 失败')

  github.state.github = {
    login,
    owner: login,
    name: GITHUB_REPO,
    releaseId: release.data.id,
    tag: GITHUB_TAG,
    connectedAt: (github.state.github && github.state.github.connectedAt) || new Date().toISOString(),
  }
  github.state.lastError = null
  saveState(github.state)
  return github.state.github
}

async function startGithubDevice(ctx, github) {
  const body = new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: 'repo read:user' })
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data || !data.device_code) throw new Error('无法开始 GitHub 授权（' + response.status + '）')
  const flow = {
    id: randomUUID(),
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: Math.max(5, Number(data.interval) || 5),
    expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    status: 'pending',
    error: null,
  }
  github.flows.set(flow.id, flow)
  runGithubDevice(ctx, github, flow).catch(() => {})
  return { id: flow.id, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresIn: Math.max(1, Math.round((flow.expiresAt - Date.now()) / 1000)) }
}

async function runGithubDevice(ctx, github, flow) {
  while (flow.status === 'pending' && Date.now() < flow.expiresAt) {
    await delay(flow.interval * 1000)
    if (flow.status !== 'pending') return
    const body = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      device_code: flow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await response.json().catch(() => null)
    if (data && data.access_token) {
      flow.status = 'provisioning'
      try {
        await writeGithubToken(ctx, github.state, data.access_token, '')
        await provisionGithub(ctx, github)
        flow.status = 'ready'
        syncGithub(ctx, github).catch(() => {})
      } catch (error) {
        flow.status = 'failed'
        flow.error = error && error.message ? error.message : String(error)
      }
      return
    }
    const code = data && data.error
    if (code === 'authorization_pending') continue
    if (code === 'slow_down') { flow.interval += 5; continue }
    if (code === 'expired_token') { flow.status = 'expired'; flow.error = '设备码已过期，请重新发起授权'; return }
    if (code === 'access_denied') { flow.status = 'failed'; flow.error = '你取消了授权'; return }
    flow.status = 'failed'
    flow.error = (data && (data.error_description || data.error)) || 'GitHub 授权失败'
    return
  }
  if (flow.status === 'pending') {
    flow.status = 'expired'
    flow.error = '设备码已过期，请重新发起授权'
  }
}

function githubStatus(github) {
  const repo = github.state.github
  return {
    connected: Boolean(repo),
    login: repo ? repo.login : null,
    repo: repo ? { owner: repo.owner, name: repo.name, url: 'https://github.com/' + repo.owner + '/' + repo.name } : null,
    release: repo ? repo.releaseId : null,
    queueCount: github.state.queueCount || 0,
    lastSyncAt: github.state.lastSyncAt || null,
    lastError: github.state.lastError || null,
    syncing: Boolean(github.syncing),
  }
}

async function ingestGithubAsset(ctx, github, token, asset) {
  const mediaType = String(asset.content_type || '').split(';')[0].trim().toLowerCase()
  if (!MEDIA.has(mediaType)) throw new Error('不支持的队列文件类型：' + (mediaType || 'unknown'))
  const data = await githubDownload(token, asset)
  const digest = createHash('sha256').update(data).digest('hex')
  const duplicate = github.items.some((item) => item.image && item.image.attachmentId === 'sha256:' + digest)
  if (duplicate) {
    await deleteGithubAsset(token, github.state.github, asset.id)
    return
  }
  const image = await ctx.attachments.saveImage({ data, mediaType, name: asset.name })
  const item = {
    id: randomUUID(),
    createdAt: asset.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'summarizing',
    image,
    summary: null,
    error: null,
    model: null,
    source: { kind: 'github', assetId: asset.id, name: asset.name },
  }
  try { storeOriginal(item, data) } catch {}
  github.items.unshift(item)
  saveItems(github.items)
  summarize(ctx.llm, github.items, item).catch(() => {})
  await deleteGithubAsset(token, github.state.github, asset.id)
}

async function generateShortcutFile(ctx, github) {
  const repo = github.state.github
  const token = repo ? await readGithubToken(ctx, github.state) : null
  if (!repo || !token) {
    const error = new Error('GitHub 未连接')
    error.status = 409
    throw error
  }
  const template = readFileSync(join(ROOT, 'assets', 'shortcut-template.plist'), 'utf8')
  const filled = template
    .split('__AURACAP_REPO__').join(repo.owner + '/' + repo.name)
    .split('__AURACAP_TOKEN__').join(token)
  mkdirSync(dataDir(), { recursive: true })
  const id = randomUUID()
  const tmp = join(dataDir(), `shortcut-${id}-input.shortcut`)
  const out = join(dataDir(), `shortcut-${id}-signed.shortcut`)
  try {
    writeFileSync(tmp, filled)
    execFileSync('/usr/bin/shortcuts', ['sign', '--mode', 'anyone', '--input', tmp, '--output', out], { timeout: 30_000, stdio: 'pipe' })
    return readFileSync(out)
  } catch (error) {
    const failure = new Error('生成快捷指令失败：' + (error && error.message ? error.message : String(error)))
    failure.status = 502
    throw failure
  } finally {
    try { unlinkSync(tmp) } catch {}
    try { unlinkSync(out) } catch {}
  }
}

async function syncGithub(ctx, github) {
  if (github.syncing) return
  if (!github.state.github) return
  github.syncing = true
  try {
    const token = await readGithubToken(ctx, github.state)
    if (!token) throw new Error('GitHub 未连接')
    const repo = github.state.github
    const response = await githubRequest(token, `/repos/${repo.owner}/${repo.name}/releases/${repo.releaseId}/assets?per_page=100`)
    if (response.status === 401) throw new Error('GitHub token 已失效，请重新连接')
    if (response.status !== 200) throw githubFailure(response, '读取队列失败')
    const assets = Array.isArray(response.data) ? response.data : []
    const processed = new Set(github.state.processed || [])
    const pending = assets
      .filter((asset) => !processed.has(asset.id))
      .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0))
    github.state.queueCount = pending.length
    for (const asset of pending) {
      try {
        await ingestGithubAsset(ctx, github, token, asset)
        github.state.processed = (github.state.processed || []).concat(asset.id).slice(-1000)
        saveState(github.state)
      } catch (error) {
        github.state.lastError = error && error.message ? error.message : String(error)
      }
    }
    github.state.lastSyncAt = new Date().toISOString()
    if (!github.state.lastError) github.state.lastError = null
  } catch (error) {
    github.state.lastError = error && error.message ? error.message : String(error)
  } finally {
    github.syncing = false
    saveState(github.state)
  }
}

async function refreshLongInsights(ctx, github) {
  if (github.longBusy) return
  github.longBusy = true
  try {
    const anchors = previousPeriodAnchors()
    const plans = [['week', anchors.week, 2], ['month', anchors.month, 4], ['year', anchors.year, 12]]
    for (const [type, anchor, minimum] of plans) {
      const info = periodInfo(type, anchor)
      if (loadPeriodInsight(type, info.key)) continue
      if (itemsInRange(github.items, info.start, info.end).length < minimum) continue
      await generatePeriodInsight(ctx, github.items, type, anchor, false)
    }
  } catch {}
  finally {
    github.longBusy = false
  }
}

function startLongInsightLoop(ctx, github) {
  const check = () => { refreshLongInsights(ctx, github).catch(() => {}) }
  const timer = setInterval(check, 30 * 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  const startup = setTimeout(check, 45_000)
  if (typeof startup.unref === 'function') startup.unref()
  ctx.effect(() => () => {
    clearInterval(timer)
    clearTimeout(startup)
  })
}

function startGithubLoop(ctx, github) {
  if (!github.state.github) return
  const timer = setInterval(() => { syncGithub(ctx, github).catch(() => {}) }, GITHUB_POLL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  const startup = setTimeout(() => { syncGithub(ctx, github).catch(() => {}) }, 4000)
  if (typeof startup.unref === 'function') startup.unref()
  ctx.effect(() => () => {
    clearInterval(timer)
    clearTimeout(startup)
  })
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  })
  res.end(data)
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message })
}

function trusted(req) {
  const origin = req.headers.origin
  if (!origin) return true
  return origin.replace(/^https?:\/\//, '') === req.headers.host
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('图片过大（上限 30MB）')
        error.status = 413
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function headerText(value) {
  if (typeof value !== 'string' || !value) return undefined
  try { return decodeURIComponent(value) } catch { return value }
}

function asStringArray(value, max) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max)
}

function ensureCoreSection(content) {
  const text = String(content || '').trim()
  if (!text) return '### 核心内容\n（画面中没有可提取的信息）'
  if (/^\s*#{1,6}\s+/m.test(text)) return text
  return '### 核心内容\n' + text
}

function makeExcerpt(markdown) {
  return String(markdown || '')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*[-*]\s+/gm, ' ')
    .replace(/```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function balancedJsonObjects(text) {
  const objects = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, index + 1))
          start = -1
        }
      }
    }
  }
  return objects
}

function regexField(text, key) {
  const pattern = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"')
  const match = text.match(pattern)
  if (!match) return ''
  try { return JSON.parse('"' + match[1] + '"') } catch { return match[1] }
}

function regexTags(text) {
  const match = text.match(/"tags"\s*:\s*\[([^\]]*)\]/)
  if (!match) return []
  const tags = []
  for (const item of match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    try { tags.push(JSON.parse('"' + item[1] + '"')) } catch { tags.push(item[1]) }
  }
  return tags.filter((tag) => typeof tag === 'string' && tag).slice(0, 4)
}

const ENTITY_TYPES = new Set(['person', 'org', 'product', 'project', 'topic', 'place', 'other'])
const NOISE_ENTITY_KEYS = new Set(['郑博士巴顿', 'data source'])

function normalizeEntityName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 48)
}

function entityMatchKey(value) {
  return normalizeEntityName(value)
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[\s·・.．,，。()（）\-_/\\]+/g, '')
}

function canonicalEntityInfo(name, type) {
  const display = normalizeEntityName(name)
  const key = entityMatchKey(display)
  if (!key || display.startsWith('@') || NOISE_ENTITY_KEYS.has(key) || key.startsWith('datacenter')) return null
  if (/^(?:理光)?(?:gr|gr3|gr3x|gr4)$/.test(key) || /^ricohgr/.test(key)) {
    return { name: '理光 GR', type: 'product', aliases: display === '理光 GR' ? [] : [display] }
  }
  if (/奔驰|迈巴赫/.test(display)) {
    return { name: '奔驰', type: 'product', aliases: display === '奔驰' ? [] : [display] }
  }
  return { name: display, type: ENTITY_TYPES.has(type) ? type : 'other', aliases: [] }
}

function entityId(type, name) {
  const info = canonicalEntityInfo(name, type)
  const key = info ? info.name : normalizeEntityName(name)
  return 'ent_' + createHash('sha256').update(entityMatchKey(key)).digest('hex').slice(0, 16)
}

export function normalizeEntities(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const entry of value) {
    const raw = typeof entry === 'string' ? { name: entry, type: 'other' } : (entry && typeof entry === 'object' ? entry : null)
    if (!raw) continue
    const info = canonicalEntityInfo(raw.name, raw.type)
    if (!info) continue
    const key = entityMatchKey(info.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const aliases = []
    for (const alias of [info.name, ...(info.aliases || []), ...(Array.isArray(raw.aliases) ? raw.aliases : [])]) {
      const normalized = normalizeEntityName(alias)
      if (!normalized || entityMatchKey(normalized) === key) continue
      if (!aliases.some((value) => entityMatchKey(value) === entityMatchKey(normalized))) aliases.push(normalized)
    }
    result.push({ name: info.name, type: info.type, aliases: aliases.slice(0, 4) })
    if (result.length >= 6) break
  }
  return result
}

export function parseSummary(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()

  const merged = {}
  for (const raw of balancedJsonObjects(cleaned)) {
    try { Object.assign(merged, JSON.parse(raw)) } catch {}
  }

  let content = typeof merged.content === 'string' ? merged.content.trim() : ''
  let title = typeof merged.title === 'string' ? merged.title.trim() : ''
  let tags = asStringArray(merged.tags, 4)
  let entities = normalizeEntities(merged.entities)
  let contentType = typeof merged.contentType === 'string' ? merged.contentType : 'other'
  let language = typeof merged.language === 'string' ? merged.language : 'zh'

  if (!content) {
    content = regexField(cleaned, 'content').trim()
    title = title || regexField(cleaned, 'title').trim()
    tags = tags.length ? tags : regexTags(cleaned)
  }

  if (content) {
    const normalized = ensureCoreSection(content)
    return {
      title: title || makeExcerpt(normalized).slice(0, 24),
      content: normalized,
      excerpt: makeExcerpt(normalized),
      tags,
      entities,
      contentType,
      language,
    }
  }

  const summary = typeof merged.summary === 'string' ? merged.summary.trim() : ''
  if (summary) {
    if (/^\s*#{1,6}\s/m.test(summary)) {
      return { title: title || makeExcerpt(summary).slice(0, 24), content: ensureCoreSection(summary), excerpt: makeExcerpt(summary), tags, entities, contentType, language }
    }
    return {
      title: title || summary.split(/[。.!?\n]/)[0].slice(0, 24),
      summary,
      keyPoints: asStringArray(merged.keyPoints, 8),
      todos: asStringArray(merged.todos, 8),
      tags,
      entities,
      contentType,
      language,
    }
  }

  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  const fallbackContent = ensureCoreSection(cleaned || lines[0] || '未命名碎片')
  return {
    title: (lines[0] || '未命名碎片').replace(/^#+\s*/, '').slice(0, 24),
    content: fallbackContent,
    excerpt: makeExcerpt(fallbackContent),
    tags: [],
    entities: [],
    contentType: 'other',
    language: 'zh',
  }
}

const memoryDir = () => join(dataDir(), 'memory')
const memoryIndexFile = () => join(memoryDir(), 'entities.json')
const memoryProfileFile = () => join(memoryDir(), 'profile.json')
let memoryIndex = { version: 1, entities: {}, aliases: {} }
let memoryBackfill = null

function saveMemoryIndex(index) {
  mkdirSync(memoryDir(), { recursive: true })
  const file = memoryIndexFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(index, null, 2))
  renameSync(tmp, file)
}

export function buildMemoryIndex(items) {
  const index = { version: 1, entities: {}, aliases: {} }
  let changed = false
  for (const item of items) {
    const current = item && item.summary && Array.isArray(item.summary.entities) ? item.summary.entities : []
    if (!current.length) continue
    const normalized = normalizeEntities(current)
    if (JSON.stringify(normalized) !== JSON.stringify(current)) {
      item.summary.entities = normalized
      changed = true
    }
    for (const entity of normalized) {
      const name = normalizeEntityName(entity.name)
      const id = entityId(entity.type, name)
      if (!index.entities[id]) {
        index.entities[id] = { id, name, type: entity.type, aliases: entity.aliases.slice(0, 4), itemIds: [], firstSeen: item.createdAt, lastSeen: item.createdAt }
      }
      const entry = index.entities[id]
      if (!entry.itemIds.includes(item.id)) entry.itemIds.push(item.id)
      if (String(item.createdAt) < String(entry.firstSeen)) entry.firstSeen = item.createdAt
      if (String(item.createdAt) > String(entry.lastSeen)) entry.lastSeen = item.createdAt
      for (const alias of [name, ...entity.aliases]) {
        const normalizedAlias = normalizeEntityName(alias)
        if (normalizedAlias && entityMatchKey(normalizedAlias) !== entityMatchKey(name) && !entry.aliases.some((value) => entityMatchKey(value) === entityMatchKey(normalizedAlias))) entry.aliases.push(normalizedAlias)
      }
    }
  }

  const nameOwner = new Map()
  for (const entry of Object.values(index.entities)) nameOwner.set(entityMatchKey(entry.name), entry.id)
  const parent = new Map(Object.keys(index.entities).map((id) => [id, id]))
  const find = (id) => {
    let current = id
    while (parent.get(current) !== current) current = parent.get(current)
    while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, current); id = next }
    return current
  }
  const union = (left, right) => {
    const a = find(left)
    const b = find(right)
    if (a === b) return
    const aa = index.entities[a]
    const bb = index.entities[b]
    const root = (aa.itemIds.length >= bb.itemIds.length ? a : b)
    const child = root === a ? b : a
    parent.set(child, root)
  }
  for (const entry of Object.values(index.entities)) {
    for (const alias of [entry.name, ...entry.aliases]) {
      const owner = nameOwner.get(entityMatchKey(alias))
      if (owner && owner !== entry.id) union(entry.id, owner)
    }
  }
  const merged = {}
  for (const entry of Object.values(index.entities)) {
    const root = find(entry.id)
    if (!merged[root]) merged[root] = { ...entry, itemIds: [], aliases: [] }
    const target = merged[root]
    for (const itemId of entry.itemIds) if (!target.itemIds.includes(itemId)) target.itemIds.push(itemId)
    for (const alias of [entry.name, ...entry.aliases]) {
      if (entityMatchKey(alias) !== entityMatchKey(target.name) && !target.aliases.some((value) => entityMatchKey(value) === entityMatchKey(alias))) target.aliases.push(alias)
    }
    if (String(entry.firstSeen) < String(target.firstSeen)) target.firstSeen = entry.firstSeen
    if (String(entry.lastSeen) > String(target.lastSeen)) target.lastSeen = entry.lastSeen
  }
  index.entities = merged
  index.aliases = {}
  for (const entry of Object.values(index.entities)) {
    for (const alias of [entry.name, ...entry.aliases]) {
      const key = entityMatchKey(alias)
      if (key && !index.aliases[key]) index.aliases[key] = entry.id
    }
  }
  memoryIndex = index
  if (changed) { try { saveItems(items) } catch {} }
  try { saveMemoryIndex(index) } catch {}
  return index
}

function loadMemoryIndex() {
  try {
    const parsed = JSON.parse(readFileSync(memoryIndexFile(), 'utf8'))
    if (parsed && parsed.entities) memoryIndex = parsed
  } catch {}
  return memoryIndex
}

function shareEntityIds(item) {
  const entities = item && item.summary && Array.isArray(item.summary.entities) ? item.summary.entities : []
  return new Set(entities.map((entity) => memoryIndex.aliases[entityMatchKey(entity.name)] || entityId(entity.type, entity.name)))
}

function relatedItems(items, itemId, limit = 5) {
  const target = items.find((item) => item.id === itemId)
  if (!target) return []
  const targetEntities = shareEntityIds(target)
  if (!targetEntities.size) return []
  const candidates = []
  for (const item of items) {
    if (!item || item.id === itemId || item.status !== 'ready') continue
    const shared = [...shareEntityIds(item)].filter((id) => targetEntities.has(id))
    if (!shared.length) continue
    let score = 0
    const reasons = []
    for (const id of shared) {
      const entity = memoryIndex.entities[id]
      if (!entity) continue
      if (entity.type === 'person' || entity.type === 'project') score += 3
      else if (entity.type === 'product' || entity.type === 'org') score += 2
      else score += 1
      if (reasons.length < 2) reasons.push((entity.type === 'person' ? '同一个人：' : entity.type === 'project' ? '同属' : '都提到') + entity.name)
    }
    const ageDays = Math.abs(Date.now() - Date.parse(item.createdAt)) / 86400000
    score += Math.max(0, 2 - ageDays / 45)
    candidates.push({ item, reason: reasons.join(' · '), score })
  }
  return candidates.sort((left, right) => right.score - left.score).slice(0, limit)
}

function allInsightFiles() {
  const files = []
  try {
    for (const name of readdirSync(join(dataDir(), 'digests'))) {
      if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) files.push({ type: 'day', file: join(dataDir(), 'digests', name) })
    }
  } catch {}
  for (const type of ['week', 'month', 'year']) {
    try {
      for (const name of readdirSync(join(dataDir(), 'insights', type))) {
        if (name.endsWith('.json')) files.push({ type, file: join(dataDir(), 'insights', type, name) })
      }
    } catch {}
  }
  return files
}

function entityDetail(id, items) {
  let entity = memoryIndex.entities[id]
  if (!entity) {
    const mapped = memoryIndex.aliases[entityMatchKey(id)]
    if (mapped) entity = memoryIndex.entities[mapped]
  }
  if (!entity) return null
  const entityItems = entity.itemIds.map((itemId) => items.find((item) => item.id === itemId)).filter(Boolean)
  const ids = new Set(entity.itemIds)
  const insights = []
  for (const meta of allInsightFiles()) {
    try {
      const parsed = JSON.parse(readFileSync(meta.file, 'utf8'))
      const sourceIds = Array.isArray(parsed.itemIds) ? parsed.itemIds : (Array.isArray(parsed.sourceItemIds) ? parsed.sourceItemIds : [])
      if (!sourceIds.some((itemId) => ids.has(itemId))) continue
      insights.push({
        type: meta.type,
        key: parsed.key || (meta.type === 'day' ? meta.file.split('/').pop().replace(/\.json$/, '') : ''),
        start: parsed.start || parsed.date || '',
        end: parsed.end || parsed.date || '',
        title: parsed.title || '',
        excerpt: String(parsed.content || '').replace(/^#{1,6}\s+.*$/gm, ' ').replace(/\s+/g, ' ').slice(0, 120),
        createdAt: parsed.createdAt || '',
      })
    } catch {}
  }
  insights.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  return { entity, items: entityItems, insights: insights.slice(0, 6) }
}

function searchEntitiesFor(query) {
  const term = String(query || '').toLowerCase()
  if (!term) return []
  return Object.values(memoryIndex.entities || {})
    .filter((entity) => entity.name.toLowerCase().includes(term) || (entity.aliases || []).some((alias) => alias.toLowerCase().includes(term)))
    .sort((left, right) => right.itemIds.length - left.itemIds.length)
    .slice(0, 6)
    .map((entity) => ({ kind: 'entity', id: entity.id, name: entity.name, type: entity.type, count: entity.itemIds.length }))
}

function loadMemoryProfile() {
  try { return JSON.parse(readFileSync(memoryProfileFile(), 'utf8')) } catch { return { version: 1, activeProjects: [], currentQuestions: [], constraints: [] } }
}

const usageFile = () => join(memoryDir(), 'usage.json')

function loadUsage() {
  try { return JSON.parse(readFileSync(usageFile(), 'utf8')) } catch { return { version: 1, days: {} } }
}

function saveUsage(data) {
  mkdirSync(memoryDir(), { recursive: true })
  const file = usageFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

function usageTotal(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const explicit = Number(usage.totalTokens)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0)
}

function recordUsage(kind, usage, model = MODEL.model) {
  const total = usageTotal(usage)
  if (!total) return
  const data = loadUsage()
  if (!data.days || typeof data.days !== 'object') data.days = {}
  const dayKey = todayKey()
  const day = data.days[dayKey] || { total: 0, calls: 0, models: {}, kinds: {} }
  day.total += total
  day.calls += 1
  day.models[model] = (day.models[model] || 0) + total
  day.kinds[kind] = (day.kinds[kind] || 0) + total
  data.days[dayKey] = day
  const keepFrom = addDays(todayKey(), -120)
  for (const key of Object.keys(data.days)) if (key < keepFrom) delete data.days[key]
  try { saveUsage(data) } catch {}
}

function usageSummary() {
  const data = loadUsage()
  const days = data.days || {}
  const today = todayKey()
  const weekStart = addDays(today, -6)
  const result = { today: 0, week: 0, total: 0, calls: 0, models: {}, kinds: {} }
  for (const [key, day] of Object.entries(days)) {
    const total = Number(day.total) || 0
    result.total += total
    result.calls += Number(day.calls) || 0
    if (key === today) result.today += total
    if (key >= weekStart && key <= today) result.week += total
    for (const [model, value] of Object.entries(day.models || {})) result.models[model] = (result.models[model] || 0) + Number(value || 0)
    for (const [kind, value] of Object.entries(day.kinds || {})) result.kinds[kind] = (result.kinds[kind] || 0) + Number(value || 0)
  }
  return result
}

function saveMemoryProfile(profile) {
  mkdirSync(memoryDir(), { recursive: true })
  const value = {
    version: 1,
    activeProjects: Array.isArray(profile.activeProjects) ? profile.activeProjects.slice(0, 3) : [],
    currentQuestions: Array.isArray(profile.currentQuestions) ? profile.currentQuestions.slice(0, 5) : [],
    constraints: Array.isArray(profile.constraints) ? profile.constraints.slice(0, 8) : [],
  }
  const file = memoryProfileFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
  return value
}

async function summarize(llm, items, item) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const captured = new Date(item.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const document = item.kind === 'document' || typeof item.text === 'string'
    const content = document
      ? [{ type: 'text', text: '文件：' + ((item.document && item.document.name) || '未命名') + '\n类型：' + ((item.document && item.document.mediaType) || 'text/plain') + '\n时间：' + captured + '\n\n' + String(item.text || '').slice(0, 18000) + '\n\n请按系统提示只输出 JSON。' }]
      : [
          { type: 'image', attachment: item.image },
          { type: 'text', text: '截图时间：' + captured + '。请阅读这张截图，按系统提示只输出 JSON。' },
        ]
    const stream = llm.stream({
      provider: MODEL.provider,
      model: MODEL.model,
      reasoningEffort: 'off',
      maxTokens: document ? 2200 : 2000,
      system: readPrompt(document ? 'text-zh.md' : 'screenshot-zh.md'),
      messages: [{ role: 'user', content }],
      signal: controller.signal,
    })
    let text = ''
    let usage = null
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'usage') {
        usage = chunk.usage
      } else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') {
          throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
        }
        if (chunk.reason && chunk.reason.kind === 'aborted') {
          throw new Error('生成已取消')
        }
      }
    }
    recordUsage(document ? 'document' : 'screenshot', usage)
    item.summary = parseSummary(text)
    item.memoryVersion = 1
    item.status = 'ready'
    item.error = null
    item.model = MODEL.model
  } catch (error) {
    item.status = 'failed'
    item.error = error && error.message ? error.message : String(error)
  } finally {
    clearTimeout(timer)
    item.updatedAt = new Date().toISOString()
    saveItems(items)
    try { buildMemoryIndex(items) } catch {}
  }
}

async function collectStreamText(stream) {
  let text = ''
  let usage = null
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') {
      if (chunk.reason && chunk.reason.kind === 'error') throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
      if (chunk.reason && chunk.reason.kind === 'aborted') throw new Error('生成已取消')
    }
  }
  return { text, usage }
}

async function extractEntitiesForItem(ctx, item) {
  const summary = item.summary || {}
  const prompt = readPrompt('entities-zh.md')
  if (!prompt) throw new Error('实体抽取提示词缺失')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const result = await collectStreamText(ctx.llm.stream({
      provider: MODEL.provider,
      model: MODEL.model,
      reasoningEffort: 'off',
      maxTokens: 700,
      system: prompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: '标题：' + (summary.title || '') + '\n\n' + plainTextOfSummary(summary).slice(0, 5000) }] }],
      signal: controller.signal,
    }))
    recordUsage('entity-backfill', result.usage)
    const text = result.text
    for (const raw of balancedJsonObjects(text)) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.entities)) return normalizeEntities(parsed.entities)
      } catch {}
    }
    return []
  } finally {
    clearTimeout(timer)
  }
}

function memoryStatus(items) {
  const total = items.filter((item) => item.summary).length
  const indexed = items.filter((item) => item.summary && item.memoryVersion && Array.isArray(item.summary.entities)).length
  return { total, indexed, entities: Object.keys(memoryIndex.entities || {}).length, backfill: memoryBackfill }
}

async function runMemoryBackfill(ctx, items) {
  if (memoryBackfill && memoryBackfill.running) return memoryBackfill
  const pending = items.filter((item) => item.summary && (!item.memoryVersion || !Array.isArray(item.summary.entities)))
  memoryBackfill = { running: true, total: pending.length, done: 0, pending: pending.length, error: null }
  for (const item of pending) {
    try {
      const entities = await extractEntitiesForItem(ctx, item)
      item.summary.entities = entities
      item.memoryVersion = 1
      item.updatedAt = new Date().toISOString()
      saveItems(items)
      buildMemoryIndex(items)
    } catch (error) {
      memoryBackfill.error = error && error.message ? error.message : String(error)
    }
    memoryBackfill.done += 1
    memoryBackfill.pending = Math.max(0, pending.length - memoryBackfill.done)
  }
  memoryBackfill.running = false
  buildMemoryIndex(items)
  return memoryBackfill
}

export function apply(ctx) {
  const items = loadItems()
  loadMemoryIndex()
  try { buildMemoryIndex(items) } catch {}
  const github = { items, state: loadState(), flows: new Map(), syncing: false, digestBusy: false, longBusy: false }
  startGithubLoop(ctx, github)
  startDigestLoop(ctx, github)
  startLongInsightLoop(ctx, github)

  const ingest = async (req, res) => {
    if (!trusted(req)) return sendError(res, 403, 'forbidden')
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (!MEDIA.has(type)) return sendError(res, 415, '仅支持 PNG / JPEG / WebP / GIF')
    let data
    try {
      data = await readBody(req, MAX_BYTES)
    } catch (error) {
      return sendError(res, error.status || 400, error.message)
    }
    if (!data.length) return sendError(res, 400, '空文件')

    let image
    try {
      image = await ctx.attachments.saveImage({ data, mediaType: type, name: headerText(req.headers['x-auracap-name']) })
    } catch (error) {
      return sendError(res, 422, error && error.message ? error.message : '图片无法读取')
    }

    const item = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'summarizing',
      image,
      summary: null,
      error: null,
      model: null,
    }
    try { storeOriginal(item, data) } catch {}
    items.unshift(item)
    saveItems(items)
    sendJson(res, 202, { item })
    summarize(ctx.llm, items, item).catch((error) => {
      item.status = 'failed'
      item.error = error && error.message ? error.message : String(error)
      saveItems(items)
    })
  }

  const serveMedia = async (req, res, id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item) return sendError(res, 404, 'not found')
    const original = item.imageFile ? join(dataDir(), item.imageFile) : null
    try {
      const data = original && existsSync(original)
        ? readFileSync(original)
        : Buffer.from((await ctx.attachments.readImage(item.image)).data)
      res.writeHead(200, {
        'content-type': item.image.mediaType,
        'content-length': data.length,
        'cache-control': 'private, max-age=31536000, immutable',
      })
      res.end(data)
    } catch (error) {
      sendError(res, 410, error && error.message ? error.message : 'image unavailable')
    }
  }

  const retry = (req, res, id) => {
    const item = items.find((entry) => entry.id === id)
    if (!item) return sendError(res, 404, 'not found')
    item.status = 'summarizing'
    item.error = null
    saveItems(items)
    sendJson(res, 202, { item })
    summarize(ctx.llm, items, item).catch(() => {})
  }

  const remove = (req, res, id) => {
    const index = items.findIndex((entry) => entry.id === id)
    if (index < 0) return sendError(res, 404, 'not found')
    const [removed] = items.splice(index, 1)
    if (removed && removed.imageFile) {
      try { unlinkSync(join(dataDir(), removed.imageFile)) } catch {}
    }
    saveItems(items)
    sendJson(res, 200, { ok: true })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      const url = new URL(req.url || '/', 'http://localhost')
      const path = url.pathname
      try {
        if (path === `${BASE}/api/insights/status`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return sendJson(res, 200, {
            day: latestInsightStatus('day'),
            week: latestInsightStatus('week'),
            month: latestInsightStatus('month'),
            year: latestInsightStatus('year'),
          })
        }
        if (path === `${BASE}/api/insights`) {
          const type = String(url.searchParams.get('type') || 'week')
          const anchor = url.searchParams.get('anchor') || todayKey()
          if (!['week', 'month', 'year'].includes(type)) return sendError(res, 400, '周期类型应为 week / month / year')
          if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return sendError(res, 400, '日期格式应为 YYYY-MM-DD')
          let info
          try { info = periodInfo(type, anchor) } catch (error) { return sendError(res, error.status || 400, error.message) }
          if (req.method === 'GET') {
            return sendJson(res, 200, { type, key: info.key, start: info.start, end: info.end, insight: loadPeriodInsight(type, info.key) })
          }
          if (req.method === 'POST') {
            if (!trusted(req)) return sendError(res, 403, 'forbidden')
            let body = {}
            try { body = await readJsonBody(req, 64 * 1024) } catch { return sendError(res, 400, '请求体不是合法 JSON') }
            try {
              const targetType = body.type || type
              const targetAnchor = body.anchor || anchor
              if (!['week', 'month', 'year'].includes(targetType)) return sendError(res, 400, '周期类型应为 week / month / year')
              const insight = await generatePeriodInsight(ctx, items, targetType, targetAnchor, Boolean(body.force))
              const targetInfo = periodInfo(targetType, targetAnchor)
              return sendJson(res, 200, { type: targetType, key: targetInfo.key, start: targetInfo.start, end: targetInfo.end, insight })
            } catch (error) {
              return sendError(res, error.status || 500, error.message || '生成失败')
            }
          }
          return sendError(res, 405, 'method not allowed')
        }
        if (path === `${BASE}/api/digest`) {
          if (req.method === 'GET') {
            const date = url.searchParams.get('date') || todayKey()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, 400, '日期格式应为 YYYY-MM-DD')
            return sendJson(res, 200, { date, digest: loadDigest(date) })
          }
          if (req.method === 'POST') {
            if (!trusted(req)) return sendError(res, 403, 'forbidden')
            let body = {}
            try {
              body = await readJsonBody(req, 64 * 1024)
            } catch {
              return sendError(res, 400, '请求体不是合法 JSON')
            }
            const date = body.date || todayKey()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, 400, '日期格式应为 YYYY-MM-DD')
            try {
              const digest = await generateDigest(ctx.llm, items, date)
              return sendJson(res, 200, { date, digest })
            } catch (error) {
              return sendError(res, error.status || 500, error.message || '生成失败')
            }
          }
          return sendError(res, 405, 'method not allowed')
        }
        if (path === `${BASE}/api/github/status`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return sendJson(res, 200, githubStatus(github))
        }
        if (path === `${BASE}/api/github/device`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          try {
            return sendJson(res, 200, await startGithubDevice(ctx, github))
          } catch (error) {
            return sendError(res, 502, error && error.message ? error.message : '无法开始 GitHub 授权')
          }
        }
        const deviceMatch = path.match(/^\/auracap\/api\/github\/device\/([^/]+)$/)
        if (deviceMatch) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const flow = github.flows.get(decodeURIComponent(deviceMatch[1]))
          if (!flow) return sendError(res, 404, '授权会话不存在或已过期')
          return sendJson(res, 200, {
            status: flow.status,
            error: flow.error,
            userCode: flow.userCode,
            verificationUri: flow.verificationUri,
            repo: github.state.github ? { owner: github.state.github.owner, name: github.state.github.name } : null,
          })
        }
        if (path === `${BASE}/api/github/sync`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          await syncGithub(ctx, github)
          return sendJson(res, 200, githubStatus(github))
        }
        if (path === `${BASE}/api/github/repair`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          try {
            await provisionGithub(ctx, github)
            await syncGithub(ctx, github)
            return sendJson(res, 200, githubStatus(github))
          } catch (error) {
            return sendError(res, 502, error && error.message ? error.message : '修复失败')
          }
        }
        if (path === `${BASE}/api/github/disconnect`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          await clearGithubToken(ctx, github.state)
          github.state.github = null
          github.state.queueCount = 0
          github.state.lastError = null
          saveState(github.state)
          return sendJson(res, 200, githubStatus(github))
        }
        if (path === `${BASE}/api/github/shortcut-file`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          try {
            const file = await generateShortcutFile(ctx, github)
            res.writeHead(200, {
              'content-type': 'application/octet-stream',
              'content-disposition': 'attachment; filename="AuraCap-mobile.shortcut"',
              'content-length': file.length,
              'cache-control': 'no-store',
            })
            return res.end(file)
          } catch (error) {
            return sendError(res, error.status || 502, error && error.message ? error.message : '生成快捷指令失败')
          }
        }
        if (path === `${BASE}/api/github/test-upload`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          const repo = github.state.github
          const token = repo ? await readGithubToken(ctx, github.state) : null
          if (!repo || !token) return sendError(res, 409, 'GitHub 未连接')
          try {
            const file = readFileSync(join(ROOT, 'assets', 'test-upload.png'))
            const name = 'auracap-test-' + Date.now() + '.png'
            const upload = await fetch(
              'https://uploads.github.com/repos/' + repo.owner + '/' + repo.name + '/releases/' + repo.releaseId + '/assets?name=' + encodeURIComponent(name),
              {
                method: 'POST',
                headers: {
                  accept: 'application/vnd.github+json',
                  authorization: 'Bearer ' + token,
                  'content-type': 'image/png',
                  'user-agent': 'dsh-auracap',
                },
                body: file,
              },
            )
            if (!upload.ok) {
              const detail = await upload.text().catch(() => '')
              throw new Error('测试图上传失败（HTTP ' + upload.status + '）' + (detail ? '：' + detail.slice(0, 160) : ''))
            }
            await delay(1500)
            await syncGithub(ctx, github)
            return sendJson(res, 200, { uploaded: true, name, status: githubStatus(github) })
          } catch (error) {
            return sendError(res, 502, error && error.message ? error.message : '测试图上传失败')
          }
        }
        if (path === `${BASE}/api/github/shortcut`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const repo = github.state.github
          const token = repo ? await readGithubToken(ctx, github.state) : null
          if (!repo || !token) return sendError(res, 409, 'GitHub 未连接')
          return sendJson(res, 200, {
            config: 'gh|' + repo.owner + '/' + repo.name + '|' + token,
            repo: repo.owner + '/' + repo.name,
            release: repo.releaseId,
          })
        }
        if (path === `${BASE}/api/usage`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return sendJson(res, 200, usageSummary())
        }
        if (path === `${BASE}/api/memory/status`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return sendJson(res, 200, memoryStatus(items))
        }
        if (path === `${BASE}/api/memory/backfill`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          if (!memoryBackfill || !memoryBackfill.running) runMemoryBackfill(ctx, items).catch(() => {})
          return sendJson(res, 202, memoryStatus(items))
        }
        if (path === `${BASE}/api/memory/entities`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const query = String(url.searchParams.get('q') || '').toLowerCase()
          const list = Object.values(memoryIndex.entities || {})
            .filter((entity) => !query || entity.name.toLowerCase().includes(query) || (entity.aliases || []).some((alias) => alias.toLowerCase().includes(query)))
            .sort((left, right) => right.itemIds.length - left.itemIds.length)
            .slice(0, 30)
          return sendJson(res, 200, { entities: list })
        }
        const entityMatch = path.match(/^\/auracap\/api\/memory\/entities\/([^/]+)$/)
        if (entityMatch) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const detail = entityDetail(decodeURIComponent(entityMatch[1]), items)
          if (!detail) return sendError(res, 404, '实体不存在')
          return sendJson(res, 200, detail)
        }
        if (path === `${BASE}/api/memory/related`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const itemId = String(url.searchParams.get('itemId') || '')
          const related = relatedItems(items, itemId).map(({ item, reason }) => ({ item, reason }))
          return sendJson(res, 200, { related })
        }
        if (path === `${BASE}/api/memory/profile`) {
          if (req.method === 'GET') return sendJson(res, 200, loadMemoryProfile())
          if (req.method === 'PUT') {
            if (!trusted(req)) return sendError(res, 403, 'forbidden')
            try {
              const body = await readJsonBody(req, 64 * 1024)
              return sendJson(res, 200, saveMemoryProfile(body || {}))
            } catch (error) {
              return sendError(res, 400, error && error.message ? error.message : '请求体不是合法 JSON')
            }
          }
          return sendError(res, 405, 'method not allowed')
        }
        if (path === `${BASE}/api/search`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          const query = String(url.searchParams.get('q') || '').trim().slice(0, 100)
          if (!query) return sendJson(res, 200, { query, results: [] })
          return sendJson(res, 200, { query, results: searchEntitiesFor(query).concat(searchItemsFor(items, query), searchInsightsFor(query)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 12) })
        }
        if (path === `${BASE}/api/items`) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return sendJson(res, 200, { items })
        }
        if (path.startsWith(`${BASE}/api/media/`)) {
          if (req.method !== 'GET') return sendError(res, 405, 'method not allowed')
          return serveMedia(req, res, decodeURIComponent(path.slice(`${BASE}/api/media/`.length)))
        }
        if (path === `${BASE}/api/ingest`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          return ingest(req, res)
        }
        if (path === `${BASE}/api/import`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
          const name = headerText(req.headers['x-auracap-name']) || '未命名文件'
          let data
          try { data = await readBody(req, MAX_IMPORT_BYTES) } catch (error) { return sendError(res, error.status || 400, error.message) }
          if (!data.length) return sendError(res, 400, '空文件')
          try {
            const imageType = MEDIA.has(type) ? type : imageTypeFromName(name)
            if (imageType) {
              const item = await addImageItem(ctx, items, data, imageType, name, { kind: 'local', name })
              return sendJson(res, 202, { item })
            }
            if (type === 'application/pdf' || String(name).toLowerCase().endsWith('.pdf')) {
              const text = await extractPdfText(data)
              const item = addDocumentItem(ctx, items, { data, mediaType: 'application/pdf', name, text })
              return sendJson(res, 202, { item })
            }
            if (type.startsWith('text/') || String(name).toLowerCase().endsWith('.txt') || String(name).toLowerCase().endsWith('.md')) {
              const text = data.toString('utf8').replace(/^\uFEFF/, '')
              const item = addDocumentItem(ctx, items, { data, mediaType: type || 'text/plain', name, text })
              return sendJson(res, 202, { item })
            }
            return sendError(res, 415, '仅支持图片、PDF、TXT、Markdown')
          } catch (error) {
            return sendError(res, error.status || 422, error && error.message ? error.message : '导入失败')
          }
        }
        if (path === `${BASE}/api/capture-screen`) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          try {
            const result = await startSystemCapture(ctx, items)
            if (!result.watching) return sendError(res, 409, result.error || '无法开始系统截图')
            return sendJson(res, 202, { watching: true })
          } catch (error) {
            return sendError(res, 422, error && error.message ? error.message : '无法开始系统截图')
          }
        }
        const action = path.match(/^\/auracap\/api\/items\/([^/]+)\/(retry|delete)$/)
        if (action) {
          if (req.method !== 'POST') return sendError(res, 405, 'method not allowed')
          if (!trusted(req)) return sendError(res, 403, 'forbidden')
          const id = decodeURIComponent(action[1])
          return action[2] === 'retry' ? retry(req, res, id) : remove(req, res, id)
        }
        return sendError(res, 404, 'not found')
      } catch (error) {
        return sendError(res, 500, error && error.message ? error.message : 'internal error')
      }
    },
  }))

  void migrateMedia(ctx, items)
}
