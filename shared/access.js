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
  approvals: { chairman: 'all', ops: 'all', cs: 'all', salesmgr: 'team', itmgr: 'team' },
  leads:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  calls:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  deals:     { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  clients:   { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all', bde: 'own' },
  quotes:    { chairman: 'all:view', ops: 'all', cs: 'all', salesmgr: 'all' },
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
  ['today', 'Dashboard', '/', ''], ['daily', 'Daily reports', '/daily', ''], ['tasks', 'Tasks', '/tasks', ''], ['inbox', 'Notifications', '/inbox', ''], ['approvals', 'Approvals', '/approvals', ''],
  ['leads', 'Leads & enquiries', '/leads', 'Sales'], ['calls', 'Call register', '/calls', 'Sales'], ['deals', 'Deals pipeline', '/deals', 'Sales'], ['clients', 'Clients', '/clients', 'Sales'], ['quotes', 'Quotations', '/quotes', 'Sales'],
  ['projects', 'Projects', '/projects', 'Delivery'], ['support', 'Support', '/support', 'Delivery'], ['assets', 'Client assets', '/assets', 'Delivery'],
  ['money', 'Payments & receipts', '/payments', 'Money'],
  ['collab', 'Collaborations', '/collab', 'Management'], ['messages', 'WhatsApp messages', '/messages', 'Management'], ['people', 'People & teams', '/settings/people', 'Management'],
  ['calendar', 'Calendar', '/calendar', 'Overview'], ['reports', 'Reports', '/reports', 'Overview'], ['settings', 'Settings', '/settings', 'Account'],
];
// What 'own' and 'team' mean in each section, in plain words (shown on the access chart).
export const MEANS = {
  today: { own: 'Own work', team: 'Own work + the team’s late items', all: 'Everyone’s work' },
  daily: { own: 'Writes own report', team: 'Own report + reads the team’s', 'all:view': 'Reads all, can remark', all: 'Reads all, sends back, deletes' },
  tasks: { team: 'Own tasks + the team list', all: 'Every task' },
  inbox: { own: 'Own notifications', all: 'Own notifications' },
  approvals: { team: 'Decides for own team', all: 'Decides all' },
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
export const levelOf = (u, section) => (!u || !ACCESS[section] ? '' : isAdminUser(u) ? 'all' : ACCESS[section][u.title] || '');
export const scopeOf = (u, section) => levelOf(u, section).split(':')[0];
export const canSee = (u, section) => !!levelOf(u, section);
export const canEdit = (u, section) => { const l = levelOf(u, section); return !!l && !l.endsWith(':view'); };

// Which section a kind of record belongs to.
export const SECTION_OF = { lead: 'leads', deal: 'deals', client: 'clients', quote: 'quotes', invoice: 'money', receipt: 'money', payment: 'money',
  project: 'projects', ticket: 'support', collab: 'collab', prospect: 'calls', asset: 'assets' };
