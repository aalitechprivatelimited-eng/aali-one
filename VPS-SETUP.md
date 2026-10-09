# Aali One on the VPS (Hostinger + Coolify) at one.aaliconssultancy.com

Decided 8 Oct 2026. Aali One moves from Vercel + Neon to the Hostinger VPS, run by Coolify, with its database on the VPS too.
The address is **https://one.aaliconssultancy.com**. The domain's records are kept at **Netlify**, where the Aali
Conssultancy website is. Until the move, the address points at the live site on Vercel (A record `one` → 76.76.21.21).

No password, token or database address is ever sent in chat or email. They are typed straight into Coolify, or into
`.env.local` on the office computer.

## 0. Before you start

- The code must reach Coolify. Coolify builds from a Git repository, so Aali One's code goes to a **private** GitHub
  repository, which Coolify then reads through its GitHub App. The repository holds no passwords. Those stay out of git
  (`.gitignore`) and out of the image (`.dockerignore`).
- The department-card layout of Daily reports is **not** approved for live. It is set aside before the code is pushed.
- Everyone signs in once on the new address (new sign-in system). Passwords stay the same.

## 1. The database (Coolify)

1. Coolify → your project → **+ New** → **Database** → **PostgreSQL** (version 16 or 17). Name: `aali-one-db`.
2. Start it. Copy its **internal** connection address (Postgres URL, internal). It looks like
   `postgres://postgres:<password>@<container-name>:5432/postgres`.
3. Leave "Make it publicly available" **off** for now (step 5 turns it on for a few minutes).

## 2. The app (Coolify)

1. **+ New** → **Application** → **Private repository (with GitHub App)** → choose the Aali One repository, branch `main`.
2. **Build Pack: Dockerfile**. **Port: 3000**. Health check path: `/api/health`.
3. **Environment variables** (mark each one "secret"):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the internal address from step 1, with `?sslmode=disable` added at the end (the app and the database talk inside the VPS) |
| `JWT_SECRET` | a long random text (64+ letters and numbers). It signs everyone's sign-in. |
| `APP_URL` | `https://one.aaliconssultancy.com` |
| `HRM_DATABASE_URL` | the same value as on Vercel today (Aali HRM, read-only) |
| `WHATSAPP_TOKEN` | Meta system-user token (see Settings → Connections → WhatsApp in Aali One). Add when ready. |
| `WHATSAPP_PHONE_NUMBER_ID` | the Aali One number's ID in WhatsApp Manager. Add when ready. |
| `WHATSAPP_REPORT_TEMPLATE` | `daily_work_report` – the approved template's name. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | the WhatsApp account's ID. Only for "Check the template with Meta" (see WHATSAPP-SETUP.md). |

4. **Deploy**. When it is green, open the temporary address Coolify shows (…sslip.io). Aali One opens on the "first time
   here" screen, because the database is still empty. Do **not** create anything there. Step 5 brings the real data.

## 3. The address one.aaliconssultancy.com (Netlify, then Coolify). Do this at the very end of step 5.

1. Netlify (app.netlify.com) → **Domains** → aaliconssultancy.com → **DNS records**: open the **A** record named
   **one** (today 76.76.21.21, the live site on Vercel) → change the value to **the VPS's IP address** (Hostinger hPanel →
   VPS → Overview) → Save. Never change the domain's nameservers: the Aali Conssultancy website lives on them.
2. Coolify → the app → **Domains**: `https://one.aaliconssultancy.com` → Save → **Redeploy**.
   Coolify gets the HTTPS certificate (Let's Encrypt) by itself once the record has spread, usually in 5–30 minutes.
3. Check: https://one.aaliconssultancy.com opens with the padlock. Then remove the address from the Vercel project
   (Vercel → aali-one → Settings → Domains), so Vercel stops asking for it.

## 4. Aali HRM and the client HRMs

Nothing changes in Aali HRM. The same read-only login works from the VPS (`HRM_DATABASE_URL` above).
A client's own HRM, once set up, adds `HRM_DATABASE_URL_<link code>` the same way (scripts/client-hrm-reader.sql).

## 5. Moving the data (Neon → VPS), the final time

Pick a quiet time (evening). Tell everyone: "Aali One moves to one.aaliconssultancy.com tonight. Please don't use it between
8 and 8:30 pm."

1. Coolify → `aali-one-db` → **Make it publicly available** (on), note its **public** address (VPS IP and a port).
2. On the office computer, in `D:\Demo\aali-one\.env.local`, add one line (typed there, never sent anywhere):
   `VPS_DATABASE_URL="postgres://postgres:<password>@<VPS IP>:<public port>/postgres?sslmode=disable"`
3. Run: `node scripts/move-to-vps.mjs` (or with `--replace` if a test copy was made before). Neon is only **read**.
   It prints how many people, records, files and audit lines were copied, and checks each count.
4. Coolify → `aali-one-db` → **Make it publicly available** → **off** again.
5. Coolify → the app → **Restart**. Open https://one.aaliconssultancy.com and sign in. Check that today's reports, leads,
   payroll and files are there.
6. Tell everyone the new address. The old Vercel address can send people to the new one a week later.

## 6. Backups (do this the same day)

Coolify → `aali-one-db` → **Backups** → **Scheduled backups**: daily at 02:00, keep 14. If an S3-type store is available
(Hostinger Object Storage, Cloudflare R2), add it as the backup destination so the backups are not only on the same VPS.

## Checks after the move

- https://one.aaliconssultancy.com/api/health answers `{"ok":true}`.
- Sign-in, Daily reports, Payroll → Rules & Aali HRM ("Linked").
- Settings → Connections → WhatsApp shows "Linked" once the two WhatsApp settings are added.
  "Send me a test message" arrives from **Aali One**.
