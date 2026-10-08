# WhatsApp for Aali One: setting up, and checking the message template

**What it does today:** when someone submits their daily report, each person in management gets that report on WhatsApp
at once, from a number that shows as **Aali One**. Nothing else is sent on WhatsApp yet: no deadline or follow-up
messages go to BDEs.

**When:** after Aali One is on the VPS (one.aaligroup.co).
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
   1–2 days). Meta checks that the name belongs to your business, so one.aaligroup.co must be live first: its sign-in
   page shows "Aali One · Aali Group". If Meta **rejects** the name, it shows the reason. Reply with the website, or
   change it to "Aali One by Aali Group".
7. **Payment method:** WhatsApp Manager → **Payment settings** → add a card. Meta charges a small amount per message.
8. *(Optional)* **Business verification:** Business settings → Security Center → Start verification (GST certificate,
   company registration). It isn't needed for sending reports to a few managers; it only raises Meta's daily limits.

## Part B. The message template (Meta must approve it)

A business may send the first message to someone only with a template Meta has approved. Aali One fills its four
blanks with the report.

1. WhatsApp Manager → **Message templates** → **Create template**.
2. **Category: Utility.** It's an update about work, not an advert.
3. **Name: `daily_report`** (exactly this, small letters with the underscore). **Language: English** (choose "English",
   not "English (US)" or "English (UK)").
4. **Type of variable: Number.**
5. **Body:** paste exactly (Aali One → Settings → Connections → WhatsApp has a **Copy** button):

   ```
   Daily report from {{1}} for {{2}}.

   {{3}}

   Full report: {{4}}

   – Aali One
   ```

6. **Samples** (Meta asks for one example per blank):
   - {{1}} `Ravi Kumar, BDE`
   - {{2}} `Wed 8 Oct 2026`
   - {{3}} `Day 09:30–18:10, worked 7h 45m · 6 tasks · 42 calls: 7 interested`
   - {{4}} `https://one.aaligroup.co/daily`
7. No header, no footer, no buttons. Press **Submit**.

### Checking the template

- **In WhatsApp Manager:** Message templates → `daily_report` → the **Status** column:
  - **In review**: wait (minutes, at most a day).
  - **Active** (or "Active – quality pending"): approved and ready.
  - **Rejected**: open it to read why, press **Edit**, fix it and submit again. Usual reasons: the text was changed so a
    blank sits at the very start or end; the samples don't fit; it reads like an advert.
  - The **Category** column must say **Utility**. If Meta changed it to Marketing, edit the wording so it plainly reads
    as a work update, and submit again.
- **In Aali One** (once Part C is done): Settings → Connections → WhatsApp → **Check the template with Meta**. It shows
  *approved · utility · same text as here*, or exactly what is wrong (not found, not approved yet, rejected and why,
  wrong language, wrong category, not four blanks).
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
