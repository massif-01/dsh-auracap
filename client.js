window.__ModuleLoader__.load({
  id: 'dsh-auracap',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'auracap'
    const API = '/auracap/api'

    const ZH = {
      appName: 'AuraCap',
      fragments: '碎片',
      layout: '视图',
      split: '双栏',
      grid: '卡片',
      import: '导入截图',
      importing: '处理中…',
      today: '今天',
      all: '全部',
      localOnly: '只在本机处理',
      dropTitle: '松手，收进碎片',
      dropHint: '同源面板直接读取，不经过相册或云盘',
      emptyTitle: '把碎片留在这里',
      emptyHint: '拖入一张截图，或用手机快捷指令随手拍下；AuraCap 会读图并整理成可检索的碎片。',
      emptyTodayTitle: '今天还没有新碎片',
      emptyTodayHint: '切到「全部」，看看之前收进来的内容。',
      viewAll: '查看全部',
      privacy: '截图保存在本机，仅用于生成总结。',
      summarizing: '正在读图…',
      failed: '整理失败',
      ready: '已整理',
      untitled: '未命名碎片',
      noSummary: '正在生成总结…',
      keyPoints: '要点',
      todos: '待办',
      tags: '标签',
      copy: '复制总结',
      copied: '已复制',
      retry: '重新整理',
      delete: '删除',
      confirmDelete: '确认删除',
      close: '关闭',
      loadFailed: '加载失败',
      onlyImages: '只支持图片文件',
      local: '本地导入',
      source: '来源',
      insights: '洞察',
      insightToday: '今日洞察',
      generateInsight: '生成今日洞察',
      generating: '正在归纳…',
      insightRegenerate: '重新生成',
      insightBasedOn: '基于今日碎片',
      insightUpdated: '生成于',
      insightEmptyTitle: '今天还没有洞察',
      insightEmptyHint: '把今天的碎片放在一起，AuraCap 会从中找主题、未完成信号和值得跟进的事。',
      viewOriginal: '查看原图',
      settings: '设置',
      githubQueue: 'GitHub 队列',
      githubHint: '连接后自动创建一个私有仓库和收件箱 Release；手机快捷指令把截图传进去，插件消费后立即删除。',
      connectGithub: '连接 GitHub',
      githubWaiting: '等待 GitHub 授权…',
      deviceCode: '在 GitHub 输入此代码',
      openDevice: '打开 GitHub 授权页',
      githubConnected: '已连接',
      githubNotConnected: '未连接',
      githubRepo: '仓库',
      githubQueueCount: '待处理',
      githubLastSync: '上次同步',
      githubSyncNow: '立即同步',
      githubRepair: '检查 / 修复',
      githubDisconnect: '断开连接',
      shortcutTitle: '手机快捷指令配置',
      shortcutHint: '在快捷指令里用一个文本变量保存这行配置；上传时先按 | 拆分，再按 / 拆分仓库。',
      copyConfig: '复制配置',
      configCopied: '已复制',
      githubError: 'GitHub 操作失败',
      itemsUnit: '条',
      phoneEntry: '手机入口',
      phoneIntro: '连接已完成。下面三步把手机接进来；快捷指令我们最后再做。',
      stepInstall: '安装快捷指令',
      stepInstallHint: '快捷指令模板稍后提供；做好后这里会出现安装链接。',
      stepConfig: '写入配置',
      stepConfigHint: '配置里包含 token，只粘贴到你自己的快捷指令里。',
      copyConfigDone: '已复制，等快捷指令做好后粘贴到唯一的文本变量。',
      stepTest: '发送测试图',
      stepTestHint: '用插件内置的测试图走一遍 上传 → 消费 → 总结，确认链路通了。',
      testUpload: '发送测试图',
      testing: '正在发送…',
      testSuccess: '已上传并消费，看看「今天」列表。',
      advanced: '高级',
      hideAdvanced: '收起高级',
      showConfig: '显示配置',
      hideConfig: '隐藏配置',
      templateSoon: '模板准备中',
    }

    const EN = {
      appName: 'AuraCap',
      fragments: 'fragments',
      layout: 'Layout',
      split: 'Split',
      grid: 'Grid',
      import: 'Import',
      importing: 'Working…',
      today: 'Today',
      all: 'All',
      localOnly: 'Processed on this Mac',
      dropTitle: 'Drop to capture',
      dropHint: 'Read in place — never uploaded to Photos or a cloud drive',
      emptyTitle: 'Keep your fragments here',
      emptyHint: 'Drop a screenshot, or capture one from the phone shortcut. AuraCap reads it and turns it into a searchable fragment.',
      emptyTodayTitle: 'Nothing captured today',
      emptyTodayHint: 'Switch to All to see earlier fragments.',
      viewAll: 'View all',
      privacy: 'Screenshots stay on this Mac and are used only to write the summary.',
      summarizing: 'Reading the screenshot…',
      failed: 'Could not summarize',
      ready: 'Ready',
      untitled: 'Untitled fragment',
      noSummary: 'Writing the summary…',
      keyPoints: 'Key points',
      todos: 'Action items',
      tags: 'Tags',
      copy: 'Copy summary',
      copied: 'Copied',
      retry: 'Try again',
      delete: 'Delete',
      confirmDelete: 'Confirm delete',
      close: 'Close',
      loadFailed: 'Failed to load',
      onlyImages: 'Images only',
      local: 'Local import',
      source: 'Source',
      insights: 'Insights',
      insightToday: 'Today’s insight',
      generateInsight: 'Generate insight',
      generating: 'Reading the day…',
      insightRegenerate: 'Regenerate',
      insightBasedOn: 'Based on',
      insightUpdated: 'Generated',
      insightEmptyTitle: 'No insight yet',
      insightEmptyHint: 'Bring today’s fragments together and AuraCap will look for themes, loose ends, and things worth following up.',
      viewOriginal: 'View original',
      settings: 'Settings',
      githubQueue: 'GitHub queue',
      githubHint: 'Connecting creates a private inbox repo and release. The phone shortcut uploads screenshots; the plugin consumes and deletes them.',
      connectGithub: 'Connect GitHub',
      githubWaiting: 'Waiting for GitHub authorization…',
      deviceCode: 'Enter this code on GitHub',
      openDevice: 'Open GitHub authorization',
      githubConnected: 'Connected',
      githubNotConnected: 'Not connected',
      githubRepo: 'Repository',
      githubQueueCount: 'Pending',
      githubLastSync: 'Last sync',
      githubSyncNow: 'Sync now',
      githubRepair: 'Check / repair',
      githubDisconnect: 'Disconnect',
      shortcutTitle: 'Phone shortcut configuration',
      shortcutHint: 'Store this line in a Text variable. Split by |, then split the repository by /.',
      copyConfig: 'Copy config',
      configCopied: 'Copied',
      githubError: 'GitHub request failed',
      itemsUnit: 'items',
      phoneEntry: 'Phone',
      phoneIntro: 'Connected. Three steps to bring your phone in; the shortcut comes last.',
      stepInstall: 'Install the shortcut',
      stepInstallHint: 'The shortcut template is coming later; an install link will appear here.',
      stepConfig: 'Store the config',
      stepConfigHint: 'The config contains a token; paste it only into your own shortcut.',
      copyConfigDone: 'Copied. Paste it into the single Text variable once the shortcut exists.',
      stepTest: 'Send a test capture',
      stepTestHint: 'Runs a built-in test image through upload → consume → summary to prove the pipeline.',
      testUpload: 'Send test capture',
      testing: 'Sending…',
      testSuccess: 'Uploaded and consumed. Check Today.',
      advanced: 'Advanced',
      hideAdvanced: 'Hide advanced',
      showConfig: 'Show config',
      hideConfig: 'Hide config',
      templateSoon: 'Template soon',
    }

    const CSS = `
.ac-root { height: 100%; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; overflow: hidden; position: relative; }
.ac-root * { box-sizing: border-box; }
.ac-header { flex: none; display: flex; align-items: center; gap: 10px; height: 58px; padding: 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ac-mark { width: 28px; height: 28px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); display: grid; place-items: center; color: var(--dsw-alias-brand-primary); flex: none; }
.ac-titles { display: flex; flex-direction: column; line-height: 1.15; }
.ac-name { font-size: 13.5px; font-weight: 600; letter-spacing: .01em; }
.ac-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.ac-count { font-size: 11px; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
.ac-grow { flex: 1; }
.ac-seg { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 9px; }
.ac-seg button { width: 30px; height: 24px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 7px; display: grid; place-items: center; cursor: pointer; padding: 0; }
.ac-seg button:hover { color: var(--dsw-alias-label-primary); }
.ac-seg button[aria-pressed="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.ac-primary { height: 30px; padding: 0 13px; border-radius: 8px; border: 0; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-family: inherit; }
.ac-primary:hover { opacity: .88; }
.ac-primary:disabled { opacity: .38; cursor: default; }
.ac-tabs { flex: none; display: flex; align-items: center; gap: 18px; height: 40px; padding: 0 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ac-tab { border: 0; background: transparent; padding: 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; height: 40px; position: relative; font-family: inherit; }
.ac-tab:hover { color: var(--dsw-alias-label-primary); }
.ac-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary); }
.ac-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1.5px; background: var(--dsw-alias-label-primary); }
.ac-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .8; }
.ac-body { flex: 1; display: flex; min-height: 0; }
.ac-list { width: 236px; flex: none; border-right: 1px solid var(--dsw-alias-border-l1); overflow: auto; padding: 8px; }
.ac-row { display: flex; gap: 10px; padding: 6px 8px; border-radius: 8px; align-items: center; border: 1px solid transparent; cursor: pointer; transition: background .12s ease, border-color .12s ease; }
.ac-row:hover { background: var(--dsw-alias-bg-layer-1); }
.ac-row[data-active="true"] { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.ac-thumb { width: 40px; height: 52px; flex: none; border-radius: 5px; object-fit: cover; object-position: top center; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.ac-row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.ac-row-title { font-size: 12.5px; font-weight: 500; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ac-row-desc { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ac-row-meta { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--dsw-alias-label-secondary); margin-top: auto; padding-top: 2px; }
.ac-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ac-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); display: inline-block; flex: none; }
.ac-dot[data-state="summarizing"] { background: var(--dsw-alias-brand-primary); animation: ac-pulse 1.4s ease-in-out infinite; }
.ac-dot[data-state="ready"] { background: var(--dsw-alias-state-success-primary); }
.ac-dot[data-state="failed"] { background: var(--dsw-alias-state-error-primary); }
@keyframes ac-pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
.ac-detail { flex: 1; min-width: 0; overflow: auto; padding: 32px 42px 64px; }
.ac-detail-inner { max-width: 860px; margin: 0 auto; }
.ac-h1 { font-size: 21px; line-height: 1.35; font-weight: 600; letter-spacing: -.01em; margin: 0 0 10px; }
.ac-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 18px; }
.ac-section { margin-top: 22px; }
.ac-sec-label { font-size: 10.5px; letter-spacing: .09em; color: var(--dsw-alias-label-secondary); margin-bottom: 8px; font-weight: 500; }
.ac-body-text { font-size: 13.5px; line-height: 1.85; white-space: pre-wrap; }
.ac-points { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }
.ac-point { display: flex; gap: 10px; font-size: 13px; line-height: 1.65; }
.ac-point-no { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; padding-top: 3px; min-width: 17px; letter-spacing: .05em; }
.ac-todos { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ac-todo { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.65; }
.ac-todo-dot { width: 13px; height: 13px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); flex: none; margin-top: 3px; }
.ac-bullets { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ac-bullet { display: flex; gap: 10px; font-size: 13px; line-height: 1.65; }
.ac-bullet-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--dsw-alias-label-secondary); flex: none; margin-top: 9px; }
.ac-digest { flex: 1; overflow: auto; padding: 30px 28px 60px; }
.ac-digest-inner { max-width: 860px; margin: 0 auto; }
.ac-digest-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 26px; }
.ac-digest-date { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.ac-digest-actions { margin-left: auto; }
.ac-digest-h1 { font-size: 24px; line-height: 1.35; font-weight: 600; letter-spacing: -.01em; margin: 0 0 10px; }
.ac-digest-meta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 26px; }
.ac-digest-empty { padding: 70px 20px; text-align: center; }
.ac-digest-hint { max-width: 420px; margin: 0 auto 20px; font-size: 13px; line-height: 1.75; color: var(--dsw-alias-label-secondary); }
.ac-digest .ac-body-text { margin-bottom: 0; }
.ac-icon-button { width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); display: grid; place-items: center; cursor: pointer; }
.ac-icon-button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.ac-settings { width: min(680px, 100%); max-height: 86vh; overflow: auto; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; box-shadow: 0 30px 80px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); padding: 26px 28px 32px; position: relative; }
.ac-settings-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.ac-settings-title { font-size: 17px; font-weight: 600; }
.ac-settings-section { padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 22px; }
.ac-set-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.ac-set-label { font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 92px; }
.ac-set-value { font-size: 12.5px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.ac-set-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.ac-device { margin-top: 14px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.ac-device-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px; letter-spacing: .12em; font-weight: 600; margin: 8px 0 12px; }
.ac-device-link { color: var(--dsw-alias-brand-primary); font-size: 12.5px; text-decoration: none; }
.ac-device-link:hover { text-decoration: underline; }
.ac-config { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; word-break: break-all; line-height: 1.6; }
.ac-settings-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.7; margin: 10px 0 0; }
.ac-steps { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; }
.ac-step { display: flex; gap: 13px; align-items: flex-start; }
.ac-step-no { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; display: grid; place-items: center; flex: none; margin-top: 1px; }
.ac-step-body { flex: 1; min-width: 0; }
.ac-step-title { font-size: 13px; font-weight: 500; line-height: 1.4; }
.ac-step-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; margin-top: 2px; }
.ac-step-actions { display: flex; gap: 8px; margin-top: 8px; }
.ac-advanced { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l1); }
.ac-success { font-size: 12px; color: var(--dsw-alias-state-success-primary); line-height: 1.6; }

.ac-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.ac-tag { font-size: 10.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.ac-actions { display: flex; gap: 8px; margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l1); flex-wrap: wrap; }
.ac-ghost { height: 28px; padding: 0 11px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-family: inherit; }
.ac-ghost:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.ac-ghost:disabled { opacity: .4; cursor: default; }
.ac-ghost[data-danger="true"]:hover { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.ac-skeleton { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--dsw-alias-bg-layer-2) 25%, var(--dsw-alias-bg-layer-1) 37%, var(--dsw-alias-bg-layer-2) 63%); background-size: 400% 100%; animation: ac-shimmer 1.4s ease infinite; }
@keyframes ac-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.ac-error { padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-base)); border-radius: 9px; color: var(--dsw-alias-state-error-primary); font-size: 12.5px; line-height: 1.6; }
.ac-banner { flex: none; margin: 10px 20px 0; padding: 9px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, var(--dsw-alias-bg-base)); color: var(--dsw-alias-state-error-primary); font-size: 12px; display: flex; align-items: center; gap: 10px; }
.ac-banner span { flex: 1; }
.ac-banner button { border: 0; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 2px; opacity: .8; }
.ac-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px; }
.ac-empty-art { width: 128px; height: 128px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); margin-bottom: 26px; opacity: .9; }
.ac-empty h2 { font-size: 21px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 8px; }
.ac-empty p { margin: 0; max-width: 420px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.75; }
.ac-empty .ac-primary { margin-top: 22px; height: 34px; padding: 0 17px; font-size: 13px; }
.ac-footnote { margin-top: 18px; font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .75; }
.ac-grid-wrap { flex: 1; overflow: auto; padding: 22px 26px 44px; }
.ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(228px, 1fr)); gap: 16px; }
.ac-card { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease; display: flex; flex-direction: column; text-align: left; padding: 0; font-family: inherit; color: inherit; }
.ac-card:hover { transform: translateY(-2px); border-color: var(--dsw-alias-border-l2); box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent); }
.ac-card-img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; object-position: top center; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.ac-card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 5px; }
.ac-card-title { font-size: 13px; font-weight: 500; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ac-card-desc { font-size: 11.5px; color: var(--dsw-alias-label-secondary); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ac-card-meta { font-size: 10.5px; color: var(--dsw-alias-label-secondary); margin-top: 4px; display: flex; gap: 8px; }
.ac-modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 40px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent); backdrop-filter: blur(10px); }
.ac-modal-card { width: min(980px, 100%); max-height: 86vh; overflow: auto; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; box-shadow: 0 30px 80px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); position: relative; }
.ac-modal-card .ac-detail { padding: 26px; }
.ac-modal-close { position: absolute; top: 12px; right: 12px; z-index: 2; width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); display: grid; place-items: center; cursor: pointer; }
.ac-modal-close:hover { color: var(--dsw-alias-label-primary); }
.ac-lightbox { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 32px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent); backdrop-filter: blur(14px); cursor: zoom-out; }
.ac-lightbox img { max-width: 94vw; max-height: 92vh; object-fit: contain; border-radius: 10px; box-shadow: 0 30px 90px color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent); }
.ac-drop { position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent); backdrop-filter: blur(2px); pointer-events: none; }
.ac-drop-inner { width: min(420px, 70%); padding: 34px; border: 1.5px dashed var(--dsw-alias-brand-primary); border-radius: 16px; text-align: center; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, var(--dsw-alias-bg-base)); }
.ac-drop-title { font-size: 16px; font-weight: 600; margin-top: 12px; }
.ac-drop-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 6px; }
.ac-drop-icon { width: 40px; height: 40px; border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); display: grid; place-items: center; margin: 0 auto; }
@media (max-width: 900px) {
  .ac-list { width: 208px; }
  .ac-detail { padding: 26px 24px 56px; }
}
@media (prefers-reduced-motion: reduce) {
  .ac-root *, .ac-root *::before, .ac-root *::after { animation: none !important; transition: none !important; }
}
`

    function buildT(ctx) {
      try {
        ctx.locale.register(NS, 'zh', ZH)
        ctx.locale.register(NS, 'en', EN)
        const bound = ctx.locale.bind(NS)
        return (key) => {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value) return value
          } catch {}
          return ZH[key] || key
        }
      } catch {
        return (key) => ZH[key] || key
      }
    }

    function mediaTypeOf(file) {
      if (file && typeof file.type === 'string' && file.type.indexOf('image/') === 0) return file.type
      const name = ((file && file.name) || '').toLowerCase()
      if (name.endsWith('.png')) return 'image/png'
      if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
      if (name.endsWith('.webp')) return 'image/webp'
      if (name.endsWith('.gif')) return 'image/gif'
      return ''
    }

    function isImageFile(file) {
      return Boolean(mediaTypeOf(file))
    }

    async function request(path, options) {
      const response = await fetch(path, Object.assign({ cache: 'no-store' }, options || {}))
      let payload = null
      try { payload = await response.json() } catch {}
      if (!response.ok) throw new Error((payload && payload.error) || 'HTTP ' + response.status)
      return payload || {}
    }

    function pad(value) { return String(value).padStart(2, '0') }

    function isToday(iso) {
      const date = new Date(iso)
      const now = new Date()
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
    }

    function todayKey() {
      const now = new Date()
      return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
    }

    function timeText(iso) {
      const date = new Date(iso)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
      if (isToday(iso)) return pad(date.getHours()) + ':' + pad(date.getMinutes())
      if (date.getFullYear() === now.getFullYear()) return (date.getMonth() + 1) + '月' + date.getDate() + '日'
      return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate())
    }

    function dateText(iso) {
      const date = new Date(iso)
      const now = new Date()
      const sameYear = date.getFullYear() === now.getFullYear()
      const datePart = isToday(iso)
        ? '今天'
        : (sameYear ? (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日' : date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日')
      return datePart + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function BrandMark() {
      return h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3.5, y: 8, width: 11, height: 11, rx: 3, opacity: .4 }),
        h('rect', { x: 9.5, y: 3.5, width: 11, height: 11, rx: 3 }),
        h('circle', { cx: 17.6, cy: 6.4, r: 1.1, fill: 'currentColor', stroke: 'none' }))
    }

    function SplitIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': true },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }),
        h('path', { d: 'M6.5 2.5v11', opacity: .55 }))
    }

    function GridIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': true },
        h('rect', { x: 1.5, y: 1.5, width: 5.5, height: 5.5, rx: 1.4 }),
        h('rect', { x: 9, y: 1.5, width: 5.5, height: 5.5, rx: 1.4 }),
        h('rect', { x: 1.5, y: 9, width: 5.5, height: 5.5, rx: 1.4 }),
        h('rect', { x: 9, y: 9, width: 5.5, height: 5.5, rx: 1.4 }))
    }

    function PlusIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M8 3v10M3 8h10' }))
    }

    function CopyIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.8 }),
        h('path', { d: 'M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5' }))
    }

    function RetryIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
        h('path', { d: 'M13 2.8v3.4H9.6' }))
    }

    function ImageIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 2 }),
        h('circle', { cx: 6, cy: 7, r: 1.1 }),
        h('path', { d: 'M2.5 11.4l3.3-2.8 2.9 2.4 1.9-1.4 2.9 2.2' }))
    }

    function TrashIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M2.8 4.3h10.4M6.4 4.3V3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3M4.2 4.3l.6 8.1a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.1' }))
    }

    function SettingsIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M2.5 4h1.7M8.7 4h4.8' }),
        h('circle', { cx: 6.5, cy: 4, r: 1.5 }),
        h('path', { d: 'M2.5 8h5.6M11.9 8h1.6' }),
        h('circle', { cx: 10.1, cy: 8, r: 1.5 }),
        h('path', { d: 'M2.5 12h1.7M8.7 12h4.8' }),
        h('circle', { cx: 6.5, cy: 12, r: 1.5 }))
    }

    function CloseIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }))
    }

    function EmptyArt() {
      return h('svg', { viewBox: '0 0 112 112', width: 128, height: 128, fill: 'none', 'aria-hidden': true },
        h('rect', { x: 20, y: 34, width: 54, height: 54, rx: 13, stroke: 'currentColor', strokeOpacity: .2, strokeWidth: 1.6 }),
        h('rect', { x: 38, y: 16, width: 54, height: 54, rx: 13, stroke: 'currentColor', strokeOpacity: .55, strokeWidth: 1.6 }),
        h('circle', { cx: 73, cy: 28, r: 4, fill: 'var(--dsw-alias-brand-primary)' }),
        h('path', { d: 'M50 42h28M50 52h18', stroke: 'currentColor', strokeOpacity: .4, strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    function statusText(item, t) {
      if (item.status === 'summarizing') return t('summarizing')
      if (item.status === 'failed') return t('failed')
      return t('ready')
    }

    function plainTextOf(summary) {
      if (!summary) return ''
      const source = typeof summary.content === 'string' && summary.content.trim()
        ? summary.content
        : (typeof summary.summary === 'string' ? summary.summary : '')
      return String(source)
        .replace(/^#{1,6}\s+.*$/gm, ' ')
        .replace(/^\s*[-*]\s+/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    function previewOf(item) {
      const summary = item.summary
      if (!summary) return ''
      if (typeof summary.excerpt === 'string' && summary.excerpt) return summary.excerpt
      return plainTextOf(summary).slice(0, 160)
    }

    function splitSections(markdown) {
      const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
      const sections = []
      let current = null
      const flush = () => {
        if (!current) return
        const bodyText = current.body.join('\n').trim()
        if (bodyText || current.items.length) sections.push({ label: current.label, bodyText, items: current.items })
        current = null
      }
      for (const raw of lines) {
        const line = raw.trim()
        const heading = line.match(/^#{1,6}\s+(.*)$/)
        if (heading) {
          flush()
          current = { label: heading[1].trim(), body: [], items: [] }
          continue
        }
        if (!current) current = { label: '', body: [], items: [] }
        const bullet = line.match(/^[-*]\s+(.*)$/)
        if (bullet) {
          current.items.push(bullet[1].trim())
          continue
        }
        if (!line) {
          if (current.body.length) current.body.push('')
          continue
        }
        current.body.push(raw)
      }
      flush()
      return sections
    }

    function Row(props) {
      const item = props.item
      const t = props.t
      const summary = item.summary
      return h('div', {
        className: 'ac-row',
        'data-active': props.active,
        role: 'button',
        tabIndex: 0,
        onClick: props.onClick,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onClick() }
        },
      },
        h('img', { className: 'ac-thumb', src: API + '/media/' + encodeURIComponent(item.id), alt: '', loading: 'lazy', draggable: false }),
        h('div', { className: 'ac-row-main' },
          h('div', { className: 'ac-row-title' }, summary && summary.title ? summary.title : t('untitled')),
          h('div', { className: 'ac-row-meta' },
            h('span', { className: 'ac-status' }, h('i', { className: 'ac-dot', 'data-state': item.status })),
            h('span', null, timeText(item.createdAt)),
            summary && summary.tags && summary.tags.length ? h('span', null, '#' + summary.tags[0]) : null)))
    }

    function Detail(props) {
      const item = props.item
      const t = props.t
      const [confirm, setConfirm] = useState(false)
      const [copied, setCopied] = useState(false)
      useEffect(() => {
        if (!confirm) return undefined
        const timer = setTimeout(() => setConfirm(false), 4000)
        return () => clearTimeout(timer)
      }, [confirm])
      useEffect(() => { setCopied(false) }, [item.id])
      const summary = item.summary
      const copyText = summary
        ? (typeof summary.content === 'string' && summary.content.trim()
            ? [summary.title, summary.content].filter(Boolean).join('\n\n')
            : [summary.title, summary.summary].concat(summary.keyPoints || [], (summary.todos || []).map((todo) => '□ ' + todo)).filter(Boolean).join('\n\n'))
        : ''
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(copyText)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {}
      }
      const meta = [
        h('span', { className: 'ac-status', key: 'status' }, h('i', { className: 'ac-dot', 'data-state': item.status }), statusText(item, t)),
        h('span', { key: 'date' }, dateText(item.createdAt)),
        h('span', { key: 'source' }, t('local')),
        item.image && item.image.width ? h('span', { key: 'dims' }, item.image.width + ' × ' + item.image.height) : null,
      ]
      const body = []
      if (item.status === 'summarizing') {
        body.push(h('div', { className: 'ac-section', key: 'loading' },
          h('div', { className: 'ac-skeleton', style: { width: '86%', marginBottom: 10 } }),
          h('div', { className: 'ac-skeleton', style: { width: '94%', marginBottom: 10 } }),
          h('div', { className: 'ac-skeleton', style: { width: '62%' } }),
          h('div', { className: 'ac-footnote', style: { marginTop: 14 } }, t('summarizing'))))
      }
      if (item.status === 'failed') {
        body.push(h('div', { className: 'ac-section', key: 'error' }, h('div', { className: 'ac-error' }, item.error || t('failed'))))
      }
      if (summary) {
        const markdown = typeof summary.content === 'string' && summary.content.trim()
          ? summary.content
          : (typeof summary.summary === 'string' && /^\s*#{1,6}\s/m.test(summary.summary) ? summary.summary : '')
        if (markdown) {
          splitSections(markdown).forEach((section, index) => {
            body.push(h('div', { className: 'ac-section', key: 'section-' + index },
              section.label ? h('div', { className: 'ac-sec-label' }, section.label) : null,
              section.bodyText ? h('div', { className: 'ac-body-text' }, section.bodyText) : null,
              section.items.length
                ? h('ul', { className: 'ac-bullets' }, section.items.map((entry, itemIndex) => h('li', { className: 'ac-bullet', key: itemIndex },
                    h('span', { className: 'ac-bullet-dot' }),
                    h('span', null, entry))))
                : null))
          })
        } else {
          if (summary.summary) body.push(h('div', { className: 'ac-section', key: 'summary' }, h('div', { className: 'ac-body-text' }, summary.summary)))
          if (summary.keyPoints && summary.keyPoints.length) {
            body.push(h('div', { className: 'ac-section', key: 'points' },
              h('div', { className: 'ac-sec-label' }, t('keyPoints')),
              h('ol', { className: 'ac-points' }, summary.keyPoints.map((point, index) => h('li', { className: 'ac-point', key: index },
                h('span', { className: 'ac-point-no' }, pad(index + 1)),
                h('span', null, point))))))
          }
          if (summary.todos && summary.todos.length) {
            body.push(h('div', { className: 'ac-section', key: 'todos' },
              h('div', { className: 'ac-sec-label' }, t('todos')),
              h('ul', { className: 'ac-todos' }, summary.todos.map((todo, index) => h('li', { className: 'ac-todo', key: index },
                h('span', { className: 'ac-todo-dot' }),
                h('span', null, todo))))))
          }
        }
        if (summary.tags && summary.tags.length) {
          body.push(h('div', { className: 'ac-section', key: 'tags' },
            h('div', { className: 'ac-sec-label' }, t('tags')),
            h('div', { className: 'ac-tags' }, summary.tags.map((tag, index) => h('span', { className: 'ac-tag', key: index }, tag)))))
        }
      }
      body.push(h('div', { className: 'ac-actions', key: 'actions' },
        h('button', { className: 'ac-ghost', onClick: () => props.onOpenImage(item) }, ImageIcon(), t('viewOriginal')),
        h('button', { className: 'ac-ghost', onClick: copy, disabled: !copyText }, CopyIcon(), copied ? t('copied') : t('copy')),
        h('button', { className: 'ac-ghost', onClick: () => props.onRetry(item) }, RetryIcon(), t('retry')),
        h('button', {
          className: 'ac-ghost',
          'data-danger': true,
          onClick: () => { if (confirm) { props.onDelete(item); setConfirm(false) } else setConfirm(true) },
        }, TrashIcon(), confirm ? t('confirmDelete') : t('delete'))))
      return h('article', { className: 'ac-detail' },
        h('div', { className: 'ac-detail-inner' },
          h('h1', { className: 'ac-h1' }, summary && summary.title ? summary.title : t('untitled')),
          h('div', { className: 'ac-meta' }, meta),
          body))
    }

    function Card(props) {
      const item = props.item
      const t = props.t
      const summary = item.summary
      return h('button', { className: 'ac-card', type: 'button', onClick: props.onClick },
        h('img', { className: 'ac-card-img', src: API + '/media/' + encodeURIComponent(item.id), alt: '', loading: 'lazy', draggable: false }),
        h('div', { className: 'ac-card-body' },
          h('div', { className: 'ac-card-title' }, summary && summary.title ? summary.title : t('untitled')),
          h('div', { className: 'ac-card-desc' },
            item.status === 'ready' ? (previewOf(item) || '')
              : item.status === 'failed' ? (item.error || t('failed'))
                : t('summarizing')),
          h('div', { className: 'ac-card-meta' },
            h('span', null, timeText(item.createdAt)),
            summary && summary.tags && summary.tags.length ? h('span', null, '#' + summary.tags[0]) : null)))
    }

    function SectionBlock(props) {
      const section = props.section
      return h('div', { className: 'ac-section' },
        section.label ? h('div', { className: 'ac-sec-label' }, section.label) : null,
        section.bodyText ? h('div', { className: 'ac-body-text' }, section.bodyText) : null,
        section.items.length
          ? h('ul', { className: 'ac-bullets' }, section.items.map((entry, index) => h('li', { className: 'ac-bullet', key: index },
              h('span', { className: 'ac-bullet-dot' }),
              h('span', null, entry))))
          : null)
    }

    function DigestView(props) {
      const t = props.t
      const digest = props.digest
      const sections = digest && digest.content ? splitSections(digest.content) : []
      const head = h('div', { className: 'ac-digest-head' },
        h('div', { className: 'ac-digest-heading' },
          h('div', { className: 'ac-sec-label', style: { marginBottom: 3 } }, t('insightToday')),
          h('div', { className: 'ac-digest-date' }, props.date)),
        h('div', { className: 'ac-digest-actions' },
          h('button', { className: 'ac-ghost', onClick: props.onGenerate, disabled: props.busy },
            RetryIcon(), props.busy ? t('generating') : (digest ? t('insightRegenerate') : t('generateInsight')))))
      let body
      if (props.busy) {
        body = h('div', null,
          h('div', { className: 'ac-skeleton', style: { width: '58%', height: 22, marginBottom: 18 } }),
          h('div', { className: 'ac-skeleton', style: { width: '92%', marginBottom: 10 } }),
          h('div', { className: 'ac-skeleton', style: { width: '88%', marginBottom: 10 } }),
          h('div', { className: 'ac-skeleton', style: { width: '64%' } }),
          h('div', { className: 'ac-footnote', style: { marginTop: 16 } }, t('generating')))
      } else if (props.error) {
        body = h('div', { className: 'ac-error' }, props.error)
      } else if (digest) {
        body = h('div', null,
          h('h1', { className: 'ac-digest-h1' }, digest.title || t('insightToday')),
          h('div', { className: 'ac-digest-meta' }, t('insightBasedOn') + ' ' + digest.itemCount + ' 条 · ' + t('insightUpdated') + ' ' + timeText(digest.createdAt)),
          sections.map((section, index) => h(SectionBlock, { key: index, section })))
      } else {
        body = h('div', { className: 'ac-digest-empty' },
          h('h2', { className: 'ac-digest-h1' }, t('insightEmptyTitle')),
          h('p', { className: 'ac-digest-hint' }, t('insightEmptyHint')),
          h('button', { className: 'ac-primary', onClick: props.onGenerate }, PlusIcon(), t('generateInsight')))
      }
      return h('div', { className: 'ac-digest' },
        h('div', { className: 'ac-digest-inner' }, head, body))
    }

    function maskedConfig(config) {
      return String(config || '').replace(/\|[^|]+$/, '|••••••••')
    }

    function SettingsModal(props) {
      const t = props.t
      const github = props.github
      const device = props.device
      const shortcut = props.shortcut
      const [advanced, setAdvanced] = useState(false)
      const [showConfig, setShowConfig] = useState(false)
      const connected = Boolean(github && github.connected)
      const waiting = device && (device.status === 'pending' || device.status === 'provisioning')

      let status
      if (!github) {
        status = h('p', { className: 'ac-settings-hint' }, t('githubWaiting'))
      } else if (!connected) {
        status = h('div', null,
          h('p', { className: 'ac-settings-hint' }, t('githubHint')),
          waiting
            ? h('div', { className: 'ac-device' },
                h('div', { className: 'ac-set-label' }, t('deviceCode')),
                h('div', { className: 'ac-device-code' }, device.userCode || ''),
                h('a', { className: 'ac-device-link', href: device.verificationUri || 'https://github.com/login/device', target: '_blank', rel: 'noreferrer' }, t('openDevice')),
                h('div', { className: 'ac-footnote', style: { marginTop: 10 } },
                  device.status === 'provisioning' ? '正在创建私有仓库与收件箱 Release…' : t('githubWaiting')))
            : h('div', { className: 'ac-set-actions' },
                h('button', { className: 'ac-primary', onClick: props.onConnect, disabled: props.busy }, t('connectGithub'))))
      } else {
        status = h('div', null,
          h('div', { className: 'ac-settings-section', style: { borderTop: 0, paddingTop: 0, marginTop: 0 } },
            h('p', { className: 'ac-settings-hint', style: { marginTop: 0, marginBottom: 2 } }, t('phoneIntro')),
            h('div', { className: 'ac-steps' },
              h('div', { className: 'ac-step' },
                h('div', { className: 'ac-step-no' }, '1'),
                h('div', { className: 'ac-step-body' },
                  h('div', { className: 'ac-step-title' }, t('stepInstall')),
                  h('div', { className: 'ac-step-hint' }, t('stepInstallHint')))),
              h('div', { className: 'ac-step' },
                h('div', { className: 'ac-step-no' }, '2'),
                h('div', { className: 'ac-step-body' },
                  h('div', { className: 'ac-step-title' }, t('stepConfig')),
                  h('div', { className: 'ac-step-hint' }, t('stepConfigHint')),
                  h('div', { className: 'ac-step-actions' },
                    h('button', { className: 'ac-ghost', onClick: props.onCopyConfig, disabled: !shortcut || !shortcut.config }, CopyIcon(), props.copied ? t('configCopied') : t('copyConfig'))))),
              h('div', { className: 'ac-step' },
                h('div', { className: 'ac-step-no' }, '3'),
                h('div', { className: 'ac-step-body' },
                  h('div', { className: 'ac-step-title' }, t('stepTest')),
                  h('div', { className: 'ac-step-hint' }, t('stepTestHint')),
                  h('div', { className: 'ac-step-actions' },
                    h('button', { className: 'ac-primary', onClick: props.onTestUpload, disabled: props.testBusy },
                      props.testBusy ? t('testing') : t('testUpload'))),
                  props.testMessage
                    ? h('div', { className: props.testMessage.ok ? 'ac-success' : 'ac-error', style: { marginTop: 10 } },
                        props.testMessage.ok ? t('testSuccess') : props.testMessage.text)
                    : null)))),
          h('div', { className: 'ac-advanced' },
            h('button', { className: 'ac-ghost', onClick: () => setAdvanced(!advanced) }, advanced ? t('hideAdvanced') : t('advanced')),
            advanced
              ? h('div', { style: { marginTop: 14 } },
                  h('div', { className: 'ac-set-row' },
                    h('span', { className: 'ac-set-label' }, t('githubRepo')),
                    h('span', { className: 'ac-set-value' },
                      h('a', { className: 'ac-device-link', href: github.repo.url, target: '_blank', rel: 'noreferrer' }, github.repo.owner + '/' + github.repo.name))),
                  h('div', { className: 'ac-set-row' },
                    h('span', { className: 'ac-set-label' }, t('githubQueueCount')),
                    h('span', { className: 'ac-set-value' }, String(github.queueCount || 0) + ' ' + t('itemsUnit'))),
                  h('div', { className: 'ac-set-row' },
                    h('span', { className: 'ac-set-label' }, t('githubLastSync')),
                    h('span', { className: 'ac-set-value' }, github.lastSyncAt ? timeText(github.lastSyncAt) : '—')),
                  h('div', { className: 'ac-set-row' },
                    h('span', { className: 'ac-set-label' }, t('shortcutTitle')),
                    h('div', { className: 'ac-set-value' },
                      h('div', { className: 'ac-config' }, showConfig && shortcut ? shortcut.config : maskedConfig(shortcut && shortcut.config)),
                      h('div', { className: 'ac-set-actions' },
                        h('button', { className: 'ac-ghost', onClick: () => setShowConfig(!showConfig) }, showConfig ? t('hideConfig') : t('showConfig')),
                        h('button', { className: 'ac-ghost', onClick: props.onCopyConfig, disabled: !shortcut }, CopyIcon(), t('copyConfig'))))),
                  h('div', { className: 'ac-set-actions' },
                    h('button', { className: 'ac-ghost', onClick: props.onSync, disabled: props.busy }, RetryIcon(), t('githubSyncNow')),
                    h('button', { className: 'ac-ghost', onClick: props.onRepair, disabled: props.busy }, t('githubRepair')),
                    h('button', { className: 'ac-ghost', 'data-danger': true, onClick: props.onDisconnect }, t('githubDisconnect'))))
              : null))
      }

      return h('div', { className: 'ac-modal', onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() } },
        h('div', { className: 'ac-settings' },
          h('div', { className: 'ac-settings-head' },
            h('div', { className: 'ac-settings-title' }, t('phoneEntry')),
            h('div', { className: 'ac-grow' }),
            h('button', { className: 'ac-icon-button', onClick: props.onClose, 'aria-label': t('close') }, CloseIcon())),
          props.error ? h('div', { className: 'ac-error', style: { marginBottom: 16 } }, props.error) : null,
          status))
    }

    function Empty(props) {
      const t = props.t
      return h('div', { className: 'ac-empty' },
        h('div', { className: 'ac-empty-art' }, EmptyArt()),
        h('h2', null, props.hasOlder ? t('emptyTodayTitle') : t('emptyTitle')),
        h('p', null, props.hasOlder ? t('emptyTodayHint') : t('emptyHint')),
        props.hasOlder
          ? h('button', { className: 'ac-primary', onClick: props.onShowAll }, t('viewAll'))
          : h('button', { className: 'ac-primary', onClick: props.onImport, disabled: props.busy },
            PlusIcon(), props.busy ? t('importing') : t('import')),
        h('div', { className: 'ac-footnote' }, t('privacy')))
    }

    function App(props) {
      const t = props.t
      const [items, setItems] = useState([])
      const [selectedId, setSelectedId] = useState(null)
      const [scope, setScope] = useState('today')
      const [view, setView] = useState(() => {
        try { return localStorage.getItem('auracap.view') === 'grid' ? 'grid' : 'split' } catch { return 'split' }
      })
      const [drag, setDrag] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [lightbox, setLightbox] = useState(null)
      const [modalId, setModalId] = useState(null)
      const [digest, setDigest] = useState(null)
      const [digestBusy, setDigestBusy] = useState(false)
      const [digestError, setDigestError] = useState(null)
      const [digestLoaded, setDigestLoaded] = useState(false)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [github, setGithub] = useState(null)
      const [githubBusy, setGithubBusy] = useState(false)
      const [githubError, setGithubError] = useState(null)
      const [device, setDevice] = useState(null)
      const [shortcut, setShortcut] = useState(null)
      const [configCopied, setConfigCopied] = useState(false)
      const [testBusy, setTestBusy] = useState(false)
      const [testMessage, setTestMessage] = useState(null)
      const fileRef = useRef(null)
      const dragDepth = useRef(0)

      const load = useCallback(async () => {
        try {
          const payload = await request(API + '/items')
          setItems(Array.isArray(payload.items) ? payload.items : [])
        } catch (loadError) {
          setError(loadError.message || t('loadFailed'))
        }
      }, [t])

      useEffect(() => {
        load()
        const timer = setInterval(load, 4000)
        return () => clearInterval(timer)
      }, [load])

      const visible = useMemo(() => (scope === 'today' ? items.filter((item) => isToday(item.createdAt)) : items), [items, scope])

      useEffect(() => {
        if (!visible.length) { if (selectedId !== null) setSelectedId(null); return }
        if (!selectedId || !visible.some((item) => item.id === selectedId)) setSelectedId(visible[0].id)
      }, [visible, selectedId])

      const selected = items.find((item) => item.id === selectedId) || null
      const modalItem = items.find((item) => item.id === modalId) || null

      const chooseView = (next) => {
        setView(next)
        try { localStorage.setItem('auracap.view', next) } catch {}
      }

      const loadDigest = useCallback(async () => {
        try {
          const payload = await request(API + '/digest?date=' + encodeURIComponent(todayKey()))
          setDigest(payload.digest || null)
          setDigestError(null)
        } catch (digestLoadError) {
          setDigestError(digestLoadError.message)
        } finally {
          setDigestLoaded(true)
        }
      }, [t])

      useEffect(() => {
        if (scope === 'digest' && !digestLoaded) loadDigest()
      }, [scope, digestLoaded, loadDigest])

      const loadGithub = useCallback(async () => {
        try {
          const payload = await request(API + '/github/status')
          setGithub(payload)
          if (payload.connected) {
            try { setShortcut(await request(API + '/github/shortcut')) } catch { setShortcut(null) }
          } else {
            setShortcut(null)
          }
        } catch (githubLoadError) {
          setGithubError(githubLoadError.message)
        }
      }, [t])

      const openSettings = () => {
        setSettingsOpen(true)
        setGithubError(null)
        loadGithub()
      }

      useEffect(() => {
        if (!device || !device.id) return undefined
        if (device.status !== 'pending' && device.status !== 'provisioning') return undefined
        const timer = setInterval(async () => {
          try {
            const payload = await request(API + '/github/device/' + encodeURIComponent(device.id))
            setDevice((current) => (current && current.id === device.id ? Object.assign({}, current, payload) : current))
            if (payload.status === 'ready') {
              setDevice(null)
              setGithubError(null)
              await loadGithub()
            } else if (payload.status === 'failed' || payload.status === 'expired') {
              setGithubError(payload.error || t('githubError'))
            }
          } catch (pollError) {
            setGithubError(pollError.message)
          }
        }, 2000)
        return () => clearInterval(timer)
      }, [device && device.id, device && device.status, loadGithub, t])

      const connectGithub = async () => {
        setGithubBusy(true)
        setGithubError(null)
        try {
          const payload = await request(API + '/github/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          setDevice(Object.assign({ status: 'pending' }, payload))
        } catch (connectError) {
          setGithubError(connectError.message)
        } finally {
          setGithubBusy(false)
        }
      }

      const syncGithub = async () => {
        setGithubBusy(true)
        setGithubError(null)
        try {
          setGithub(await request(API + '/github/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
          await loadGithub()
        } catch (syncError) {
          setGithubError(syncError.message)
        } finally {
          setGithubBusy(false)
        }
      }

      const repairGithub = async () => {
        setGithubBusy(true)
        setGithubError(null)
        try {
          setGithub(await request(API + '/github/repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
          await loadGithub()
        } catch (repairError) {
          setGithubError(repairError.message)
        } finally {
          setGithubBusy(false)
        }
      }

      const disconnectGithub = async () => {
        setGithubBusy(true)
        setGithubError(null)
        try {
          setGithub(await request(API + '/github/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
          setShortcut(null)
        } catch (disconnectError) {
          setGithubError(disconnectError.message)
        } finally {
          setGithubBusy(false)
        }
      }

      const testGithubUpload = async () => {
        setTestBusy(true)
        setTestMessage(null)
        try {
          const payload = await request(API + '/github/test-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          if (payload.status) setGithub(payload.status)
          setTestMessage({ ok: true })
          await load()
          await loadGithub()
        } catch (testError) {
          setTestMessage({ ok: false, text: testError.message })
        } finally {
          setTestBusy(false)
        }
      }

      const copyConfig = async () => {
        if (!shortcut || !shortcut.config) return
        try {
          await navigator.clipboard.writeText(shortcut.config)
          setConfigCopied(true)
          setTimeout(() => setConfigCopied(false), 1600)
        } catch {}
      }

      const generateInsight = async () => {
        setDigestBusy(true)
        setDigestError(null)
        try {
          const payload = await request(API + '/digest', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ date: todayKey() }),
          })
          setDigest(payload.digest || null)
          setDigestLoaded(true)
        } catch (insightError) {
          setDigestError(insightError.message)
        } finally {
          setDigestBusy(false)
        }
      }

      const importFiles = useCallback(async (fileList) => {
        const files = Array.from(fileList || []).filter((file) => file && isImageFile(file))
        if (!files.length) { setError(t('onlyImages')); return }
        setBusy(true)
        setError(null)
        try {
          for (const file of files) {
            const payload = await request(API + '/ingest', {
              method: 'POST',
              headers: {
                'content-type': mediaTypeOf(file),
                'x-auracap-name': encodeURIComponent(file.name || 'screenshot'),
              },
              body: file,
            })
            if (payload.item) {
              setItems((previous) => [payload.item].concat(previous.filter((item) => item.id !== payload.item.id)))
              setSelectedId(payload.item.id)
              setScope('today')
            }
          }
        } catch (importError) {
          setError(importError.message || t('loadFailed'))
        } finally {
          setBusy(false)
        }
      }, [t])

      const retry = async (item) => {
        try {
          const payload = await request(API + '/items/' + encodeURIComponent(item.id) + '/retry', { method: 'POST' })
          if (payload.item) setItems((previous) => previous.map((entry) => (entry.id === item.id ? payload.item : entry)))
        } catch (retryError) { setError(retryError.message) }
      }

      const remove = async (item) => {
        try {
          await request(API + '/items/' + encodeURIComponent(item.id) + '/delete', { method: 'POST' })
          setItems((previous) => previous.filter((entry) => entry.id !== item.id))
          if (selectedId === item.id) setSelectedId(null)
          if (modalId === item.id) setModalId(null)
        } catch (removeError) { setError(removeError.message) }
      }

      const openImage = (item) => setLightbox(item)

      const onDragEnter = (event) => {
        event.preventDefault()
        dragDepth.current += 1
        setDrag(true)
      }
      const onDragLeave = (event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDrag(false)
      }
      const onDragOver = (event) => {
        event.preventDefault()
        try { event.dataTransfer.dropEffect = 'copy' } catch {}
      }
      const onDrop = (event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDrag(false)
        if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) importFiles(event.dataTransfer.files)
      }

      const openPicker = () => { if (fileRef.current) fileRef.current.click() }
      const hasOlder = scope === 'today' && visible.length === 0 && items.length > 0

      const header = h('header', { className: 'ac-header' },
        h('div', { className: 'ac-mark' }, BrandMark()),
        h('div', { className: 'ac-titles' },
          h('div', { className: 'ac-name' }, t('appName')),
          h('div', { className: 'ac-sub' }, t('fragments'))),
        h('span', { className: 'ac-count' }, String(items.length)),
        h('div', { className: 'ac-grow' }),
        h('button', { className: 'ac-icon-button', onClick: openSettings, title: t('settings'), 'aria-label': t('settings') }, SettingsIcon()),
        h('div', { className: 'ac-seg', role: 'group', 'aria-label': t('layout') },
          h('button', { type: 'button', 'aria-pressed': view === 'split', title: t('split'), onClick: () => chooseView('split') }, SplitIcon()),
          h('button', { type: 'button', 'aria-pressed': view === 'grid', title: t('grid'), onClick: () => chooseView('grid') }, GridIcon())),
        h('button', { className: 'ac-primary', onClick: openPicker, disabled: busy },
          PlusIcon(), busy ? t('importing') : t('import')),
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp,image/gif',
          multiple: true,
          style: { display: 'none' },
          onChange: (event) => {
            const files = Array.from(event.target.files || [])
            event.target.value = ''
            importFiles(files)
          },
        }))

      const tabs = h('div', { className: 'ac-tabs' },
        h('button', { className: 'ac-tab', 'aria-selected': scope === 'today', onClick: () => setScope('today') }, t('today')),
        h('button', { className: 'ac-tab', 'aria-selected': scope === 'all', onClick: () => setScope('all') }, t('all')),
        h('button', { className: 'ac-tab', 'aria-selected': scope === 'digest', onClick: () => setScope('digest') }, t('insights')),
        h('div', { className: 'ac-grow' }),
        h('span', { className: 'ac-hint' }, t('localOnly')))

      let content
      if (scope === 'digest') {
        content = h(DigestView, {
          t,
          date: todayKey(),
          digest,
          busy: digestBusy,
          error: digestError,
          onGenerate: generateInsight,
        })
      } else if (!visible.length) {
        content = h(Empty, { t, busy, hasOlder, onImport: openPicker, onShowAll: () => setScope('all') })
      } else if (view === 'grid') {
        content = h('div', { className: 'ac-grid-wrap' },
          h('div', { className: 'ac-grid' }, visible.map((item) => h(Card, { key: item.id, item, t, onClick: () => setModalId(item.id) }))))
      } else {
        content = h('div', { className: 'ac-body' },
          h('div', { className: 'ac-list', role: 'list' },
            visible.map((item) => h(Row, { key: item.id, item, t, active: item.id === selectedId, onClick: () => setSelectedId(item.id) }))),
          selected
            ? h(Detail, { item: selected, t, onRetry: retry, onDelete: remove, onOpenImage: openImage })
            : h('div', { className: 'ac-empty' }, h('p', null, t('untitled'))))
      }

      return h('div', {
        className: 'ac-root',
        onDragEnter, onDragLeave, onDragOver, onDrop,
      },
        h('style', null, CSS),
        header,
        tabs,
        error ? h('div', { className: 'ac-banner' }, h('span', null, error), h('button', { onClick: () => setError(null), 'aria-label': t('close') }, CloseIcon())) : null,
        content,
        drag ? h('div', { className: 'ac-drop' },
          h('div', { className: 'ac-drop-inner' },
            h('div', { className: 'ac-drop-icon' }, PlusIcon()),
            h('div', { className: 'ac-drop-title' }, t('dropTitle')),
            h('div', { className: 'ac-drop-hint' }, t('dropHint')))) : null,
        modalItem ? h('div', {
          className: 'ac-modal',
          onMouseDown: (event) => { if (event.target === event.currentTarget) setModalId(null) },
        },
          h('div', { className: 'ac-modal-card' },
            h('button', { className: 'ac-modal-close', onClick: () => setModalId(null), 'aria-label': t('close') }, CloseIcon()),
            h(Detail, { item: modalItem, t, onRetry: retry, onDelete: remove, onOpenImage: openImage }))) : null,
        settingsOpen ? h(SettingsModal, {
          t,
          github,
          device,
          shortcut,
          busy: githubBusy,
          error: githubError,
          copied: configCopied,
          onClose: () => setSettingsOpen(false),
          onConnect: connectGithub,
          onSync: syncGithub,
          onRepair: repairGithub,
          onDisconnect: disconnectGithub,
          onCopyConfig: copyConfig,
          testBusy,
          testMessage,
          onTestUpload: testGithubUpload,
        }) : null,
        lightbox ? h('div', { className: 'ac-lightbox', onClick: () => setLightbox(null) },
          h('img', {
            src: API + '/media/' + encodeURIComponent(lightbox.id),
            alt: lightbox.summary && lightbox.summary.title ? lightbox.summary.title : '',
            draggable: false,
          })) : null)
    }

    return {
      isPlugin: true,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = buildT(ctx)
        const Panel = () => h(App, { t })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'auracap',
          order: 4,
          label: () => 'AuraCap',
        }, function AuraCapEntryIcon(iconProps) {
          const size = (iconProps && iconProps.size) || 18
          return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('rect', { x: 3.5, y: 8, width: 11, height: 11, rx: 3, opacity: .42 }),
            h('rect', { x: 9.5, y: 3.5, width: 11, height: 11, rx: 3 }),
            h('circle', { cx: 17.6, cy: 6.4, r: 1.1, fill: 'currentColor', stroke: 'none' }))
        }))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'auracap' }, Panel))
      },
    }
  },
})
