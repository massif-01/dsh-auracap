import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform, Writable } from 'node:stream'
import yazl from 'yazl'
import yauzl from 'yauzl'
import parser from 'stream-json'
import ignore from 'stream-json/filters/ignore.js'
import streamValues from 'stream-json/streamers/stream-values.js'
import { backupError, insightKey } from './runtime.js'

export const LIMITS = Object.freeze({ archive: 2 * 1024 ** 3, expanded: 2 * 1024 ** 3, entries: 50_000, text: 64 * 1024 ** 2, image: 40 * 1024 ** 2 })
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const ITEM_FIELDS = new Set(['id', 'kind', 'createdAt', 'updatedAt', 'status', 'text', 'document', 'summary', 'error', 'model', 'contentLanguage', 'memoryVersion', 'source', 'image', 'imageFile', 'imageFileMediaType'])
const contentPath = path => /^(items|groups|manifest)\.json$/.test(path) || path === 'memory/profile.json' || /^digests\/\d{4}-\d{2}-\d{2}\.json$/.test(path) || /^insights\/(week|month|year)\/[\dW-]+\.json$/.test(path) || /^media\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.(png|jpg|gif|webp)$/.test(path)

export function byteLimit(max, signal, progress = () => {}) {
  let bytes = 0
  return new Transform({ transform(chunk, encoding, next) {
    bytes += chunk.length
    if (signal?.aborted) return next(signal.reason)
    if (bytes > max) return next(backupError('LIMIT_EXCEEDED', '文件超过当前备份容量上限'))
    progress(bytes)
    next(null, chunk)
  } })
}

export async function fileHash(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function jsonFile(file, missing) {
  let data
  try {
    if ((await stat(file)).size > LIMITS.text) throw backupError('LIMIT_EXCEEDED', '内容文件超过 64 MiB：' + file)
    data = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT' && missing !== undefined) return structuredClone(missing)
    if (error.code === 'LIMIT_EXCEEDED') throw error
    throw backupError('SOURCE_UNREADABLE', '无法读取内容文件：' + file)
  }
  try { return JSON.parse(data) } catch { throw backupError('SOURCE_UNREADABLE', '内容文件损坏：' + file) }
}

export function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return 'image/gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  throw backupError('IMAGE_UNAVAILABLE', '图片格式无法读取')
}

