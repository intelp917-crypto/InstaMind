# InstaMind — SaaS مدیریت اتوماسیون دایرکت اینستاگرام

InstaMind یک SaaS کامل است که پیج‌های فروش اینستاگرام را به یک **دستیار هوشمند دایرکت** مجهز می‌کند: مشتری با گوگل یا ایمیل وارد می‌شود، اشتراک ماهانه می‌خرد، پیجش را وصل می‌کند، دستیار را با «دانش + پرسش‌وپاسخ» آموزش می‌دهد و از آن به بعد هر DM به‌صورت هوشمند (یا دستی) پاسخ می‌گیرد.

> پوشهٔ `legacy/` نسخهٔ قبلی پروژه است و به هیچ‌وجه وارد گردش کار فعلی نمی‌شود.

---

## معماری (Architecture)

```
web/                # SPA فرانت‌اند — React 19 + Vite + TypeScript (RTL فارسی)
  src/pages/        # LoginPage، DashboardPage (داشبورد + tier list)، AppShell
                    # (اینباکس / دستیار / آمار / اتصال)، AdminPage
worker/             # بک‌اند — Hono روی Cloudflare Workers + D1 (SQLite)
  src/index.ts      # همهٔ مسیرها (auth, account, plans, tenant, admin, oauth, webhook)
  src/db.ts         # لایهٔ دسترسی D1 + ساخت اسکیمای جدول‌ها در اولین ایزولیت
  src/plans.ts      # کاتالوگ پلن‌ها (tier list) — تک منبع قیمت و سقف‌ها
  src/password.ts   # PBKDF2-SHA256 برای هش رمز عبور
  src/webhook.ts    # موتور پاسخ: وب‌هوک Meta → guardrail → مدل AI → ارسال DM
  src/ai.ts         # کال OpenAI-compatible (base URL و مدل قابل تنظیم)
  src/prompt.ts     # ساخت پرامپت سیستمی (شخصیت + قوانین + دانش + Q&A)
  src/sessions.ts   # کوکی‌های امضاشده HMAC: admin / tenant / user
  src/crypto.ts     # AES-256-GCM برای رمزگذاری اسرار در D1، HMAC، ابزارهای hex/base64
```

- **پروتکل**: فرانت SPA است و فقط `/api/*` را صدا می‌زند؛ worker هم assets را سرو می‌کند هم API را.
- **جلسه‌ها**: کوکی امضاشده (`im_user`, `im_tenant`, `im_admin`) — بدون انبار نشست سمت سرور.
- **اسرار**: کلید اپلیکیشن Meta، رمز AI و آواتار Google با AES-256-GCM داخل D1 رمز می‌شوند.
- **وب‌هوک**: Meta سریع 200 می‌گیرد (`waitUntil`) و پاسخ‌دهی در پس‌زمینه انجام می‌شود.

---

## قابلیت‌ها (Features)

### حساب کاربری

- ورود با **گوگل** (OAuth 2.0، بدون کلاینت سکرت سمت فرانت) و/یا **ایمیل + رمز عبور** (PBKDF2، 120,000 تکرار) — عضویت با یک ایمیل واحد؛ اگر با گوگل ساخته شود ایمیل هم می‌تواند بعدها رمز بگیرد.
- **داشبورد حساب** (`/dashboard`): وضعیت اشتراک، اتصال پیج، مصرف روزانه/کل، لیست پلن‌ها، سفارش‌ها، پروفایل (نام/رمز).
- پیج اینستاگرام به حساب لینک می‌شود (`tenants.user_id`)؛ نقش‌های legacy (ورود مستقیم با اینستاگرام) همچنان کار می‌کنند.

### اشتراک (tier list) — ماهانه

