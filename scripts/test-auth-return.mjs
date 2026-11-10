// node --experimental-vm-modules scripts/test-auth-return.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fixture, untilTask } from './backup-fixture.mjs'

const previous = { login: 'existing', owner: 'existing', name: 'auracap-inbox', releaseId: 7, tag: 'auracap-inbox', connectedAt: '2026-01-01T00:00:00Z' }
const oldGrant = { kind: 'grant', payload: { token: 'existing-token', login: 'existing' } }
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return
    await nextTurn()
  }
  throw Error('Expected authorization phase did not arrive')
}
function grants(beforeWrite = async () => {}) {
  let value = structuredClone(oldGrant), writes = 0
  return {
    async readRecord() { return value },
    async modifyRecord(key, update) { await beforeWrite(); value = await update(value); writes++ },
    get value() { return value }, get writes() { return writes },
  }
}
function network({ token, user = async () => json({ login: 'next' }) }) {
  return async (url, options) => {
    if (url.endsWith('/login/device/code')) return json({ device_code: 'device-secret', user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 })
    if (url.endsWith('/login/oauth/access_token')) return token(options)
    if (url === 'https://api.github.com/user') return user(options)
    if (url.includes('/releases/tags/')) return json({ id: 8 })
    if (url.includes('/repos/next/')) return json({ private: true, default_branch: 'main' })
    throw Error('Unexpected external request in authorization test: ' + url)
  }
}
async function begin(app) {
  const flow = await app.request('github/device', post({}))
  const timer = app.timers.findLast(timer => timer.ms === 5000 && !timer.cancelled)
  assert.ok(timer)
  timer.fn()
  return flow
}

test('return drains a late token response, preserves the existing grant, and releases restore admission', async () => {
  const incoming = Promise.withResolvers(), credentials = grants()
  let requestSignal
  const app = await fixture({ credentials, githubState: previous, network: network({ token: options => { requestSignal = options.signal; return incoming.promise } }) })
  try {
    // Prepare a real restore preview before starting phone authorization.
    const full = await app.request('backup/tasks', post({ type: 'export', kind: 'package', operationId: randomUUID() }))
    await untilTask(app, full.id, task => task.state === 'DOWNLOAD_READY')
    const bytes = await (await fetch(app.origin + '/auracap/api/backup/tasks/' + full.id + '/file')).arrayBuffer()
    const restore = await app.request('backup/tasks', post({ type: 'restore', operationId: randomUUID() }))
    await app.request('backup/tasks/' + restore.id + '/archive', { method: 'PUT', body: bytes })
    await untilTask(app, restore.id, task => task.state === 'PREVIEW_READY')
    const flow = await begin(app); await waitFor(() => requestSignal)
    await assert.rejects(app.request('backup/tasks/' + restore.id + '/restore', post()), error => error.code === 'PHONE_CONNECTION_PENDING')
    let returned = false
    const cancel = app.request('github/device/' + flow.id + '/cancel', post()).then(value => { returned = true; return value })
    await waitFor(() => requestSignal.aborted); assert.equal(returned, false)
    // Deliberately emulate a transport completing after it was aborted.
    incoming.resolve(json({ access_token: 'late-token' }))
    assert.equal((await cancel).status, 'cancelled')
    assert.equal((await app.request('github/device/' + randomUUID() + '/cancel', post())).status, 'cancelled')
    assert.equal(credentials.writes, 0); assert.deepEqual(credentials.value, oldGrant)
    assert.deepEqual(JSON.parse(await readFile(join(app.dir, 'state.json'))).github, previous)
    await app.request('backup/tasks/' + restore.id + '/restore', post())
    await untilTask(app, restore.id, task => task.state === 'SUCCEEDED')
    assert.equal(app.modelCalls, 0)
  } finally { incoming.resolve(json({ error: 'authorization_pending' })); await app.close() }
})

