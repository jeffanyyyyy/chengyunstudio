-- 官網聯絡表單的資料表。
-- 到 Supabase 後台左邊的 SQL Editor，整份貼上去按 Run 就好，只要跑一次。

create table if not exists public.enquiries (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- 前端的必填欄位
  subject     text not null,
  message     text not null,
  name        text not null,
  company     text not null,
  email       text not null,
  phone       text not null,

  -- 選填
  mobile      text,
  fax         text,
  website     text,
  country     text,
  postal      text,
  state       text,
  city        text,
  address     text,

  -- 送出當下的狀態
  lang        text,
  consent     boolean not null default false,
  ip          text,
  user_agent  text
);

-- 後台通常是照時間由新到舊看，直接給它一個索引
create index if not exists enquiries_created_at_idx
  on public.enquiries (created_at desc);


-- ── 權限 ──────────────────────────────────────────────
-- 打開 RLS，然後「一條 policy 都不建」。
--
-- 這不是漏寫。RLS 打開之後，沒有 policy 就等於全部拒絕：
-- anon（瀏覽器拿得到的那把公開金鑰）和 authenticated 都讀不到也寫不進去，
-- 就算有人把 anon key 挖出來也一樣。
--
-- 只有 service_role 進得來，因為它在設計上就繞過 RLS，
-- 而那把金鑰只存在 Vercel 的環境變數裡，不會出現在前端或倉庫中。
alter table public.enquiries enable row level security;


-- 確認一下（跑完應該看到 rowsecurity = true）：
-- select relname, relrowsecurity as rowsecurity
--   from pg_class where relname = 'enquiries';
--
-- 確認沒有任何 policy（應該是 0 筆）：
-- select * from pg_policies where tablename = 'enquiries';
