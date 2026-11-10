import { existsSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, rm, copyFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJson, syncPath, fileHashSync } from './io.js'
import { inventory, filesUnder, readContent } from './format.js'
import { backupError, restoreBaseline } from './runtime.js'

export const controlDir = dir => join(dirname(dir), '.auracap-transfer')

function identity(dir) {
  return existsSync(join(dir, 'library.json')) ? readJson(join(dir, 'library.json')).storeId : null
}

function verified(dir, id, files) {
  if (identity(dir) !== id) return false
  return files.every(file => {
    const path = join(dir, file.path)
    return existsSync(path) && statSync(path).size === file.bytes && fileHashSync(path) === file.sha256
  })
}

function durableRename(from, to) {
  renameSync(from, to)
  syncPath(dirname(from))
  if (dirname(from) !== dirname(to)) syncPath(dirname(to))
}

function clearPointer(control) {
  unlinkSync(join(control, 'active-restore.json'))
  syncPath(control)
}

// Recovery is intentionally synchronous and runs before any content loader or timer.
export function recoverRestore(dir, checkpoint = () => {}) {
  const control = controlDir(dir), pointer = join(control, 'active-restore.json')
  if (!existsSync(pointer)) return null
  const { taskId } = readJson(pointer)
  if (!/^[\da-f-]{36}$/.test(taskId)) throw backupError('RECOVERY_REQUIRED', '恢复事务标识无效', 503)
  const work = join(control, 'jobs', taskId)
  const file = join(work, 'transaction.json'), tx = readJson(file)
  const old = join(work, 'previous'), next = join(work, 'next'), quarantine = join(work, 'uncommitted')
  const fail = () => { throw backupError('RECOVERY_REQUIRED', '无法确认完整内容库，已保留恢复副本', 503) }
  if (tx.taskId !== taskId || !Array.isArray(tx.oldFiles) || !Array.isArray(tx.newFiles)) fail()
  let result
  if (tx.decision === 'committed') {
    if (!verified(dir, tx.newId, tx.newFiles)) fail()
    result = { ...tx.result, state: 'SUCCEEDED', committed: true, completedAt: new Date().toISOString() }
  } else if (tx.decision === 'uncommitted') {
    const current = identity(dir), previous = identity(old)
    if (current === tx.newId && previous === tx.oldId) {
      if (existsSync(quarantine)) fail()
      durableRename(dir, quarantine)
      checkpoint('rollback-quarantined')
    } else if (current && current !== tx.oldId) fail()
    if (!existsSync(dir) && identity(old) === tx.oldId && verified(old, tx.oldId, tx.oldFiles)) { durableRename(old, dir); checkpoint('rollback-restored') }
    if (existsSync(old) || !verified(dir, tx.oldId, tx.oldFiles)) fail()
    result = { ...tx.result, state: 'FAILED', code: 'INTERRUPTED', error: '恢复未完成，已保留恢复前的内容', completedAt: new Date().toISOString() }
  } else fail()
  writeJson(join(control, 'receipts', taskId + '.json'), result)
  clearPointer(control)
  // Cleanup is not part of the commit decision. A subsequent cleanup pass can retry it.
  for (const path of [old, next, quarantine]) {
    try { rmSync(path, { recursive: true, force: true }) } catch {}
  }
  return result
}

export async function restorePackage({ dir, task, content, attachments, buildIndex, publish, rollback, gate, phase, checkpoint = () => {} }) {
  const control = controlDir(dir), work = join(control, 'jobs', task.id), next = join(work, 'next'), previous = join(work, 'previous')
  await readContent(dir)
  await mkdir(next, { recursive: true })
  const items = structuredClone(content.items)
  for (const [index, item] of items.filter(x => x.kind === 'image').entries()) {
    const media = content.media.find(x => x.itemId === item.id)
    const data = await readFile(join(content.root, media.path))
    item.image = await attachments.saveImage({ data, mediaType: media.mediaType, name: media.name || item.source?.name })
    item.imageFileMediaType = media.mediaType
    phase('PREPARING', { done: index + 1, total: content.media.length })
  }
  for (const item of items) if (item.status === 'summarizing') {
    item.status = 'failed'
    item.error = '备份时生成未完成，可手动重试'
  }
  for (const path of await filesUnder(content.root)) {
    if (path === 'manifest.json' || path === 'items.json') continue
    await mkdir(dirname(join(next, path)), { recursive: true })
    await copyFile(join(content.root, path), join(next, path))
  }
  writeJson(join(next, 'items.json'), items)
  writeJson(join(next, 'memory/usage.json'), { version: 1, days: {} })
  const baseline = restoreBaseline(items, content.groups, content.insights)
  writeJson(join(next, 'memory/restore-baseline.json'), baseline)
  const index = buildIndex(items)
  writeJson(join(next, 'memory/entities.json'), index)
  for (const path of ['state.json', 'memory/settings.json']) if (existsSync(join(dir, path))) {
    readJson(join(dir, path))
    await copyFile(join(dir, path), join(next, path))
  }
  await mkdir(dir, { recursive: true })
  if (!identity(dir)) writeJson(join(dir, 'library.json'), { version: 1, storeId: randomUUID() })
  const oldId = identity(dir), newId = randomUUID()
  writeJson(join(next, 'library.json'), { version: 1, storeId: newId })
  for (const path of await filesUnder(next)) syncPath(join(next, path))
  for (const path of [join(next, 'memory'), join(next, 'media'), join(next, 'digests'), ...['week', 'month', 'year'].map(x => join(next, 'insights', x)), join(next, 'insights'), next]) if (existsSync(path)) syncPath(path)
  const tx = { taskId: task.id, oldId, newId, decision: 'uncommitted', intent: 'prepared', oldFiles: await inventory(dir), newFiles: await inventory(next), result: { ...task, counts: content.manifest.counts } }
  const txFile = join(work, 'transaction.json')
  writeJson(txFile, tx)
  writeJson(join(control, 'active-restore.json'), { taskId: task.id })
  gate.readBlocked = true
  try {
    checkpoint('prepared')
    tx.intent = 'switching'
    writeJson(txFile, tx)
    phase('SWITCHING')
    checkpoint('before-old-rename')
    durableRename(dir, previous)
    checkpoint('after-old-rename')
    durableRename(next, dir)
    checkpoint('after-new-rename')
    if (!verified(dir, newId, tx.newFiles)) throw backupError('INVALID_BACKUP', '恢复内容校验失败')
    tx.decision = 'committed'
    writeJson(txFile, tx)
    phase('COMMITTED')
    checkpoint('committed')
    publish({ items, groups: content.groups, index, baseline })
    const result = { ...tx.result, state: 'SUCCEEDED', committed: true, completedAt: new Date().toISOString() }
    writeJson(join(control, 'receipts', task.id + '.json'), result)
    clearPointer(control)
    gate.readBlocked = false
    try { await rm(previous, { recursive: true, force: true }) } catch {}
    return result
  } catch (error) {
    if (tx.decision === 'committed') throw backupError('RECOVERY_REQUIRED', '内容已恢复，需要重新载入，请重启插件', 503)
    phase('ROLLING_BACK')
    const result = recoverRestore(dir)
    rollback()
    gate.readBlocked = false
    return { ...result, error: '恢复失败，已保留恢复前的内容：' + error.message }
  }
}
