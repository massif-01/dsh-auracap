// Isolated plugin fixture: real HTTP + production module, no network or paid models.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

export const sample = readFileSync(new URL('../assets/test-upload.png', import.meta.url))
export const seed = () => [
  { id: 'image-a', kind: 'image', createdAt: new Date().toISOString(), updatedAt: '2026-10-01T00:00:00Z', status: 'ready', imageFile: 'media/image-a.png', image: { attachmentId: 'fixture', mediaType: 'image/png', width: 640, height: 480 }, summary: { title: '设计记录', content: '### 核心内容\n\n现有总结必须原样保留。', tags: ['设计'], entities: [{ name: 'AuraCap', type: 'project', aliases: [] }] } },
  { id: 'image-b', createdAt: new Date(Date.now() - 7 * 86400_000).toISOString(), updatedAt: '2026-10-02T00:00:00Z', status: 'failed', imageFile: 'media/image-b.png', image: { attachmentId: 'fixture', mediaType: 'image/png', width: 640, height: 480 }, summary: null, error: '保留失败状态' },
  { id: 'document-a', kind: 'document', createdAt: new Date(Date.now() - 7 * 86400_000).toISOString(), updatedAt: '2026-10-02T00:00:00Z', status: 'ready', text: 'PDF 已提取文字。\n```js\nconst original = true\n```', document: { name: '说明.pdf', mediaType: 'application/pdf', chars: 49 }, summary: { title: '文档', summary: '旧版总结', keyPoints: ['保留要点'], todos: ['保留行动项'], tags: [], entities: [] } },
]

export async function fixture({ empty = false, home = mkdtempSync(join(tmpdir(), 'auracap-backup-test-')), network = () => { throw Error('Network is disabled in backup tests') }, credentials = null, githubState = null } = {}) {
  const dir = join(home, 'auracap')
  if (!existsSync(join(dir, 'items.json'))) {
  mkdirSync(join(dir, 'media'), { recursive: true })
  mkdirSync(join(dir, 'memory'), { recursive: true })
  writeFileSync(join(dir, 'items.json'), JSON.stringify(empty ? [] : seed()))
  if (!empty) for (const id of ['image-a', 'image-b']) writeFileSync(join(dir, 'media', id + '.png'), sample)
  if (!empty) {
    writeFileSync(join(dir,'groups.json'),JSON.stringify({version:1,groups:{'grp-manual':{id:'grp-manual',source:'manual',status:'merged',dismissed:false,itemIds:['image-a','document-a'],primaryId:'image-a',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',merged:{title:'合并记录',content:'合并结果保持原样。',sourceItemIds:['image-a','document-a']}}}}))
    for (const [type,key] of [['day','2000-01-02'],['week','2000-W01'],['month','2000-01'],['year','2000']]) {
      const folder=type==='day'?'digests':'insights/'+type
      mkdirSync(join(dir,folder),{recursive:true})
      writeFileSync(join(dir,folder,key+'.json'),JSON.stringify({...(type==='day'?{date:key}:{type,key}),title:type+' 已有结果',content:type+' 洞察正文，不重新生成。',sourceItemIds:['image-a','deleted-source'],createdAt:'2026-10-01T00:00:00Z'}))
    }
  }
  writeFileSync(join(dir, 'memory/profile.json'), JSON.stringify({ version: 1, note: empty ? '目标设备原项目' : '现有项目上下文' }))
  writeFileSync(join(dir, 'memory/settings.json'), JSON.stringify({ version: 1, agentMemory: false, contentLanguage: 'zh', lastUiLocale: 'zh' }))
  writeFileSync(join(dir, 'memory/usage.json'), JSON.stringify({ version: 1, days: { '2026-10-01': { total: 123 } } }))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ github: githubState, processed: ['current-device-only'], lastSyncAt: null }))
  }
  const timers = [], cleanup = [], blobs = new Map([['fixture', sample]])
  let modelCalls = 0, route
  const attachments = {
    async validateImage({ data, mediaType }) { if (!data.length || mediaType !== 'image/png') throw Error('invalid fixture image') },
    async saveImage({ data, mediaType }) { const attachmentId = createHash('sha256').update(data).digest('hex'); blobs.set(attachmentId, Buffer.from(data)); return { attachmentId, mediaType, width: 640, height: 480, bytes: data.length } },
    async readImage(ref) { const data = blobs.get(ref?.attachmentId); if (!data) throw Error('attachment missing'); return { data } },
  }
  const context = vm.createContext({ Buffer, console, URL, URLSearchParams, AbortSignal, AbortController,
    process: { pid: process.pid, env: { DSH_HOME: home } },
    setInterval(fn, ms) { const value = { fn, ms, unref() {} }; timers.push(value); return value }, clearInterval(timer) { if (timer) timer.cancelled = true },
    setTimeout(fn, ms) { const value = { fn, ms, unref() {} }; timers.push(value); return value }, clearTimeout(timer) { if (timer) timer.cancelled = true },
    fetch: network,
  })
  const sourceUrl = new URL('../index.js', import.meta.url)
  const mod = new vm.SourceTextModule(readFileSync(sourceUrl, 'utf8') + '\nexport function testGate(){return operationGate}\n', { context, initializeImportMeta(meta) { meta.url = sourceUrl.href } })
  await mod.link(async specifier => {
    const dependency = await import(specifier.startsWith('.') ? new URL(specifier, sourceUrl).href : specifier)
    return new vm.SyntheticModule(Object.keys(dependency), function () { for (const [key, value] of Object.entries(dependency)) this.setExport(key, value) }, { context })
  })
  await mod.evaluate()
  mod.namespace.apply({ get(name) { return name === 'credentials' ? credentials : null }, effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanup.push(dispose); return dispose },
    webServer: { register(value) { route = value.handler; return () => {} } }, attachments,
    llm: { stream() { modelCalls += 1; throw Error('Restore must not call a model') } },
  })
  const server = createServer((req, res) => { route(req, res).catch(error => { if (!res.headersSent) res.writeHead(500); res.end(error.message) }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  let generation
  async function request(path, options = {}) {
    const response = await fetch(origin + '/auracap/api/' + path, { ...options, headers: { ...(generation ? { 'x-auracap-generation': generation } : {}), ...options.headers } })
    generation = response.headers.get('x-auracap-generation')
    const payload = await response.json()
    if (!response.ok) throw Object.assign(Error(payload.error), { code: payload.code, status: response.status })
    return payload
  }
  await request('backup/status')
  return { home, dir, origin, request, attachments, timers, gate: mod.namespace.testGate(), get modelCalls() { return modelCalls },
    async close({ preserve = false } = {}) { for (const fn of cleanup.reverse()) await fn(); await new Promise(resolve => server.close(resolve)); if (!preserve) rmSync(home, { recursive: true, force: true }) },
  }
}

export async function untilTask(app, id, predicate) {
  const start = Date.now()
  while (Date.now() - start < 20_000) {
    const task = await app.request('backup/tasks/' + id)
    if (predicate(task)) return task
    if (['FAILED', 'RECOVERY_REQUIRED', 'EXPIRED'].includes(task.state)) throw Object.assign(Error(task.error), { task })
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw Error('Timed out waiting for backup task')
}
