/* 聯絡表單的後端。部署在 Vercel 上，網址是 /api/contact。
 *
 * 做兩件事：把表單寫進 Supabase，然後寄一封通知信到公司信箱。
 *
 * 為什麼不讓瀏覽器直接打 Supabase：
 *   前端只能拿 anon key，那把鑰匙是公開的，擋不擋得住全看 RLS 政策寫得對不對，
 *   寫錯一行整張表就任人讀寫。走這支函式的話，service_role key 只存在伺服器上，
 *   資料表可以一條 policy 都不開（service_role 本來就繞過 RLS），
 *   誰都碰不到，而且擋垃圾訊息的邏輯放在這裡才有意義——放前端等於沒擋。
 *
 * 不依賴任何 npm 套件：Node 18 以後 fetch 是內建的，Supabase 和 Resend
 * 都有 HTTP API。倉庫維持零依賴，Vercel 那邊也就不需要任何 build 步驟。
 *
 * 需要的環境變數（在 Vercel 後台設定，四個都是必填）：
 *   SUPABASE_URL                你的專案網址，長得像 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   服務金鑰。這把鑰匙可以繞過所有權限檢查，
 *                               只能放在這裡，絕對不能出現在前端或倉庫裡
 *   RESEND_API_KEY              Resend 的 API 金鑰
 *   CONTACT_TO                  收通知信的信箱
 * 選填：
 *   CONTACT_FROM                寄件者。沒設就用 onboarding@resend.dev
 *                               （Resend 給的公用寄件地址，不必驗證網域）
 */

/* 必填欄位，和前端的 REQUIRED 一致 */
const REQUIRED = ['subject', 'message', 'name', 'company', 'email', 'phone'];

/* 每個欄位的長度上限。超過就截斷，不是退回——
   使用者寫太長是小事，讓資料庫吞下無上限的字串才是問題 */
const LIMITS = {
  subject: 40, message: 4000, name: 120, company: 200, email: 254,
  phone: 60, mobile: 60, fax: 60, website: 300, country: 80,
  postal: 24, state: 120, city: 120, address: 300, lang: 8
};

const FIELDS = Object.keys(LIMITS);

/* 欄位在信裡的抬頭 */
const LABEL = {
  subject: '主旨', message: '訊息內容', name: '姓名', company: '公司',
  email: 'Email', phone: '電話', mobile: '手機', fax: '傳真',
  website: '網站', country: '國家／地區', postal: '郵遞區號',
  state: '州／省', city: '城市', address: '地址'
};

/* 表單裡主旨是選單，存的是代碼，信裡要看得懂 */
const SUBJECT_ZH = {
  corporate: '企業活動與典禮',
  market: '市集與品牌 IP',
  production: '製作與人力',
  esg: 'ESG 永續活動',
  press: '合作與媒體',
  other: '其他'
};

/* 同一個 IP 短時間內灌爆的簡易防線。
   注意：serverless 每個執行個體各有一份記憶體，冷啟動就歸零，
   所以這只擋得住最粗糙的洗版，不是真正的 rate limit。
   要嚴謹的話得接 Vercel KV 或 Upstash，目前的流量還用不上。 */
const RATE = new Map();
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 5;

