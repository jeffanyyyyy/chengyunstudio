# 澄耘活動工作室 — 官方網站

沉浸式單頁網站。五個章節：關於我們、服務內容、我們的團隊、常見問題、聯繫我們。

線上位址：<https://chengyunstudio.vercel.app>

這個倉庫只放「網站跑起來需要的東西」，不含開發用的原始碼與素材。

---

## 檔案

| 路徑 | 用途 |
|---|---|
| `index.html` | 整個網站，單一檔案 |
| `api/contact.js` | 聯絡表單的後端：寫進 Supabase，並寄通知信 |
| `assets/bg-obsidian.mp4` | 首頁背景的水晶 |
| `assets/seg-a-*.mp4` | 過場第二節，捲動拖著播 |
| `assets/seg-b-*.mp4` | 過場第三段，水中回到水晶 |
| `assets/crystal-rest.mp4` | 內頁背景，水晶落定後的循環 |
| `assets/team/01–16.jpg` | 團隊照片 |
| `assets/tw.css` | 預先編譯的 Tailwind，CDN 沒跑起來時的保底 |

`-480` 與 `-720` 兩種尺寸由瀏覽器依螢幕寬度與省流量設定自動挑。

## `index.html` 是產生出來的

不要直接改它。原始碼在 `jeffanyyyyy/chengyun` 的
`claude/resn-portfolio-experimental-aqcfoq` 分支，路徑
`experimental/immersive/index.html`，用同一個分支的 `tools/build-site.py` 產生：

```
python3 tools/build-site.py index.html --no-pf --vercel
```

`--no-pf` 拿掉「活動成果」那一章，`--vercel` 把資源路徑改成絕對路徑
（`/assets/…`），HTML 放在站台的任何一層都不會斷。

`api/contact.js` 的原始檔在同一個分支的 `deploy/api/contact.js`。

---

# 聯絡表單的設定

表單送到 `/api/contact`。那支函式做兩件事：把內容寫進 Supabase 的
`enquiries` 資料表，同時寄一封通知信。

兩件事的成敗分開算——只要有一邊成功就回報成功給填表的人。
資料庫掛了信還寄得出去，反過來也一樣，不會因為單邊故障就弄丟一筆詢問。

下面四步做完就會運作。**四組金鑰只填在 Vercel 後台，絕對不要寫進這個倉庫。**

## 步驟 1 — 建 Supabase 專案與資料表

1. 到 <https://supabase.com> 註冊，New project
   - Region 選 **Northeast Asia (Tokyo)**，離台灣最近
   - Database Password 自己設一組並保存好（這支網站用不到，但之後可能會用）
2. 專案建好後，左邊選 **SQL Editor** → New query
3. 把 `supabase/enquiries.sql` 整份貼上去，按 **Run**

那份 SQL 會建好資料表，並打開 RLS 但**一條 policy 都不建**。
這不是漏寫：RLS 打開而沒有 policy 就等於全部拒絕，
`anon`（公開金鑰）讀不到也寫不進去。只有 `service_role` 進得來，
因為它在設計上就繞過 RLS——而那把金鑰只會存在 Vercel 的環境變數裡。

## 步驟 2 — 拿 Supabase 的兩個值

| 要填的環境變數 | 在 Supabase 的哪裡 |
|---|---|
| `SUPABASE_URL` | **Project Settings → Data API** 的 Project URL，長得像 `https://xxxx.supabase.co`。專案首頁標題底下也有，旁邊有 Copy 按鈕 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings → API Keys** 的 **Secret keys**，`sb_secret_…` 開頭那一把 |

Supabase 在 2025 年換了金鑰格式。新專案的 API Keys 頁有兩個分頁：

- **Publishable and secret API keys**（新版，預設看到的）
  - `sb_publishable_…` 給瀏覽器用，**不是我們要的**
  - `sb_secret_…` 就是這裡要填的那一把
- **Legacy anon, service_role API keys**（舊版）
  - 舊專案才有，填 `service_role` 那一把，功能相同

這支函式只是把環境變數的值原封不動放進 `apikey` 與 `Authorization: Bearer`
兩個標頭，兩種格式的用法一樣，所以程式不需要為此改動。
實際跑過的是新版 `sb_secret_…`。

