import { unpack } from '../backup/format.js'
import { restorePackage, recoverRestore } from '../backup/restore.js'
import { ContentGate } from '../backup/runtime.js'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const [dir, archive, point] = process.argv.slice(2)
const checkpoint = stage => { if (stage === point) process.kill(process.pid, 'SIGKILL') }
if (point.startsWith('rollback-')) recoverRestore(dir, checkpoint)
else {
  const content = await unpack(archive, join(dirname(dir), 'checked'), new AbortController().signal)
  await restorePackage({ dir, content, task: { id: randomUUID(), type: 'restore' }, gate: new ContentGate(), phase() {}, checkpoint, publish() {}, rollback() {}, buildIndex: () => ({ version: 1, entities: {}, aliases: {} }),
    attachments: { async saveImage({ data, mediaType }) { return { attachmentId: createHash('sha256').update(data).digest('hex'), mediaType, bytes: data.length } } },
  })
}
