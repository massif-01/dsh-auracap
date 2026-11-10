import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, stat, rm, readdir, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { backupError } from './runtime.js'
import { readJson, writeJson } from './io.js'
import { controlDir, restorePackage } from './restore.js'
import { LIMITS, byteLimit, snapshot, standalone, makePackage, zipDirectory, unpack, fileHash } from './format.js'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/
const CANCEL = new Set(['CREATED', 'RECEIVING', 'CHECKING', 'PREVIEW_READY', 'WAITING'])
const RETENTION = 30 * 60_000

export class BackupTasks {
  tasks = new Map()
  active = null

  constructor({ dir, gate, attachments, current, buildIndex, publish, rollback, hasAuthorization, recoveryError = null }) {
    Object.assign(this, { dir, gate, attachments, current, buildIndex, publish, rollback, hasAuthorization, recoveryError })
    this.control = controlDir(dir)
  }

  path(id, file = '') { return join(this.control, 'jobs', id, file) }
  receipt(id) { return join(this.control, 'receipts', id + '.json') }

  view(task) {
    const keys = ['id', 'operationId', 'type', 'kind', 'state', 'filename', 'exportedAt', 'createdAt', 'completedAt', 'counts', 'done', 'total', 'error', 'code', 'committed', 'touchedAt', 'generation']
    return Object.fromEntries(keys.filter(key => task[key] !== undefined).map(key => [key, task[key]]))
  }

  persist(task) { writeJson(this.receipt(task.id), this.view(task)) }