async function list(dir) {
  try { return await readdir(dir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export async function insightFile(file) {
  if ((await stat(file)).size > LIMITS.text) throw backupError('LIMIT_EXCEEDED', '洞察文件超过 64 MiB')
  let depth = 0, key, readingContent = false, hasContent = false, value
  const keys = new Set(), hash = createHash('sha256')
  const observe = new Transform({ objectMode: true, transform(token, encoding, next) {
    if (token.name === 'keyValue' && depth === 1) {
      if (keys.has(token.value)) return next(backupError('INVALID_BACKUP', '洞察字段重复'))
      key = token.value; keys.add(key)
    }
    if (token.name === 'startString' && depth === 1 && key === 'content') { readingContent = true; hasContent = true }
    if (readingContent && token.name === 'stringChunk') hash.update(token.value, 'utf16le')
    if (token.name === 'endString') readingContent = false
    if (token.name === 'startObject' || token.name === 'startArray') depth += 1
    if (token.name === 'endObject' || token.name === 'endArray') depth -= 1
    next(null, token)
  } })
  let parts
  const packMetadata = new Transform({ objectMode: true, transform(token, encoding, next) {
    if (token.name === 'startString') parts = []
    if (parts && token.name === 'stringChunk') parts.push(token.value)
    if (token.name === 'endString' && parts) { this.push({ name: 'stringValue', value: parts.join('') }); parts = null }
    next(null, token)
  } })
  try {
    await pipeline(createReadStream(file), byteLimit(LIMITS.text), parser({ packKeys: true, packStrings: false }), observe,
      ignore.asStream({ filter: 'content' }), packMetadata, streamValues.asStream(), new Writable({ objectMode: true, write(entry, encoding, next) { value = entry.value; next() } }))
  } catch (error) { throw backupError('SOURCE_UNREADABLE', '洞察文件无法读取：' + file + '（' + error.message + '）') }
  if (!hasContent || !value || typeof value !== 'object' || Array.isArray(value)) throw backupError('SOURCE_UNREADABLE', '洞察内容损坏：' + file)
  return { value, fingerprint: insightKey(value, hash.digest('hex')) }
}

export async function readContent(dir, withInsights = true) {
  const missingItems = !existsSync(join(dir, 'items.json'))
  const items = await jsonFile(join(dir, 'items.json'), [])
  const groups = withInsights ? await jsonFile(join(dir, 'groups.json'), { version: 1, groups: {} }) : { version: 1, groups: {} }
  const profile = withInsights ? await jsonFile(join(dir, 'memory/profile.json'), { version: 1, note: '' }) : { version: 1, note: '' }
  const insights = []
  if (withInsights) for (const type of ['day', 'week', 'month', 'year']) {
    const folder = type === 'day' ? 'digests' : 'insights/' + type
    for (const entry of await list(join(dir, folder))) {
      if (!entry.name.endsWith('.json')) continue
      const path = folder + '/' + entry.name
      if (!entry.isFile() || !contentPath(path)) throw backupError('SOURCE_UNREADABLE', '不支持的内容文件：' + path)
      const { value, fingerprint } = await insightFile(join(dir, path))
      const key = entry.name.slice(0, -5)
      if ((type === 'day' ? value.date : value.key) !== key) throw backupError('SOURCE_UNREADABLE', '洞察周期与文件不一致：' + path)
      insights.push({ type, key, path, fingerprint })
    }
  }
  validateContent(items, groups, profile)
  if (missingItems && (Object.keys(groups.groups).length || insights.length || (await list(join(dir, 'media'))).length)) {
    throw backupError('SOURCE_UNREADABLE', '条目文件缺失，不能按空库导出')
  }
  return { items, groups, profile, insights }
}

export function validateContent(items, groups, profile) {
  if (!Array.isArray(items) || !groups || groups.version !== 1 || !groups.groups || Array.isArray(groups.groups) || typeof groups.groups !== 'object' || !profile || typeof profile !== 'object' || Array.isArray(profile) || (profile.note !== undefined && typeof profile.note !== 'string')) {
    throw backupError('INVALID_BACKUP', '内容结构不完整')
  }
  const ids = new Set()
  for (const item of items) {
    if (!item || !ID.test(item.id) || ids.has(item.id)) throw backupError('INVALID_BACKUP', '条目 ID 缺失或重复')
    ids.add(item.id)
    if (item.kind && !['image', 'document'].includes(item.kind)) throw backupError('INVALID_BACKUP', '不支持的条目类型')
    if (item.summary && (typeof item.summary !== 'object' || Array.isArray(item.summary))) throw backupError('INVALID_BACKUP', '总结内容结构无效')
    for (const key of Object.keys(item)) if (!ITEM_FIELDS.has(key)) throw backupError('UNSUPPORTED_VERSION', '条目包含未支持的字段：' + key)
  }
  const occupied = new Set()
  for (const [id, group] of Object.entries(groups.groups)) {
    if (!ID.test(id) || group.id !== id || !Array.isArray(group.itemIds) || group.itemIds.length < 2 || new Set(group.itemIds).size !== group.itemIds.length || group.itemIds.some(id => !ids.has(id)) || !group.itemIds.includes(group.primaryId)) {
      throw backupError('INVALID_BACKUP', '分组成员不完整')
    }
    if (!group.dismissed) for (const id of group.itemIds) {
      if (occupied.has(id)) throw backupError('INVALID_BACKUP', '分组成员冲突')
      occupied.add(id)
    }
  }
}

export function isDocument(item) { return item.kind === 'document' || typeof item.text === 'string' }

export function countsOf(content) {
  return { items: content.items.length, images: content.items.filter(item => !isDocument(item)).length, documents: content.items.filter(isDocument).length, groups: Object.keys(content.groups.groups).length,
    insights: content.insights.length, day: content.insights.filter(x => x.type === 'day').length, week: content.insights.filter(x => x.type === 'week').length, month: content.insights.filter(x => x.type === 'month').length, year: content.insights.filter(x => x.type === 'year').length }
}

async function putJson(root, path, value) {
  const data = Buffer.from(JSON.stringify(value, null, 2))
  if (data.length > LIMITS.text) throw backupError('LIMIT_EXCEEDED', '内容文件超过 64 MiB')
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), data)
}

export async function snapshot(dir, root, attachments, kind, runtime, signal, progress) {
  const exportedAt = new Date().toISOString()
  const content = await readContent(dir, kind !== 'images')
  if (runtime && (JSON.stringify(content.items) !== JSON.stringify(runtime.items) || (kind !== 'images' && JSON.stringify(content.groups) !== JSON.stringify(runtime.groups)))) {
    throw backupError('SOURCE_UNREADABLE', '内容尚未完整保存，请稍后重试')
  }
  await mkdir(root, { recursive: true })
  const portable = structuredClone(content)
  const media = []
  if (kind !== 'text') for (const [index, item] of content.items.filter(item => !isDocument(item)).entries()) {
    signal.throwIfAborted()
    let data, mediaType
    try {
      if (!item.imageFile || !/^media\/[^/]+$/.test(item.imageFile)) throw backupError('IMAGE_UNAVAILABLE', '无本地图片')
      if ((await stat(join(dir, item.imageFile))).size > LIMITS.image) throw backupError('LIMIT_EXCEEDED', '图片过大')
      data = await readFile(join(dir, item.imageFile))
      mediaType = imageType(data)
    } catch {
      try {
        data = Buffer.from((await attachments.readImage(item.image)).data)
        mediaType = imageType(data)
      } catch { throw backupError('IMAGE_UNAVAILABLE', '图片无法读取：' + (item.summary?.title || item.id)) }
    }
    if (data.length > LIMITS.image) throw backupError('LIMIT_EXCEEDED', '图片超过容量上限')
    const path = 'media/' + item.id + '.' + IMAGE_EXT[mediaType]
    await mkdir(join(root, 'media'), { recursive: true })
    await writeFile(join(root, path), data)
    media.push({ itemId: item.id, path, mediaType, bytes: data.length })
    progress({ done: index + 1, total: countsOf(content).images })
  }
  for (const item of portable.items) {
    item.kind = isDocument(item) ? 'document' : 'image'
    delete item.image
    delete item.imageFileMediaType
    const image = media.find(x => x.itemId === item.id)
    if (image) item.imageFile = image.path
    else delete item.imageFile
    if (item.source) item.source = Object.fromEntries(Object.entries(item.source).filter(([key]) => ['kind', 'name', 'assetId', 'digest'].includes(key)))
  }
  await putJson(root, 'items.json', portable.items)
  await putJson(root, 'groups.json', portable.groups)
  await putJson(root, 'memory/profile.json', portable.profile)
  for (const entry of portable.insights) {
    await mkdir(dirname(join(root, entry.path)), { recursive: true })
    await pipeline(createReadStream(join(dir, entry.path)), createWriteStream(join(root, entry.path)))
  }
  return { ...portable, media, root, exportedAt }
}

export async function filesUnder(root, prefix = '') {
  const files = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) files.push(...await filesUnder(root, path))
    else if (entry.isFile()) files.push(path)
    else throw backupError('INVALID_BACKUP', '不支持的文件类型')
  }
  return files.sort()
}

