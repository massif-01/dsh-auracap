# Third-Party Notices

本仓库的原创代码与文档以 Apache License 2.0 发布，完整文本见 [LICENSE](LICENSE)。

原 AuraCap 项目的部分内容仍按 MIT 授权，完整文本见 [third-party/AuraCap-MIT.txt](third-party/AuraCap-MIT.txt)。

本文件列出随仓库分发或运行时依赖的第三方作品，以及它们的授权来源。  
分发本仓库或基于它构建的安装包时，请一并保留本文件和相关许可证。

---

## AuraCap

- 项目：<https://github.com/massif-01/AuraCap>
- 用途：最初的截图收集、LLM 整理、时间线思路，以及部分提示词结构
- 许可证：MIT
- 版权：Copyright (c) 2026 massif-01
- 完整 MIT 文本：[third-party/AuraCap-MIT.txt](third-party/AuraCap-MIT.txt)

当前仓库的提示词是在原 AuraCap 思路基础上改写和扩展的；原项目的 MIT 许可和署名需要保留。

---

## Geist

- 项目：<https://github.com/vercel/geist-font>
- 用途：界面英文字体，文件为 `assets/fonts/Geist-Variable.woff2`
- 许可证：SIL Open Font License 1.1
- 版权：Copyright 2024 The Geist Project Authors
- 完整许可证：见 [assets/fonts/Geist-OFL.txt](assets/fonts/Geist-OFL.txt)

OFL 允许使用、修改和再分发字体，但字体本身不能单独出售；如果修改字体，需要遵守 OFL 的保留名称等条款。

---

## pdf-parse

- 项目：<https://github.com/mehmet-kozan/pdf-parse>
- 用途：PDF 正文提取
- 版本：`^2.4.5`
- 许可证：Apache License 2.0
- 说明：通过 npm 安装，许可证随依赖包分发；本仓库不包含其源码。

## pdfjs-dist

- 项目：<https://github.com/mozilla/pdf.js>
- 用途：`pdf-parse` 的 PDF 解析依赖
- 版本：`5.4.296`
- 许可证：Apache License 2.0

## @napi-rs/canvas

- 项目：<https://github.com/Brooooooklyn/canvas>
- 用途：`pdf-parse` 的渲染依赖
- 版本：`0.1.80`
- 许可证：MIT

---

## React

- 项目：<https://react.dev/>
- 用途：DSH Client 端插件复用宿主提供的 React
- 许可证：MIT
- 说明：作为 `peerDependency` 使用，不随本仓库打包。

---

## Backup file libraries

- `yazl` 3.3.1 and `yauzl` 3.4.0: streaming ZIP writing and reading, MIT, Copyright (c) 2014 Josh Wolfe. Sources: <https://github.com/thejoshwolfe/yazl>, <https://github.com/thejoshwolfe/yauzl>.
- `buffer-crc32`: ZIP checksums, MIT. Source: <https://github.com/brianloveswords/buffer-crc32>.
- `pend`: bounded ZIP file operations, MIT. Source: <https://github.com/andrewrk/node-pend>.
- `stream-json` 3.9.0 and `stream-chain`: streaming insight metadata and content fingerprints, BSD-3-Clause. Sources: <https://github.com/uhop/stream-json>, <https://github.com/uhop/stream-chain>.
- License texts: [third-party/backup-libraries.txt](third-party/backup-libraries.txt).

---

## 名称与商标

Apache 2.0 与本仓库包含的 MIT 内容都只授予版权/专利许可，不授予任何商标、品牌名或标识的使用权。

- **AuraCap / 拾穗**：项目名称与品牌；
- **DeepSeek Harness**：DeepSeek 的产品名称；
- **GitHub**：GitHub, Inc. 的商标；
- **Geist**：Vercel / Geist Project Authors 的字体名称。

第三方名称仅用于说明来源和兼容性，不代表任何官方背书。
