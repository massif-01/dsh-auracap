import assert from 'node:assert/strict'
import { parseInsightOutput } from '../index.js'

const markdown = parseInsightOutput('# 一屏之内\n\n### 本周主线\n正文')
assert.equal(markdown.title, '一屏之内')
assert.equal(markdown.content, '### 本周主线\n正文')

const legacy = parseInsightOutput('{"title":"旧标题","content":"### 正文\\n内容"}')
assert.equal(legacy.title, '旧标题')
assert.equal(legacy.content, '### 正文\n内容')

const truncated = parseInsightOutput('{\n  "title": "坏 JSON",\n  "content": "第一段\\n\\n### 小标题\\n第二段')
assert.equal(truncated.title, '坏 JSON')
assert.equal(truncated.content.startsWith('{'), false)

const raw = parseInsightOutput('{"title":"raw","content":"{\\"bad\\":"}')
assert.equal(raw.title, '')
assert.equal(raw.content, '')

console.log('insight parser ok')
