# news-crawler-service

个人新闻系统的外部抓取测试服务。当前提供健康检查、列表页候选新闻解析和单篇文章正文抽取，不存数据库。

## 环境要求

- Node.js 20+
- npm

## 安装与启动

```bash
npm install
npx playwright install chromium
npm run dev
```

生产方式：

```bash
npm run build
npm start
```

默认监听 `http://localhost:3000`，可通过 `PORT` 环境变量修改端口。

## API Key 鉴权

设置 `CRAWLER_API_KEY` 后，除 `GET /health` 外的所有接口都需要 API Key：

```bash
CRAWLER_API_KEY='your-secret-key' npm run dev
```

生产启动：

```bash
CRAWLER_API_KEY='your-secret-key' npm start
```

请求时可使用 `x-api-key`：

```bash
curl -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{"url":"https://example.com"}'
```

或 Bearer Token：

```bash
curl -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer your-secret-key' \
  -d '{"url":"https://example.com"}'
```

未设置 `CRAWLER_API_KEY` 时不启用鉴权。`GET /health` 始终无需鉴权。

## 抓取资源限制

Hub 和 Article 请求共用一个进程内 FIFO 调度器：同时只运行 `1` 个抓取任务，最多允许 `3` 个请求等待。队列已满，或请求排队超过 `300` 秒仍未开始执行时，返回 HTTP `429`，并带有 `Retry-After: 300`。该限制以单个 Node.js 进程为边界；多进程或多副本部署还需要外部共享队列。

每个页面从公共地址校验、HTTP 重定向到响应体读取共用 `30` 秒 deadline；HTML 最大为 `5 MiB`。HTTP 响应采用流式计数，超时或超限后立即取消。Playwright 页面同样限制为 `30` 秒和 `5 MiB`，并会校验最终地址及页面发出的网络请求；浏览器路径的大小检查发生在页面 HTML 生成后，主要限制后续解析和 API 返回体，不等同于传输层流量上限。

## 接口测试

健康检查：

```bash
curl http://localhost:3000/health
```

默认 `auto` 模式先使用 HTTP，候选结果少于 5 条时回退 Playwright：

```bash
curl -sS -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "auto",
    "maxPages": 3,
    "delayMs": 1500,
    "stopOn403": true,
    "stopWhenNoNewItems": true,
    "selectors": {
      "item": ".views-row",
      "title": ".field-title",
      "link": "a",
      "date": "time",
      "next": "a[rel=next]"
    }
  }'
```

只使用 HTTP：

```bash
curl -sS -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "http"
  }'
```

强制使用 Playwright：

```bash
curl -sS -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "playwright"
  }'
```

友好抓取配置：

- `maxPages`：默认 `1`，最大 `5`
- `delayMs`：翻页请求前等待时间，默认 `0`，最大 `60000`
- `stopOn403`：遇到 HTTP 403 时停止翻页，默认 `true`
- `stopWhenNoNewItems`：某页没有新增候选 URL 时停止翻页，默认 `true`
- `selectors`：可选的手动 CSS selector 规则，支持 `item`、`title`、`link`、`date`、`next`

传入 `selectors.item` 时使用手动 item 模式；未传时继续使用自动候选识别。手动 item 模式中，`link` 默认 `a[href]`，`title` 默认复用 `link`。传入 `selectors.next` 时优先用它识别下一页。

多页候选结果按 URL 去重。成功响应包含 `renderModeUsed`、候选新闻、实际使用规则 `rule.selectors`，以及分页状态：

```json
{
  "rule": {
    "selectors": {
      "item": ".views-row",
      "title": ".field-title",
      "link": "a",
      "date": "time",
      "next": "a[rel=next]"
    }
  }
}
```

```json
{
  "pages": {
    "visited": ["https://www.usgs.gov/mission-areas/water-resources/news"],
    "nextUrl": "https://www.usgs.gov/mission-areas/water-resources/news?page=1",
    "stoppedReason": null
  }
}
```

`stoppedReason` 在遇到 HTTP 403 时为 `"http_403"`，在某页没有新增 URL 时为 `"no_new_items"`，其他情况为 `null`。

