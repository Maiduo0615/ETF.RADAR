# ETF 加碼雷達 V3 Web

這是 Cloudflare Pages + Pages Functions 版本。

## 檔案結構

- `public/index.html`：前端網站
- `functions/api/[[path]].js`：資料中繼 API

## 部署方式

1. 建立 Cloudflare 帳號。
2. 建立 Pages 專案。
3. 上傳此資料夾內容，或接 GitHub Repository。
4. Build command 留空。
5. Output directory 設為 `public`。
6. 部署後打開 Pages 給你的網址。

## API

- `/api/health`
- `/api/market`
- `/api/etf?market=TW&symbol=00981A`
- `/api/etf?market=US&symbol=VOO`

## 注意

本版本不要用 `file://` 雙擊開啟。請部署到 Cloudflare Pages 後使用。
