// Role based level access. This one table decides what every role can see and do, section by section.
// The sidebar, every page and the server all read it, so a change here changes the whole system.
//
// Levels:  'all'  – sees and works on everything in the section
//          'team' – own department only
//          'own'  – only what belongs to the person (their own leads, their own projects …)
//          add ':view' – can look but cannot change anything
//          missing – the section does not exist for that role: not in the sidebar, no data sent, the server refuses.
export const ROLES = ['chairman', 'ops', 'cs', 'salesmgr', 'bde', 'itmgr', 'itlead', 'dev'];
export const ROLE_NAME = { chairman: 'Founder & Chairman', ops: 'Operations Manager', cs: 'Company Secretary', salesmgr: 'Sales Manager', bde: 'BDE',
  itmgr: 'IT Manager', itlead: 'IT Team Lead', dev: 'Developer / Designer', admin: 'Administrator' };

const everyone = (level) => Object.fromEntries(ROLES.map((r) => [r, level]));
export const ACCESS = {
  today:     { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'team', bde: 'own', itmgr: 'team', itlead: 'own', dev: 'own' },
  daily:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'team', bde: 'own', itmgr: 'team', itlead: 'own', dev: 'own' },
  tasks:     { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'team', bde: 'team', itmgr: 'team', itlead: 'team', dev: 'team' },
  inbox:     everyone('own'),
  // Bills an employee paid for the company, to be paid back (the user, 9 Oct 2026): everyone but management submits their own;
  // management sees them all, approves them and marks them paid. Department managers see only their own.
  bills:     { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'own', bde: 'own', itmgr: 'own', itlead: 'own', dev: 'own' },
  approvals: { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'team', itmgr: 'team' },
  leads:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  calls:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  deals:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  clients:   { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  // A BDE never makes or changes a quotation or an agreement: they see only the ones given to them, take them to the client and
  // collect the client's sign (server/logic.js docFlow, the user 16 Oct 2026).
  quotes:    { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own:view' },
  // Client service agreements and project closure agreements. Made by the Operations Manager and the Sales Manager (a closure
  // agreement by the Operations Manager only – canClose below); read by the Company Secretary and the Chairman. See STRICT.
  agreements: { chairman: 'all:view', ops: 'all', cs: 'all:view', salesmgr: 'all', bde: 'own:view' },
  // Payroll: the Operations Manager reads, reviews and remarks. HR changes everything – HR is not a level but a switch on a person
  // ("HR & payroll", today the Company Secretary), see levelOf. The Founder & Chairman sees it all and can step in and change anything
  // (asked 8 Oct 2026); HR and the Operations Manager are then told. Nobody else sees payroll.
  payroll:   { chairman: 'all', ops: 'all:view' },
  // Client payroll: the payroll Aali Conssultancy runs for its clients – the same people as Payroll (HR makes it, the Operations Manager reviews).
  clientpay: { chairman: 'all', ops: 'all:view' },
  projects:  { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all:view', bde: 'own:view', itmgr: 'all', itlead: 'all', dev: 'own' },
  support:   { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own', itmgr: 'all', itlead: 'all', dev: 'own' },
  assets:    { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own', itmgr: 'team', itlead: 'own', dev: 'own' },
  money:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all' },
  collab:    { chairman: 'all:view', ops: 'all', cs: 'all' },
  messages:  { chairman: 'all', ops: 'all', cs: 'all' },
  people:    { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'team', itmgr: 'team' },
  calendar:  { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'team', bde: 'own', itmgr: 'team', itlead: 'team', dev: 'own' },
  reports:   { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'team', itmgr: 'team' },
  settings:  { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'own', bde: 'own', itmgr: 'own', itlead: 'own', dev: 'own' },
};

// The sidebar, in order. [key, label, path, group]
export const SECTIONS = [
  ['today', 'Dashboard', '/', ''], ['daily', 'Daily reports', '/daily', ''], ['tasks', 'Tasks', '/tasks', ''], ['bills', 'Bills', '/bills', ''], ['inbox', 'Notifications', '/inbox', ''], ['approvals', 'Approvals', '/approvals', ''],
  ['leads', 'Leads & enquiries', '/leads', 'Sales'], ['calls', 'Call register', '/calls', 'Sales'], ['deals', 'Deals pipeline', '/deals', 'Sales'], ['clients', 'Clients', '/clients', 'Sales'], ['quotes', 'Quotations', '/quotes', 'Sales'], ['agreements', 'Agreements', '/agreements', 'Sales'],
  ['projects', 'Projects', '/projects', 'Delivery'], ['support', 'Support', '/support', 'Delivery'], ['assets', 'Client assets', '/assets', 'Delivery'],
  ['money', 'Payments & receipts', '/payments', 'Money'], ['payroll', 'Payroll', '/payroll', 'Money'], ['clientpay', 'Client payroll', '/client-payroll', 'Money'],
  ['collab', 'Collaborations', '/collab', 'Management'], ['messages', 'WhatsApp messages', '/messages', 'Management'], ['people', 'People & teams', '/settings/people', 'Management'],
  ['calendar', 'Calendar', '/calendar', 'Overview'], ['reports', 'Reports', '/reports', 'Overview'], ['settings', 'Settings', '/settings', 'Account'],
];
// What 'own' and 'team' mean in each section, in plain words (shown on the access chart).
export const MEANS = {
  today: { own: 'Own work', team: 'Own work + the team’s late items', all: 'Everyone’s work' },
  daily: { own: 'Writes own report', team: 'Own report + reads the team’s', 'all:view': 'Reads all, can remark', all: 'Reads all, sends back, deletes' },
  tasks: { team: 'Own tasks + the team list', all: 'Every task' },
  bills: { own: 'Submits own bills, sees what happens to them', all: 'Every bill; approves and marks paid' },
  inbox: { own: 'Own notifications', all: 'Own notifications' },
  approvals: { team: 'Decides for own team', all: 'Decides all' },
  agreements: { all: 'Makes service agreements; a closure agreement is made by the Operations Manager only', 'all:view': 'Reads every agreement', 'own:view': 'Only those given to them: takes them to the client, collects the advance and the client’s sign' },
  quotes: { 'own:view': 'Only those given to them: takes them to the client and collects the client’s sign' },
  payroll: { all: 'Salaries, payroll, loans, payslips – sees and changes everything', 'all:view': 'Reads payroll, reviews and remarks' },
  clientpay: { all: 'Clients\' payroll – their rules, employees, months, payslips – sees and changes everything', 'all:view': 'Reads clients\' payroll, reviews and remarks' },
  leads: { own: 'Own leads only' }, calls: { own: 'Own numbers; checks every number before calling', all: 'All numbers; Do Not Call list', 'all:view': 'All numbers, view only' }, deals: { own: 'Own deals only' }, clients: { own: 'Own clients only' },
  projects: { own: 'Projects they work on', 'own:view': 'Own clients’ projects, view only', 'all:view': 'All projects, view only' },
  support: { own: 'Own requests only' },
  assets: { own: 'Own uploads and what is given to them', team: 'Assets sent to IT; gives them to a person', all: 'All assets', 'all:view': 'All assets, view only' },
  people: { team: 'Adds own team members', 'all:view': 'Reads the list and the staff register', all: 'Adds, changes, removes anyone' },
  calendar: { own: 'Own dates', team: 'Own team’s dates', all: 'Every date' },
  reports: { team: 'Own team’s numbers', 'all:view': 'All numbers', all: 'All numbers' },
  settings: { own: 'Own profile and password', 'all:view': 'Own profile + reads the audit log', all: 'Every setting' },
  messages: { all: 'Sees and sends the lists' },
};
export const LEVEL_WORD = { all: 'Full', 'all:view': 'View only', team: 'Own team', own: 'Own only', 'own:view': 'Own, view only', '': 'No access' };
export const levelText = (section, level) => MEANS[section]?.[level] || LEVEL_WORD[level] || level;

// Operations Manager and Company Secretary always have the admin features.
export const ADMIN_TITLES = ['admin', 'ops', 'cs'];
export const isAdminUser = (u) => !!u && (!!(u.is_admin ?? u.isAdmin) || ADMIN_TITLES.includes(u.title));
// A STRICT section follows the table exactly, admins included: the Company Secretary is an admin but only reads agreements.
export const STRICT = ['agreements', 'payroll', 'clientpay'];
// "HR & payroll" (u.hr) is given by the Founder & Chairman, and only to the Company Secretary (who is also HR). They make the
// payroll; the Operations Manager only reads it; the Chairman may change it too (ACCESS). The switch on anyone else does nothing.
export const HR_TITLE = 'cs';
export const isHr = (u) => !!u && !!u.hr && u.title === HR_TITLE;
export const levelOf = (u, section) => (!u || !ACCESS[section] ? '' : (section === 'payroll' || section === 'clientpay') && isHr(u) ? 'all'
  : isAdminUser(u) && !STRICT.includes(section) ? 'all' : ACCESS[section][u.title] || '');
export const scopeOf = (u, section) => levelOf(u, section).split(':')[0];
export const canSee = (u, section) => !!levelOf(u, section);
export const canEdit = (u, section) => { const l = levelOf(u, section); return !!l && !l.endsWith(':view'); };
// The closure (completion and delivery) agreement at the end of a project is made and changed by the Operations Manager only.
export const canClose = (u) => !!u && u.title === 'ops';

// Which section a kind of record belongs to.
export const SECTION_OF = { lead: 'leads', deal: 'deals', client: 'clients', quote: 'quotes', invoice: 'money', receipt: 'money', payment: 'money',
  project: 'projects', ticket: 'support', collab: 'collab', prospect: 'calls', asset: 'assets', bill: 'bills', agreement: 'agreements',
  salary: 'payroll', payrun: 'payroll', loan: 'payroll', payee: 'payroll', pclient: 'payroll', pemp: 'payroll' };
// Kinds of item that only the people of their section may know exist: not in the recycle bin, the audit log, the list of deleted
// items, file downloads or comments for anyone else – management and admins included.
// pclient / pemp: payroll Aali Conssultancy runs for its clients – the client's details and rules, and the client's employees.
export const SECRET = { agreement: 'agreements', salary: 'payroll', payrun: 'payroll', loan: 'payroll', payee: 'payroll', pclient: 'payroll', pemp: 'payroll' };
export const hiddenFrom = (u, type) => !!SECRET[type] && !canSee(u, SECRET[type]);
