// End-to-end check with a real browser (Playwright driving the Edge or Chrome already on this computer).
// It starts Aali One on an empty in-memory database, signs in as a BDE and as the Sales Manager, and walks the
// everyday flows on a laptop screen and a phone screen. Run it with: npm run test:e2e
// It never touches the live database: the server is started with no database address and stops if the database is not empty.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

  browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
  const errors = [];
  const open = async (size, mobile = false) => { const ctx = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile }), page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('page error: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
    return page; };
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
  await step('upload a calling list; the free numbers are kept', async () => { await bde.locator('.steps button', { hasText: 'My calls' }).click(); await bde.getByRole('button', { name: 'Upload my list (Excel)' }).click();
    await bde.locator('.modal textarea').fill('Test Medicals, 9876501234, Guntur, Pharmacy\nLotus Clinic, 9876501235, Brodipet'); await bde.locator('.modal .chip', { hasText: 'Google Maps' }).click();
    await bde.getByRole('button', { name: 'Check and keep the free ones' }).click(); await bde.locator('.modal', { hasText: 'You can call these 2' }).waitFor();
    await bde.locator('.modal-h').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' }); });
  await step('the Excel template downloads, and Aali One reads it back (its example rows are not uploaded)', async () => { await bde.locator('.steps button', { hasText: 'My calls' }).click(); await bde.getByRole('button', { name: 'Upload my list (Excel)' }).click();
    for (const h of ['Business name', 'Contact number', 'Place', 'Industry', 'Source']) await bde.locator('.modal .fmt th', { hasText: h }).waitFor();
    const [file] = await Promise.all([bde.waitForEvent('download'), bde.getByRole('button', { name: 'Download the Excel template' }).click()]); must(/\.xlsx$/.test(file.suggestedFilename()), 'the template is not an Excel file');
    await file.saveAs('.review/calling-list-template.xlsx'); await bde.locator('.modal input[type=file]').setInputFiles('.review/calling-list-template.xlsx');
    await bde.locator('.modal-f', { hasText: '0 businesses with a number found' }).waitFor(); must((await bde.locator('.modal textarea').inputValue()).includes('(Example) Sri Sai Medicals'), 'the template was not read back');
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
    await bde.locator('.modal-f').getByRole('button', { name: 'Close' }).click(); await bde.locator('.modal').waitFor({ state: 'detached' });
    await bde.locator('table tr', { hasText: 'Test Medicals' }).locator('.pill', { hasText: 'Interested' }).waitFor(); });
  await step('finish the calling time, write the plan, submit the day', async () => { await bde.locator('.steps button').first().click(); await bde.locator('.nowcard').getByRole('button', { name: /Finish/ }).click(); await bde.locator('.nowcard').waitFor({ state: 'detached' });
    await bde.getByRole('button', { name: /Finish my day/ }).last().click(); await bde.getByPlaceholder('What you will do next').fill('Call the remaining clinics'); await bde.getByPlaceholder('What you will do next').blur();
    await bde.getByRole('button', { name: 'Submit for the day' }).click(); await bde.locator('.banner.ok', { hasText: 'Submitted' }).waitFor(); });
  await step('the call back shows on the dashboard for today', async () => { await bde.locator('.nav a', { hasText: 'Dashboard' }).click(); const row = bde.locator('.list .li', { hasText: 'Call back: Lotus Clinic' }); await row.scrollIntoViewIfNeeded();
    await row.getByRole('link', { name: 'Call now' }).waitFor(); must(/to call back today/.test(await bde.locator('.stat', { hasText: 'Still to call' }).textContent()), 'the tile does not count the call back'); });
  await step('search: Ctrl + K finds the business by part of its number and opens the register on it', async () => { await bde.keyboard.press('Control+k'); await bde.getByRole('combobox', { name: 'Search' }).fill('98765012');
    await bde.locator('.search-row', { hasText: 'Lotus Clinic' }).waitFor(); await bde.locator('.search-row', { hasText: 'Test Medicals' }).click(); await bde.locator('.search').waitFor({ state: 'detached' });
    await bde.locator('tbody tr', { hasText: 'Test Medicals' }).waitFor(); must(new URL(bde.url()).pathname === '/calls', 'did not open the call register'); must(await bde.locator('tbody tr').count() === 1, 'the register is not filtered to that business');
    await bde.keyboard.press('Control+k'); await bde.getByRole('combobox', { name: 'Search' }).fill('tasks'); await bde.keyboard.press('Enter'); await bde.locator('.page h1', { hasText: 'Tasks' }).waitFor(); });
  await step('the call register lists the business with its call', async () => { await bde.locator('.nav a', { hasText: 'Call register' }).click(); await bde.locator('table tr', { hasText: 'Test Medicals' }).click();
    await bde.locator('.modal', { hasText: 'Calls made (1)' }).waitFor(); await bde.keyboard.press('Escape'); await bde.locator('.modal').waitFor({ state: 'detached' }); });
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
    await phone.locator('.side.open .nav a', { hasText: 'Daily reports' }).click(); await phone.locator('.steps').waitFor(); await noSideScroll(phone);
    must(await phone.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden'), 'the page stays locked after the menu closed'); });
  await step('the menu closes with its Close button, and choosing the page already open closes it too', async () => { await phone.getByRole('button', { name: 'Open menu' }).click();
    await phone.locator('.side.open').getByRole('button', { name: 'Close the menu' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' });
    await phone.getByRole('button', { name: 'Open menu' }).click(); await phone.locator('.side.open .nav a', { hasText: 'Daily reports' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' });
    await phone.getByRole('button', { name: 'Open menu' }).click(); await phone.locator('.side.open .nav a', { hasText: 'Dashboard' }).click(); await phone.locator('.side.open').waitFor({ state: 'detached' }); await phone.locator('.hero').waitFor(); });
  await step('call register and profile fit the phone', async () => { for (const p of ['/calls', '/settings/me', '/leads', '/tasks']) { await phone.goto(BASE + p); await phone.locator('.page h1').first().waitFor(); await noSideScroll(phone); } });

  // ---------- the Sales Manager ----------
  console.log('Sales Manager on a wide screen (1920 × 1080)');
  const mgr = await open({ width: 1920, height: 1080 });
  await step('sign in; the team report is there and can be reviewed', async () => { await signIn(mgr, 'sm@e2e.test'); await skipGuide(mgr); await mgr.locator('.nav a', { hasText: 'Daily reports' }).click();
    const row = mgr.locator('.list button.li', { hasText: 'Kiran' }); await row.locator('.pill', { hasText: 'Submitted' }).waitFor(); await row.click();
    await mgr.getByRole('button', { name: 'Mark reviewed' }).click(); await toast(mgr, 'Marked as reviewed'); await row.locator('.pill', { hasText: 'Reviewed' }).waitFor(); });
  await step('the manager sees the call in the register and can add a Do Not Call number', async () => { await mgr.locator('.nav a', { hasText: 'Call register' }).click(); await mgr.locator('table tr', { hasText: 'Test Medicals' }).waitFor();
    await mgr.getByRole('button', { name: '+ Do Not Call number' }).click(); await mgr.getByLabel(/Number/).fill('9876509999'); await mgr.getByLabel(/Why must it not be called/).fill('Asked us to stop calling');
    await mgr.getByRole('button', { name: 'Add to Do Not Call' }).click(); await toast(mgr, 'Added'); });
  await step('the BDE is now refused that number', async () => { const c = (await api('POST', '/auth/login', { email: 'bde@e2e.test', password: PW })).cookie;
    const r = await api('POST', '/prospects/check', { items: [{ org: 'Padma Traders', phone: '9876509999' }], claim: true }, c); must(r.body.results[0].ok === false && r.body.results[0].kind === 'dnc', 'the Do Not Call number was not refused'); });
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

  await step('the audit log is short: a day is one line, everyday work is one line for each person', async () => { await top.goto(BASE + '/settings/audit'); await top.locator('.log-day').first().waitFor();
    must(await top.locator('.log-day').count() === 1 && await top.locator('.page tbody tr').count() === 0, 'the log is not folded into days'); const who = top.locator('.log-who', { hasText: 'Kiran' }).first();
    const sum = await who.locator('summary').textContent(); must(/(added|changed) \d+ \w/.test(sum), 'no one-line summary of the BDE\'s work: ' + sum); must(await who.locator('.log-line').first().isHidden(), 'the details should be closed until asked for');
    await who.locator('summary').click(); await who.locator('.log-line', { hasText: /Added an? |Changed an? / }).first().waitFor(); must(await top.locator('.log-day .log-line:visible').count() < 40, 'the day is still a long list');
    await top.getByPlaceholder('Search the log').fill('wrong password'); await top.getByText('Nothing matches.').waitFor(); });

  await step('no errors were written to the browser console', async () => must(!errors.length, errors.slice(0, 3).join(' | ')));
  console.log(failed ? `\n${failed} step(s) failed.` : '\nAll steps passed.');
  await stop(failed ? 1 : 0);
} catch (e) { console.error('The run could not finish:', e.message); await stop(1); }
