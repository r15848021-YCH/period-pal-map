# 好朋友地圖 Period Pal Map

公衛學院試辦的生理用品即時地圖。同學掃描貼在補給點旁的 QR Code，一鍵回報「充足／剩少量／已用完」，其他人打開網頁就知道哪裡有。

依指導教授建議，地圖（方案 A）與經期・心情紀錄（方案 B）已合併成 **好朋友 Pal**，再加上科普互動遊戲，全部放進同一個 LINE 官方帳號：聊天室下方選單點「找補給／我的紀錄／科普遊戲／我的徽章」，就在 LINE 裡打開 `pal.html`。

本專案為 115-1 NTU Challengers #PBL #AI Agent 個別型提案。

## 目前進度

- [x] 網頁原型：即時總覽、掃碼回報頁、各點 QR Code 產生
- [x] 補給點清單：公衛學院大樓 1 到 7 樓，每層一個女廁點
- [ ] 實地確認各樓層補給點的實際位置與補貨窗口
- [x] 回報 API 與資料庫：Cloudflare Worker + D1（取代原本規劃的 Notion）
- [x] LINE Bot：查詢各樓層現況、在 LINE 裡回報、用完時通知補貨群組
- [ ] 在 Cloudflare 與 LINE Developers 建立正式帳號並上線
- [x] 好朋友 Pal（LINE 內網頁）：地圖＋經期・心情紀錄＋科普遊戲＋徽章
- [x] LINE Bot「今日一題」與遊戲進度同步
- [ ] 科普題目請醫師或公衛老師審閱
- [ ] 在 LINE Developers 建立 LIFF、設定圖文選單
- [x] Claude Agent 第一步：每週一自動產出供需與識能摘要草稿（`src/agent.js`）
- [ ] Claude Agent：LINE 自然語言查詢、矛盾回報裁決
- [ ] 每週匿名統計匯出到本 repo 的 `data/`，作為公開紀錄

## 架構

全部放在一個 Cloudflare Worker（免費方案）：

```
同學掃 QR Code ─┐                       ┌─ 即時總覽網頁
                ├─► Cloudflare Worker ──┤
LINE Bot ───────┘    （D1 資料庫）       └─ LINE 通知補貨群組
                          ▲
                Claude Agent（之後用 Cron Triggers 定時執行）
```

| 檔案 | 用途 |
| --- | --- |
| `public/index.html` | 好朋友地圖網頁（掃 QR Code 回報、各點 QR 碼） |
| `public/pal.html` | 好朋友 Pal：在 LINE 裡打開的整合頁（今天／經期／心情／地圖／遊戲／徽章） |
| `public/game.json` | 科普題庫：五關問答、迷思是真是假、一個月模擬（網頁與 LINE Bot 共用） |
| `public/game-rules.js` | 徽章條件、進度合併、今日一題（網頁與 LINE Bot 共用） |
| `line/richmenu.png` | LINE 圖文選單圖片（2500×1686，四格） |
| `public/locs.json` | 補給點清單（網頁與 LINE Bot 共用） |
| `public/sites.json` | 地圖上的站點（一棟樓一個標記，含座標；性工坊交換站也在這裡） |
| `public/sitemap.js`、`sitemap.css` | 站點地圖（MapLibre + OpenFreeMap，免費免金鑰）與站點卡片 |
| `public/rules.js` | 判斷規則（網頁與 LINE Bot 共用） |
| `src/worker.js` | 回報 API、CSV 匯出、LINE Bot webhook |
| `src/agent.js` | 每週摘要 Agent：程式算統計，Claude 用工具讀取後寫摘要草稿，推播給負責人確認 |
| `schema.sql` | D1 資料表 |
| `wrangler.toml` | Cloudflare 設定 |
| `data/` | 每週匿名統計（之後由 Agent 自動寫入） |

## 第一次上線

需要 Node.js 18 以上。