  get(id) {
    if (!UUID.test(id)) throw backupError('TASK_EXPIRED', '任务不存在或已过期', 404)
    let task = this.tasks.get(id)
    if (!task) {
      if (!existsSync(this.receipt(id))) throw backupError('TASK_EXPIRED', '任务不存在或已过期', 404)
      task = readJson(this.receipt(id))
      if (!['DOWNLOAD_READY', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(task.state)) Object.assign(task, { state: 'FAILED', code: 'INTERRUPTED', error: '处理已中断，请重新选择文件', completedAt: new Date().toISOString() })
      task.controller = new AbortController()
      this.tasks.set(id, task)
    }
    if (Date.now() - Date.parse(task.createdAt) > 7 * 86400_000) throw backupError('TASK_EXPIRED', '任务已过期', 410)
    if (['CREATED', 'PREVIEW_READY', 'DOWNLOAD_READY'].includes(task.state) && Date.now() - task.touchedAt > RETENTION && !task.downloads) {
      task.state = 'EXPIRED'
      delete task.content
      delete task.archiveHash
      if (this.active === id) this.active = null
      this.persist(task)
    }
    return task
  }

  status() {
    const last = existsSync(join(this.control, 'export-history.json')) ? readJson(join(this.control, 'export-history.json')) : null
    return { generation: this.gate.generation, active: this.active ? this.view(this.get(this.active)) : null, lastExport: last, recoveryError: this.recoveryError?.message || (this.gate.readBlocked ? '恢复需要完成载入，请重启插件' : null) }
  }

  create({ type, kind, operationId }) {
    if (!UUID.test(operationId || '')) throw backupError('INVALID_REQUEST', '操作标识无效', 400)
    const opFile = join(this.control, 'operations', operationId + '.json')
    if (existsSync(opFile)) return this.get(readJson(opFile).taskId)
    if (this.recoveryError || this.gate.readBlocked) throw backupError('RECOVERY_REQUIRED', '恢复需要处理，已暂停内容读写', 503)
    if (this.active) throw backupError('BUSY', '已有导出或恢复正在进行', 409)
    if (!['export', 'restore'].includes(type) || (type === 'export' && !['package', 'images', 'text'].includes(kind))) throw backupError('INVALID_REQUEST', '导出类型无效', 400)
    const task = { id: randomUUID(), operationId, type, kind, state: type === 'export' ? 'WAITING' : 'CREATED', createdAt: new Date().toISOString(), touchedAt: Date.now(), controller: new AbortController(), generation: this.gate.generation }
    this.tasks.set(task.id, task)
    this.active = task.id
    this.persist(task)
    writeJson(opFile, { taskId: task.id, createdAt: task.createdAt })
    if (type === 'export') this.start(task, () => this.export(task))
    return task
  }

  phase(task, state, values = {}) { Object.assign(task, { state }, values) }

  start(task, work) {
    task.work = Promise.resolve().then(work).catch(error => {
      Object.assign(task, { state: task.controller.signal.aborted ? 'CANCELLED' : this.gate.readBlocked ? 'RECOVERY_REQUIRED' : 'FAILED', code: error.code || 'TRANSFER_FAILED', error: error.message, completedAt: new Date().toISOString() })
    }).finally(() => {
      if (this.active === task.id) this.active = null
      if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED'].includes(task.state)) { delete task.content; delete task.archiveHash }
      this.persist(task)
    }).catch(error => {
      Object.assign(task, { state: this.gate.readBlocked ? 'RECOVERY_REQUIRED' : 'FAILED', code: 'RECEIPT_WRITE_FAILED', error: '无法保存任务结果：' + error.message })
    })
  }

  async export(task) {
    const signal = task.controller.signal
    const content = await this.gate.exclusive('export', signal, async () => {
      this.phase(task, 'SNAPSHOTTING')
      return snapshot(this.dir, this.path(task.id, 'snapshot'), this.attachments, task.kind, this.current(), signal, value => Object.assign(task, value))
    })
    this.phase(task, 'PACKING', { counts: { items: content.items.length, images: content.media.length, insights: content.insights.length } })
    let root = content.root
    if (task.kind === 'package') {
      const manifest = await makePackage(content, this.attachments, '0.1.0', null, signal)
      Object.assign(task, { exportedAt: manifest.exportedAt, counts: manifest.counts })
    } else {
      root = this.path(task.id, 'standalone')
      await standalone(content, task.kind, root)
      task.exportedAt = content.exportedAt
    }
    await zipDirectory(root, this.path(task.id, 'export.zip'), signal)
    const date = new Date(task.exportedAt), pad = value => String(value).padStart(2, '0')
    const stamp = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
    task.filename = 'AuraCap-' + (task.kind === 'package' ? '' : task.kind + '-') + stamp + (task.kind === 'package' ? '.auracap.zip' : '.zip')
    await rm(content.root, { recursive: true, force: true })
    if (root !== content.root) await rm(root, { recursive: true, force: true })
    this.phase(task, 'DOWNLOAD_READY', { touchedAt: Date.now() })
  }

  async upload(task, req) {
    if (task.type !== 'restore' || task.state !== 'CREATED' || this.active !== task.id) throw backupError('INVALID_STATE', '请重新选择备份文件', 409)
    this.phase(task, 'RECEIVING', { filename: decodeURIComponent(String(req.headers['x-auracap-name'] || 'AuraCap.auracap.zip')) })
    task.uploading = true
    await mkdir(this.path(task.id), { recursive: true })
    try {
      await pipeline(req, byteLimit(LIMITS.archive, task.controller.signal, done => { task.done = done }), createWriteStream(this.path(task.id, 'incoming.zip'), { flags: 'wx' }), { signal: task.controller.signal })
    } catch (error) {
      this.phase(task, task.controller.signal.aborted ? 'CANCELLED' : 'FAILED', { code: error.code, error: error.message })
      if (this.active === task.id) this.active = null
      this.persist(task)
      throw error
    } finally { task.uploading = false }
    this.start(task, async () => {
      this.phase(task, 'CHECKING', { done: 0 })
      const content = await unpack(this.path(task.id, 'incoming.zip'), this.path(task.id, 'checked'), task.controller.signal)
      task.controller.signal.throwIfAborted()
      task.archiveHash = await fileHash(this.path(task.id, 'incoming.zip'))
      task.content = content
      this.phase(task, 'PREVIEW_READY', { counts: content.manifest.counts, exportedAt: content.manifest.exportedAt, touchedAt: Date.now(), generation: this.gate.generation })
    })
  }

  confirm(task, generation) {
    if (task.accepted) return task
    if (task.state === 'SUCCEEDED' || task.committed) return task
    if (task.state !== 'PREVIEW_READY') throw backupError('INVALID_STATE', '请重新检查备份文件', 409)
    if (generation !== this.gate.generation || task.generation !== generation) throw backupError('LIBRARY_CHANGED', '内容库已更新，请重新选择备份', 409)
    if (this.hasAuthorization()) throw backupError('PHONE_CONNECTION_PENDING', '请先完成或取消正在进行的手机连接', 409)
    if (this.active) throw backupError('BUSY', '已有导出或恢复正在进行', 409)
    task.accepted = true
    task.touchedAt = Date.now()
    this.active = task.id
    this.phase(task, 'WAITING')
    this.persist(task)
    this.start(task, async () => {
      if (this.hasAuthorization() || generation !== this.gate.generation) throw backupError('BUSY', '连接或内容状态已改变，请重新选择备份', 409)
      await this.gate.exclusive('restore', task.controller.signal, async () => {
        if (await fileHash(this.path(task.id, 'incoming.zip')) !== task.archiveHash) throw backupError('INVALID_BACKUP', '已检查的备份文件已改变')
        task.controller.signal.throwIfAborted()
        const disk = await statfs(this.control)
        const needed = task.content.manifest.files.reduce((n, file) => n + file.bytes, 0) + task.content.media.reduce((n, file) => n + file.bytes, 0)
        if (disk.bavail * disk.bsize < needed) throw backupError('NO_SPACE', '空间不足，无法准备恢复内容')
        this.phase(task, 'PREPARING', { done: 0, total: task.content.media.length })
        const result = await restorePackage({ dir: this.dir, task: this.view(task), content: task.content, attachments: this.attachments, buildIndex: this.buildIndex, publish: this.publish, rollback: this.rollback, gate: this.gate, phase: (state, values) => this.phase(task, state, values) })
        Object.assign(task, result)
      })
    })
    return task
  }

  cancel(task) {
    if (!CANCEL.has(task.state)) throw backupError('INVALID_STATE', '当前阶段不能取消', 409)
    task.controller.abort(backupError('CANCELLED', '已取消', 409))
    this.phase(task, 'CANCELLED')
    if (this.active !== task.id) { delete task.content; delete task.archiveHash }
    if (!task.work && !task.uploading && this.active === task.id) this.active = null
    this.persist(task)
  }

  async download(task, req, res) {
    if (task.state !== 'DOWNLOAD_READY') throw backupError('TASK_EXPIRED', '下载文件尚未准备好或已过期', 410)
    task.downloads = (task.downloads || 0) + 1
    task.touchedAt = Date.now()
    try {
      const file = this.path(task.id, 'export.zip')
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': (await stat(file)).size, 'content-disposition': 'attachment; filename="' + task.filename + '"', 'cache-control': 'no-store' })
      if (req.method === 'HEAD') { res.end(); return }
      await pipeline(createReadStream(file), res)
      if (task.kind === 'package') {
        const path = join(this.control, 'export-history.json')
        const old = existsSync(path) ? readJson(path) : null
        if (!old || old.exportedAt <= task.exportedAt) writeJson(path, { exportedAt: task.exportedAt, deliveredAt: new Date().toISOString(), filename: task.filename, taskId: task.id })
      }
    } finally { task.downloads -= 1 }
  }

  async cleanup() {
    await mkdir(join(this.control, 'jobs'), { recursive: true })
    const pointer = existsSync(join(this.control, 'active-restore.json')) ? readJson(join(this.control, 'active-restore.json')).taskId : null
    for (const entry of await readdir(join(this.control, 'jobs'))) {
      if (!UUID.test(entry) || entry === this.active || entry === pointer || this.tasks.get(entry)?.downloads) continue
      const age = Date.now() - (this.tasks.get(entry)?.touchedAt || (await stat(this.path(entry))).mtimeMs)
      if (age > RETENTION) {
        const task = this.tasks.get(entry)
        if (task && ['CREATED', 'PREVIEW_READY', 'DOWNLOAD_READY'].includes(task.state)) { task.state = 'EXPIRED'; this.persist(task) }
        this.tasks.delete(entry)
        await rm(this.path(entry), { recursive: true, force: true })
      }
    }
    for (const folder of ['receipts', 'operations']) {
      const root = join(this.control, folder)
      if (!existsSync(root)) continue
      for (const entry of await readdir(root)) {
        if (!UUID.test(entry.replace(/\.json$/, ''))) continue
        const file = join(root, entry)
        if (Date.now() - (await stat(file)).mtimeMs > 7 * 86400_000) {
          if (folder === 'receipts' && (entry === this.active + '.json' || entry === pointer + '.json')) continue
          await rm(file, { force: true })
          if (folder === 'receipts') this.tasks.delete(entry.slice(0, -5))
        }
      }
    }
  }
}
