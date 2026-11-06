import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
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
      contentType,
      language,
    }
  }

  const summary = typeof merged.summary === 'string' ? merged.summary.trim() : ''
  if (summary) {
    if (/^\s*#{1,6}\s/m.test(summary)) {
      return { title: title || makeExcerpt(summary).slice(0, 24), content: ensureCoreSection(summary), excerpt: makeExcerpt(summary), tags, contentType, language }
    }
    return {
      title: title || summary.split(/[。.!?\n]/)[0].slice(0, 24),
      summary,
      keyPoints: asStringArray(merged.keyPoints, 8),
      todos: asStringArray(merged.todos, 8),
      tags,
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
  const github = { items, state: loadState(), flows: new Map(), syncing: false, digestBusy: false }
  startGithubLoop(ctx, github)
  startDigestLoop(ctx, github)

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
