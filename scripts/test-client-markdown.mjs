// Regression guard for the AuraCap Markdown renderer and the server-side
// plain-text extraction. The client bundle is a browser script, so the renderer
// is lifted out of client.js by its section markers and evaluated with a
// stand-in React.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import {
  parseSummary,
  stripInlineMarkdown as serverStrip,
  cleanPreviewText as serverPreview,
  makeExcerpt,
  searchSnippet,
  compactItemLine,
  plainTextOfSummary,
} from '../index.js'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('// Inline Markdown for model output.')
const end = source.indexOf('function groupTitle(')
assert.ok(start > 0 && end > start, 'renderer section markers moved; update this test')

const exposed = new Function('h', 'React', `${source.slice(start, end)}
return { stripInlineMarkdown, inlineToPlainText, markdownToPlainText, cleanPreview, plainTextOf, previewOf, renderInline, parseMarkdownSections, summaryMarkdown, summaryCopyText }`)
const {
  stripInlineMarkdown, inlineToPlainText, markdownToPlainText, cleanPreview,
  previewOf, renderInline, parseMarkdownSections, summaryMarkdown, summaryCopyText,
} = exposed(React.createElement, React)

const types = (nodes) => nodes.map((node) => (typeof node === 'string' ? 'text' : node.type))
const plain = (node) => {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plain).join('')
  return node.props ? plain(node.props.children) : ''
}

// Inline markers become elements, not literal characters.
const inline = renderInline('**粗体** 与 `MEMORY.md` 和 *斜体*')
assert.deepEqual(types(inline), ['strong', 'text', 'code', 'text', 'em'])
assert.equal(plain(inline), '粗体 与 MEMORY.md 和 斜体')

// Code spans stay literal: emphasis markers inside them are never parsed away.
for (const value of ['__init__', '2**3', 'src/**/test.js', 'a_b', 'https://example.com/?q=__init__']) {
  const nodes = renderInline('`' + value + '`')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].type, 'code')
  assert.equal(nodes[0].props.children, value)
  assert.equal(inlineToPlainText('`' + value + '`'), value)
  assert.equal(serverStrip('`' + value + '`'), value)
}

// Emphasis nested in strong, escaped stars and compact math.
const boldCode = renderInline('**运行 `npm run build`**')
assert.equal(boldCode.length, 1)
assert.equal(boldCode[0].type, 'strong')
assert.ok([].concat(boldCode[0].props.children).some((node) => node && node.type === 'code'))
assert.equal(inlineToPlainText('**运行 `npm run build`**'), '运行 npm run build')
assert.equal(inlineToPlainText('***重点***'), '重点')
assert.equal(inlineToPlainText('2*3*4'), '2*3*4')
assert.equal(inlineToPlainText('价格 2 * 3 * 4'), '价格 2 * 3 * 4')
assert.deepEqual(types(renderInline('价格 2*3*4')), ['text'])
assert.equal(plain(renderInline('\\*保留原样\\*')), '*保留原样*')
assert.deepEqual(types(renderInline('这是**粗体**内容和*斜体*文本')), ['text', 'strong', 'text', 'em', 'text'])
assert.equal(plain(renderInline('这是**粗体**内容和*斜体*文本')), '这是粗体内容和斜体文本')

// Emphasis never matches across a code span or a link target.
const boldCode2 = renderInline('**运算 `2**3`**')
assert.equal(boldCode2.length, 1)
assert.equal(boldCode2[0].type, 'strong')
assert.ok([].concat(boldCode2[0].props.children).some((node) => node && node.type === 'code'))
assert.equal(inlineToPlainText('**运算 `2**3`**'), '运算 2**3')
assert.equal(serverStrip('**运算 `2**3`**'), '运算 2**3')
assert.equal(inlineToPlainText('**粗体** 与 `2**3` 与 `src/**/test.js`'), '粗体 与 2**3 与 src/**/test.js')
const boldLink = renderInline('**见 [文档](https://example.com/a_b)**')
assert.ok([].concat(boldLink[0].props.children).some((node) => node && node.type === 'a'))