金鑰在列表裡預設是遮住的，**直接按旁邊的複製圖示就好，不必按眼睛顯示出來**。
**這把鑰匙可以繞過所有權限檢查**，等同資料庫的萬用鑰匙，
只能貼進 Vercel 的環境變數，不要貼到任何其他地方。

## 步驟 3 — 設定 Resend（寄信）

1. 到 <https://resend.com> 註冊
   - **用要收通知信的那個公司信箱註冊。** 沒有驗證自訂網域之前，
     Resend 只寄得到你註冊時用的信箱，用別的地址會被退件
2. 左邊 **API Keys** → Create API Key，權限選 **Sending access**
3. 金鑰只會顯示一次，當下就複製起來

之後想讓寄件者顯示成 `hello@你的網域.com` 而不是 `onboarding@resend.dev`，
到 Resend 的 **Domains** 驗證網域，再把 `CONTACT_FROM` 設成那個地址。
在那之前留空就好。

## 步驟 4 — 在 Vercel 填環境變數

Vercel → `chengyunstudio` 專案 → **Settings** → **Environments** → 點進 **Production**，
往下捲就是 **Environment Variables**。新版介面把變數收進各個環境底下了，
側邊欄不再有獨立的 Environment Variables 項目。

新增時 **Type** 選哪個：金鑰兩把選 **Secret**（存完就再也看不到值），
網址與信箱選 **Config**（之後還看得到）。四個都勾
**Production**、**Preview**、**Development**——真正必要的只有 Production，
那才是正式網址跑的環境：

| 名稱 | 值 | 必填 |
|---|---|---|
| `SUPABASE_URL` | 步驟 2 的 Project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 步驟 2 的 service_role 金鑰 | ✅ |
| `RESEND_API_KEY` | 步驟 3 的金鑰 | ✅ |
| `CONTACT_TO` | 收通知信的信箱。多個用逗號隔開 | ✅ |
| `CONTACT_FROM` | 寄件者。留空就用 `Chengyun Studio <onboarding@resend.dev>` | — |

**環境變數要重新部署才會生效。** 填完到 **Deployments**，
在最新那一筆按 ⋯ → **Redeploy**。

## 測試

開 <https://chengyunstudio.vercel.app>，到「聯繫我們」填完送出。三個地方要對得起來：

1. 畫面出現「已收到您的訊息，我們會盡速與您聯繫。」
2. Supabase → **Table Editor** → `enquiries` 多一筆
3. `CONTACT_TO` 那個信箱收到標題是 `[官網詢問] …` 的信

沒收到信先看垃圾郵件匣（`onboarding@resend.dev` 是公用地址，容易被分類進去）。
還是沒有的話，Vercel → Deployments → 點進最新那筆 → **Runtime Logs**，
函式寄信失敗會印出原因。

## 擋垃圾訊息

| 手段 | 做法 |
|---|---|
| 蜜罐欄位 | 畫面外的 `nickname` 欄位，機器人會填、真人不會。填了就假裝成功但什麼都不做 |
| 填寫時間 | 六個必填欄位在 2.5 秒內填完視為機器人 |
| 同 IP 速率 | 一分鐘 5 次。注意這是存在函式記憶體裡的，冷啟動會歸零，只擋得住粗糙的洗版 |
| 長度上限 | 每個欄位都有上限，超過就截斷 |
| 跳脫 | 信件內容全部經過 HTML 跳脫；單行欄位清掉換行，擋住郵件標頭注入 |

流量大到這些擋不住時，再接 Vercel KV 或 Upstash 做真正的速率限制。

---

## 部署到 Vercel（第一次）

零設定，不需要 `vercel.json`：

1. Vercel → Add New → Project → 匯入 `jeffanyyyyy/chengyunstudio`
2. **Project Name** 填 `chengyunstudio`（決定網址）
3. **Framework Preset** 選 `Other`
4. Build Command、Output Directory、Install Command 全部留空
5. Deploy

`api/` 底下的檔案 Vercel 會自動認成 Serverless Function，
不需要任何設定，也不需要 `package.json`——函式只用 Node 內建的 `fetch`，
零依賴。

之後推到 `main` 就會自動重新部署。
