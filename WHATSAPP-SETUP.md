# WhatsApp for Aali One: setting up, and checking the message template

The detailed step-by-step version, with tick boxes and Copy buttons, is the page "Aali One WhatsApp Setup":
https://claude.ai/artifact/1Agz1zSXUyLvcFSsPfqWZ8 (private to Nikhil; share it from its Share menu).

**What it does today:** when someone submits their daily report, each person in management gets that report on WhatsApp
at once, from a number that shows as **Aali One**. Nothing else is sent on WhatsApp yet: no deadline or follow-up
messages go to BDEs.

**When:** after Aali One is on the VPS (one.aaliconssultancy.com).
**Who:** Nikhil (Meta Business account owner). Tokens and passwords are typed into Meta and Coolify, never sent in chat.

---

## Part A. The number and the name "Aali One"

1. **Get a new mobile number only for Aali One** (a new SIM is fine). It must not be on WhatsApp or the WhatsApp Business
   app. If it is, delete that WhatsApp account first. Keep the SIM in a phone: the codes come by SMS or call.
2. Go to **business.facebook.com** and open the Aali Group business portfolio (or create one with the company's name,
   address and website).
3. **developers.facebook.com** → My Apps → **Create app** → type **Business** → name "Aali One" → link it to the Aali
   Group portfolio → add the **WhatsApp** product.
4. **WhatsApp Manager** (business.facebook.com/wa/manage) → **Phone numbers** → **Add phone number**:
   - **Display name: Aali One**
   - Category: Professional services
   - Verify the number with the SMS or call code.
5. In the number's **Profile**: photo = the Aali One logo, About = "Aali One – Aali Group's work app".
6. **Wait for the display name review.** The Phone numbers list shows *Name status*. Wait for **Approved** (usually
   1–2 days). Meta checks that the name belongs to your business, so one.aaliconssultancy.com must be live first: its sign-in
   page shows "Aali One · Aali Group". If Meta **rejects** the name, it shows the reason. Reply with the website, or
   change it to "Aali One by Aali Group".
7. **Payment method:** WhatsApp Manager → **Payment settings** → add a card. Meta charges a small amount per message.
8. *(Optional)* **Business verification:** Business settings → Security Center → Start verification (GST certificate,
   company registration). It isn't needed for sending reports to a few managers; it only raises Meta's daily limits.

## Part B. The message template (Meta must approve it)

A business may send the first message to someone only with a template Meta has approved. Aali One fills its six
blanks with the report, and the button opens that one report.

1. WhatsApp Manager → **Message templates** → **Create template**.
2. **Category: Utility.** It's an update about work, not an advert. Meta's form starts on Marketing – change it.
   (The first try, `daily_report`, went in as Marketing on 9 Oct 2026, so the template is now `daily_work_report`.)
3. **Name: `daily_work_report`** (exactly this, small letters with the underscore). **Language: English** (choose "English",
   not "English (US)" or "English (UK)").
4. **Type of variable: Number.**
5. **Body:** paste exactly (Aali One → Settings → Connections → WhatsApp has a **Copy** button). Each blank is one line,
   because Meta allows no line breaks inside a blank. (Seven blanks were refused as "too many variables for its length",
   so the link is a button and the body has more words.)

   ```
   👤 {{1}}
   Daily work report · Aali One

   ⏱️ Worked hours: {{2}}
   Work done: {{3}}

   📋 Final report
   Calls: {{4}}
   Plan for tomorrow: {{5}}
   Problem: {{6}}

   This report was just submitted in Aali One. Tap the button below to open it in full.
   ```

6. **Samples** (one per blank):
   - {{1}} `*Rasheed Shaik*, BDE · Thu 8 Oct 2026`
   - {{2}} `4 h 40 min (9:40 am – 3:51 pm · Break 40 min · Nothing recorded 1 h 30 min)`
   - {{3}} `Calling 2 h 25 min · Client visit 1 h 30 min · Quotations 45 min`
   - {{4}} `3 calls · 1 interested · 1 to call back · 1 meeting fixed · 0 met in person`
   - {{5}} `Visit Ravi Stores and send the demo link to Sri Sai Traders`
   - {{6}} `Need the new price list from the office`
7. **Buttons → Add button → Visit website:** text `Open full report`, URL type **Dynamic**, URL
   `https://one.aaliconssultancy.com/daily/` – type it only up to `/daily/`; Meta adds `{{1}}` after the box by itself
   (typing `{{1}}` too makes it appear twice and the link breaks – happened 10 Oct 2026), sample `https://one.aaliconssultancy.com/daily/Xq3Lm8Rt2Vb6Nw9Kd4Hs7Pa1`.
   The button opens only that person's report of that day, with no sign-in (each submitted report gets its own link, like a
   client's progress link). No header, no footer. Press **Submit**.

### Checking the template

- **In WhatsApp Manager:** Message templates → `daily_work_report` → the **Status** column:
  - **In review**: wait (minutes, at most a day).
  - **Active** (or "Active – quality pending"): approved and ready.
  - **Rejected**: open it to read why, press **Edit**, fix it and submit again. Usual reasons: the text was changed so a
    blank sits at the very start or end; the samples don't fit; it reads like an advert.
  - The **Category** column must say **Utility**. If Meta changed it to Marketing, edit the wording so it plainly reads
    as a work update, and submit again.
- **In Aali One** (once Part C is done): Settings → Connections → WhatsApp → **Check the template with Meta**. It shows
  *approved · utility · same text as here*, or exactly what is wrong (not found, not approved yet, rejected and why,
  wrong language, wrong category, not six blanks or no button).
- **A real message:** press **Send me a test message** there. It arrives on your phone from **Aali One**. The list below
  the button shows *Sent*, or Meta's reason if it was refused.

## Part C. Linking Aali One

1. Business settings → **Users → System users** → **Add**: name "Aali One", role **Admin**.
2. Select it → **Assign assets**: the "Aali One" app (full control) and the WhatsApp account (full control).
3. **Generate new token**: app "Aali One", expiry **Never**, permissions **whatsapp_business_messaging** and
   **whatsapp_business_management**. Copy the token straight into Coolify (next step). Don't keep it anywhere else.
4. Coolify → Aali One → **Environment variables** (secret):
   - `WHATSAPP_TOKEN` = the token
   - `WHATSAPP_PHONE_NUMBER_ID` = WhatsApp Manager → Phone numbers → the number → **Phone number ID**
   - `WHATSAPP_REPORT_TEMPLATE` = `daily_work_report` (the template's name)
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` = WhatsApp Manager → **WhatsApp account ID** (on the overview page). Used only by
     "Check the template with Meta".
   - Then **Restart**.
5. Aali One → Settings → Connections → WhatsApp shows **Linked**. Run the three checks above.
6. Make sure each person in management has their mobile number in Settings → People & teams. The list in the WhatsApp
   section shows who will get the reports.
7. Ask management to **save the number as "Aali One"** in their phone contacts. Then the chats always show "Aali One",
   even before Meta has finished reviewing the name.

If WhatsApp Manager shows the number as **Pending** or **Not registered** after Part A, tell Claude. Aali One can
register it with a 6-digit PIN you choose.
