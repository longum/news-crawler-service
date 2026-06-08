# news-crawler-service

个人新闻系统的外部 hub page 抓取测试服务。当前仅提供健康检查和单个列表页候选新闻解析，不抓正文、不存数据库。

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

## 接口测试

健康检查：

```bash
curl http://localhost:3000/health
```

默认 `auto` 模式先使用 HTTP，候选结果少于 5 条时回退 Playwright：

```bash
curl -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "auto"
  }'
```

只使用 HTTP：

```bash
curl -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "http"
  }'
```

强制使用 Playwright：

```bash
curl -X POST http://localhost:3000/hub/test \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.usgs.gov/mission-areas/water-resources/news",
    "renderMode": "playwright"
  }'
```

成功响应包含 `renderModeUsed`、最多 30 条候选新闻和当前空规则对象 `rule`。所有错误均返回：

```json
{
  "ok": false,
  "error": "..."
}
```

## 人工验证 Profile

需要通过 noVNC / X11 手动完成验证码时，启动带界面的持久化 Chromium：

```bash
npm run manual:profile -- \
  --url https://www.usgs.gov/mission-areas/water-resources/news \
  --profile usgs
```

浏览器数据保存在 `./profiles/usgs`。完成验证码后在终端按回车，浏览器会正常关闭并保留 cookies、localStorage 和其他 profile 数据。
