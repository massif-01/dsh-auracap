<p align="center">
  <img src="assets/icon-mark.png" width="84" alt="AuraCap · 拾穗">
</p>

<h1 align="center">AuraCap · 拾穗</h1>

<p align="center">
  <em>把散落的片刻轻轻拾起，让它们在回头时连成脉络。</em>
</p>

> 一个长在 DeepSeek Harness 里的个人记忆插件。  
> 手机截图、相册照片、电脑文件，收进同一个地方。

AuraCap 不是另一个笔记软件，也不是知识图谱。  
它只做三件事：**收进来、读明白、在需要的时候想起来。**

---

## 现在能做什么

### 收进来

- **电脑**：拖入图片、PDF、TXT 或 Markdown，或点右上角「导入」；
- **截图**：点截图按钮，按 macOS 的 `⌘⇧4` 截完自动收进来；
- **手机**：通过 iOS 快捷指令，把截屏、相册照片分享进来；
- **手机运行方式**：分享菜单、`Action Button`、辅助功能里的「轻点背面」。

### 读明白

- 图片交给 `deepseek-flash` 读图，输出 `核心内容 / 行动项 / 待确认`；
- PDF 和文本先提取正文，再交给模型整理；
- 自动生成标题、摘要和标签；
- 支持重新整理、复制总结、删除单条片刻。

### 回看

- 「今天 / 全部」时间线，支持双栏和卡片视图；
- 标签可点击，直接过滤当前列表；
- 每条片刻会抽出**线索**（人物、项目、产品、主题）；
- 线索浮层展示它出现过的片刻、时间线和相关洞察；
- 相关片刻会说明关联理由，例如「同属 AuraCap」「都提到 Geist」；
- `/` 打开全局搜索，可搜片刻、洞察和线索。

### 洞察

- 日洞察：每天自动汇总，最多每 4 小时刷新一次；
- 周迹、月迹、岁迹：周期结束后自动生成，也可以在洞察页手动生成；
- 新生成的洞察带有「依据 N 条片刻」，可以展开回看来源；
- 洞察会引用当天/当周的真实片段，不凭空写。

### 记忆

- 自动抽取线索，并用通用规则合并同一事物的不同写法；
- 旧数据可在「设置 → 记忆」里建立索引；
- 不引入向量数据库，不维护第二套不可解释的记忆；
- 所有关联都有来源，不做黑盒「猜你喜欢」。

### 用量

- 记录 AuraCap 自己发起的模型调用；
- 按模型、用途、日期统计 token；
- 按 DeepSeek 官方人民币单价估算费用，含高峰/空闲时段；
- 只做估算，不代表实际账单。

---

## 第一次使用

首次打开时，AuraCap 会先引导你把手机接上。

### 接手机

1. 点「连接手机」；
2. 在 GitHub 输入验证码完成授权；
3. 插件自动创建一个**私有收件箱**；
4. 下载快捷指令；
5. 用 AirDrop 把文件传到 iPhone，系统会把它加入「快捷指令」；
6. 之后可以：
   - 在相册里分享照片给 AuraCap；
   - 把快捷指令绑定到 `Action Button / 操作按钮`；
   - 没有 Action Button 的设备，绑定到「设置 → 辅助功能 → 触控 → 轻点背面」。

### 先只用电脑

也可以点「先在电脑上试试」，直接拖入图片或文件。  
不接手机、不连 GitHub 也能使用本地导入、读图、搜索和洞察。

---

## 为什么是 GitHub？

手机在外面，Mac 在家里，中间需要一个只有你能访问的地方。

GitHub 的**私有仓库 + Release** 正好可以当这个中转：

- 正常个人用量免费；
- 不需要我们自己的服务器；
- 不需要你配置端口、域名或 token；
- 手机截屏先进入你的私有收件箱；
- Mac 取回后，插件会从队列中删除原图；
- 授权只存在本机 DSH 凭据里，可以随时在 GitHub 设置中撤销。

