import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dataDir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'auracap')
const itemsFile = join(dataDir, 'items.json')
const mediaDir = join(dataDir, 'media')
const demoFlag = 'demo'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const clean = process.argv.includes('--clean')

const pad = (v) => String(v).padStart(2, '0')
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const isoWeekKey = (date) => {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round((utc.getTime() - first.getTime()) / 604800000)
  return `${utc.getUTCFullYear()}-W${pad(week)}`
}

if (!existsSync(itemsFile)) {
  console.error('没有找到 items.json，请先启动一次 AuraCap。')
  process.exit(1)
}

const items = JSON.parse(readFileSync(itemsFile, 'utf8'))
const source = items.find((item) => item.status === 'ready' && item.imageFile && existsSync(join(dataDir, item.imageFile)))
if (!source) {
  console.error('没有找到可复用的截图文件，请先正常收一条截图。')
  process.exit(1)
}
mkdirSync(mediaDir, { recursive: true })

// 清理旧的 demo 数据
const kept = items.filter((item) => item.demo !== demoFlag)
for (const item of items) {
  if (item.demo === demoFlag && item.imageFile) {
    try { unlinkSync(join(dataDir, item.imageFile)) } catch {}
  }
}
if (clean) {
  writeFileSync(itemsFile, JSON.stringify(kept, null, 2))
  for (const type of ['weekly', 'monthly', 'yearly']) {
    const dir = join(dataDir, 'insights', type)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (parsed.demo === demoFlag) unlinkSync(file)
      } catch {}
    }
  }
  console.log('已清理 demo 数据。')
  process.exit(0)
}

const themes = [
  ['Agent 评测笔记', '### 核心内容\n记录了 Agent 评测的两个关键点：先建立真实验收集，再让模型自己跑回归；只追求分数容易过拟合。\n### 行动项\n- 在一个小项目上试跑 build-eval。', ['ai', 'eval']],
  ['理光 GR 直出参数', '### 核心内容\n负片模式基础上调整对比度和白平衡，适合阴天和室内。\n参数：饱和度 +2、对比度 +3、白平衡 A6G0。', ['摄影', '理光']],
  ['行政轿车 NVH 对比', '### 核心内容\n几台行政旗舰的静态隔声与行驶噪声数据，重点看 80km/h 和 120km/h 的差距。\n### 待确认\n- 测试路面和轮胎条件是否一致。', ['汽车', 'NVH']],
  ['网站品质提示词', '### 核心内容\n把 awwwards、FWA 的获奖标准写进提示词，让模型先自检再交付。\n### 行动项\n- 下次做落地页时试一次。', ['design', 'prompt']],
  ['Slack 社区引导', '### 核心内容\nvLLM 工作区的成员和频道列表，推荐先加入 pr-reviews 和 semantic-router。', ['community']],
  ['相机色彩参考', '### 核心内容\n一组胶片模拟的色彩倾向：高光偏暖、阴影偏青，适合街拍。', ['摄影', 'color']],
  ['产品设计拆解', '### 核心内容\n一个编辑器界面的信息层级：左侧导航、中间画布、右侧属性面板；底部只保留状态。', ['design', 'product']],
  ['旅行路线备忘', '### 核心内容\n三天路线：第一天老城，第二天博物馆，第三天近郊；第二天需要提前预约。', ['travel']],
  ['论文阅读摘录', '### 核心内容\n多模态模型的评测不应只看单图问答，还要看跨图推理和长上下文。', ['paper', 'ai']],
  ['会议纪要', '### 核心内容\n确定了本周的三个优先级：评测集、上传链路、移动端入口。\n### 行动项\n- 周四前给出评测集初版。', ['work', 'meeting']],
  ['咖啡店清单', '### 核心内容\n收藏了三家手冲店，其中两家周末排队较长，建议工作日去。', ['life']],
  ['代码报错记录', '### 核心内容\n`TypeError: Cannot read properties of undefined` 来自异步初始化顺序；把依赖放进 effect 后解决。', ['code']],
]

