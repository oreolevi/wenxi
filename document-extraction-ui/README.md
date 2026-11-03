# 文析前端

React 19、TypeScript、Ant Design 6、Ant Design X 2 与 Vite 单文件应用。

## 开发与构建

环境：Node.js 24。

```sh
npm ci
npm run dev
```

UI 开发预览位于 <http://127.0.0.1:5178>。真实识别需先构建，再使用项目根目录的 `mineru-local/启动文析.command` 启动同源试用服务，访问 <http://127.0.0.1:8768>。

```sh
npm test
npm run build
```

构建检查 TypeScript，生成 `dist/index.html` 并导出根目录单文件 HTML。生成文件、备份、依赖目录不提交到 Git；干净克隆可重新构建。

## 主要界面

- 文析：附件对话、Excel 字段要求、原文与结果分屏、全文 Markdown、人工核验和导出。
- 文析 Studio：我的场景、我的服务、公共服务库；服务内含版式配置、单份调试、批量测试、接口与版本及运行记录。
- 历史记录：个人解析记录；Studio API 运行记录独立查看。
- 能力及运营：Skill 库、能力组件、评测与发布、运行看板、接入与权限；部分仍为原型或模拟流程。

## 组件与资源

输入区使用 Ant Design X Sender / Bubble，分栏使用 Ant Design Splitter。原文高亮基于服务端页码与归一化坐标；字段引用、模型提取和真实 OCR 不在浏览器中执行。

首页流彩效果使用 `border-beam`；分屏和结果入场组件保留 React Bits 许可证与版本说明。字体、图标资源及许可随源码保存，最终构建不依赖公网 CDN。减少动态效果偏好下跳过装饰动画。

密钥只通过后端配置。真实上传文件、Studio 草稿、任务结果和本机历史不打包进前端。产品说明见[文档首页](../docs/README.md)，环境安装见[项目 README](../README.md)。