| پلن | قیمت/ماه | پیج | پاسخ/روز | Q\&A | دانش |
| :--- | :--- | :--- | :--- | :--- | :--- |
| استارت | 999,000 تومان | 1 | 200 | 20 | 30 |
| حرفه‌ای (پرطرفدار) | 1,990,000 تومان | 1 | 600 | 60 | 80 |
| بیزینس | 2,900,000 تومان | 2 | 2,000 | 120 | 150 |
| پیشرفته | 4,900,000 تومان | 5 | 5,000 | 250 | 300 |
| سازمانی | 9,000,000 تومان | 20 | 20,000 | 500 | 600 |

- خرید = ثبت سفارش (`pending`) → پرداخت خارجی → **تأیید ادمین** (`POST /api/admin/orders/:id/decide`) → پلن فعال می‌شود و سقف‌ها به‌صورت خودکار روی پیج‌های لینک‌شده اعمال می‌گردد.
- لغو سفارش `pending` از داشبورد کاربر؛ حالت‌های `active/rejected/cancelled`.
- **دیوار پرداخت**: پیج‌های کاربران حساب اگر پلن فعال نداشته باشند AI جواب نمی‌دهد (`blocked:برای پاسخ هوشمند، اشتراک فعال لازم است`). پیج‌های قدیمی بدون حساب (فقط اینستاگرام) دست‌نخورده کار می‌کنند (grandfathered).
- سقف تعداد پیج طبق پلن در لحظهٔ اتصال چک می‌شود؛ سقف Q\&A و دانش در ذخیرهٔ تنظیمات اعمال می‌شود.

### دستیار هوشمند

- دروازهٔ موضوع (scope-gate)، پرسش‌وپاسخ آموزش‌دیده (پاسخ دقیق حتی با پارافریز/تایپو)، دانشنامه، کلمات مسدود، سقف پاسخ در ساعت برای هر مخاطب، هرگز افشای پرامپت نمی‌کند.
- شخصیت: نام دستیار، لحن، زبان، محدود طول پاسخ، ایموجی، پاسخ آف‌تاپیک ثابت.
- اینباکس با توقف/شروع AI برای هر گفتگو، پاسخ دستی، آمار (پاسخ‌ها، توکن، امروز/کل).

### پنل ادمین (`/admin`)

- راه‌اندازی یک‌باره: اپ Meta (App ID/Secret/verify token) و سرویس AI (base URL، مدل، دما...).
- مدیریت مشتریان (سقف روزانه، پاسخ خودکار، حذف)، سفارش‌های اشتراک (تأیید/رد)، آمار کل.

---

## راه‌اندازی محلی (Local Setup)

پیش‌نیاز: Node 20+، npm.

```
# 1) فرانت
cd web
npm install --legacy-peer-deps    # on Windows/Mac if peer conflicts arise
npm run build                     # خروجی web/dist که worker سرو می‌کند

# 2) بک‌اند
cd ../worker
npm install --legacy-peer-deps
cp .dev.vars.example .dev.vars    # مقدارها را پر کن
npx wrangler d1 create instamind  # فقط بار اول؛ id را در wrangler.jsonc بگذار
npm run dev                       # http://localhost:8787
```

نکته: `wrangler dev` پایگاه دادهٔ D1 را لوکال می‌سازد و اسکیمای جدول‌ها در اولین request ایزولیت خودکار ساخته می‌شود (`ensureSchema`) — شامل مهاجرت `tenants.user_id`.

مقدارهای لازم در `.dev.vars` (نمونهٔ کامل: `.dev.vars.example`):

| کلید | نقش |
| :--- | :--- |
| `ADMIN_KEY` | رمز ورود پنل ادمین |
| `ENCRYPTION_KEY` | 64 کاراکتر hex؛ کلید AES-256 برای اسرار در D1 |
| `SESSION_SECRET` | کلید HMAC کوکی‌های جلسه |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | پیش‌فرض سرویس AI (پنل ادمین اولویت دارد) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ورود با گوگل؛ خالی = دکمه غیرفعال |

---

## پیکربندی Google OAuth

