# AGENTS.md

## 项目定位

这是个人新闻系统的外部爬虫服务。

本服务只负责网页抓取和 hub_page 列表页解析，不负责：

- 前端页面
- 数据库存储
- Cloudflare Worker
- AI 摘要
- 向量检索
- 正文抽取

当前阶段只做 `hub_page`。

## 技术栈

使用：

- Node.js
- TypeScript
- Express
- Crawlee
- Playwright
- npm

## 当前目标

先实现最小可用服务：

- `GET /health`
- `POST /hub/test`

暂不实现：

- `/hub/crawl`
- RSS
- Jina Reader
- 数据库
- 登录态爬虫
- 大规模并发抓取

## /hub/test

输入示例：

    {
      "url": "https://www.usgs.gov/mission-areas/water-resources/news",
      "renderMode": "auto"
    }

`renderMode` 支持：

- `auto`：默认。先 HTTP 抓取，候选结果太少时再用 Playwright。
- `http`：只用 HTTP。
- `playwright`：强制 Playwright 渲染。

输出示例：

    {
      "ok": true,
      "url": "...",
      "renderModeUsed": "http",
      "items": [
        {
          "title": "...",
          "url": "...",
          "published_at": "..."
        }
      ],
      "rule": {}
    }

第一版只要求返回候选新闻列表。

## 抓取策略

默认不要直接启动 Playwright。

优先级：

1. 先用 HTTP 抓 HTML
2. 从 HTML 中分析候选新闻链接
3. 如果候选项太少，再使用 Crawlee + Playwright 渲染
4. 返回前 30 条候选新闻

Playwright 只用于：

- JS 动态渲染页面
- HTTP 内容过少
- HTTP 分析不到候选新闻项
- 用户指定 `renderMode = "playwright"`

## 资源限制

个人服务器资源有限，默认限制：

- `maxConcurrency = 1`
- 单个页面超时不超过 30 秒
- 不截图
- 不抓正文
- 不无限重试
- 不长时间保留无用浏览器页面

## 候选新闻识别

从页面中提取候选新闻项：

- title
- url
- published_at

第一版可以使用启发式规则：

- 从 `a` 标签中提取标题和链接
- 标题不能为空
- 标题长度不能太短
- URL 必须合法
- 优先保留同站链接
- 去除导航、页脚、社交分享、分页等明显无关链接
- 尝试从链接附近节点提取日期

不要追求一次性适配所有网站。

## 错误处理

所有接口返回 JSON。

错误格式：

    {
      "ok": false,
      "error": "..."
    }

URL 必须校验。

请求失败、超时、页面无法解析时，不要让服务崩溃。

## 开发命令

修改前先查看 `package.json`。

常用命令：

    npm install
    npm run dev
    npm run build
    npm start

如果修改接口，要更新 README。