export async function inventory(root) {
  const files = []
  for (const path of await filesUnder(root)) files.push({ path, bytes: (await stat(join(root, path))).size, sha256: await fileHash(join(root, path)) })
  return files
}

function checkSize(files) {
  if (files.length > LIMITS.entries || files.reduce((n, x) => n + x.bytes, 0) > LIMITS.expanded) throw backupError('LIMIT_EXCEEDED', '内容超过当前备份容量上限')
}

export async function makePackage(content, attachments, sourceVersion, hostVersion, signal) {
  for (const media of content.media) {
    signal.throwIfAborted()
    await attachments.validateImage({ data: await readFile(join(content.root, media.path)), mediaType: media.mediaType })
  }
  const files = await inventory(content.root)
  checkSize(files)
  const manifest = { format: 'auracap-backup', formatVersion: 1, contentSchemaVersion: 1, exportId: randomUUID(), exportedAt: content.exportedAt, exportTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sourcePluginVersion: sourceVersion, sourceHostVersion: hostVersion, counts: countsOf(content), media: content.media, files }
  await putJson(content.root, 'manifest.json', manifest)
  return manifest
}

const textOf = summary => [summary?.content || summary?.summary, summary?.excerpt, summary?.oneLine, ...(summary?.keyPoints || []), ...(summary?.todos || []), summary?.nextStep].filter(Boolean).join('\n\n')
const titleOf = value => String(value || '未命名').replace(/[\r\n]+/g, ' ')