Hub 入口 URL 和每一个分页 URL 都必须解析到公共地址。跨域分页仍允许，但目标域名及 Playwright 子资源同样需要通过公共地址检查。

候选结果优先返回 URL path 包含 `/news/` 的链接，其次优先返回提取到发布日期的链接。所有错误均返回：

### 单篇文章正文抽取

`POST /article/test` 只处理单篇文章正文抽取，不会在 `/hub/test` 的列表页抓取过程中自动抓正文。

默认 `auto` 模式先使用 HTTP 获取 HTML，并用 JSDOM + Mozilla Readability 提取正文；当 HTTP 请求失败、Readability 提取失败，或正文质量规则不通过时回退 Playwright：

```bash
curl -sS -X POST http://localhost:3000/article/test \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: your-secret-key' \
  -d '{
    "url": "https://example.com/news/story",
    "renderMode": "auto"
  }'
```

也可以传 `"renderMode": "http"` 强制只使用 HTTP，或传 `"renderMode": "playwright"` 强制使用 Playwright。

成功响应包含实际使用的抓取方式、请求 URL、重定向后的最终 URL、清理后的 HTML 正文和纯文本正文：

```json
{
  "ok": true,
  "url": "https://example.com/news/story",
  "renderModeUsed": "http",
  "article": {
    "title": "Article title",
    "byline": null,
    "siteName": "Example",
    "excerpt": "Short summary",
    "contentHtml": "<div><p>Article body...</p></div>",
    "textContent": "Article body...",
    "textLength": 1234,
    "wordCount": 180,
    "paragraphCount": 6,
    "longParagraphCount": 5,
    "publishedAt": "2026-06-25T01:00:00.000Z",
    "requestedUrl": "https://example.com/news/story",
    "finalUrl": "https://example.com/news/story",
    "extractorUsed": "readability"
  }
}
```

`publishedAt` 优先从 JSON-LD 提取，其次从 Open Graph / meta 标签和 `time` 标签提取；无法确定时返回 `null`。`contentHtml` 返回前会移除 `script`、`iframe`、事件属性和危险 URL 协议，同时保留 Readability 提取后的正文结构。

正文质量规则集中在代码中管理，要求标题存在、正文长度和有效长段落达标，并结合链接文本密度、短链接列表数量、噪声文本占比、标题与正文关联度、主体段落文本占比识别版权声明、首页和列表页误判。默认先使用 Readability；当 Readability 结果质量不合格时，会尝试一次通用 DOM fallback 补救短快讯等非标准文章。`extractorUsed` 表示最终使用的抽取器，可能为 `"readability"` 或 `"dom-fallback"`。质量规则拒绝时，错误信息会包含拒绝原因，便于调试。

所有 Hub 和 Article 抓取都带有应用层 SSRF 防护：禁止请求 `localhost`、回环地址、私有网段、链路本地地址、云元数据地址和其他保留网段；HTTP 重定向、Hub 分页、Playwright 最终地址和浏览器子资源都会再次校验。某些代理、透明代理或受控网络环境可能会把外部域名映射到 `198.18.0.0/15` 等保留网段，这种情况下服务会被 SSRF 规则阻断。应通过部署网络或明确配置解决，不应默认降低安全限制。

DNS 校验和底层 HTTP/Chromium 建立连接之间仍存在操作系统解析层面的 TOCTOU 窗口。若调用方可能控制恶意 DNS，生产部署必须同时使用出站防火墙、网络命名空间或受控代理阻断私网目标；仅依赖应用层检查不能替代网络层隔离。

所有错误均返回：

```json
{
  "ok": false,
  "error": "..."
}
```

队列错误使用 HTTP `429`，`error` 为 `"crawler queue is full"` 或 `"crawler queue wait timed out"`。抓取超时、HTML 超限、地址检查失败及上游抓取错误继续使用相同的 JSON 错误结构。

## 人工验证 Profile

需要通过 noVNC / X11 手动完成验证码时，启动带界面的持久化 Chromium：

```bash
npm run manual:profile -- \
  --url https://www.usgs.gov/mission-areas/water-resources/news \
  --profile usgs
```

浏览器数据保存在 `./profiles/usgs`。完成验证码后在终端按回车，浏览器会正常关闭并保留 cookies、localStorage 和其他 profile 数据。