不用它的话，就需要自己维护一台有公网地址的服务器，或者接付费同步服务。  
读图和总结仍然走 DeepSeek 模型，结果、原图、索引都留在本机。

`auracap-inbox` 是私有仓库，代码仓库 `dsh-auracap` 不包含任何用户截图或个人数据。

---

## 日常使用

### 导入

- 拖拽：图片、PDF、TXT、Markdown；
- 导入：右上角上传按钮；
- 系统截图：截图按钮 → `⌘⇧4` → 自动导入；
- 手机：快捷指令上传到私有收件箱，本机自动轮询取回。

图片支持 PNG / JPEG / WebP / GIF，单张 ≤ 30MB；导入文件 ≤ 40MB。

### 阅读

- 左侧是片刻列表，右侧是整理结果；
- 顶部可切换双栏 / 卡片；
- 「查看原图」打开大图；
- 标签点击后过滤当前列表，点筛选条上的 × 取消。

### 洞察

- 切到「洞察」；
- 选择今日 / 周迹 / 月迹 / 岁迹；
- 有新内容时可以重新生成；
- 展开「依据的片刻」查看来源。

### 搜索

- 按 `/` 打开搜索；
- 支持片刻、洞察、线索；
- 点击线索结果会打开线索浮层。

---

## 数据与隐私

### 数据在哪里

默认数据目录：

```text
$DSH_HOME/auracap/
  items.json          片刻索引与总结
  media/              原图留档
  digests/            日洞察
  insights/           周/月/年洞察
  memory/             线索索引、用量；项目上下文（规划中）
  state.json          GitHub 收件箱状态
```

`$DSH_HOME` 默认是 `~/.dsh`。

### 边界

- 原图、总结、洞察、线索索引都保存在本机；
- 读图/总结会把对应内容发送给 DeepSeek 模型，和日常对话使用同一数据边界；
- GitHub 只作为手机与本机之间的私有中转，不参与读图和总结；
- 手机上传的原图在 Mac 取回后从队列删除；
- GitHub 授权只保存在本机 DSH 凭据里；
- 删除片刻会删除本地原图和索引；DSH 附件库按 DSH 既有策略保留。

### 不给模型自动写记忆

AuraCap 不做“模型自己记住用户偏好”的自动写入。  
线索从内容里抽出来；未来的 Agent 设计上也只读，项目上下文由用户维护，不由模型自行写入。

---

## 安装

### 要求

- DeepSeek Harness `>= 0.2.1-rc.2 < 0.3.0`（当前在 `0.2.2-rc.1` 验证）；
- 默认模型路由：`deepseek-account` / `deepseek-flash`；
- 手机接入需要 GitHub 账号；
- 系统截图流程仅支持 macOS。

### 安装本地 bundle

1. 在 DSH 的插件管理里安装本目录（Install bundle），或让 DSH 指向本地 `dsh-auracap`；
2. **重启 DSH**，Host 侧插件需要重新加载；
3. 左侧栏出现 AuraCap，点开即可。

更新 Host 代码后重启 DSH；只改 Client 代码时刷新页面即可。

---

## 架构

```text
dsh-auracap/
  index.js            Host：HTTP API、模型调用、本地存储、GitHub 队列
  client.js           Client：侧栏入口 + 主面板（React，无构建步骤）
  prompts/            读图、文本、洞察、线索抽取提示词
  locale/             插件元数据（中文 / English）
  assets/             图标、字体、快捷指令模板、测试图
  docs/               快捷指令指南与开发预览
```

### Host

- 通过 Cordis `webServer` 注册 `/auracap/api/*`；
- 读图：`ctx.attachments.saveImage` → `ctx.llm.stream`；
- 本地数据原子写入 `items.json`；
- GitHub 设备授权、私有仓库/Release 自动创建、队列轮询；
- 定时任务：日洞察刷新、周/月/年洞察、GitHub 同步。

