import { closeSync, fsyncSync, openSync, readFileSync, readSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { backupError } from './runtime.js'

export function readJson(file, missing) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT' && missing !== undefined) return structuredClone(missing)
    throw backupError('SOURCE_UNREADABLE', '无法读取内容文件：' + file)
  }
  try { return JSON.parse(text) } catch { throw backupError('SOURCE_UNREADABLE', '内容文件损坏：' + file) }
}

export function syncPath(path) {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + randomUUID() + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  syncPath(tmp)
  renameSync(tmp, file)
  syncPath(dirname(file))
}

export function fileHashSync(file) {
  const fd = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let bytes
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
