// Run: node --experimental-vm-modules scripts/test-performance.mjs
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

const sourceUrl = new URL('../index.js', import.meta.url)
const source = readFileSync(sourceUrl, 'utf8') + `
export { itemsForList, saveItems, saveGroups, extractPdfText };
export function setTestGroups(groups) { groupStore = { version: 1, groups }; }
`
const home = mkdtempSync(join(tmpdir(), 'auracap-performance-tests-'))
let checks = 0
const now = '2026-11-10T12:00:00Z'
const image = (id, offset = 0) => ({
  id, kind: 'image', createdAt: new Date(Date.parse(now) + offset).toISOString(), status: 'ready',
  image: { mediaType: 'image/png', width: 1170, height: 2532 },
  summary: { title: 'Apollo 第 2 屏', content: 'Apollo project budget', tags: ['Apollo'], entities: [] },
})
const checked = (name, fn) => Promise.resolve().then(fn).then(() => { checks += 1; console.log('ok - ' + name) })

async function sandbox(seed = []) {
  const dir = mkdtempSync(join(home, 'case-'))
  mkdirSync(join(dir, 'auracap'))
  writeFileSync(join(dir, 'auracap/items.json'), JSON.stringify(seed))
  const timers = [], pdf = { imports: 0, destroyed: 0, fail: false }
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return Date.parse(now) }
  }
  const context = vm.createContext({
    Buffer, console, URL, URLSearchParams, AbortSignal, AbortController, Date: TestDate,
    process: { pid: process.pid, env: { DSH_HOME: dir } },
    setTimeout(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer }, clearTimeout() {},
    setInterval(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer }, clearInterval() {},
    fetch() { throw Error('Tests must not access the network') },
  })
  const link = async (specifier) => {
    const loaded = await import(specifier.startsWith('.') ? new URL(specifier, sourceUrl).href : specifier)
    return new vm.SyntheticModule(Object.keys(loaded), function () {
      for (const [key, value] of Object.entries(loaded)) this.setExport(key, value)
    }, { context })
  }
  const mod = new vm.SourceTextModule(source, {
    context,
    initializeImportMeta(meta) { meta.url = sourceUrl.href },
    async importModuleDynamically(specifier) {
      assert.equal(specifier, 'pdf-parse')
      pdf.imports += 1
      const dependency = new vm.SyntheticModule(['PDFParse'], function () {
        this.setExport('PDFParse', class {
          async getText() { if (pdf.fail) throw Error('invalid PDF'); return { text: 'PDF text' } }
          async destroy() { pdf.destroyed += 1 }
        })
      }, { context })
      await dependency.link(link)
      await dependency.evaluate()
      return dependency
    },
  })
  await mod.link(link)
  await mod.evaluate()
  let route
  const ctx = {
    get() { return null }, effect(fn) { return fn() },
    webServer: { register(config) { route = config.handler; return () => {} } },
    llm: { stream() { throw Error('Tests must not invoke models') } },
    attachments: {},
  }
  const request = async (path) => {
    let status, body
    const req = Object.assign(new EventEmitter(), { url: path, method: 'GET', headers: { host: '127.0.0.1:50121' } })
    await route(req, { setHeader() {}, writeHead(code) { status = code }, end(data) { body = JSON.parse(String(data)) } })
    return { status, body }
  }
  return { api: mod.namespace, pdf, apply() { mod.namespace.apply(ctx) }, request }
}

