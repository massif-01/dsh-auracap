import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID, createHash } from 'node:crypto'
const taskContext = new AsyncLocalStorage()

export function backupError(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status })
}

// A lease covers its detached children as well as the initiating request.
export class ContentGate {
  context = taskContext
  jobs = new Set()
  generation = randomUUID()
  mode = null
  readBlocked = false
  listeners = new Set()

  run(fn, kind = 'content', expected) {
    const parent = this.context.getStore()
    if ((expected && expected !== this.generation) || (parent && (parent.gate !== this || parent.generation !== this.generation))) {
      throw backupError('LIBRARY_CHANGED', '内容库已更新，请重新查看后操作', 409)
    }
    const inherited = parent && this.jobs.has(parent)
    if (this.mode && ((!inherited && (kind === 'content' || this.mode === 'restore')) || (inherited && kind === 'content' && !parent.content))) {
      throw backupError('BUSY', '正在导出或恢复，请稍后重试', 409)
    }
    const lease = inherited ? parent : { gate: this, generation: this.generation, kind, content: kind === 'content', pending: 0 }
    if (kind === 'content') lease.content = true
    lease.pending += 1
    this.jobs.add(lease)
    const release = () => {
      if (--lease.pending === 0) {
        this.jobs.delete(lease)
        for (const notify of this.listeners) notify()
      }
    }
    try {
      const value = this.context.run(lease, fn)
      if (value && typeof value.then === 'function') return value.finally(release)
      release()
      return value
    } catch (error) { release(); throw error }
  }

  async exclusive(mode, signal, fn) {
    if (this.mode) throw backupError('BUSY', '已有导出或恢复正在进行', 409)
    this.mode = mode
    try {
      while ([...this.jobs].some(job => job.content || mode === 'restore')) {
        await new Promise((resolve, reject) => {
          const done = () => { this.listeners.delete(done); signal.removeEventListener('abort', abort); resolve() }
          const abort = () => { this.listeners.delete(done); signal.removeEventListener('abort', abort); reject(signal.reason) }
          this.listeners.add(done)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
      }
      signal.throwIfAborted()
      return await fn()
    } finally {
      if (!this.readBlocked) this.mode = null
    }
  }

  rotate() { this.generation = randomUUID() }

  isCurrent() {
    const lease = this.context.getStore()
    return !lease || (lease.gate === this && lease.generation === this.generation)
  }

  assertCurrent() { if (!this.isCurrent()) throw backupError('LIBRARY_CHANGED', '旧内容任务已失效', 409) }
}

function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['updatedAt', 'image', 'imageFile', 'imageFileMediaType'].includes(key)).map(key => [key, semantic(value[key])]))
}

export function materialKey(value) { return createHash('sha256').update(JSON.stringify(semantic(value))).digest('hex') }

export function insightKey(entry, contentHash = createHash('sha256').update(entry.content, 'utf16le').digest('hex')) {
  return materialKey({ title: entry.title, contentHash, itemIds: entry.itemIds, sourceItemIds: entry.sourceItemIds, sourceInsightKeys: entry.sourceInsightKeys })
}

export function restoreBaseline(items, groups, insights) {
  const nodes = {}
  for (const item of items) nodes['item:' + item.id] = materialKey({ id: item.id, kind: item.kind, createdAt: item.createdAt, status: item.status, summary: item.summary })
  for (const group of Object.values(groups.groups)) nodes['group:' + group.id] = materialKey({ id: group.id, itemIds: group.itemIds, status: group.status, dismissed: group.dismissed, merged: group.merged && { title: group.merged.title, content: group.merged.content, tags: group.merged.tags, entities: group.merged.entities } })
  for (const entry of insights) nodes['insight:' + entry.type + ':' + entry.key] = entry.fingerprint || insightKey(entry)
  return { version: 1, nodes }
}

export function hasNewMaterial(baseline, items, groups, insights = []) {
  if (!baseline) return true
  const current = restoreBaseline(items, { groups: Object.fromEntries(groups.map(g => [g.id, g])) }, insights)
  return Object.entries(current.nodes).some(([id, value]) => baseline.nodes[id] !== value)
}
