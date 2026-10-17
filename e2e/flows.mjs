// End-to-end check with a real browser (Playwright driving the Edge or Chrome already on this computer).
// It starts Aali One on an empty in-memory database, signs in as a BDE and as the Sales Manager, and walks the
// everyday flows on a laptop screen and a phone screen. Run it with: npm run test:e2e
// It never touches the live database: the server is started with no database address and stops if the database is not empty.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 3190 + Math.floor(Math.random() * 200), BASE = `http://127.0.0.1:${PORT}`, PW = 'T-' + randomBytes(9).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ['server/dev.js', String(PORT)], { env: { ...process.env, DATABASE_URL: '', POSTGRES_URL: '', PGLITE_DIR: 'memory://', PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] });
let browser, failed = 0;
const stop = async (code) => { await browser?.close().catch(() => {}); server.kill(); process.exit(code); };
const api = async (method, path, body, cookie = '') => { const r = await fetch(BASE + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
async function step(name, fn) { try { await fn(); console.log('  ✔', name); } catch (e) { failed++; console.log('  ✖', name, '\n     ', String(e.message || e).split('\n')[0]); } }
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(250); }
  must((await api('GET', '/setup')).body.needsSetup === true, 'The test server is not on an empty database. Stopping.');
  const admin = (await api('POST', '/setup', { name: 'Test Admin', email: 'admin@e2e.test', password: PW })).cookie;
  const person = (firstName, surname, email, title, designation) => api('POST', '/users', { firstName, surname, email, password: PW, title, designation, company: 'Aali Conssultancy' }, admin);
  const smUser = await person('Meera', 'Rao', 'sm@e2e.test', 'salesmgr', 'Sales Manager');
  must(smUser.status === 200, 'could not add the Sales Manager');
  must((await person('Kiran', 'Kumar', 'bde@e2e.test', 'bde', 'BDE - Sales')).status === 200, 'could not add the BDE');
  must((await person('Vani', 'Reddy', 'bde2@e2e.test', 'bde', 'BDE - Sales')).status === 200, 'could not add the second BDE');

  browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
  const errors = [];
  const open = async (size, mobile = false) => { const ctx = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage();
    await ctx.addInitScript(() => { try { localStorage.getItem('aali-side') || localStorage.setItem('aali-side', 'full'); } catch {} }); // the steps click sections in the full sidebar (it starts collapsed)
    page.on('pageerror', (e) => errors.push('page error: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
    return page; };
  // Like Zoho One (17 Oct 2026): a section lives inside its app – when it is not in the menu now, open the app from All apps first.
  const go = async (page, app, label) => { if (!(await page.locator('.nav a', { hasText: label }).count())) { await page.locator('.nav a', { hasText: 'All apps' }).click(); await page.locator('.nav a', { hasText: app }).click(); }
    await page.locator('.nav a', { hasText: label }).click(); };
  const signIn = async (page, email) => { await page.goto(BASE); await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill(PW);
    await page.getByRole('button', { name: 'Sign in' }).click(); await page.locator('.hero h1').waitFor({ timeout: 8000 }); };
  // The first-day guide opens on a person's first sign-in on a device; most flows below close it first.
  const skipGuide = async (page) => { await page.getByRole('button', { name: 'Not now' }).click(); await page.locator('.modal').waitFor({ state: 'detached' }); };
  // Walk the whole guide with Next and note every page it opens.
  const walkGuide = async (page) => { const seen = new Set(); let framed = 0;
    for (let n = 0; n < 40; n++) { await sleep(420); seen.add(new URL(page.url()).pathname); framed += await page.locator('.tour-ring').count();
      if (await page.locator('.tour').getByRole('button', { name: 'Finish' }).count()) break; await page.locator('.tour').getByRole('button', { name: 'Next' }).click(); }
    await page.locator('.tour').getByRole('button', { name: 'Finish' }).click(); await page.locator('.tour').waitFor({ state: 'detached' }); return { seen, framed }; };
  const noSideScroll = async (page) => must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the page scrolls sideways at ' + page.url());
  const toast = (page, text) => page.locator('.toast', { hasText: text }).waitFor({ timeout: 6000 });

  // ---------- a BDE's day, on a laptop ----------
  console.log('BDE on a laptop screen (1366 × 768)');
  const bde = await open({ width: 1366, height: 768 });
  await step('the opening screen shows, then lifts away', async () => { await bde.goto(BASE); await bde.locator('#splash svg').waitFor({ timeout: 8000 });
    await bde.locator('#splash').waitFor({ state: 'detached', timeout: 6000 }); await bde.locator('input[type=email]').waitFor(); });
  await step('sign in; the dashboard greets the person', async () => { await signIn(bde, 'bde@e2e.test'); must((await bde.locator('.hero h1').textContent()).includes('Kiran'), 'no greeting by name'); });
  await step('the app launcher shows the BDE their apps, and only theirs (like Zoho One)', async () => { const t = bde.locator('.home-tiles');
    for (const g of ['Aali CRM', 'Aali Calling', 'Aali Projects', 'Aali Work']) await t.locator('.tile', { hasText: g }).waitFor();
    for (const g of ['Aali Deals Desk', 'Aali People', 'Aali Insights', 'Aali Connect']) must(await t.locator('.tile', { hasText: g }).count() === 0, 'a BDE sees ' + g); });
  await step('first sign-in offers the guide; it walks the BDE through the pages of a BDE, and only those', async () => { await bde.locator('.modal', { hasText: 'Welcome to Aali One' }).waitFor();
    must((await bde.locator('.guide p').first().textContent()).includes('Your work is sales'), 'the welcome is not written for a BDE'); await bde.getByRole('button', { name: 'Start the guide' }).click(); await bde.locator('.tour').waitFor();
    const { seen, framed } = await walkGuide(bde); for (const p of ['/', '/daily', '/calls', '/leads', '/assets', '/settings/me']) must(seen.has(p), 'the guide did not open ' + p);
    for (const p of ['/payments', '/quotes', '/settings/people', '/settings/audit']) must(!seen.has(p), 'the guide took a BDE to ' + p); must(framed > 3, 'the guide did not frame the part it explains'); });
  await step('the guide does not come back by itself, and the Guide button on the dashboard opens it at any section', async () => { await bde.reload(); await bde.locator('.hero').waitFor(); await sleep(700);
    must(await bde.locator('.modal').count() === 0 && await bde.locator('.tour').count() === 0, 'the guide came back'); await bde.locator('.hero').getByRole('button', { name: 'Guide' }).click(); await bde.locator('.tour').waitFor();
    await bde.getByLabel('Jump to a section of the guide').selectOption({ label: (await bde.locator('.tour select option', { hasText: 'Call register' }).textContent()) }); await bde.locator('.page h1', { hasText: 'call register' }).waitFor();
    must((await bde.locator('.tour p').textContent()).includes('one business must have only one caller'), 'wrong words for the call register'); await bde.locator('.tour').getByRole('button', { name: 'End guide' }).click(); await bde.locator('.tour').waitFor({ state: 'detached' });
    await bde.goto(BASE); await bde.locator('.hero').waitFor(); });
  await step('Start my day', async () => { await bde.locator('.hero').getByRole('link', { name: 'Start my day' }).click(); await bde.getByRole('button', { name: 'Start my day' }).click();
    await toast(bde, 'Your day has started'); await bde.locator('.composer').waitFor(); });
  await step('pick a kind of work, write the task, start it', async () => { await bde.locator('.composer .chip', { hasText: 'Follow-up messages' }).click();
    await bde.getByPlaceholder(/Editing 6 photos/).fill('Sent the brochure to 5 schools'); await bde.getByRole('button', { name: 'Start this task now' }).click();
    await bde.locator('.nowcard', { hasText: 'Sent the brochure to 5 schools' }).waitFor(); });
  await step('the running task shows a clock; Finish closes it', async () => { must(/\d\d:\d\d:\d\d/.test(await bde.locator('.nowcard .clock').textContent()), 'no clock');
    await bde.locator('.nowcard').getByRole('button', { name: /Finish/ }).click(); await toast(bde, 'Task finished'); await bde.locator('.nowcard').waitFor({ state: 'detached' });
    await bde.locator('.list .li', { hasText: 'Sent the brochure to 5 schools' }).scrollIntoViewIfNeeded(); });
  await step('upload a calling list: every row is shown first, a wrong row is left out, the person confirms', async () => { await bde.locator('.steps button', { hasText: 'My calls' }).click(); await bde.getByRole('button', { name: 'Upload numbers to call (Excel)' }).click();
    await bde.locator('.modal textarea').fill('Test Medicals, 9876501234, Guntur, Pharmacy\nLotus Clinic, 9876501235, Brodipet\n· Closes 9 pm, 9876501299, https://maps.example/x'); await bde.locator('.modal .chip', { hasText: 'Google Maps' }).click();
    must(await bde.locator('.modal .readback tbody tr').count() === 3, 'the rows are not shown before keeping'); must(!(await bde.locator('.modal .readback tbody tr').nth(2).locator('input[type=checkbox]').isChecked()), 'a row that looks wrong is ticked');
    await bde.getByRole('button', { name: 'Keep the 2 ticked' }).click(); await bde.locator('.modal-f', { hasText: 'Keep 2 businesses for you?' }).waitFor();
    await bde.getByRole('button', { name: 'Yes, keep them' }).click(); await bde.locator('.modal', { hasText: 'You can call these 2' }).waitFor();
    must(!(await bde.locator('.modal').textContent()).includes('9876501299'), 'the wrong row was kept');
    await bde.locator('.modal-h').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('a list kept by mistake is deleted from "Your lists"; only that list goes', async () => { await bde.getByRole('button', { name: 'Upload numbers to call (Excel)' }).click();
    await bde.locator('.modal textarea').fill('Wrong Shop A, 9876501401, Tenali\nWrong Shop B, 9876501402, Tenali'); await bde.locator('.modal .chip', { hasText: 'Instagram' }).click();
    await bde.getByRole('button', { name: 'Keep the 2 ticked' }).click(); await bde.getByRole('button', { name: 'Yes, keep them' }).click(); await bde.locator('.modal', { hasText: 'You can call these 2' }).waitFor();
    const lists = bde.locator('.modal .li', { hasText: 'not called yet' }); await lists.first().waitFor(); must(await lists.count() === 2, 'both lists should be listed');
    await lists.filter({ hasText: 'Instagram' }).getByRole('button', { name: 'Delete this list' }).click(); await bde.getByRole('button', { name: 'Yes, delete' }).click(); await toast(bde, 'List deleted: 2 businesses removed');
    await bde.locator('.modal .li', { hasText: 'Instagram' }).waitFor({ state: 'detached' }); must(await bde.locator('.modal .li', { hasText: 'Google Maps' }).count() === 1, 'the right list stays');
    await bde.locator('.modal-f').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('the Excel template downloads, and Aali One reads it back (its example rows are not uploaded)', async () => { await bde.locator('.steps button', { hasText: 'My calls' }).click(); await bde.getByRole('button', { name: 'Upload numbers to call (Excel)' }).click();
    for (const h of ['Business name', 'Contact number', 'Place', 'Industry', 'Source']) await bde.locator('.modal .fmt th', { hasText: h }).waitFor();
    const [file] = await Promise.all([bde.waitForEvent('download'), bde.getByRole('button', { name: 'Download the Excel template' }).click()]); must(/\.xlsx$/.test(file.suggestedFilename()), 'the template is not an Excel file');
    await file.saveAs('.review/calling-list-template.xlsx'); await bde.locator('.modal input[type=file]').setInputFiles('.review/calling-list-template.xlsx');
    await bde.locator('.modal-f', { hasText: 'No business with a number found yet' }).waitFor(); must((await bde.locator('.modal textarea').inputValue()).includes('(Example) Sri Sai Medicals'), 'the template was not read back');
    must(await bde.locator('.modal .chip', { hasText: 'What to fill' }).count() === 0, 'the help sheet is offered as a list');
    await bde.locator('.modal-h').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('choose Calling: the list opens; pick a business, tap Interested, save the call', async () => { await bde.locator('.steps button').first().click(); await bde.locator('.composer .chip', { hasText: /^Calling$/ }).click();
    await bde.locator('.modal', { hasText: 'Who are you calling?' }).waitFor(); await bde.locator('.modal .li', { hasText: 'Test Medicals' }).click();
    await bde.locator('.modal').getByRole('button', { name: 'Interested', exact: true }).click(); await bde.getByPlaceholder(/What do they want/).fill('Wants a quotation for a pharmacy website');
    await bde.getByRole('button', { name: 'Save this call' }).click(); await toast(bde, 'Written on your call sheet');
    // the second business asks to be called back: the day is asked, today is chosen so that it shows on the dashboard
    await bde.locator('.modal .li', { hasText: 'Lotus Clinic' }).click(); await bde.locator('.modal').getByRole('button', { name: 'Call back', exact: true }).click();
    await bde.getByLabel('Call back on this date').fill(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)); await bde.getByPlaceholder(/What did they say/).fill('Owner is busy, call in the evening');
    await bde.getByRole('button', { name: 'Save this call' }).click(); await toast(bde, 'call back on');
    // a number not in the list, with the place typed last: the place must reach the call sheet and the call register
    await bde.getByRole('button', { name: '+ Not in my list' }).click(); await bde.getByPlaceholder('Business / person name').fill('Padma Fancy Store'); await bde.getByPlaceholder('Contact no. (10 digits)').fill('9876501240');
    await bde.locator('.modal .banner.ok').waitFor(); await bde.getByPlaceholder('Place', { exact: true }).fill('Tenali'); await sleep(900);
    await bde.getByRole('button', { name: 'Use this number' }).click(); await bde.locator('.modal').getByRole('button', { name: 'No answer', exact: true }).click(); await toast(bde, 'Padma Fancy Store: No answer');
    await bde.locator('.modal-f').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' });
    await bde.locator('table tr', { hasText: 'Test Medicals' }).locator('.pill', { hasText: 'Interested' }).waitFor();
    must((await bde.locator('table tr', { hasText: 'Padma Fancy Store' }).textContent()).includes('Tenali'), 'the place typed last was not kept on the call sheet'); });
  await step('a call sheet kept in Excel goes straight onto today\'s call sheet; the numbers-to-call upload says where it belongs', async () => {
    const { xlsxBlob } = await import('../src/xlsx.js'), sheet = async (file, rows) => fs.writeFileSync(file, Buffer.from(await xlsxBlob([{ name: 'Calls', widths: [24, 14, 16, 16], rows: [['Organisation', 'Contact no.', 'Location', 'Response'], ...rows] }]).arrayBuffer()));
    await sheet('.review/call-sheet-1.xlsx', [['Lakshmi Opticals', '9876501401', 'Tenali', 'Interested'], ['Vijaya Bakery', '9876501402', 'Tenali', 'Call back'], ['Ravi Mobiles', '9876501403', 'Tenali', 'No answer']]);
    await bde.getByRole('button', { name: 'Upload numbers to call (Excel)' }).click(); await bde.locator('.modal input[type=file]').setInputFiles('.review/call-sheet-1.xlsx');
    await bde.locator('.modal .banner', { hasText: 'This looks like calls you already made' }).waitFor(); await bde.getByRole('button', { name: "Add them to today's call sheet instead" }).click();
    await bde.locator('.readback tbody tr', { hasText: 'Lakshmi Opticals' }).waitFor(); await bde.getByRole('button', { name: 'Add 3 calls' }).click(); await bde.getByRole('button', { name: 'Yes, add them' }).click();
    await toast(bde, '3 calls added'); await bde.locator('table tr', { hasText: 'Vijaya Bakery' }).waitFor();
    await sheet('.review/call-sheet-2.xlsx', [['Sai Ram Jewellers', '9876501404', 'Bapatla', 'Interested']]);
    await bde.locator('label', { hasText: 'Upload calls I already made' }).locator('input').setInputFiles('.review/call-sheet-2.xlsx');
    await bde.getByRole('button', { name: 'Add 1 call' }).click(); await bde.getByRole('button', { name: 'Yes, add them' }).click(); await toast(bde, '1 call added');
    await bde.locator('table tr', { hasText: 'Sai Ram Jewellers' }).waitFor(); });
  await step('pasted calls are shown first, added after a confirmation, and a whole paste can be removed', async () => { await bde.getByRole('button', { name: 'Or paste them' }).click();
    await bde.getByPlaceholder('Paste rows here').fill('Sri Ram Traders\t9876501301\tNarasaraopet\tNo answer\nKrishna Stores\t9876501302\tChilakaluripet\tBusy');
    must(await bde.locator('.readback tbody tr').count() === 2, 'the pasted rows are not shown first'); await bde.getByRole('button', { name: 'Add 2 calls' }).click();
    await bde.getByRole('button', { name: 'Yes, add them' }).click(); await toast(bde, '2 calls added'); await bde.locator('table tr', { hasText: 'Sri Ram Traders' }).waitFor();
    await bde.locator('.row', { hasText: ': 2 calls' }).getByRole('button', { name: 'Remove this paste' }).click(); await bde.getByRole('button', { name: 'Yes, remove' }).click(); await toast(bde, 'pasted calls were removed');
    await bde.locator('table tr', { hasText: 'Sri Ram Traders' }).waitFor({ state: 'detached' }); must(await bde.locator('table tr', { hasText: 'Test Medicals' }).count() === 1, 'other calls were removed too'); });
  await step('finish the calling time, write the plan, submit the day', async () => { await bde.locator('.steps button').first().click(); await bde.locator('.nowcard').getByRole('button', { name: /Finish/ }).click(); await bde.locator('.nowcard').waitFor({ state: 'detached' });
    await bde.getByRole('button', { name: /Finish my day/ }).last().click(); await bde.getByPlaceholder('What you will do next').fill('Call the remaining clinics'); await bde.getByPlaceholder('What you will do next').blur();
    await bde.getByRole('button', { name: 'Submit for the day' }).click(); await bde.locator('.banner.ok', { hasText: 'Submitted' }).waitFor(); });
  await step('the call back shows on the dashboard for today', async () => { await bde.locator('.nav a', { hasText: 'All apps' }).click(); const row = bde.locator('.list .li', { hasText: 'Call back: Lotus Clinic' }); await row.scrollIntoViewIfNeeded();
    await row.getByRole('link', { name: 'Call now' }).waitFor(); must(/to call back today/.test(await bde.locator('.stat', { hasText: 'Still to call' }).textContent()), 'the tile does not count the call back'); });
  await step('search: Ctrl + K finds the business by part of its number and opens the register on it', async () => { await bde.keyboard.press('Control+k'); await bde.getByRole('combobox', { name: 'Search' }).fill('98765012');
    await bde.locator('.search-row', { hasText: 'Lotus Clinic' }).waitFor(); await bde.locator('.search-row', { hasText: 'Test Medicals' }).click(); await bde.locator('.search').waitFor({ state: 'detached' });
    await bde.locator('tbody tr', { hasText: 'Test Medicals' }).waitFor(); must(new URL(bde.url()).pathname === '/calls', 'did not open the call register'); must(await bde.locator('tbody tr').count() === 1, 'the register is not filtered to that business');
    await bde.keyboard.press('Control+k'); await bde.getByRole('combobox', { name: 'Search' }).fill('tasks'); await bde.keyboard.press('Enter'); await bde.locator('.page h1', { hasText: 'Tasks' }).waitFor(); });
  await step('the call register lists the business with its call', async () => { await go(bde, 'Aali Calling', 'Call register'); await bde.locator('table tr', { hasText: 'Test Medicals' }).click();
    await bde.locator('.modal', { hasText: 'Calls made (1)' }).waitFor(); await bde.keyboard.press('Escape'); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('calendar: a tap on a day opens everything on it, and a task can be added for that day', async () => { await bde.goto(BASE + '/calendar'); await bde.locator('.calday.now').click();
    const day = bde.locator('.modal'); await day.waitFor(); must((await day.locator('.modal-h h2').textContent()).includes(new Date().toLocaleDateString('en-IN', { weekday: 'long' })), 'the pop-up is not for that day');
    await day.getByLabel('New task for this day').fill('Take the brochure to Sunrise Tiles'); await day.getByRole('button', { name: 'Add task' }).click(); await toast(bde, 'Task added for');
    await day.locator('.li', { hasText: 'Take the brochure to Sunrise Tiles' }).waitFor(); await day.locator('.modal-f').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('a BDE cannot open Payments', async () => { await bde.goto(BASE + '/payments'); await bde.getByText('This section is not part of your access').waitFor(); });
  await step('the sidebar collapses to a strip and opens again', async () => { await bde.locator('.brand .collapse').click(); must(await bde.locator('.shell.mini').count() === 1, 'did not collapse');
    await bde.locator('.brand .logo').click(); must(await bde.locator('.shell.mini').count() === 0, 'did not open again'); });
  await step('profile: a display name outside the real name is refused', async () => { await bde.goto(BASE + '/settings/me'); const box = bde.getByLabel(/Display name/); await box.fill('Demigod');
    must(await bde.getByRole('button', { name: 'Save' }).isDisabled(), 'Save should be off'); await box.fill('Kiran'); await bde.getByRole('button', { name: 'Save' }).click(); await toast(bde, 'Saved'); });

  // ---------- the same person on a phone ----------
  console.log('BDE on a phone screen (390 × 844)');
  const phone = await open({ width: 390, height: 844 }, true);
  await step('sign in on the phone; nothing scrolls sideways', async () => { await signIn(phone, 'bde@e2e.test'); await skipGuide(phone); await noSideScroll(phone); });
  await step('search opens from the phone\'s top bar', async () => { await phone.locator('.mobilebar').getByRole('button', { name: 'Search' }).click(); await phone.getByRole('combobox', { name: 'Search' }).fill('lotus'); await phone.locator('.search-row', { hasText: 'Lotus Clinic' }).waitFor(); await noSideScroll(phone); await phone.keyboard.press('Escape'); });
  await step('the menu opens, holds the page behind it still, and leads to a section', async () => { await phone.getByRole('button', { name: 'Open menu' }).click();
    must(await phone.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'), 'the page behind the open menu can still scroll');
    await phone.locator('.side.open .nav a', { hasText: 'Aali Work' }).click(); await phone.locator('.steps').waitFor(); await noSideScroll(phone); // Aali Work opens on Daily reports
    must(await phone.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden'), 'the page stays locked after the menu closed'); });
  await step('the menu closes with its Close button, and choosing the page already open closes it too', async () => { await phone.getByRole('button', { name: 'Open menu' }).click();
    await phone.locator('.side.open').getByRole('button', { name: 'Close the menu' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' });
    await phone.getByRole('button', { name: 'Open menu' }).click(); await phone.locator('.side.open .nav a', { hasText: 'Daily reports' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' });
    await phone.getByRole('button', { name: 'Open menu' }).click(); await phone.locator('.side.open .nav a', { hasText: 'All apps' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' }); await phone.locator('.hero').waitFor(); });
  await step('the day’s timeline reads well on a phone: each task uses the full width', async () => { await phone.goto(BASE + '/daily'); const b = phone.locator('.li.tl .tl-b').first(); await b.waitFor();
    must(await b.evaluate((e) => e.getBoundingClientRect().width) > 280, 'the task text is squeezed into a narrow column'); await noSideScroll(phone); });
  await step('call register and profile fit the phone', async () => { for (const p of ['/calls', '/settings/me', '/leads', '/tasks']) { await phone.goto(BASE + p); await phone.locator('.page h1').first().waitFor(); await noSideScroll(phone); } });

  // ---------- the Sales Manager ----------
  console.log('Sales Manager on a wide screen (1920 × 1080)');
  const mgr = await open({ width: 1920, height: 1080 });
  await step('sign in; the team report is there and can be reviewed', async () => { await signIn(mgr, 'sm@e2e.test'); await skipGuide(mgr); await go(mgr, 'Aali Work', 'Daily reports');
    const row = mgr.locator('.list button.li', { hasText: 'Kiran' }); await row.locator('.pill', { hasText: 'Submitted' }).waitFor(); await row.click();
    await mgr.getByRole('button', { name: 'Mark reviewed' }).click(); await toast(mgr, 'Marked as reviewed'); await row.locator('.pill', { hasText: 'Reviewed' }).waitFor(); });
  await step('the manager sees the call in the register and can add a Do Not Call number', async () => { await go(mgr, 'Aali Calling', 'Call register'); await mgr.locator('table tr', { hasText: 'Test Medicals' }).waitFor();
    await mgr.getByRole('button', { name: '+ Do Not Call number' }).click(); await mgr.getByLabel(/Number/).fill('9876509999'); await mgr.getByLabel(/Why must it not be called/).fill('Asked us to stop calling');
    await mgr.getByRole('button', { name: 'Add to Do Not Call' }).click(); await toast(mgr, 'Added'); });
  await step('the BDE is now refused that number', async () => { const c = (await api('POST', '/auth/login', { email: 'bde@e2e.test', password: PW })).cookie;
    const r = await api('POST', '/prospects/check', { items: [{ org: 'Padma Traders', phone: '9876509999' }], claim: true }, c); must(r.body.results[0].ok === false && r.body.results[0].kind === 'dnc', 'the Do Not Call number was not refused'); });
  await step('a lead import is shown first, confirmed, and can be undone', async () => { await mgr.goto(BASE + '/leads'); await mgr.getByRole('button', { name: 'Import from Excel' }).click();
    await mgr.locator('.modal textarea').fill('name,mobile,service,source\nAnil Kumar,9876502001,Website – 5 pages,Referral\nNo Number Person,,Website – 5 pages,Referral');
    must(await mgr.locator('.modal .readback tbody tr').count() === 2, 'the rows are not shown first'); await mgr.locator('.modal .readback', { hasText: 'this row will fail' }).waitFor();
    await mgr.locator('.modal-f').getByRole('button', { name: 'Import' }).click(); await mgr.getByRole('button', { name: 'Yes, import' }).click(); await mgr.locator('.modal .banner.ok', { hasText: '1 new lead' }).waitFor();
    await mgr.getByRole('button', { name: 'Undo this import' }).click(); await mgr.getByRole('button', { name: 'Yes, undo' }).click(); await toast(mgr, 'Import undone: 1 lead');
    await mgr.locator('.modal-f').getByRole('button', { name: 'Close' }).click(); await mgr.locator('.modal').waitFor({ state: 'detached' }); must(await mgr.locator('.li, tr', { hasText: 'Anil Kumar' }).count() === 0, 'the undone lead still shows'); });
  await step('a client is chosen by typing part of its name, however many there are', async () => {
    for (let i = 0; i < 70; i++) must((await api('POST', '/records', { type: 'client', data: { name: i === 41 ? 'Kaveri Traders' : `Client number ${i + 1}`, phone: String(9000100000 + i), city: i === 41 ? 'Tenali' : 'Guntur' } }, admin)).status === 200, 'could not add a client');
    await mgr.goto(BASE + '/payments'); await mgr.getByRole('button', { name: '+ Payment to collect' }).click(); const box = mgr.locator('.modal').getByLabel('Client'); await box.click();
    await mgr.locator('.pick-pop', { hasText: 'type a few letters' }).waitFor(); await box.fill('kav'); must(await mgr.locator('.pick-pop button').count() === 1, 'typing did not narrow the list');
    await mgr.locator('.pick-pop button', { hasText: 'Kaveri Traders' }).click(); must(await box.inputValue() === 'Kaveri Traders', 'the client was not chosen');
    await box.click(); await mgr.keyboard.press('Escape'); must(await mgr.locator('.pick-pop').count() === 0 && await mgr.locator('.modal').count() === 1, 'Escape should close the list, not the window');
    await box.blur(); await mgr.keyboard.press('Escape'); await mgr.locator('.modal').waitFor({ state: 'detached' }); });
  await step('a pop-up notification arrives when a task is given, and opens it', async () => { await mgr.goto(BASE + '/calls'); await mgr.locator('.page h1').waitFor();
    must((await api('POST', '/records', { type: 'task', data: { title: 'Review the price list', owner: smUser.body.user.id, due: new Date().toISOString().slice(0, 10) } }, admin)).status === 200, 'could not add the task');
    const card = mgr.locator('.popup', { hasText: 'New task: Review the price list' }); await card.waitFor({ timeout: 20000 }); await card.locator('.popup-b').click();
    await mgr.locator('.page h1', { hasText: 'Tasks' }).waitFor(); must(await mgr.locator('.popup', { hasText: 'Review the price list' }).count() === 0, 'the card stayed'); });
  await step('wide screen: nothing scrolls sideways', async () => { for (const p of ['/', '/daily', '/calls', '/payments', '/settings/people']) { await mgr.goto(BASE + p); await mgr.locator('.page').waitFor(); await noSideScroll(mgr); } });

  console.log('Management on a laptop screen (1366 × 768)');
  const top = await open({ width: 1366, height: 768 });
  await step('management gets the guide for the whole group, with money, people and the audit log', async () => { await signIn(top, 'admin@e2e.test'); must((await top.locator('.guide p').first().textContent()).includes('every activity across Aali Group'), 'the welcome is not written for management');
    await top.getByRole('button', { name: 'Start the guide' }).click(); const { seen } = await walkGuide(top);
    for (const p of ['/daily', '/payments', '/quotes', '/projects', '/collab', '/settings/people', '/settings/access', '/settings/staff', '/settings/audit']) must(seen.has(p), 'the guide did not open ' + p); });

  await step("daily reports for management: Sales and IT only (no All); Sales opens first with each person's whole report, the Sales Manager first; a name in the table jumps to it", async () => { await top.goto(BASE + '/daily');
    await top.locator('.repcard').first().waitFor(); must(await top.locator('.seg button', { hasText: /^All$/ }).count() === 0, 'the All filter is still there');
    must(await top.locator('.seg button[aria-pressed=true]', { hasText: /^Sales$/ }).count() === 1, 'Sales is not chosen at first'); const kiran = top.locator('.repcard', { hasText: 'Kiran' }); await kiran.waitFor();
    const names = await top.locator('.repcard .rep-name').allTextContents(); must(names[0].includes('Meera') && names.length >= 3, 'not the Sales Manager first, then the team: ' + names.join(', '));
    must(await kiran.locator('.pill', { hasText: 'Reviewed' }).count() > 0 && await kiran.locator('.li.tl').count() > 0, "Kiran's report is not shown in full");
    await top.locator('.linkbtn', { hasText: 'Vani' }).click(); await sleep(900);
    const [y, h, sy] = await top.locator('.repcard', { hasText: 'Vani' }).evaluate((e) => [e.getBoundingClientRect().top, innerHeight, scrollY]);
    must(sy > 0 && y >= 0 && y < h - 60, "the name did not bring Vani's report into view: " + [y, h, sy]);
    await top.locator('.seg button', { hasText: /^IT$/ }).click(); await top.getByText('No people in this view').waitFor(); must(await top.locator('.repcard').count() === 0, 'IT shows the Sales team'); });
  await step('signing out and in again opens the dashboard, not the page left', async () => { await top.goto(BASE + '/daily'); await top.locator('.page h1').first().waitFor();
    await top.getByRole('button', { name: 'Sign out' }).click(); await top.locator('input[type=email]').waitFor(); must(new URL(top.url()).pathname === '/', 'still on ' + new URL(top.url()).pathname);
    await top.locator('input[type=email]').fill('admin@e2e.test'); await top.locator('input[type=password]').fill(PW); await top.getByRole('button', { name: 'Sign in' }).click(); await top.locator('.hero h1').waitFor(); });
  await step('the team report message is detailed: every task, the calls that matter; Short gives the totals', async () => { await top.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await top.goto(BASE + '/daily'); await top.getByRole('button', { name: 'Copy the message' }).first().click(); await toast(top, 'Report copied');
    const full = await top.evaluate(() => navigator.clipboard.readText()); must(full.includes('(detailed)') && full.includes('_Tasks_') && full.includes('Sent the brochure to 5 schools'), 'the detailed message lacks the tasks');
    must(full.includes('_Calls that matter_') && full.includes('Test Medicals'), 'the detailed message lacks the interested calls');
    await top.locator('.seg button', { hasText: 'Short' }).click(); await top.getByRole('button', { name: 'Copy the message' }).first().click(); await sleep(400);
    const short = await top.evaluate(() => navigator.clipboard.readText()); must(!short.includes('_Tasks_') && short.length < full.length, 'Short is not shorter'); });
  await step('the audit log is short: a day is one line, everyday work is one line for each person', async () => { await top.goto(BASE + '/settings/audit'); await top.locator('.log-day').first().waitFor();
    must(await top.locator('.log-day').count() === 1 && await top.locator('.page tbody tr').count() === 0, 'the log is not folded into days'); const who = top.locator('.log-who', { hasText: 'Kiran' }).first();
    const sum = await who.locator('summary').textContent(); must(/(added|changed) \d+ \w/.test(sum), 'no one-line summary of the BDE\'s work: ' + sum); must(await who.locator('.log-line').first().isHidden(), 'the details should be closed until asked for');
    await who.locator('summary').click(); await who.locator('.log-line', { hasText: /Added an? |Changed an? / }).first().waitFor(); must(await top.locator('.log-day .log-line:visible').count() < 40, 'the day is still a long list');
    await top.getByPlaceholder('Search the log').fill('wrong password'); await top.getByText('Nothing matches.').waitFor(); });

  console.log('A BDE on a client visit, on a phone (390 × 844)');
  const vis = await open({ width: 390, height: 844 }, true);
  const vc = (await api('POST', '/auth/login', { email: 'bde2@e2e.test', password: PW })).cookie, ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const visit = { client: 'Sunrise Dental', person: 'Dr. Rao', phone: '9876503001', place: 'Guntur' };
  let vrep;
  const putVisit = (extra) => api('PATCH', '/records/' + vrep, { data: { entries: [{ id: 'v1', at: ago(15), text: 'Visit to Sunrise Dental', kind: 'Client visit', state: 'running', start: ago(15), visit: { ...visit, ...extra } }] } }, vc);
  await step('15 minutes after leaving for a visit, the app asks: have you reached the client?', async () => { await signIn(vis, 'bde2@e2e.test'); await skipGuide(vis);
    vrep = (await api('POST', '/records', { type: 'report', data: { date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) } }, vc)).body.record.id; must((await putVisit({})).status === 200, 'could not start the visit');
    await vis.reload(); await vis.locator('.modal', { hasText: 'Have you reached Sunrise Dental?' }).waitFor({ timeout: 10000 });
    await vis.getByRole('button', { name: 'Yes, I have reached' }).click(); await toast(vis, 'Noted: you reached Sunrise Dental'); await vis.locator('.modal').waitFor({ state: 'detached' }); });
  await step('after some time at the client it asks: are you leaving? "Not yet" asks again later', async () => { must((await putVisit({ reachedAt: ago(25) })).status === 200, 'could not mark reached');
    await vis.reload(); await vis.locator('.modal', { hasText: 'Are you leaving Sunrise Dental now?' }).waitFor({ timeout: 10000 }); await vis.getByRole('button', { name: 'Not yet' }).click();
    await vis.locator('.modal').waitFor({ state: 'detached' }); await vis.reload(); await vis.locator('.hero').waitFor(); await sleep(1500); must(await vis.locator('.modal').count() === 0, '"Not yet" did not wait'); });
  await step('leaving: outcome, remark and "where now" are asked; another client starts at once; the Sales Manager hears of an accepted deal', async () => { await vis.goto(BASE + '/daily'); await vis.locator('.nowcard', { hasText: 'At the client since' }).waitFor();
    await vis.getByRole('button', { name: 'I am leaving the client' }).click(); const o = vis.locator('.modal', { hasText: 'How did the visit to Sunrise Dental go?' }); await o.waitFor();
    must(await o.getByRole('button', { name: 'Save and end the visit' }).isDisabled(), 'it can be saved without an outcome'); await o.locator('.chip', { hasText: 'Deal accepted' }).click();
    await o.locator('textarea').fill('Agreed to the 5-page website, advance on Monday'); must(await o.getByRole('button', { name: 'Save and end the visit' }).isDisabled(), 'it can be saved without saying where the person goes');
    await o.locator('.chip', { hasText: 'Another client' }).click(); await o.getByLabel('Client or business name').fill('Lotus Clinic'); await o.getByLabel('Place or address').fill('Brodipet');
    await o.getByRole('button', { name: 'Save and end the visit' }).click(); await toast(vis, 'Visit to Lotus Clinic started');
    await vis.locator('.nowcard', { hasText: 'Lotus Clinic' }).waitFor(); await vis.locator('.pill', { hasText: 'Deal accepted' }).first().waitFor(); await noSideScroll(vis);
    const sc = (await api('POST', '/auth/login', { email: 'sm@e2e.test', password: PW })).cookie, b = (await api('GET', '/bootstrap', null, sc)).body;
    must(b.records.some((r) => r.type === 'notice' && /Sunrise Dental accepted the deal/.test(r.text)), 'the Sales Manager was not told'); });
  await step('second visit: reached, "could not meet", back to the office; the app asks "Are you back at the office?"', async () => {
    await vis.locator('.nowcard').getByRole('button', { name: 'I have reached' }).click(); await vis.getByRole('button', { name: 'Yes, I have reached' }).click(); await toast(vis, 'Noted: you reached Lotus Clinic');
    await vis.locator('.nowcard').getByRole('button', { name: 'I am leaving the client' }).click(); const o = vis.locator('.modal', { hasText: 'How did the visit to Lotus Clinic go?' }); await o.waitFor();
    await o.locator('.chip', { hasText: 'Could not meet' }).click(); await o.locator('textarea').fill('Doctor was in surgery; come back next week'); await o.locator('.chip', { hasText: 'Back to the office' }).click();
    await o.getByRole('button', { name: 'Save and end the visit' }).click(); await toast(vis, 'Have a safe trip back'); await vis.locator('.nowcard', { hasText: 'On the way back to the office' }).waitFor();
    const sc = (await api('POST', '/auth/login', { email: 'sm@e2e.test', password: PW })).cookie;
    must((await api('GET', '/bootstrap', null, sc)).body.records.some((r) => r.type === 'presence' && r.why === 'Returning to the office'), 'the manager does not see the trip back');
    await vis.locator('.nowcard').getByRole('button', { name: 'I am back at the office' }).click(); await vis.getByRole('button', { name: 'Yes, I am back' }).click(); await toast(vis, 'Welcome back');
    await vis.locator('.nowcard').waitFor({ state: 'detached' }); });
  await step('a client asks to meet out of the blue: "Client visit now" on the dashboard starts a visit with just the name and place', async () => { await vis.goto(BASE); await vis.locator('.hero').waitFor();
    await vis.getByRole('button', { name: 'Client visit now' }).click(); const m = vis.locator('.modal', { hasText: 'Client visit now' }); await m.waitFor();
    must(await m.getByRole('button', { name: 'Start the visit' }).isDisabled(), 'a visit can start without a name and place'); await m.getByLabel('Client or business name').fill('Hotel Palm Grove'); await m.getByLabel('Place or address').fill('Tenali');
    await m.getByRole('button', { name: 'Start the visit' }).click(); await toast(vis, 'Visit to Hotel Palm Grove started');
    await vis.getByRole('button', { name: 'Client visit now' }).click(); await vis.locator('.modal', { hasText: 'You are on a visit to Hotel Palm Grove' }).waitFor(); await vis.keyboard.press('Escape'); await vis.locator('.modal').waitFor({ state: 'detached' }); });

  // ---------- agreements: made by the Operations Manager and the Sales Manager, a closure by the Operations Manager only ----------
  console.log('Agreements (Operations Manager on a laptop, Company Secretary, Sales Manager, BDE, phone)');
  must((await person('Nikhil', 'Tummala', 'ops@e2e.test', 'ops', 'Operations Manager')).status === 200, 'could not add the Operations Manager');
  must((await person('Harika', 'Amirineni', 'cs@e2e.test', 'cs', 'Company Secretary')).status === 200, 'could not add the Company Secretary');
  const agDeal = (await api('POST', '/records', { type: 'deal', data: { title: 'Lotus School website', contactName: 'Mr. Prasad', phone: '9876512345', value: 53100 } }, admin)).body.record;
  const ops = await open({ width: 1366, height: 768 }); let saUrl = '';
  await step('the Operations Manager starts a service agreement from the deal; it is filled in, saved with its number and shown as an A4 agreement', async () => {
    await signIn(ops, 'ops@e2e.test'); await skipGuide(ops); await ops.goto(BASE + '/deals/' + agDeal.id); await ops.getByRole('link', { name: '+ Agreement' }).click();
    await ops.locator('.ag-form').waitFor(); must(await ops.getByLabel('Service (short name) *').inputValue() === 'Lotus School website', 'the deal did not fill the agreement');
    await ops.getByLabel('Client name *').fill('Lotus School'); await ops.getByRole('button', { name: 'Save & get number' }).click(); await toast(ops, 'Saved as SA/');
    await ops.locator('.paper.agree', { hasText: 'Agreement No. SA/' }).waitFor(); must((await ops.locator('.paper.agree').textContent()).includes('Lotus School'), 'the agreement does not name the client'); saUrl = ops.url(); });
  await step('marked as signed, it cannot be changed any more', async () => { await ops.getByRole('button', { name: 'Mark as signed…' }).click();
    await ops.locator('.modal').getByLabel('Signed for the client by').fill('Mr. Prasad'); await ops.locator('.modal-f').getByRole('button', { name: 'Mark as signed' }).click(); await toast(ops, 'Marked as signed');
    await ops.locator('.banner', { hasText: 'A signed agreement cannot be changed' }).waitFor(); must(await ops.getByRole('button', { name: 'Save changes' }).count() === 0, 'a signed agreement can still be saved'); });
  await step('the closure agreement is made from the finished project, with the service agreement already named', async () => {
    const p = (await api('POST', '/records', { type: 'project', data: { name: 'Lotus School website', dealId: agDeal.id, stage: 'live', scope: 'Five-page school website' } }, admin)).body.record;
    await ops.goto(BASE + '/projects/' + p.id); await ops.getByRole('link', { name: '+ Closure agreement' }).click(); await ops.locator('.ag-form').waitFor();
    must((await ops.locator('.paper.agree').textContent()).includes('Service Agreement No. SA/'), 'the closure does not name the service agreement');
    await ops.getByRole('button', { name: 'Save & get number' }).click(); await toast(ops, 'Saved as PCA/'); });
  await step('the Sales Manager reads the closure agreement but cannot change it', async () => { await mgr.goto(BASE + '/agreements'); await mgr.locator('tr', { hasText: 'PCA/' }).click();
    await mgr.locator('.paper.agree').waitFor(); must(await mgr.locator('.topbar .pill', { hasText: 'View only' }).count() === 1 && await mgr.getByRole('button', { name: 'Save changes' }).count() === 0, 'the Sales Manager can change a closure agreement'); });
  await step('the Company Secretary reads every agreement and cannot make one', async () => { const cs = await open({ width: 1366, height: 768 }); await signIn(cs, 'cs@e2e.test'); await skipGuide(cs);
    await cs.goto(BASE + '/agreements'); await cs.locator('tr', { hasText: 'SA/' }).waitFor(); await cs.locator('tr', { hasText: 'PCA/' }).waitFor();
    must(await cs.getByRole('link', { name: '+ Service agreement' }).count() === 0, 'the Company Secretary can make one'); await cs.context().close(); });
  await step('a BDE has no Agreements in the menu and cannot open the page', async () => { await bde.goto(BASE); await bde.locator('.hero').waitFor(); must(await bde.locator('.nav a', { hasText: 'Agreements' }).count() === 0, 'a BDE sees Agreements');
    await bde.goto(BASE + '/agreements'); await bde.getByText('This section is not part of your access').waitFor(); });
  await step('on a phone the agreement switches between the details and the A4 page, and nothing scrolls sideways', async () => { const ph = await open({ width: 390, height: 844 }, true); await signIn(ph, 'ops@e2e.test'); await skipGuide(ph);
    await ph.goto(saUrl); await ph.locator('.ag-form').waitFor(); await noSideScroll(ph); await ph.locator('.seg-phone button', { hasText: 'The agreement' }).click(); await ph.locator('.paper.agree').waitFor();
    must(await ph.locator('.ag-form').isHidden(), 'the details stay on the phone screen'); await noSideScroll(ph); await ph.context().close(); });

  // ---------- payroll: HR (a switch on the Company Secretary) makes it; the Operations Manager reviews; nobody else sees it ----------
  console.log('Payroll (Aali HRM not linked here, so HR types the paid days)');
  must((await person('Azagar Ali', 'Shaik', 'chair@e2e.test', 'chairman', 'Founder & Chairman')).status === 200, 'could not add the Chairman');
  await step('an admin cannot switch "HR & payroll" on; the Founder & Chairman gives it to the Company Secretary', async () => { await top.goto(BASE + '/settings/people');
    await top.locator('tr', { hasText: 'Harika' }).getByRole('button', { name: 'Actions' }).click(); await top.locator('.modal', { hasText: 'Only the Founder & Chairman can switch it on' }).waitFor();
    await top.keyboard.press('Escape'); await top.locator('.modal').waitFor({ state: 'detached' });
    const chair = await open({ width: 1366, height: 768 }); await signIn(chair, 'chair@e2e.test'); await skipGuide(chair); await chair.goto(BASE + '/settings/people');
    await chair.locator('tr', { hasText: 'Harika' }).getByRole('button', { name: 'Give HR & payroll' }).waitFor();
    must(await chair.getByRole('button', { name: 'Give HR & payroll' }).count() === 1, 'the button shows on rows other than the Company Secretary');
    await chair.locator('tr', { hasText: 'Harika' }).getByRole('button', { name: 'Give HR & payroll' }).click(); await chair.locator('.modal-f').getByRole('button', { name: 'Give HR & payroll' }).click();
    await toast(chair, 'can now make payroll'); await chair.locator('tr', { hasText: 'Harika' }).locator('.pill', { hasText: 'HR & payroll' }).waitFor();
    must(await chair.locator('.nav a', { hasText: 'Payroll' }).count() > 0, 'the Chairman does not see Payroll in Aali People (the Chairman may step in on it)'); await chair.context().close(); });
  const hrPage = await open({ width: 1366, height: 768 }), lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  await step('HR enters a salary, makes last month\'s payroll, types the paid days and locks it', async () => { await signIn(hrPage, 'cs@e2e.test'); await skipGuide(hrPage);
    await hrPage.goto(BASE + '/payroll/salaries'); await hrPage.locator('tr', { hasText: 'Vani Reddy' }).click(); await hrPage.locator('.modal').getByLabel(/Monthly gross salary/).fill('18000');
    await hrPage.locator('.modal').getByRole('button', { name: 'Make salary sheet' }).click(); await toast(hrPage, 'Salary sheet made');
    await hrPage.goto(BASE + '/payroll'); await hrPage.getByRole('button', { name: `Make payroll for ${lastMonth}` }).click(); await toast(hrPage, 'is made');
    await hrPage.locator('.banner', { hasText: 'Aali HRM is not linked yet' }).waitFor(); must(await hrPage.getByRole('button', { name: 'Lock payroll' }).isDisabled(), 'it can be locked without paid days');
    await hrPage.locator('tr', { hasText: 'Vani Reddy' }).click(); await hrPage.locator('.modal').getByLabel(/^Paid days/).fill('29'); await hrPage.locator('.modal').getByRole('button', { name: 'Save changes' }).click(); await toast(hrPage, 'worked out again');
    await hrPage.getByRole('button', { name: 'Lock payroll' }).click(); await hrPage.locator('.modal-f').getByRole('button', { name: 'Lock' }).click(); await toast(hrPage, 'Locked');
    await hrPage.getByRole('link', { name: 'Payslips' }).click(); await hrPage.locator('.paper.slip', { hasText: 'Vani Reddy' }).waitFor(); });
  await step('client payroll: HR adds a payroll client with its own rules and an employee; the month waits for the attendance Excel', async () => {
    await hrPage.goto(BASE + '/client-payroll'); await hrPage.getByRole('button', { name: '+ New payroll client' }).click(); await hrPage.getByRole('button', { name: /Fixed monthly salary/ }).click(); const f = hrPage.locator('.modal');
    await f.getByLabel('Name on the payslips *').fill('Test Mills Pvt Ltd'); await f.getByLabel("One day's pay = monthly gross ÷").selectOption('26');
    await f.getByRole('button', { name: 'Add the client' }).click(); await toast(hrPage, 'Test Mills Pvt Ltd added');
    await hrPage.getByRole('button', { name: '+ Add employee' }).click(); const m = hrPage.locator('.modal');
    await m.getByLabel('Employee code *').fill('TM-1'); await m.getByLabel('Full name *').fill('Ravi Kumar'); await m.getByLabel(/Monthly gross salary/).fill('13000');
    await m.getByRole('button', { name: 'Add employee' }).click(); await toast(hrPage, 'Ravi Kumar added');
    await hrPage.getByRole('tab', { name: 'Months' }).click(); await hrPage.getByRole('button', { name: `Make payroll for ${lastMonth}` }).click(); await toast(hrPage, 'is made');
    await hrPage.locator('.banner', { hasText: 'Upload the attendance Excel' }).waitFor(); await hrPage.locator('tr', { hasText: 'Ravi Kumar' }).waitFor();
    must(await hrPage.locator('tr', { hasText: 'Vani Reddy' }).count() === 0, 'Aali staff are on a client month'); });
  await step('the Operations Manager reads it as view only and writes a remark; a BDE has no Payroll', async () => { await ops.goto(BASE + '/payroll'); await ops.locator('tr', { hasText: 'Vani Reddy' }).waitFor();
    must(await ops.locator('.topbar .pill', { hasText: 'View only' }).count() === 1 && await ops.getByRole('button', { name: 'Reopen…' }).count() === 0, 'the Operations Manager can change payroll');
    await ops.getByLabel('Remark').fill('Checked, fine.'); await ops.getByRole('button', { name: 'Add remark' }).click(); await toast(ops, 'Remark added');
    await bde.goto(BASE); await bde.locator('.hero').waitFor(); must(await bde.locator('.nav a', { hasText: 'Aali People' }).count() === 0 && await bde.locator('.nav a', { hasText: 'Payroll' }).count() === 0, 'a BDE sees Payroll or Client payroll'); await hrPage.context().close(); });
  await step('the Operations Manager sees client payroll as view only', async () => { await ops.goto(BASE + '/client-payroll'); await ops.locator('tr', { hasText: 'Test Mills' }).click();
    await ops.getByRole('tab', { name: 'Months' }).waitFor(); await ops.locator('tr', { hasText: 'Ravi Kumar' }).waitFor();
    must(await ops.getByRole('button', { name: '+ New payroll client' }).count() === 0 && await ops.getByRole('button', { name: 'Attendance Excel' }).count() === 0, 'the Operations Manager can change client payroll'); });

  // ---------- calendars: Sales team, IT team, Deadlines ----------
  console.log('Calendars');
  const dayAt = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
  must((await api('POST', '/records', { type: 'project', data: { name: 'Sunrise Dental app', stage: 'development', deadline: dayAt(2) } }, admin)).status === 200, 'could not add the project');
  must((await api('POST', '/records', { type: 'payment', data: { title: 'Second instalment', amount: 9000, due: dayAt(-1) } }, admin)).status === 200, 'could not add the payment');
  await step('management has three calendars; Deadlines lists the missed payment and the project due in 2 days', async () => { await top.goto(BASE + '/calendar/deadlines'); await top.getByRole('tab', { name: 'Deadlines' }).waitFor();
    for (const t of ['Sales team', 'IT team', 'Deadlines']) must(await top.getByRole('tab', { name: t }).count() === 1, 'no tab ' + t);
    await top.locator('.card', { hasText: 'Missed' }).locator('.li', { hasText: 'Payment due – Second instalment' }).waitFor();
    await top.locator('.card', { hasText: 'Next 14 days' }).locator('.li', { hasText: 'Project delivery – Sunrise Dental app' }).waitFor();
    must(+(await top.locator('.nav a', { hasText: 'Calendar' }).locator('.cnt').textContent()) >= 2, 'the sidebar does not count the urgent deadlines');
    await top.getByRole('tab', { name: 'IT team' }).click(); await top.locator('.pill', { hasText: 'Delivery: Sunrise Dental app' }).first().waitFor(); });
  await step('a BDE has the Sales team calendar and Deadlines, not the IT one', async () => { await bde.goto(BASE + '/calendar'); await bde.getByRole('tab', { name: 'Sales team' }).waitFor();
    must(await bde.getByRole('tab', { name: 'IT team' }).count() === 0 && await bde.getByRole('tab', { name: 'Deadlines' }).count() === 1, 'wrong calendars for a BDE'); });

  console.log('Bills (the BDE on a laptop, the Operations Manager)');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await step('a BDE adds the UPI QR code once and submits a bill with its photo; the QR code is then locked; management has no "+ Submit a bill"', async () => {
    await bde.goto(BASE + '/bills'); await bde.getByText('My UPI QR code – needed before your first bill').waitFor();
    await bde.locator('.qrcard input[type=file]').setInputFiles({ name: 'my-qr.png', mimeType: 'image/png', buffer: PNG }); await toast(bde, 'UPI QR code saved'); await bde.locator('.qrcard img.qr-thumb').waitFor();
    await bde.getByRole('button', { name: '+ Submit a bill' }).click(); const m = bde.locator('.modal');
    await m.locator('input[type=number]').fill('450'); await m.locator('select').selectOption('Fuel'); await m.getByPlaceholder('e.g. Indian Oil, Brodipet').fill('Indian Oil, Brodipet');
    await m.locator('textarea').fill('Petrol for the client visit'); await m.locator('.seg button', { hasText: 'Cash' }).click();
    must(await m.getByRole('button', { name: 'Submit the bill' }).isDisabled(), 'a bill without its photo can be sent');
    await m.locator('input[type=file]').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG }); await m.locator('.billpic img').waitFor();
    await m.getByRole('button', { name: 'Submit the bill' }).click(); await toast(bde, 'Bill submitted');
    await bde.locator('tr', { hasText: 'Indian Oil' }).locator('.pill', { hasText: 'Waiting for approval' }).waitFor(); await bde.getByText(/waiting to be paid, so the QR code/).waitFor();
    await ops.goto(BASE + '/bills'); await ops.locator('.page h1').waitFor(); must(await ops.getByRole('button', { name: '+ Submit a bill' }).count() === 0, 'management can submit a bill'); });
  await step('management sees the photo and the QR code to pay, approves the bill and marks it paid; the BDE sees it paid and can change the QR code again', async () => {
    must(+(await ops.locator('.nav a', { hasText: 'Bills' }).locator('.cnt').textContent()) >= 1, 'the sidebar does not count the bill');
    await ops.locator('tr', { hasText: 'Indian Oil' }).click(); const m = ops.locator('.modal'); await m.locator('.billqr img').waitFor(); await m.locator('.billpic img').waitFor();
    await m.getByRole('button', { name: 'Approve' }).click(); await toast(ops, 'Approved'); await m.getByRole('button', { name: 'Mark paid' }).click(); await toast(ops, 'Marked paid');
    await bde.goto(BASE + '/bills'); await bde.locator('tr', { hasText: 'Indian Oil' }).locator('.pill', { hasText: 'Paid' }).waitFor();
    must(await bde.locator('.qrcard label', { hasText: 'Change QR code' }).count() === 1, 'the QR code is still locked after the bill was paid'); });

  await step('no errors were written to the browser console', async () => must(!errors.length, errors.slice(0, 3).join(' | ')));
  console.log(failed ? `\n${failed} step(s) failed.` : '\nAll steps passed.');
  await stop(failed ? 1 : 0);
} catch (e) { console.error('The run could not finish:', e.message); await stop(1); }