try {
  await checked('group window includes 15 minutes and excludes the next millisecond', async () => {
    const { api } = await sandbox()
    assert.equal(Object.keys(api.rebuildGroups([image('a'), image('b', 900_000)]).groups).length, 1)
    api.setTestGroups({})
    assert.equal(Object.keys(api.rebuildGroups([image('a'), image('b', 900_001)]).groups).length, 0)
  })
  await checked('source, aspect, pending and invalid-date exclusions remain effective', async () => {
    const { api } = await sandbox()
    for (const edit of [item => { item.source = { kind: 'other' } }, item => { item.image.width = 300 }, item => { item.status = 'summarizing' }, item => { item.createdAt = 'invalid' }]) {
      const other = image('b'); edit(other); api.setTestGroups({})
      assert.equal(Object.keys(api.rebuildGroups([image('a'), other]).groups).length, 0)
    }
  })
  await checked('group order, transitive members and the eight-screen cap are preserved', async () => {
    const { api } = await sandbox()
    const items = Array.from({ length: 10 }, (_, i) => image('i' + i, i * 600_000)).reverse()
    const group = Object.values(api.rebuildGroups(items).groups)[0]
    assert.deepEqual(Array.from(group.itemIds), Array.from({ length: 8 }, (_, i) => 'i' + i))
  })
  await checked('manual, merged and dismissed groups survive, with removed merged content invalidated', async () => {
    const { api } = await sandbox()
    for (const attributes of [{ source: 'manual', status: 'candidate' }, { source: 'auto', status: 'merged' }, { source: 'auto', dismissed: true }]) {
      api.setTestGroups({ saved: { id: 'saved', ...attributes, itemIds: ['a', 'b'], primaryId: 'a' } })
      assert.ok(api.rebuildGroups([image('a'), image('b')]).groups.saved)
    }
    api.setTestGroups({ saved: { id: 'saved', source: 'manual', status: 'merged', itemIds: ['a', 'b', 'deleted'], primaryId: 'deleted', merged: { content: 'stale' } } })
    const group = api.rebuildGroups([image('a'), image('b')]).groups.saved
    assert.equal(group.merged, null); assert.equal(group.status, 'candidate'); assert.equal(group.primaryId, 'a')
  })
  await checked('light list omits raw text, preserves legacy document identity and leaves storage untouched', async () => {
    const { api } = await sandbox()
    const items = [{ id: 'doc', text: 'original document', summary: { title: 'title' } }, image('a')]
    const before = JSON.stringify(items), list = api.itemsForList(items)
    assert.equal(list.items[0].kind, 'document'); assert.equal('text' in list.items[0], false)
    assert.equal(list.items[0].summary.title, 'title'); assert.equal(JSON.stringify(items), before)
    assert.equal(api.itemsForList(items, list.version).unchanged, true)
    assert.equal(api.itemsForList([{ ...items[0], kind: 'image' }]).items[0].kind, 'document')
  })
  await checked('item edits, deletion and group updates invalidate the list cursor', async () => {
    const { api } = await sandbox()
    const items = [image('a'), image('b')]
    let version = api.itemsForList(items).version
    for (const status of ['failed', 'ready']) {
      items[0].status = status; api.saveItems(items)
      const list = api.itemsForList(items, version)
      assert.equal(list.items[0].status, status); assert.notEqual(list.version, version); version = list.version
    }
    items.pop(); api.saveItems(items)
    const deleted = api.itemsForList(items, version); assert.equal(deleted.items.length, 1)
    api.setTestGroups({ g: { id: 'g', itemIds: ['a', 'b'], status: 'candidate' } }); api.saveGroups()
    assert.equal(api.itemsForList(items, deleted.version).groups[0].id, 'g')
    const other = await sandbox(); assert.notEqual(other.api.itemsForList(items).version, api.itemsForList(items).version)
  })
  await checked('original full endpoint remains compatible; list endpoint supports conditional polling', async () => {
    const document = { id: 'doc', kind: 'document', text: 'original document', status: 'ready', createdAt: now, summary: { title: 'Document', content: 'Content', entities: [] } }
    const s = await sandbox([document]); s.apply()
    const full = await s.request('/auracap/api/items'); assert.equal(full.status, 200); assert.equal(full.body.items[0].text, document.text)
    const list = await s.request('/auracap/api/items?view=list'); assert.equal(list.body.items[0].text, undefined)
    const same = await s.request('/auracap/api/items?view=list&version=' + encodeURIComponent(list.body.version))
    assert.equal(same.body.unchanged, true); assert.equal('items' in same.body, false)
  })
  await checked('PDF dependency is deferred; parser is destroyed on success and failure', async () => {
    const { api, pdf } = await sandbox(); assert.equal(pdf.imports, 0)
    assert.equal(await api.extractPdfText(Buffer.from('test')), 'PDF text'); assert.equal(pdf.destroyed, 1)
    pdf.fail = true; await assert.rejects(api.extractPdfText(Buffer.from('test')), /invalid PDF/)
    assert.equal(pdf.destroyed, 2)
  })
  console.log(`${checks} performance regression groups passed`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