export async function standalone(content, kind, root) {
  await mkdir(root, { recursive: true })
  if (kind === 'images') {
    if (!content.media.length) throw backupError('EMPTY_EXPORT', '当前没有可导出的图片')
    for (const media of content.media) {
      const item = content.items.find(x => x.id === media.itemId)
      const date = new Date(item.createdAt)
      const valid = Number.isFinite(date.getTime())
      const day = valid ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : 'undated'
      const time = valid ? [date.getHours(), date.getMinutes(), date.getSeconds()].map(x => String(x).padStart(2, '0')).join('') + '_' : ''
      const file = join(root, 'images', day, time + item.id + '.' + IMAGE_EXT[media.mediaType])
      await mkdir(dirname(file), { recursive: true })
      await pipeline(createReadStream(join(content.root, media.path)), createWriteStream(file))
    }
    return
  }
  if (!content.profile.note && !content.insights.length && !Object.values(content.groups.groups).some(g => textOf(g.merged)) && !content.items.some(item => item.text || textOf(item.summary) || item.summary?.title)) throw backupError('EMPTY_EXPORT', '当前没有可导出的文本内容')
  const index = ['# AuraCap 文本导出', '', '导出时间：' + new Date().toISOString(), '', '仅包含已保存文字，不含图片和原始 PDF。', '']
  const put = async (path, body, label) => {
    if (Buffer.byteLength(body) > LIMITS.text) throw backupError('LIMIT_EXCEEDED', '文本文件过大')
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), body)
    index.push('- [' + titleOf(label).replace(/[\[\]\\]/g, '\\$&') + '](' + path.split('/').map(encodeURIComponent).join('/') + ')')
  }
  for (const item of content.items) {
    const summary = item.summary || {}
    const tags = Array.isArray(summary.tags) ? summary.tags.join('、') : ''
    const entities = Array.isArray(summary.entities) ? summary.entities.map(x => x.name).join('、') : ''
    const body = ['# ' + titleOf(summary.title || item.document?.name), '时间：' + (item.createdAt || '未知'), item.source?.name ? '来源：' + item.source.name : '', '状态：' + (item.status || '未知'), textOf(summary), tags ? '标签：' + tags : '', entities ? '实体：' + entities : '', item.text ? '## 文档文字\n\n' + item.text : '', !item.text && !textOf(summary) ? '暂无已保存文字。' : ''].filter(Boolean).join('\n\n') + '\n'
    await put('片刻/' + item.id + '.md', body, summary.title || item.document?.name || item.id)
  }
  for (const group of Object.values(content.groups.groups)) if (group.merged) {
    await put('分组合并/' + group.id + '.md', '# ' + titleOf(group.merged.title) + '\n\n' + textOf(group.merged) + '\n\n## 成员\n\n' + group.itemIds.map(id => '- [' + id + '](../' + encodeURIComponent('片刻') + '/' + id + '.md)').join('\n'), group.merged.title || group.id)
  }
  const folders = { day: '日洞察', week: '周迹', month: '月迹', year: '岁迹' }
  for (const entry of content.insights) {
    const value = await jsonFile(join(content.root, entry.path))
    const refs = value.sourceItemIds || value.itemIds || []
    const body = '# ' + titleOf(value.title || entry.key) + '\n\n周期：' + entry.key + '\n\n' + value.content + '\n\n## 来源\n\n' + refs.map(id => content.items.some(x => x.id === id) ? '- [' + id + '](../' + encodeURIComponent('片刻') + '/' + id + '.md)' : '- ' + id + '（来源已不可用）').join('\n')
    await put(folders[entry.type] + '/' + entry.key + '.md', body, value.title || entry.key)
  }
  if (content.profile.note) await put('项目上下文.md', '# 项目上下文\n\n' + content.profile.note + '\n', '项目上下文')
  await writeFile(join(root, 'README.md'), index.join('\n') + '\n')
}