// "**" may follow a letter so page markers survive, but not a digit.
assert.equal(inlineToPlainText('第 page**2** 页'), '第 page2 页')
assert.equal(inlineToPlainText('2**3'), '2**3')
assert.deepEqual(types(renderInline('2**3')), ['text'])

// Links: balanced targets, protocol whitelist, literal fallback.
const paren = renderInline('[文档](https://example.com/wiki/Example_(software))')
assert.equal(paren.length, 1)
assert.equal(paren[0].type, 'a')
assert.equal(paren[0].props.href, 'https://example.com/wiki/Example_(software)')
assert.equal(plain(paren), '文档')
assert.equal(inlineToPlainText('[文档](https://example.com/wiki/Example_(software))'), '文档 (https://example.com/wiki/Example_(software))')
for (const href of ['https://example.com/a', 'http://example.com/b', 'mailto:someone@example.com']) {
  assert.equal(renderInline('[链接](' + href + ')')[0].props.href, href)
}
const titled = renderInline('[Guide](https://example.com/a "Guide")')
assert.equal(titled[0].props.href, 'https://example.com/a')
assert.equal(titled[0].type, 'a')
const angled = renderInline('[Guide](<https://example.com/a_(b)>)')
assert.equal(angled[0].props.href, 'https://example.com/a_(b)')
const escaped = renderInline('[a](https://example.com/a\\(b\\))')
assert.equal(escaped[0].props.href, 'https://example.com/a(b)')
const longTarget = 'https://example.com/' + 'a'.repeat(900)
assert.equal(renderInline('[a](' + longTarget + ')')[0].props.href, longTarget)
const unsafe = renderInline('[危险](javascript:alert(1))')
assert.equal(unsafe.some((node) => typeof node !== 'string' && node.type === 'a'), false)
assert.equal(plain(unsafe), '[危险](javascript:alert(1))')
assert.equal(plain(renderInline('[缺少引号](https://example.com/a')), '[缺少引号](https://example.com/a')

// Long unclosed brackets stay linear (this was a 4.5s pathological case).
const brackets = '['.repeat(64000)
let startedAt = Date.now()
const bracketNodes = renderInline(brackets)
const bracketRenderMs = Date.now() - startedAt
assert.equal(plain(bracketNodes), brackets)
startedAt = Date.now()
assert.equal(stripInlineMarkdown(brackets), brackets)
assert.ok(bracketRenderMs < 500, `renderInline of 64k "[" took ${bracketRenderMs}ms`)
assert.ok(Date.now() - startedAt < 500)

// Blocks keep their order and list numbering per depth.
const muse = [
  '### 核心内容',
  '董青山整理了五类机制：',
  '- **长期记忆**（`MEMORY.md`）：实时记录。',
  '',
  '作者注明：内容依据提示词整理。',
  '',
  '### 待确认',
  '- 正文缺少上下文。',
].join('\n')
const sections = parseMarkdownSections(muse)
assert.deepEqual(sections.map((section) => section.label), ['核心内容', '待确认'])
assert.deepEqual(sections[0].blocks.map((block) => block.type), ['paragraph', 'list', 'paragraph'])
assert.equal(sections[0].blocks[1].items[0].text, '**长期记忆**（`MEMORY.md`）：实时记录。')
assert.equal(sections[0].blocks[2].text, '作者注明：内容依据提示词整理。')

const numbered = parseMarkdownSections('3. 步骤\n   1. 子项\n4. 收尾')[0].blocks[0]
assert.equal(numbered.ordered, true)
assert.deepEqual(numbered.items.map((item) => [item.depth, item.number]), [[0, 3], [1, 1], [0, 4]])
assert.equal(markdownToPlainText('3. 步骤\n   1. 子项\n4. 收尾'), '3. 步骤\n  1. 子项\n4. 收尾')
assert.equal(inlineToPlainText('3. 步骤'), '3. 步骤')

// Fenced code: longer fences, indentation, trailing spaces and blank lines survive.
const fenced = parseMarkdownSections('````md\n```js\nx\n```\n````')[0].blocks
assert.equal(fenced.length, 1)
assert.equal(fenced[0].type, 'code')
assert.equal(fenced[0].text, '```js\nx\n```')
const codeBody = '  key: value  \n\n\n  next: 1'
assert.equal(markdownToPlainText('```yaml\n' + codeBody + '\n```'), codeBody)
const tickSpan = parseMarkdownSections('`` `inline` ``')[0].blocks[0]
assert.equal(tickSpan.type, 'paragraph')
assert.equal(inlineToPlainText(tickSpan.text), '`inline`')

