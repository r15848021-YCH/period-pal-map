-- 回報資料表。不存姓名、學號或 LINE 帳號；device 是網頁隨機產生的匿名代碼，
-- LINE 回報則存加鹽雜湊，只用來做「同一來源 5 分鐘內只算一筆」。
CREATE TABLE IF NOT EXISTS reports (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  loc    TEXT    NOT NULL,
  lv     TEXT    NOT NULL CHECK (lv IN ('full','low','empty')),
  kinds  TEXT    NOT NULL DEFAULT '[]',
  at     INTEGER NOT NULL,
  device TEXT    NOT NULL,
  via    TEXT    NOT NULL DEFAULT 'web' CHECK (via IN ('web','line'))
);
CREATE INDEX IF NOT EXISTS reports_loc_at ON reports (loc, at);
CREATE INDEX IF NOT EXISTS reports_device ON reports (device, loc, at);

-- 科普遊戲進度。user 是 LINE 帳號的加鹽雜湊（資料庫裡沒有原本的 LINE ID），data 是 JSON：
-- 過關紀錄、徽章條件、今日一題作答日期。不含任何經期或心情資料。
CREATE TABLE IF NOT EXISTS progress (
  user TEXT    PRIMARY KEY,
  data TEXT    NOT NULL DEFAULT '{}',
  at   INTEGER NOT NULL
);