1. `npm install`，再 `npx wrangler login` 登入 Cloudflare 帳號。
2. 正式資料庫已建立，`database_id` 已填在 `wrangler.toml`（若要另建一個，用 `npx wrangler d1 create period-pal-map` 再換掉 ID，並執行 `npm run db:init`）。
3. （已在 Cloudflare 後台 D1 Console 建好資料表，不用再做。）
4. `npx wrangler secret put ADMIN_KEY`，設一組下載 CSV 用的密碼。
5. `npm run deploy`。網址會是 `https://period-pal-map.<你的子網域>.workers.dev/`。

之後也可以在 Cloudflare 後台把這個 GitHub repo 接上 Workers Builds，push 到 main 就自動部署。

### 接上 LINE Bot

1. 到 [LINE Developers](https://developers.line.biz/) 建立 Messaging API 頻道（會同時建立 LINE 官方帳號）。
2. 把頻道的 Channel secret 與 Channel access token 存成機密：
   `npx wrangler secret put LINE_CHANNEL_SECRET`、`npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN`。
3. Webhook URL 填 `https://<你的網址>/api/line`，開啟「Use webhook」，按 Verify。
4. 在 LINE Official Account Manager 關掉「自動回應訊息」，避免和 Bot 重複回覆。
5. 把官方帳號加進補貨窗口的 LINE 群組，在群組傳「群組ID」，把回覆的 ID 存成 `LINE_STAFF_TO`。

LINE Bot 能做的事：

- 傳任何訊息（或「查詢」）：回覆 1 到 7 樓目前狀態。
- 傳「回報」：用按鈕選樓層和狀態，和掃 QR Code 回報一樣寫進資料庫。
- 有樓層從其他狀態變成「已用完」時，主動推播到補貨群組。回覆訊息免費；主動推播會用到官方帳號每月的免費訊息額度。

### 接上好朋友 Pal（LINE 內網頁）

1. 先更新資料表：到 Cloudflare 後台 D1 Console，貼上 `schema.sql` 最後的 `CREATE TABLE IF NOT EXISTS progress ...` 那一段執行（或 `npm run db:init`，已存在的表不會被動到）。
2. 到 LINE Developers，在**同一個 Provider** 底下建立「LINE Login」頻道，再到該頻道的 LIFF 分頁按 Add：
   - Size：Full
   - Endpoint URL：`https://<你的網址>/pal`
   - Scope：勾 `openid`（徽章同步用，不需要 `profile`）
   - 打開「shareTargetPicker」（迷思遊戲分享給朋友用）
3. 把拿到的 LIFF ID 填進 `wrangler.toml` 的 `[vars]` 裡的 `LIFF_ID`（它是公開的，不是密碼），push 到 main 就會自動部署。
4. 到 LINE Official Account Manager → 圖文選單 → 建立：版型選大型四格（2 × 2），圖片上傳 `line/richmenu.png`，四格動作都選「連結」：
   - 左上 找補給：`https://liff.line.me/<LIFF ID>?tab=map`
   - 右上 我的紀錄：`https://liff.line.me/<LIFF ID>?tab=today`
   - 左下 科普遊戲：`https://liff.line.me/<LIFF ID>?tab=game`
   - 右下 我的徽章：`https://liff.line.me/<LIFF ID>?tab=badges`
   - 選單列文字填「好朋友 Pal 選單」，預設顯示選「顯示」。

還沒設定 LIFF 前，`https://<你的網址>/pal` 也能直接用瀏覽器打開，只是徽章不會同步。

LINE Bot 新增的指令：

- 傳「今日一題」：出一題科普題，按 A／B／C／D 作答後回覆解說。每天同一題，網頁「遊戲」頁也是同一題；累積 7 天拿徽章。
- 傳「遊戲」「紀錄」「徽章」等：回覆打開好朋友 Pal 的按鈕。
- 遊戲統計（給成效指標）：`https://<你的網址>/api/game-stats?key=<ADMIN_KEY>`，回傳玩家數與各徽章人數。

## 本機測試

```
npm run db:init:local
printf 'ADMIN_KEY=test\nLINE_CHANNEL_SECRET=test\n' > .dev.vars
npm run dev
```

打開 http://localhost:8787 （地圖）或 http://localhost:8787/pal （好朋友 Pal）。若要只看網頁、不連資料庫，把 `public/index.html` 的 `CONFIG.apiUrl` 改成空字串就會回到示範模式。

## 要改設定的地方

- `public/sites.json`：地圖標記。可即時回報的站點用 `locs` 列出它包含的 `locs.json` 樓層；沒有 `locs` 的是合作站點（例如性工坊交換站），只顯示資訊、不能回報。座標可以在 OpenStreetMap 上查。
- `public/locs.json`：補給點清單。每個點的 `id` 會出現在 QR Code 網址裡（例如 `#r-cph-2f`），QR Code 貼出去後就不要再改。
- `public/index.html` 的 `CONFIG.apiUrl`：回報 API 位置，預設 `/api`（同一個網站）。

## 網址格式

- 即時總覽：`https://<你的網址>/`
- 某個點的回報頁（QR Code 內容）：`https://<你的網址>/#r-cph-2f`
- 產生所有 QR Code：`https://<你的網址>/#qr`
- 下載全部回報（給系辦與評鑑，Excel 可開）：`https://<你的網址>/api/export.csv?key=<ADMIN_KEY>`

## 隱私原則

- 回報不需要登入，不收集姓名、學號、照片或任何可辨識個人的資料。
- 網頁回報只帶一組隨機匿名代碼；LINE 回報只存 LINE 帳號的加鹽雜湊，資料庫裡沒有原本的 LINE ID。兩者都只用來做「同一來源 5 分鐘內只算一筆」與計算不重複使用人數。
- 經期、症狀、心情與備註只存在使用者手機（LINE 內網頁的本機儲存），不會上傳。遊戲進度只存 LINE 帳號的加鹽雜湊與過關紀錄，不含經期資料。
- 公開到 GitHub 的只有每週彙總統計（各點回報次數、用完次數、盤點用量），不含單筆回報時間戳記。

## 判斷規則（`public/rules.js`，之後交給 Agent）

- 以最新一筆回報為準。
- 一小時內有人說用完、有人說還有 → 標示「回報不一致」。
- 超過 6 小時沒人回報 → 標示「待確認」。

## 每週摘要 Agent

每週一台北時間 09:00，Cloudflare 會自動啟動 `src/agent.js`：

1. 程式先算好過去 7 天的統計（各點回報筆數、變成已用完的次數、估計缺貨小時、矛盾次數、最長無人回報時間；遊戲各關嘗試與過關人數）。數字都由程式算，AI 不會自己估。
2. Claude 透過 `get_supply_stats`、`get_game_stats` 兩個工具讀取統計，寫出四段摘要：補給、識能、下週建議、需要人處理。
3. 草稿存進 D1 的 `summaries` 資料表，並推播到負責人的 LINE。確認後才公開或轉給補貨窗口。

Agent 讀不到任何經期或心情紀錄（那些只存在使用者手機）。

第一次啟用：

1. 在 Cloudflare 後台 D1 Console 執行 `schema.sql` 最後一段（建立 `summaries` 資料表），或 `npm run db:init`。
2. `npx wrangler secret put ANTHROPIC_API_KEY`，貼上 Claude API 金鑰。
3. （選填）`npx wrangler secret put LINE_OWNER_TO`，填自己的 LINE user ID；沒設會送到補貨群組。
4. 部署後先試跑：打開 `/api/agent/stats?key=ADMIN_KEY` 看統計，再打開 `/api/agent/weekly?key=ADMIN_KEY&push=0` 看 AI 寫的摘要（不推播）。

模型寫在 `wrangler.toml` 的 `AGENT_MODEL`，想省錢可以改成 `claude-haiku-5-5`。
