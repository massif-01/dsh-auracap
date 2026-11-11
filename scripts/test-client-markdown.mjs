// Regression guard for the AuraCap client Markdown renderer.
// The client bundle is a browser script, so the renderer is lifted out of
// client.js by its section markers and evaluated with a stand-in React.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('function stripInlineMarkdown(')
const end = source.indexOf('function groupTitle(')
assert.ok(start > 0 && end > start, 'renderer section markers moved; update this test')

const exposed = new Function('h', 'React', `${source.slice(start, end)}\nreturn { stripInlineMarkdown, plainTextOf, previewOf, renderInline, parseMarkdownSections }`)
const { stripInlineMarkdown, previewOf, renderInline, parseMarkdownSections } = exposed(React.createElement, React)

const types = (nodes) => nodes.map((node) => (typeof node === 'string' ? 'text' : node.type))

// Inline markers must become elements, not literal characters.
const inline = renderInline('**粗体** 与 `MEMORY.md` 和 *斜体*')
assert.deepEqual(types(inline), ['strong', 'text', 'code', 'text', 'em'])
assert.equal(inline[0].props.children, '粗体')
assert.equal(inline[2].props.children, 'MEMORY.md')

// Only safe link targets become anchors.
const link = renderInline('[文档](https://example.com/a)')
assert.equal(link[0].type, 'a')
assert.equal(link[0].props.rel, 'noreferrer noopener')
const unsafe = renderInline('[危险](javascript:alert(1))')
assert.equal(unsafe.some((node) => typeof node !== 'string' && node.type === 'a'), false)
assert.equal(unsafe.join(''), '[危险](javascript:alert(1))')

// `**` inside inline code stays literal, and code is not re-parsed.
const nested = renderInline('`a**b**`')
assert.equal(nested[0].type, 'code')
assert.equal(nested[0].props.children, 'a**b**')

// Blocks keep the original order: paragraph, list, paragraph, then the next section.
const muse = [
  '### 核心内容',
  '董青山整理了五类机制：',
  '- **长期记忆**（`MEMORY.md`）：实时记录。',
  '  1. 编号条目',
  '',
  '作者注明：内容依据提示词整理。',
  '',
  '### 待确认',
  '- 正文缺少上下文。',
].join('\n')
const sections = parseMarkdownSections(muse)
assert.deepEqual(sections.map((section) => section.label), ['核心内容', '待确认'])
assert.deepEqual(sections[0].blocks.map((block) => block.type), ['paragraph', 'list', 'list', 'paragraph'])
assert.equal(sections[0].blocks[1].items[0].text, '**长期记忆**（`MEMORY.md`）：实时记录。')
assert.equal(sections[0].blocks[2].ordered, true)
assert.equal(sections[0].blocks[2].items[0].depth, 1)
assert.equal(sections[0].blocks[3].text, '作者注明：内容依据提示词整理。')
assert.equal(sections[1].blocks[0].type, 'list')

// Fenced code, quotes and tables survive as their own blocks.
const rich = ['```js', 'const x = 1', '```', '> 引用', '> 第二行', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n')
const richBlocks = parseMarkdownSections(rich)[0].blocks.map((block) => block.type)
assert.deepEqual(richBlocks, ['code', 'quote', 'table'])
assert.equal(parseMarkdownSections(rich)[0].blocks[1].text, '引用\n第二行')

// Wrapped bullet lines stay inside the same list item.
const wrapped = parseMarkdownSections('- 第一行\n  续行').at(0).blocks[0]
assert.equal(wrapped.items[0].text, '第一行\n续行')

// Plain-text surfaces never leak stored Markdown markers (old items keep raw excerpts).
assert.equal(stripInlineMarkdown('**长期记忆**（`MEMORY.md`）'), '长期记忆（MEMORY.md）')
assert.equal(stripInlineMarkdown('[官方链接](https://example.com) 与 *斜体*'), '官方链接 与 斜体')
assert.equal(stripInlineMarkdown('价格 2 * 3 * 4'), '价格 2 * 3 * 4')
const stale = { excerpt: '**长期记忆**（`MEMORY.md`）：对话中实时记录', summary: '', content: '' }
assert.equal(previewOf({ summary: stale }), '长期记忆（MEMORY.md）：对话中实时记录')
const halfBold = { excerpt: '**未闭合的粗体', summary: '', content: '' }
assert.equal(previewOf({ summary: halfBold }), '未闭合的粗体')

console.log('client markdown ok')
