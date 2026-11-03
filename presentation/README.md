# Mind Harness 演示

这里是独立的演示项目，当前为 16 页。
整个目录可以单独复制或归档，构建和测试不依赖 MindHarnessV2 的主应用、后端或 frontend 目录。

## 打开与修改

用浏览器直接打开 [Mind*Harness*独立版.html](Mind_Harness_独立版.html)。
演示、独立讲稿、编辑功能、项目图标和案例图片均已内嵌，离线也可以使用。
点击“编辑内容”修改文字后，点击“保存新版 HTML”，再把下载的文件放回本目录，替换同名文件。
只点击“应用修改”不会覆盖磁盘上的 HTML。
分享演示时只需要发送这个 HTML 文件；需要继续开发时复制整个目录，node_modules 可以省略。

## 文件说明

| 路径                                                  | 用途                                                   |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `Mind_Harness_独立版.html`                            | 当前可直接打开的演示，也是已保存文字修改的来源         |
| `src/presentationStandalone.tsx`                      | 当前独立演示的页面编排与讲稿入口                       |
| `src/presentationContent.ts`                          | 页面标题、正文、讲稿与过渡语的基础文案                 |
| `src/Presentation.tsx`                                | 页面布局、示例与交互                                   |
| `src/PresentationNotes.tsx`                           | 独立讲稿视图                                           |
| `src/PresentationEditor.tsx`、`src/presentation*.ts`  | 文字编辑、备份及独立 HTML 保存                         |
| `src/presentation.css`、`src/presentationEditor.css`  | 演示与编辑样式                                         |
| `src/assets/`                                         | 图标、聊天室截图和案例原图                             |
| `scripts/build-presentation-standalone.mjs`           | 将源码、图片和已保存文字打包成单一 HTML                |
| `Mind_Harness_Presentation_文案.md`                   | 早期 12 页策划底稿，保留作为参考                       |
| `Mind_Harness_Presentation_编辑.json`                 | 历史服务器版文字存档，仅在首次生成 HTML 时作为初始数据 |
| `presentationServer.ts`、`presentationServer.test.ts` | 历史服务器版保存模块及其测试                           |
| `src/*.test.*`                                        | 编辑、保存和文件读取测试                               |

## 重新构建

在本目录运行，使用 Node.js 22.13+（22 系列）或 24+ 与 npm。

```sh
npm ci
npm run build
```

构建输出到本目录的 `Mind_Harness_独立版.html`。
已有 HTML 中保存的文字修改会被保留，不会被旧 JSON 覆盖。
若已有 HTML 的编辑数据损坏，构建会停止，不会静默重置内容。
历史 JSON 与当前 HTML 不会自动同步。

```sh
npm run type-check
npm run lint
npm test
```

## 后续维护

后续修改统一在此目录进行，主应用已移除原来的演示路由和构建接线。
保留现有文字字段 ID，以免让 HTML 内已保存的修改失去对应位置。
页面数量、顺序、布局或图片改变后，重新构建 HTML，并核对独立讲稿与页码。