// Tables keep escaped pipes in one cell; quotes split on blank lines.
const indentedFence = parseMarkdownSections('```\n    ```\nstill code\n```')[0].blocks
assert.equal(indentedFence.length, 1)
assert.equal(indentedFence[0].text, '    ```\nstill code')
const badInfo = parseMarkdownSections('```js `x`\nafter')[0].blocks
assert.equal(badInfo.every((block) => block.type !== 'code' || !block.text.includes('after')), true)
const tableMarkdown = '| JS | `a \\| b` |\n| --- | --- |\n| 1 | 2 |'
const table = parseMarkdownSections(tableMarkdown)[0].blocks[0]
assert.equal(table.header.length, 2)
assert.equal(table.header[1], '`a | b`')
assert.equal(plain(renderInline(table.header[1])), 'a | b')
assert.equal(markdownToPlainText(tableMarkdown), 'JS | a | b\n1 | 2')
const quotes = parseMarkdownSections('> 引用一\n\n> 引用二')[0].blocks
assert.equal(quotes.length, 2)
assert.equal(markdownToPlainText('> 引用一\n\n> 引用二'), '  引用一\n\n  引用二')

// Section labels go through the same inline parsing as body text.
const headingSection = parseMarkdownSections('### **核心内容**\n正文')[0]
assert.equal(headingSection.label, '**核心内容**')
assert.equal(renderInline(headingSection.label)[0].type, 'strong')
assert.equal(markdownToPlainText('### **核心内容**\n正文'), '核心内容\n正文')

// Detail and copy share the same body selection.
assert.equal(summaryMarkdown({ content: '### A\nx' }), '### A\nx')
assert.equal(summaryMarkdown({ content: ' ', summary: '### 旧标题\n- 摘要' }), '### 旧标题\n- 摘要')
assert.equal(summaryMarkdown({ content: '', summary: '普通摘要' }), '')
assert.equal(markdownToPlainText('### 旧标题\n- **摘要**'), '旧标题\n· 摘要')

// Group continuation still recognizes page markers after the emphasis change.
assert.ok(plainTextOfSummary({ content: '第 page**2** 页' }).includes('page2'))

// Copy follows the same body selection as the detail view, including legacy fields.
assert.equal(summaryCopyText({ title: 'T', content: '### A\n正文' }), 'T\n\nA\n正文')
assert.equal(summaryCopyText({ title: '旧摘要', summary: '纯文本', keyPoints: ['要点一', '要点二'], todos: ['待办'] }), '旧摘要\n\n纯文本\n1. 要点一\n2. 要点二\n□ 待办')
assert.equal(summaryCopyText({ title: '旧标题条目', summary: '### 旧标题\n- **摘要**' }), '旧标题条目\n\n旧标题\n· 摘要')
assert.equal(
  summaryCopyText({ title: '旧', summary: '### 旧\n- 摘要', keyPoints: ['请确认'], todos: ['联系 Alice'] }),
  '旧\n\n旧\n· 摘要\n1. 请确认\n□ 联系 Alice',
)

// Mixed list types split into separate blocks; wrapped lines stay in the item.
const mixed = parseMarkdownSections('- a\n1. b\n2. c')[0].blocks
assert.deepEqual(mixed.map((block) => [block.ordered, block.items.length]), [[false, 1], [true, 2]])
assert.equal(markdownToPlainText('- a\n1. b'), '· a\n\n1. b')
const wrapped = parseMarkdownSections('- 第一行\n  续行')[0].blocks[0]
assert.equal(wrapped.items[0].text, '第一行\n续行')

// Generated excerpts are plain text and must not be cleaned twice.
assert.equal(previewOf({ summary: { excerpt: '计算 2**3 和 src/**/test.js', excerptClean: true } }), '计算 2**3 和 src/**/test.js')

