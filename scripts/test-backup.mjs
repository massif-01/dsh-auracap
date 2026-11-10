// node --experimental-vm-modules scripts/test-backup.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fixture, untilTask, sample } from './backup-fixture.mjs'
import { ContentGate } from '../backup/runtime.js'
import { unpack } from '../backup/format.js'
import { restorePackage, recoverRestore, controlDir } from '../backup/restore.js'
import { readJson } from '../backup/io.js'

const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function exported(app, kind = 'package') {
  const task = await app.request('backup/tasks', post({ type: 'export', kind, operationId: randomUUID() }))
  const ready = await untilTask(app, task.id, value => value.state === 'DOWNLOAD_READY')
  const response = await fetch(app.origin + '/auracap/api/backup/tasks/' + task.id + '/file')
  assert.equal(response.status, 200)
  return { task: ready, bytes: Buffer.from(await response.arrayBuffer()) }
}
async function preview(app, bytes) {
  const task = await app.request('backup/tasks', post({ type: 'restore', operationId: randomUUID() }))
  await app.request('backup/tasks/' + task.id + '/archive', { method: 'PUT', headers: { 'x-auracap-name': encodeURIComponent('测试.auracap.zip') }, body: bytes })
  return untilTask(app, task.id, value => value.state === 'PREVIEW_READY')
}

test('full backup restores into an empty device without models, preserves text and settings, fences stale writes', async () => {
  const source = await fixture(); let target = await fixture({ empty: true })
  try {
    const original = (await source.request('items')).items
    // Exercise the supported host-image source when a local copy is gone.
    await rm(join(source.dir, 'media/image-b.png'))
    const archive = await exported(source)
    const archiveFile = join(source.home, 'backup.zip'); await writeFile(archiveFile, archive.bytes)
    const content = await unpack(archiveFile, join(source.home, 'inspected'), new AbortController().signal)
    assert.equal(content.items[1].kind, 'image')
    assert.equal('image' in content.items[0], false)
    assert.equal(content.items[2].text, original[2].text)
    assert.equal(content.manifest.files.some(x => /state|usage|settings|\.pdf$/.test(x.path)), false)
    const oldGeneration = (await target.request('backup/status')).generation
    const checked = await preview(target, archive.bytes)
    assert.equal(checked.counts.images, 2)
    assert.equal(checked.counts.insights, 4)
    await target.request('backup/tasks/' + checked.id + '/restore', { method: 'POST' })
    await untilTask(target, checked.id, value => value.state === 'SUCCEEDED')
    const restored = (await target.request('items')).items
    assert.equal(restored.length, 3)
    assert.deepEqual(restored.map(x => x.id), original.map(x => x.id))
    assert.equal(restored[0].summary.content, original[0].summary.content)
    assert.equal(restored[2].summary.todos[0], '保留行动项')
    assert.equal((await target.request('groups')).groups[0].merged.content, '合并结果保持原样。')
    assert.equal(readJson(join(target.dir,'insights/year/2000.json')).content,'year 洞察正文，不重新生成。')
    assert.equal((await target.request('memory/profile')).note, '现有项目上下文')
    assert.equal((await target.request('usage')).total, 0)
    assert.equal(readJson(join(target.dir, 'state.json')).processed[0], 'current-device-only')
    for (const item of restored.filter(x => x.kind === 'image')) assert.deepEqual(Buffer.from((await target.attachments.readImage(item.image)).data), sample)
    const image = await fetch(target.origin + '/auracap/api/media/image-a')
    assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), sample)
    await assert.rejects(target.request('items/image-a/delete', { method: 'POST', headers: { 'x-auracap-generation': oldGeneration } }), error => error.code === 'LIBRARY_CHANGED')
    assert.equal((await fetch(target.origin + '/auracap/api/items/image-a/delete', { method: 'POST' })).status, 409)
    // A retry of an accepted confirmation must not clear later changes.
    await target.request('memory/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: '恢复之后新修改' }) })
    await target.request('backup/tasks/' + checked.id + '/restore', { method: 'POST' })
    assert.equal((await target.request('memory/profile')).note, '恢复之后新修改')
    for (const timer of target.timers.filter(x => [30_000,45_000].includes(x.ms))) timer.fn()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(target.modelCalls, 0)
    const home = target.home
    await target.close({ preserve: true })
    target = await fixture({ home })
    for (const timer of target.timers.filter(x => [30_000,45_000].includes(x.ms))) timer.fn()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(target.modelCalls, 0)
    assert.equal((await target.request('items')).items[0].summary.content, original[0].summary.content)
    await target.request('items/image-b/retry', { method: 'POST' })
    assert.equal(target.modelCalls, 1, 'manual retry remains available after restore')
  } finally { await source.close(); await target.close() }
})