test('return during repository preparation cannot replace an existing connection; a new attempt can finish', async () => {
  const pendingUser = Promise.withResolvers(), credentials = grants()
  let userSignal, delayed = true
  const app = await fixture({ credentials, githubState: previous, network: network({ token: async () => json({ access_token: 'next-token' }), user: options => { userSignal = options.signal; return delayed ? pendingUser.promise : json({ login: 'next' }) } }) })
  try {
    const flow = await begin(app); await waitFor(() => userSignal)
    assert.equal((await app.request('github/device/' + flow.id)).status, 'provisioning')
    const cancel = app.request('github/device/' + flow.id + '/cancel', post())
    await waitFor(() => userSignal.aborted); pendingUser.resolve(json({ login: 'next' }))
    assert.equal((await cancel).status, 'cancelled')
    assert.equal(credentials.writes, 0); assert.deepEqual(credentials.value, oldGrant)
    assert.equal((await app.request('github/status')).repo.owner, 'existing')
    delayed = false
    const fresh = await begin(app)
    await waitFor(async () => (await app.request('github/device/' + fresh.id)).status === 'ready')
    assert.equal(credentials.writes, 1)
    assert.equal((await app.request('github/status')).repo.owner, 'next')
    assert.equal((await app.request('github/device/' + flow.id)).status, 'cancelled')
  } finally { pendingUser.resolve(json({ login: 'next' })); await app.close() }
})

test('return at the grant commit boundary waits for the established result instead of disconnecting it', async () => {
  const commit = Promise.withResolvers(); let committing = false
  const credentials = grants(() => { committing = true; return commit.promise })
  const app = await fixture({ credentials, githubState: previous, network: network({ token: async () => json({ access_token: 'committed-token' }) }) })
  try {
    const flow = await begin(app); await waitFor(() => committing)
    let returned = false
    const cancel = app.request('github/device/' + flow.id + '/cancel', post()).then(value => { returned = true; return value })
    await nextTurn(); assert.equal(returned, false)
    commit.resolve()
    assert.equal((await cancel).status, 'ready')
    assert.equal((await app.request('github/status')).repo.owner, 'next')
    assert.equal(credentials.value.payload.token, 'committed-token')
  } finally { commit.resolve(); await app.close() }
})

test('failed grant storage leaves the existing connection authoritative', async () => {
  const credentials = grants(async () => { throw Error('Credential storage unavailable') })
  const app = await fixture({ credentials, githubState: previous, network: network({ token: async () => json({ access_token: 'not-saved-token' }) }) })
  try {
    const flow = await begin(app)
    await waitFor(async () => ['ready', 'failed'].includes((await app.request('github/device/' + flow.id)).status))
    assert.equal((await app.request('github/device/' + flow.id)).status, 'failed')
    assert.deepEqual(credentials.value, oldGrant)
    assert.deepEqual(JSON.parse(await readFile(join(app.dir, 'state.json'))).github, previous)
  } finally { await app.close() }
})

test('concurrent starts share one unfinished flow, which status can reattach and return can end', async () => {
  let starts = 0
  const app = await fixture({ network: async url => {
    if (!url.endsWith('/login/device/code')) throw Error('Unexpected request')
    starts++
    return json({ device_code: 'one-flow', user_code: 'ONE-CODE', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 })
  } })
  try {
    const [first, second] = await Promise.all([app.request('github/device', post()), app.request('github/device', post())])
    assert.equal(first.id, second.id)
    assert.equal(starts, 1)
    assert.equal((await app.request('github/status')).device.id, first.id)
    assert.equal((await app.request('github/device', post())).id, first.id)
    await app.request('github/device/' + first.id + '/cancel', post())
    assert.equal((await app.request('github/status')).device, null)
    assert.equal(app.gate.jobs.size, 0)
  } finally { await app.close() }
})

test('unload waits for both credential and repository state to finish the same commit', async () => {
  const commit = Promise.withResolvers(); let committing = false, closing
  const credentials = grants(() => { committing = true; return commit.promise })
  const app = await fixture({ credentials, githubState: previous, network: network({ token: async () => json({ access_token: 'next-token' }) }) })
  try {
    await begin(app); await waitFor(() => committing)
    closing = app.close({ preserve: true })
    await nextTurn()
    commit.resolve()
    await closing
    const saved = JSON.parse(await readFile(join(app.dir, 'state.json')))
    assert.equal(credentials.value.payload.login, 'next')
    assert.equal(saved.github.owner, credentials.value.payload.login)
  } finally {
    commit.resolve()
    if (!closing) await app.close()
    else { await closing; await rm(app.home, { recursive: true, force: true }) }
  }
})