export async function zipDirectory(root, output, signal) {
  const files = await inventory(root)
  checkSize(files)
  const zip = new yazl.ZipFile()
  const done = pipeline(zip.outputStream, byteLimit(LIMITS.archive, signal), createWriteStream(output), { signal })
  zip.on('error', error => zip.outputStream.destroy(error))
  for (const file of files) zip.addFile(join(root, file.path), file.path, { forceZip64Format: false })
  zip.end({ forceZip64Format: false })
  await done
}

export async function unpack(archive, root, signal) {
  if ((await stat(archive)).size > LIMITS.archive) throw backupError('LIMIT_EXCEEDED', '备份文件超过 2 GiB')
  await mkdir(root, { recursive: true })
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(backupError('INVALID_BACKUP', '无法打开完整备份')) : resolve(value)))
  let total = 0
  const paths = new Set()
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        ;(async () => {
          signal.throwIfAborted()
          const key = entry.fileName.toLowerCase()
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000
          if (!contentPath(entry.fileName) || paths.has(key) || mode === 0xa000 || (entry.generalPurposeBitFlag & 1) || ![0,8].includes(entry.compressionMethod)) throw backupError('INVALID_BACKUP', '备份包含不支持或重复的路径')
          paths.add(key)
          total += entry.uncompressedSize
          if (paths.size > LIMITS.entries || total > LIMITS.expanded || entry.uncompressedSize > (entry.fileName.endsWith('.json') ? LIMITS.text : LIMITS.image)) throw backupError('LIMIT_EXCEEDED', '备份超过容量上限')
          const input = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value)))
          const file = join(root, entry.fileName)
          await mkdir(dirname(file), { recursive: true })
          await pipeline(input, byteLimit(entry.uncompressedSize, signal), createWriteStream(file, { flags: 'wx' }), { signal })
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally { zip.close() }
  const manifest = await jsonFile(join(root, 'manifest.json'))
  if (!manifest || manifest.format !== 'auracap-backup') throw backupError('INVALID_BACKUP', '这不是 AuraCap 完整备份')
  if (manifest.formatVersion !== 1 || manifest.contentSchemaVersion !== 1) throw backupError('UNSUPPORTED_VERSION', '此备份需要更新版本的 AuraCap')
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.media)) throw backupError('INVALID_BACKUP', '文件清单缺失')
  const expected = new Set(['manifest.json'])
  for (const file of manifest.files) {
    if (!contentPath(file.path) || expected.has(file.path)) throw backupError('INVALID_BACKUP', '文件清单重复或无效')
    expected.add(file.path)
    if (!paths.has(file.path.toLowerCase()) || (await stat(join(root, file.path))).size !== file.bytes || await fileHash(join(root, file.path)) !== file.sha256) throw backupError('INVALID_BACKUP', '备份文件不完整或已改变')
  }
  if (expected.size !== paths.size) throw backupError('INVALID_BACKUP', '文件清单与备份内容不一致')
  for (const path of ['items.json', 'groups.json', 'memory/profile.json']) if (!expected.has(path)) throw backupError('INVALID_BACKUP', '必需内容文件缺失')
  const content = await readContent(root)
  const images = content.items.filter(item => !isDocument(item))
  if (manifest.media.length !== images.length || new Set(manifest.media.map(x => x.itemId)).size !== images.length) throw backupError('INVALID_BACKUP', '图片清单不完整')
  for (const item of images) {
    const media = manifest.media.find(x => x.itemId === item.id)
    if (!media || item.imageFile !== media.path || media.path !== 'media/' + item.id + '.' + IMAGE_EXT[media.mediaType] || !expected.has(media.path)) throw backupError('INVALID_BACKUP', '图片关联不完整')
    const data = await readFile(join(root, media.path))
    if (imageType(data) !== media.mediaType || data.length !== media.bytes) throw backupError('INVALID_BACKUP', '图片类型或大小不一致')
  }
  if (!manifest.counts || Object.entries(countsOf(content)).some(([key, value]) => manifest.counts[key] !== value)) throw backupError('INVALID_BACKUP', '备份数量不一致')
  return { ...content, root, manifest, media: manifest.media }
}