const makeDate = (offsetDays, hour = 10) => {
  const date = new Date(2026, 0, 5, hour, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date
}

const seeded = []
for (let index = 0; index < 31; index += 1) {
  const created = makeDate(index * 10, 9 + (index % 8))
  const theme = themes[index % themes.length]
  const id = `demo-${pad(index + 1)}`
  const ext = source.imageFile.split('.').pop() || 'jpg'
  const fileName = `demo-${pad(index + 1)}.${ext}`
  copyFileSync(join(dataDir, source.imageFile), join(mediaDir, fileName))
  seeded.push({
    id,
    demo: demoFlag,
    createdAt: created.toISOString(),
    updatedAt: created.toISOString(),
    status: 'ready',
    image: Object.assign({}, source.image, { name: fileName }),
    summary: {
      title: theme[0],
      content: theme[1],
      excerpt: theme[1].replace(/^###.*$/gm, '').replace(/\n+/g, ' ').trim().slice(0, 120),
      tags: theme[2],
      contentType: 'other',
      language: 'zh',
    },
    error: null,
    model: 'demo',
    source: null,
    imageFile: `media/${fileName}`,
  })
}

const all = kept.concat(seeded).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
writeFileSync(itemsFile, JSON.stringify(all, null, 2))
try { writeFileSync(join(dataDir, `items.demo-backup-${stamp}.json`), JSON.stringify(items, null, 2)) } catch {}

const today = new Date(2026, 10, 7, 12)
const weekStart = new Date(today)
weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
const prevWeek = new Date(weekStart)
prevWeek.setDate(prevWeek.getDate() - 7)
const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0, 12)
const currentWeekKey = isoWeekKey(weekStart)
const prevWeekKey = isoWeekKey(prevWeek)
const currentMonthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
const prevMonthKey = `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}`

const writeInsight = (type, key, start, end, title, content) => {
  const dir = join(dataDir, 'insights', type)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${key}.json`)
  if (existsSync(file)) return
  writeFileSync(file, JSON.stringify({
    type, key, start, end, title, content, itemCount: 0, sourceCount: 0,
    createdAt: new Date().toISOString(), model: 'demo', demo: demoFlag,
  }, null, 2))
}

writeInsight('weekly', prevWeekKey, dateKey(prevWeek), dateKey(new Date(prevWeek.getTime() + 6 * 86400000)), '这一周留下的三条线', '### 本周主线\n评测、上传链路和移动端入口同时在推进。\n\n### 推进与搁置\n上传链路已经跑通；评测集仍停在准备阶段。\n\n### 反复出现的信号\n“先把真实链路跑通，再谈优化”出现了不止一次。\n\n### 下周值得带入\n先把评测集做出一个可运行的小版本。')
writeInsight('weekly', currentWeekKey, dateKey(weekStart), dateKey(new Date(weekStart.getTime() + 6 * 86400000)), '把链路接起来的一周', '### 本周主线\n从手机截图到桌面碎片的链路已经打通。\n\n### 推进与搁置\n移动端上传和插件消费已经验证；洞察的长期结构还在设计。\n\n### 反复出现的信号\n「不要让用户配置」反复出现，产品判断开始收敛。')
writeInsight('monthly', prevMonthKey, `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-01`, `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-${pad(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate())}`, '从记录到链路的十月', '### 本月轨迹\n这个月的主线从“收集截图”转向“让截图自己到达”。\n\n### 主题与变化\n前半月的记录以阅读和参考为主；后半月开始出现上传、评测、移动端入口这些动手信号。\n\n### 反复出现的信号\n对“无感”和“不打断”的要求越来越明确。\n\n### 下个月值得关注\n把链路稳定下来，再考虑更长的洞察。')
writeInsight('monthly', currentMonthKey, `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate())}`, '十一月：把碎片接成线', '### 本月轨迹\n从单张截图的提取，转向时间线和长期洞察。\n\n### 主题与变化\n产品判断从“功能”转向“体验”；技术侧从“能跑”转向“稳定”。\n\n### 反复出现的信号\n降低配置摩擦、保持无感记录。')

console.log(`已加入 ${seeded.length} 条 demo 碎片。`)
console.log(`备份：${join(dataDir, `items.demo-backup-${stamp}.json`)}`)
console.log(`demo 周洞察：${prevWeekKey} / ${currentWeekKey}`)
console.log(`demo 月洞察：${prevMonthKey} / ${currentMonthKey}`)