1. در [Google Cloud Console](https://console.cloud.google.com/apis/credentials) یک OAuth Client از نوع **Web application** بساز.
2. Authorized redirect URI:
    - توسعه: `http://localhost:8787/oauth/google/callback`
    - تولید: `https://<دامنهٔ شما>/oauth/google/callback`
3. Client ID و Client Secret را در `.dev.vars` (لوکال) یا Secrets محیط (تولید) بگذار.
4. `GET /oauth/google/start` state امن می‌سازد (یک‌بار مصرف در `oauth_states`)، کد را در `oauth2.googleapis.com/token` تبادل و پروفایل را از `openidconnect.googleapis.com/v1/userinfo` می‌گیرد (فقط حساب‌های `email_verified`).

---

## پیکربندی اینستاگرام (Meta)

1. در [developers.facebook.com](https://developers.facebook.com) اپ بساز و **Messenger/Instagram (Direct Messaging)** را اضافه کن؛ پیج Business و اتصال حساب اینستاگرام حرفه‌ای لازم است.
2. در پنل ادمین (`/admin`): App ID و App Secret و verify token را ذخیره کن؛ Redirect URI پیشنهادشده را در اپ Meta قرار بده.
3. Webhook URL: `https://<دامنه>/webhook/instagram` + همان verify token؛ فیلد `messages` را subscribe کن.
4. مشتری دکمهٔ «اتصال پیج اینستاگرام» را می‌زند → توکن‌ها رمز شده ذخیره و وب‌هوک subscribe می‌شود.

---

## مدل هوش مصنوعی (AI provider)

- مسیر پیش‌فرض: کلید را در **پنل ادمین → راه‌اندازی** بده (در D1 رمز می‌شود) یا متغیرهای `OPENAI_*` را بگذار؛ هر سرور سازگار با OpenAI chat completions کار می‌کند (از جمله API خود Freebuff: `https://freebuff.com/api/v1`). فیلد `model` جای مدل دلخواه شماست.
- تا وقتی provider تنظیم نشده، چرخهٔ پاسخ با پیام سیستمی «سرویس تنظیم نشده» متوقف می‌شود.
- سقف توکن/دما/زمان‌آوت و دروازهٔ موضوع (مدل دوم سبک) هم همه در پنل ادمین است.

---

## API (خلاصهٔ کاربردی)

قانونی بودن: klein کوکی `im_user` و Everything `/api/account/*`. خطای JSON همیشه `{ok:false, error}`.

| مسیر | شرح |
| :--- | :--- |
| `POST /api/auth/register` | ساخت حساب {name, email, password} — rate limit 5 / 30 دقیقه |
| `POST /api/auth/login` | ورود — rate limit 10 / 5 دقیقه |
| `POST /api/auth/logout` | خروج همهٔ نقش‌ها (حساب + پیج + ادمین) |
| `POST /api/admin/login` | با `ADMIN_KEY` — rate limit 5 / 15 دقیقه |
| `GET /api/me` | نشست پیج (تمانت) — null یعنی پیج متصل نیست |
| `GET /api/account/me` | داشبورد حساب: user + instagram + usage + orders |
| `POST /api/account/profile` | تغییر نام نمایشی |
| `POST /api/account/password` | تغییر/تعیین رمز (حساب گوگلی بدون رمز هم می‌تواند رمز بگذارد) |
| `GET /api/plans` | کاتالوگ عمومی پلن‌ها |
| `POST /api/account/subscribe` | ثبت/استفادهٔ مجدد سفارش pending برای یک پلن |
| `POST /api/account/orders/:id/cancel` | لغو سفارش خودِ کاربر |
| `GET /oauth/google/start` → `callback` / `GET /oauth/instagram/start` → `callback` | دو OAuth |
| `GET/PUT /api/tenant/settings` | شخصیت + دانش + Q\&A + قوانین (با سقف پلن) |
| `GET /api/tenant/prompt` | پیش‌نمایش پرامپت سیستمی که واقعاً به مدل می‌رود |
| `GET /api/admin/*`، `GET /api/admin/orders`، `POST /api/admin/orders/:id/decide` | پنل ادمین و تأیید سفارش |
| `GET/POST /webhook/instagram` | verify (challenge) + پیام‌های Meta با تأیید امضای X-Hub-Signature-256 |

---

## دیپلوی (Deployment)

پروژه برای **Freebuff Sites** (Cloudflare Workers) آماده است:

- ورکر: `worker/src/index.ts` (Hono) با `assets = web/dist`.
- جریان پیشنهادی: بیلد فرانت → deploy ورکر → Secrets محیطی (ADMIN\_KEY, ENCRYPTION\_KEY, SESSION\_SECRET, OPENAI\_*, GOOGLE\_*) را در محیط تولید بگذار → D1 تولیدی را بساز و در تنظیمات ورکر وصل کن → دامنه را در Meta/Google با callbackهای تولیدی به‌روز کن.
- توجه: `ENCRYPTION_KEY` و `SESSION_SECRET` تولیدی باید از لوکال جدا باشند؛ بدون `ENCRYPTION_KEY` درست، اسراری که در D1 رمز شده‌اند ناخوانا می‌شوند.

---

## امنیت (Security)

- حساهای جلسه امضاشده HMAC و HttpOnly/SameSite=Lax (+Secure در آدرس https) هستند.
- هر مشتری فقط داده‌های پیج خودش را می‌بیند؛ هیچ شناسه‌ای از سمت کلاینت به کوئری‌ها اعتماد نمی‌شود (همیشه از جلسه می‌آید).
- وب‌هوک Meta: تأیید امضای X-Hub-Signature-256 با App Secret پیش از هر پردازش.
- رمز: PBKDF2-SHA256 با salt تصادفی؛ مسیر ورود برای حساب‌های موجود/ناموجود انعطاف زمانی ندارد (ثابت).
- Rate limiting برای ورود/ثبت‌نام/ادمین (per-isolate؛ خط اول دفاع، نه جایگزین WAF).
- Prompt-injection: پیام کاربر فقط داده است؛ آف‌تاپیک یا دستور تغییر نقش → پاسخ ثابت صاحب پیج.

---

## نقشهٔ راه (Roadmap)

- درگاه پرداخت (زرین‌پال/آیدی‌پی) برای فعال‌سازی خودکار سفارش‌ها
- ریست رمز با ایمیل (فعلاً تعویض رمز از داشبورد)
- چندپیج: UI مدیریت صف متصل + سوییچ بین پیج‌ها (زیرساخت لینک پیج به حساب آماده است)
- استریم آمار زنده و تحلیل نرخ فروش
- اشتراک سالانه و کد تخفیف

---

## عیب‌یابی (Troubleshooting)

| علامت | دلیل / راه حل |
| :--- | :--- |
| دکمهٔ ورود با گوگل غیرفعال | `GOOGLE_CLIENT_ID/SECRET` تنظیم نشده |
| «ورود با گوگل» برمی‌گردد به صفحهٔ خانه با خطا | redirect URI اشتباه یا state منقضی — مجدداً تلاش کنید |
| پیام سیستمی «اشتراک فعال لازم است» | ادمین سفارش را تأیید نکرده یا رد شده |
| پیام «سقف روزانهٔ پاسخ پر شده» | dailyReplyLimit پلن پر شده — پلن بالاتر یا فردا |
| پیام «سرویس هوش مصنوعی تنظیم نشده» | پنل ادمین → راه‌اندازی → سرویس AI |
| خطای `ENCRYPTION_KEY must be 64 hex chars` | کلید دقیقاً 64 کاراکتر hex نباشد |
| ابزارها لوکال به وب‌هوک نمی‌رسند | localhost را Meta ضمیمه نمی‌کند؛ از tunnel + دامنهٔ واقعی استفاده کن |
