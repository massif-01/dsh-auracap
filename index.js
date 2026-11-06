import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

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
const MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MODEL = { provider: 'deepseek-account', model: 'deepseek-flash' }

const dataDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'auracap')
const itemsFile = () => join(dataDir(), 'items.json')
const mediaDir = () => join(dataDir(), 'media')

function extensionOf(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

function storeOriginal(item, data) {
  mkdirSync(mediaDir(), { recursive: true })
  const relative = join('media', `${item.id}.${extensionOf(item.image.mediaType)}`)
  writeFileSync(join(dataDir(), relative), data)
  item.imageFile = relative
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

function parseDigest(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        return { title: typeof parsed.title === 'string' ? parsed.title.trim() : '', content: parsed.content.trim() }
      }
    } catch {}
  }
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
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
        if (chunk.reason && chunk.reason.kind === 'aborted') throw new Error('生成已取消')
      }
    }
    const parsed = parseDigest(text)
    let content = parsed.content
    if (content && !/^\s*#{1,6}\s+/m.test(content)) content = '### 今日焦点\n' + content
    const digest = {
      date,
      title: parsed.title || `${date} 洞察`,
      content,
      itemCount: ready.length,
      createdAt: new Date().toISOString(),
      model: MODEL.model,
    }
    saveDigest(digest)
    return digest
  } finally {
    clearTimeout(timer)
  }
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

function parseSummary(text) {
  const cleaned = String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const tags = asStringArray(parsed.tags, 4)
      const contentType = typeof parsed.contentType === 'string' ? parsed.contentType : 'other'
      const language = typeof parsed.language === 'string' ? parsed.language : 'zh'
      if (content) {
        const normalized = ensureCoreSection(content)
        return {
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : makeExcerpt(normalized).slice(0, 24),
          content: normalized,
          excerpt: makeExcerpt(normalized),
          tags,
          contentType,
          language,
        }
      }
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
      if (title || summary) {
        if (/^\s*#{1,6}\s/m.test(summary)) {
          return { title: title || makeExcerpt(summary).slice(0, 24), content: summary, excerpt: makeExcerpt(summary), tags, contentType, language }
        }
        return {
          title: title || summary.split(/[。.!?\n]/)[0].slice(0, 24),
          summary: summary || title,
          keyPoints: asStringArray(parsed.keyPoints, 8),
          todos: asStringArray(parsed.todos, 8),
          tags,
          contentType,
          language,
        }
      }
    } catch {
      // fall through to plain text
    }
  }
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  const content = ensureCoreSection(cleaned || lines[0] || '未命名碎片')
  return {
    title: (lines[0] || '未命名碎片').replace(/^#+\s*/, '').slice(0, 24),
    content,
    excerpt: makeExcerpt(content),
    tags: [],
    contentType: 'other',
    language: 'zh',
  }
}

async function summarize(llm, items, item) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const captured = new Date(item.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const stream = llm.stream({
      provider: MODEL.provider,
      model: MODEL.model,
      reasoningEffort: 'off',
      maxTokens: 2000,
      system: readPrompt('screenshot-zh.md'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', attachment: item.image },
            { type: 'text', text: '截图时间：' + captured + '。请阅读这张截图，按系统提示只输出 JSON。' },
          ],
        },
      ],
      signal: controller.signal,
    })
    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') {
          throw new Error(chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : '模型调用失败')
        }
        if (chunk.reason && chunk.reason.kind === 'aborted') {
          throw new Error('生成已取消')
        }
      }
    }
    item.summary = parseSummary(text)
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
  }
}

export function apply(ctx) {
  const items = loadItems()

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