function rateLimited(ip) {
  const now = Date.now();
  const hits = (RATE.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  hits.push(now);
  RATE.set(ip, hits);

  /* 順手把過期的清掉，免得這張表隨著執行個體的壽命一直長大 */
  if (RATE.size > 500) {
    for (const [k, v] of RATE) {
      if (!v.some((t) => now - t < RATE_WINDOW)) { RATE.delete(k); }
    }
  }
  return hits.length > RATE_MAX;
}

/* 只有訊息欄是多行的。其餘欄位一律把換行拿掉——
   name 和 company 會被放進郵件的 Subject 標頭，
   標頭裡出現 CR/LF 就有被拆成偽造標頭的空間（header injection）。
   把單行欄位的換行清掉，這條路就不存在。 */
function clean(value, max, multiline) {
  if (typeof value !== 'string') { return ''; }
  const out = multiline
    /* 訊息欄：留下 \t \n \r，其餘控制字元清掉 */
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    /* 單行欄位：換行也算控制字元，換成空白後把連續空白收成一個 */
    : value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/ {2,}/g, ' ');
  return out.trim().slice(0, max);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 寬鬆的信箱檢查。這裡的目的只是擋掉明顯不是信箱的東西，
   不是要窮舉 RFC 5322——真正的驗證是對方回不回得了信 */
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function mailHtml(data, meta) {
  const rows = FIELDS
    .filter((k) => k !== 'lang' && k !== 'message' && data[k])
    .map((k) => {
      const v = k === 'subject' ? (SUBJECT_ZH[data[k]] || data[k]) : data[k];
      return '<tr>'
        + '<td style="padding:8px 16px 8px 0;color:#6b6b6b;font-size:13px;white-space:nowrap;vertical-align:top">'
        + escapeHtml(LABEL[k] || k) + '</td>'
        + '<td style="padding:8px 0;color:#14130f;font-size:14px">' + escapeHtml(v) + '</td>'
        + '</tr>';
    }).join('');

  return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Noto Sans TC\',sans-serif;'
    + 'max-width:640px;margin:0 auto;padding:32px 24px;color:#14130f">'
    + '<p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8a8a">'
    + 'Chengyun Studio</p>'
    + '<h1 style="margin:0 0 24px;font-size:20px;font-weight:600">官網有新的詢問</h1>'
    + '<div style="padding:16px 20px;background:#f4f1e9;border-radius:6px;margin-bottom:24px">'
    + '<p style="margin:0 0 6px;font-size:12px;color:#6b6b6b">訊息內容</p>'
    + '<p style="margin:0;font-size:15px;line-height:1.75;white-space:pre-wrap">'
    + escapeHtml(data.message) + '</p></div>'
    + '<table style="border-collapse:collapse;width:100%">' + rows + '</table>'
    + '<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e2da;font-size:12px;color:#8a8a8a">'
    + '送出時間 ' + escapeHtml(meta.at) + '　·　語言 ' + escapeHtml(data.lang || '—')
    + '<br />直接回覆這封信就會寄到 ' + escapeHtml(data.email) + '</p>'
    + '</div>';
}

async function saveToSupabase(row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { throw new Error('Supabase 的環境變數沒設'); }

  const res = await fetch(url.replace(/\/+$/, '') + '/rest/v1/enquiries', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    throw new Error('Supabase ' + res.status + ' ' + (await res.text()).slice(0, 300));
  }
}

async function sendMail(data, meta) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  if (!key || !to) { throw new Error('寄信的環境變數沒設'); }

  const subject = SUBJECT_ZH[data.subject] || data.subject || '其他';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CONTACT_FROM || 'Chengyun Studio <onboarding@resend.dev>',
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      /* 回信直接回到填表的人，不用再複製貼上 */
      reply_to: data.email,
      subject: '[官網詢問] ' + subject + '　—　' + data.name + '（' + data.company + '）',
      html: mailHtml(data, meta)
    })
  });

  if (!res.ok) {
    throw new Error('Resend ' + res.status + ' ' + (await res.text()).slice(0, 300));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'too_many_requests' });
  }

  /* Vercel 會依 Content-Type 幫忙解析，但別人可以送任何東西過來，
     所以自己再擋一次，不要相信 req.body 一定是物件 */
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  /* 蜜罐：這個欄位在畫面上看不到，正常使用者不可能填。
     填了就直接回成功——讓機器人以為送出了，不必知道自己被擋 */
  if (clean(body.nickname, 80)) {
    return res.status(200).json({ ok: true });
  }

  /* 六個必填欄位在正常填寫下不可能兩秒半內完成 */
  const elapsed = Number(body.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 2500) {
    return res.status(200).json({ ok: true });
  }

  const data = {};
  for (const k of FIELDS) { data[k] = clean(body[k], LIMITS[k], k === 'message'); }

  const missing = REQUIRED.filter((k) => !data[k]);
  if (missing.length) {
    return res.status(400).json({ error: 'missing_fields', fields: missing });
  }
  if (!looksLikeEmail(data.email)) {
    return res.status(400).json({ error: 'bad_email' });
  }
  if (body.consent !== true) {
    return res.status(400).json({ error: 'consent_required' });
  }

  const meta = { at: new Date().toISOString() };
  const row = Object.assign({}, data, {
    consent: true,
    ip: ip,
    user_agent: clean(req.headers['user-agent'], 400)
  });

  /* 兩件事分開算成敗。寫入失敗還是要試著寄信，反過來也是——
     兩條路都斷了才算真的失敗，只斷一條的話這筆詢問還留得住。
     使用者那端只要有一條成功就回成功，沒有理由叫人家重填一次。 */
  const results = await Promise.allSettled([saveToSupabase(row), sendMail(data, meta)]);
  const [saved, mailed] = results;

  if (saved.status === 'rejected') { console.error('[contact] 寫入 Supabase 失敗：', saved.reason); }
  if (mailed.status === 'rejected') { console.error('[contact] 寄信失敗：', mailed.reason); }

  if (saved.status === 'rejected' && mailed.status === 'rejected') {
    return res.status(502).json({ error: 'upstream_failed' });
  }

  return res.status(200).json({
    ok: true,
    saved: saved.status === 'fulfilled',
    mailed: mailed.status === 'fulfilled'
  });
};