// Generation to display: a saved excerpt is already plain text.
const generated = parseSummary(JSON.stringify({ title: '生成', content: '### 核心内容\n计算 `2**3` 和 `src/**/test.js`' }))
assert.equal(generated.excerptClean, true)
assert.ok(generated.excerpt.includes('2**3'), generated.excerpt)
assert.equal(previewOf({ summary: generated }), generated.excerpt.slice(0, 160))
assert.equal(previewOf({ summary: { content: '### 标题\n正文' } }), '正文')

// Previews tolerate the markers that were cut off in stored excerpts.
assert.equal(previewOf({ summary: { excerpt: '**未闭合的粗体' } }), '未闭合的粗体')
assert.equal(cleanPreview('**长期记忆**（`MEMORY.md`'), '长期记忆（MEMORY.md')
assert.equal(serverPreview('**未闭合的粗体'), '未闭合的粗体')
assert.equal(serverPreview('**长期记忆**（`MEMORY.md`'), '长期记忆（MEMORY.md')
assert.equal(previewOf({ summary: { excerpt: '**长期记忆**（`MEMORY.md`）：对话中实时记录' } }), '长期记忆（MEMORY.md）：对话中实时记录')

// Server-side cleaning is structure-aware as well.
assert.equal(serverStrip('`__init__` 与 `2**3`'), '__init__ 与 2**3')
assert.equal(serverStrip('[文档](https://example.com/?q=__init__)'), '文档')
assert.equal(makeExcerpt('`__init__` 与 `2**3`'), '__init__ 与 2**3')
assert.equal(makeExcerpt('### 标题\n- **要点**'), '要点')
assert.ok(makeExcerpt('```sh\n# config flag\n- argument\n1. keep\n```').includes('# config flag'))
assert.ok(makeExcerpt('```sh\n# config flag\n- argument\n1. keep\n```').includes('- argument'))
assert.ok(makeExcerpt('```sh\n# config flag\n- argument\n1. keep\n```').includes('1. keep'))
const blank = '\n'.repeat(32000)
const blankStarted = Date.now()
makeExcerpt(blank)
assert.ok(Date.now() - blankStarted < 500, 'blank lines must not make excerpt extraction slow')
const summaryStarted = Date.now()
plainTextOfSummary({ content: blank })
assert.ok(Date.now() - summaryStarted < 500, 'blank lines must not make summary extraction slow')
const longBrackets = makeExcerpt('['.repeat(64000))
assert.ok(longBrackets.length <= 240)

const located = searchSnippet('x'.repeat(400) + ' __init__ tail', ['__init__'])
assert.ok(located.includes('__init__'), located)
assert.ok(located.startsWith('…'), located)
assert.equal(searchSnippet('开头 `__init__` 结尾', ['__init__']).includes('__init__'), true)
const headingHit = searchSnippet('### 关键词标题\n正文内容', ['关键词'])
assert.ok(headingHit.includes('关键词标题'), headingHit)
const longQuery = 'q'.repeat(90)
const longSnippet = searchSnippet('x'.repeat(200) + longQuery + 'tail', [longQuery])
assert.ok(longSnippet.includes(longQuery), longSnippet)

const legacy = compactItemLine({ id: 'old-1', createdAt: '2026-11-01T00:00:00Z', summary: { title: '旧条目', excerpt: '**旧摘要** 内容' } }, 0)
assert.ok(legacy.includes('旧摘要 内容'), legacy)

// Group status aggregates members instead of showing the latest one only.
const statusStart = source.indexOf('function groupStatus(')
const statusEnd = source.indexOf('function GroupStack(')
assert.ok(statusStart > 0 && statusEnd > statusStart)
const { groupStatus } = new Function('h', 'React', `${source.slice(statusStart, statusEnd)}\nreturn { groupStatus }`)(React.createElement, React)
assert.equal(groupStatus([{ status: 'ready' }, { status: 'failed' }]), 'ready')
assert.equal(groupStatus([{ status: 'failed' }, { status: 'summarizing' }]), 'summarizing')
assert.equal(groupStatus([{ status: 'failed' }, { status: 'failed' }]), 'failed')
assert.equal(groupStatus([]), 'ready')

console.log('client markdown ok')