### Client

- 通过 `sidebar.panellist` 注册侧栏入口；
- 通过 `main` slot 注册主面板；
- 使用 DSH 主题 token，无 iframe；
- 首次引导、时间线、详情、线索浮层、洞察、设置、搜索都在同一面板内。

### 模型

默认：

```js
{ provider: 'deepseek-account', model: 'deepseek-flash' }
```

---

## 已知限制

- **扫描版 PDF 没有 OCR**：只支持能提取文字的 PDF；
- **旧洞察的来源**：`sourceItemIds` 是后来加的，旧洞察需要重新生成才有「依据」；
- **旧标签**：早期数据可能有 tags 为空，不会自动补；
- **旧线索**：需要在设置里手动建立一次记忆索引；
- **费用是估算**：按官方单价和高峰/空闲时段计算，法定节假日例外没有接入；
- **GitHub token 失效**：设置里会提示，需要重新连接；
- **刷新节奏**：本机面板平时 15 秒刷新，摘要处理中 2.5 秒，页面隐藏时 60 秒；GitHub 队列本身 60 秒轮询；
- **不做**：独立主题页、向量数据库、自动写入用户画像。

---

## 路线图

### 已完成

- 本地导入、系统截图、手机 GitHub 队列；
- 图片/PDF/文本摘要；
- 日/周/月/年洞察；
- 标签过滤、线索索引、相关片刻、洞察来源；
- 首次引导、设置重排、token/费用统计；
- 通用线索归并，不写死品牌规则。

### 接下来

1. **多屏归组 + 手动合并**：同一篇文章的多屏截图自动归组，详情页合并成一条；
2. **项目上下文**：维护少量 active 项目、当前问题、约束，注入长洞察和 Agent；
3. **Agent 只读记忆工具**：`search_moments`、`moments_about`、`related_moments`、`recent_insights`；
4. **线索人工校正**：合并、改名、忽略；
5. **旧数据回填**：标签和旧洞察来源。

### 已提 issue / 暂缓

- [Tailscale 直传](https://github.com/massif-01/dsh-auracap/issues/1)：有真实隐私需求再做；
- [从片刻详情「转新对话」](https://github.com/massif-01/dsh-auracap/issues/2)：等 DSH 的会话注入接口成熟；
- [基于原 AuraCap 项目重写 README](https://github.com/massif-01/dsh-auracap/issues/3)：文风和叙事再打磨。

### 明确不做

- 独立收件箱页面 / 未读 / 待办 / 失败筛选；
- 洞察导出 Markdown；
- SSE 实时推送：用自适应轮询替代；
- 本地 inbox 文件夹监听；
- iCloud 分享链接：下载 + AirDrop 已足够；
- PAT 授权：Device Flow 已覆盖；
- HEIC 转换兜底：交给 Shortcuts；
- 独立主题页：内容留在相关片刻和线索浮层里；
- 向量数据库：先靠实体 + 时间 + 全文；
- Agent 自由写入记忆：只读，必要时由用户显式保存为片刻。

---

## 致谢

- 产品思路与提示词来自 [AuraCap](https://github.com/massif-01/AuraCap)（原项目 MIT，当前插件以 Apache 2.0 发布）；
- 插件机制基于 DeepSeek Harness / Cordis；
- 字体使用 [Geist](https://github.com/vercel/geist-font)（SIL OFL）。

## License

本仓库的原创代码与文档以 **Apache License 2.0** 发布，完整文本见 [LICENSE](LICENSE)。

版权与归属声明见 [NOTICE](NOTICE)，第三方组件、字体、原 AuraCap 的 MIT 提示词来源与商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Apache 2.0 包含明确的专利授权；但它只授予代码版权与专利许可，不授予 AuraCap、DeepSeek Harness、GitHub 等名称或标识的商标权。