test('standalone images and text contain usable files, including legacy actions and extracted PDF text', async () => {
  const app = await fixture()
  try {
    const images = await exported(app, 'images'), text = await exported(app, 'text')
    const yauzl = (await import('yauzl')).default
    const entries = async bytes => {
      const zip = await new Promise((resolve,reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (e,z) => e ? reject(e) : resolve(z)))
      const result = {}
      await new Promise((resolve,reject) => {
        zip.on('error',reject);zip.on('end',resolve)
        zip.on('entry', entry => zip.openReadStream(entry,(e,stream) => {
          if(e)return reject(e);const data=[];stream.on('error',reject);stream.on('data',x=>data.push(x));stream.on('end',()=>{result[entry.fileName]=Buffer.concat(data);zip.readEntry()})
        }));zip.readEntry()
      });return result
    }
    const pics = await entries(images.bytes); assert.equal(Object.keys(pics).length,2);assert.ok(Object.keys(pics).every(x=>x.endsWith('.png')))
    const words = await entries(text.bytes)
    const doc = words['片刻/document-a.md'].toString()
    assert.ok(doc.includes('保留行动项'));assert.ok(doc.includes('PDF 已提取文字'));assert.ok(words['README.md']);assert.ok(words['项目上下文.md'])
  } finally { await app.close() }
})

test('corrupt source cannot become a valid empty backup; invalid input leaves the current library intact', async () => {
  const app = await fixture()
  try {
    await writeFile(join(app.dir, 'items.json'), '{broken')
    const task = await app.request('backup/tasks', post({ type: 'export', kind: 'package', operationId: randomUUID() }))
    const failed = await untilTask(app, task.id, value => value.state === 'FAILED')
    assert.equal(failed.code, 'SOURCE_UNREADABLE')
    const incoming = await app.request('backup/tasks', post({ type: 'restore', operationId: randomUUID() }))
    await app.request('backup/tasks/' + incoming.id + '/archive', { method: 'PUT', body: Buffer.from('not zip') })
    assert.equal((await untilTask(app, incoming.id, value => value.state === 'FAILED')).code, 'INVALID_BACKUP')
    assert.equal(await readFile(join(app.dir, 'items.json'),'utf8'), '{broken')
  } finally { await app.close() }
})

test('drain waits for detached children and allows them to finish; new tasks cannot enter', async () => {
  const gate = new ContentGate(); let finish, child
  gate.run(() => { child = gate.run(() => new Promise(resolve => { finish = resolve })) })
  let entered = false
  const waiting = gate.exclusive('restore', new AbortController().signal, async () => { entered = true })
  assert.equal(entered, false)
  assert.throws(() => gate.run(() => {}), error => error.code === 'BUSY')
  finish(); await child; await waiting
  assert.equal(entered, true);assert.equal(gate.jobs.size,0)
})

test('restore failure at each namespace boundary rolls back once; a committed interruption keeps the new library', async () => {
  const source = await fixture()
  const root = await mkdtemp(join(tmpdir(), 'auracap-backup-faults-'))
  try {
    const archive = await exported(source)
    const file = join(root, 'input.zip'); await writeFile(file, archive.bytes)
    const content = await unpack(file, join(root,'checked'),new AbortController().signal)
    for (const point of ['prepared','before-old-rename','after-old-rename','after-new-rename','committed']) {
      const dir = join(root, point, 'auracap');await mkdir(dir,{recursive:true})
      await writeFile(join(dir,'items.json'),'[]')
      const gate = new ContentGate(), task = { id: randomUUID(), type:'restore' }
      const run = () => restorePackage({ dir,task,content,attachments:source.attachments,buildIndex:()=>({version:1,entities:{},aliases:{}}), publish:()=>{},rollback:()=>{},gate,phase:()=>{},checkpoint:stage=>{if(stage===point)throw Error('injected interruption')} })
      if(point==='committed') {
        await assert.rejects(run(),error=>error.code==='RECOVERY_REQUIRED')
        assert.equal(recoverRestore(dir).state,'SUCCEEDED')
        assert.equal(readJson(join(dir,'items.json')).length,3)
      } else {
        assert.equal((await run()).state,'FAILED')
        assert.deepEqual(readJson(join(dir,'items.json')),[])
      }
      assert.equal(recoverRestore(dir),null)
    }
  } finally { await source.close(); await rm(root,{recursive:true,force:true}) }
})

test('SIGKILL and a second interruption during rollback recover using durable on-disk state', async () => {
  const source = await fixture(), root = await mkdtemp(join(tmpdir(),'auracap-backup-kill-'))
  try {
    const archive = join(root,'input.zip');await writeFile(archive,(await exported(source)).bytes)
    const child = new URL('./backup-fault-child.mjs',import.meta.url)
    for (const point of ['after-old-rename','after-new-rename','committed']) {
      const dir = join(root,point,'auracap');await mkdir(dir,{recursive:true});await writeFile(join(dir,'items.json'),'[]')
      const killed = spawnSync(process.execPath,[child.pathname,dir,archive,point],{encoding:'utf8',timeout:15_000})
      assert.equal(killed.signal,'SIGKILL',killed.stderr)
      if(point==='after-new-rename') {
        const again=spawnSync(process.execPath,[child.pathname,dir,archive,'rollback-quarantined'],{encoding:'utf8',timeout:15_000})
        assert.equal(again.signal,'SIGKILL',again.stderr)
      }
      assert.equal(recoverRestore(dir).state,point==='committed'?'SUCCEEDED':'FAILED')
      assert.equal(readJson(join(dir,'items.json')).length,point==='committed'?3:0)
      assert.equal(recoverRestore(dir),null)
    }
  } finally {await source.close();await rm(root,{recursive:true,force:true})}
})
