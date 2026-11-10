async page => {
  const out = 'output/playwright/unified-ui-fixed-20261111/'
  const passed = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(8000)
  const check = (value, message) => { if (!value) throw Error(message) }
  const origin = new URL(page.url()).origin
  await page.unrouteAll()
  await page.evaluate(() => localStorage.setItem('auracap.view', 'split'))
  let finish
  await page.route('**/auracap/api/items?view=list*', async route => {
    const response = await route.fetch(), data = await response.json(), document = data.items.find(item => item.id === 'document-a')
    const extra = ['other-a', 'other-b'].map(id => ({ ...document, id, createdAt: new Date().toISOString(), summary: { title: id } }))
    await route.fulfill({ response, json: { ...data, items: data.items.concat(extra), groups: data.groups.concat({ id: 'other-group', itemIds: ['other-a', 'other-b'], primaryId: 'other-a', merged: { title: '另一个组', content: '独立内容。' } }), version: 'two-groups-fixed' } })
  })
  await page.route('**/auracap/api/groups/grp-manual/merge', async route => {
    await new Promise(resolve => { finish = resolve })
    await route.fulfill({ status: 500, json: { error: '测试：原分组的合并失败' } })
  })
  await page.reload()
  await page.locator('.ac-group-row').filter({ hasText: '合并记录' }).click()
  await page.getByRole('button', { name: '重新合并整理', exact: true }).click()
  await page.getByRole('button', { name: '正在合并…', exact: true }).waitFor()
  check(await page.getByRole('button', { name: '撤销合并整理', exact: true }).isDisabled(), 'Other group actions are not blocked')
  await page.locator('.ac-group-row').filter({ hasText: '另一个组' }).click()
  check(await page.getByRole('button', { name: '正在合并…', exact: true }).count() === 0, 'The new group inherited progress')
  finish()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '重新合并整理' && !button.disabled))
  check(await page.locator('.ac-group-error').count() === 0, 'The new group inherited the old error')
  await page.screenshot({ path: out + 'group-no-crossed-error.png' })
  passed.push('Progress and failures stay with their target group after navigation')
  await page.unrouteAll()

  const generation = (await (await page.request.get(origin + '/auracap/api/backup/status')).json()).generation
  await page.request.post(origin + '/auracap/api/groups/grp-manual/dismiss', { headers: { 'x-auracap-generation': generation } })
  await page.reload()
  await page.getByRole('button', { name: '与其他片刻归组', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择要归组的片刻', exact: true })
  await picker.locator('.ac-merge-option').click()
  let submittedIds
  await page.route('**/auracap/api/groups', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submittedIds = route.request().postDataJSON().itemIds
    await new Promise(resolve => { finish = resolve })
    const response = await route.fetch(); await route.fulfill({ response })
  })
  await picker.getByRole('button', { name: '归为一组 · 2', exact: true }).click()
  await picker.getByRole('button', { name: '正在归组…', exact: true }).waitFor()
  check(await picker.getByRole('button', { name: '取消', exact: true }).isDisabled(), 'An unimplemented cancellation is still offered')
  check(await picker.locator('.ac-merge-option').isDisabled(), 'Selection can change after submission')
  await page.keyboard.press('Escape')
  check(await picker.count() === 1, 'Escape hid an operation that cannot be cancelled')
  await page.screenshot({ path: out + 'grouping-pending.png' })
  finish()
  await page.getByRole('button', { name: '合并整理', exact: true }).waitFor()
  check(submittedIds.length === 2, 'The displayed total does not match the group')
  await page.screenshot({ path: out + 'group-created.png' })
  passed.push('Grouping names and total match the real API; pending controls cannot falsely cancel or change the submitted selection')

  await page.evaluate(() => { document.documentElement.lang = 'en' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'AuraCap Settings', exact: true })
  await settings.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles({ name: 'invalid.auracap.zip', mimeType: 'application/zip', buffer: Buffer.from('not a backup') })
  const restore = page.getByRole('dialog', { name: 'Restore backup', exact: true })
  await restore.getByRole('alert').filter({ hasText: 'not a valid full AuraCap backup' }).waitFor()
  check(!/[\u4e00-\u9fff]/.test(await restore.getByRole('alert').textContent()), 'The task error leaked untranslated Chinese')
  await page.screenshot({ path: out + 'english-invalid-backup.png' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  passed.push('A real invalid archive produces an actionable English task error in the restore dialog')
  await page.unrouteAll()
  await page.reload()
  check(errors.length === 0, errors.join('\n'))
  await page.evaluate(result => { window.__fixedGroups = result }, { passed, runtimeErrors: errors })
}
