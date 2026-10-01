// Default settings. Admins can change most of these in Settings; these are the starting values.
export const TITLES = {
  admin: 'Administrator', chairman: 'Founder & Chairman', ops: 'Operations Manager', cs: 'Company Secretary',
  salesmgr: 'Sales Manager', bde: 'BDE', itmgr: 'IT Manager', itlead: 'IT Team Lead', dev: 'Developer / Designer',
};
export const TITLE_TEAM = { admin: 'management', chairman: 'management', ops: 'management', cs: 'management',
  salesmgr: 'sales', bde: 'sales', itmgr: 'it', itlead: 'it', dev: 'it' };
export const TEAMS = { sales: 'Sales', it: 'IT', management: 'Management' };
export const MANAGER_TITLES = ['salesmgr', 'itmgr', 'ops', 'cs', 'chairman', 'admin'];
export const TOP_TITLES = ['ops', 'cs', 'chairman'];
// Aali Group and its companies. Management belongs to the group and looks after every company.
export const GROUP = 'Aali Group';
export const COMPANIES = ['Aali Conssultancy', 'AaliTech', 'Aali Builders'];
// Roles a department manager may add and look after in their own team.
export const MANAGER_ADDS = { salesmgr: ['bde'], itmgr: ['itlead', 'dev'] };

export const DEFAULT_SETTINGS = {
  business: {
    name: 'AALI CONSSULTANCY', parentLine: 'A subsidiary of Aali Group', tagline: 'Where expertise meets opportunity',
    address: 'Syamala Nagar 4th line, Guntur, Andhra Pradesh', phone: '08341085415', email: 'info@aaliconssultancy.com',
    website: 'aaliconssultancy.com', gstin: '', pan: '', state: 'Andhra Pradesh',
    bank: 'Account name : AALI CONSSULTANCY\nBank : ICICI Bank\nAccount no. : \nIFSC : \nUPI : ',
    quoteTerms: '1. 50% advance to start work; balance on delivery.\n2. Hosting, domain and third-party fees are extra unless listed.\n3. GST as applicable.\n4. Timeline starts after advance and all content are received.\n5. Work outside this scope is quoted separately.',
    receiptTerms: '1. This receipt is valid subject to realisation of payment.\n2. All disputes are subject to Guntur jurisdiction.',
    quotePrefix: 'AC', receiptPrefix: 'ACY', invoicePrefix: 'AI', signName: '', signRole: '',
  },
  pipeline: [
    { key: 'lead', label: 'New lead', p: 10 }, { key: 'contacted', label: 'Contacted', p: 20 },
    { key: 'meeting', label: 'Meeting / demo', p: 35 }, { key: 'proposal', label: 'Quotation sent', p: 50 },
    { key: 'negotiation', label: 'Negotiation', p: 70 }, { key: 'won', label: 'Won', p: 100 }, { key: 'lost', label: 'Lost', p: 0 },
  ],
  projectStages: [
    { key: 'awaiting', label: 'Waiting for advance' }, { key: 'planning', label: 'Planning' }, { key: 'design', label: 'Design' },
    { key: 'development', label: 'Development' }, { key: 'testing', label: 'Testing / review' }, { key: 'live', label: 'Live' },
    { key: 'onhold', label: 'On hold' },
  ],
  sources: ['Website', 'Walk-in', 'Referral', 'Phone call', 'WhatsApp', 'Facebook / Instagram', 'Existing client', 'Other'],
  lostReasons: ['Price too high', 'Went to a competitor', 'Timing not right', 'No budget', 'No response', 'Requirement changed', 'Other'],
  services: [
    { id: 'svc-web5', name: 'Website – 5 pages', unit: 'Project', rate: 45000, note: 'Design, 5 pages, contact form, WhatsApp button, basic SEO.' },
    { id: 'svc-ecom', name: 'E-commerce website', unit: 'Project', rate: 150000, note: 'Catalogue, cart, payment gateway, admin panel.' },
    { id: 'svc-app', name: 'Mobile app (Android + iOS)', unit: 'Project', rate: 250000, note: 'Design, development, store publishing.' },
    { id: 'svc-erp', name: 'Software / ERP', unit: 'Project', rate: 180000, note: 'Custom modules as per scope.' },
    { id: 'svc-hrm', name: 'HRM / Payroll setup', unit: 'Project', rate: 60000, note: 'Setup, masters, first payroll run.' },
    { id: 'svc-seo', name: 'SEO & digital marketing', unit: 'Month', rate: 15000, note: 'Monthly SEO and social posting.' },
    { id: 'svc-amc', name: 'Website maintenance (AMC)', unit: 'Month', rate: 1500, note: 'Updates, backups, small changes.' },
    { id: 'svc-host', name: 'Domain + hosting (yearly)', unit: 'Year', rate: 4500, note: 'Domain renewal and shared hosting.' },
  ],
  discountApprovalPct: 10,
  // Kinds of work a person can pick for each line of the daily report (time is added up per kind).
  workTypes: {
    sales: ['Calling', 'Information gathering', 'Client visit / meeting', 'Follow-up messages', 'Video making', 'Poster / design work', 'Client work (photo editing etc.)', 'Quotation / paperwork', 'Payment collection', 'Team management', 'Other'],
    it: ['Development', 'Design', 'Testing', 'Client changes', 'Support', 'Meeting', 'Team management', 'Other'],
  },
  leadSeesReports: false, // when on, the IT Team Lead can read the developers' daily reports
  escalateDays: 3,
  templates: [
    { id: 'tp-first', name: 'First follow-up', text: 'Hi {client}, this is {me} from Aali Conssultancy. Thank you for your enquiry about {service}. When is a good time to talk?' },
    { id: 'tp-quote', name: 'Quotation sent', text: 'Hi {client}, please find our quotation {quote} for {service} (total {amount}). Happy to answer any questions. – {me}, Aali Conssultancy' },
    { id: 'tp-pay', name: 'Payment reminder', text: 'Hi {client}, a gentle reminder that {amount} for {item} is due on {due}. UPI / bank details are on the quotation. Thank you! – {me}, Aali Conssultancy' },
    { id: 'tp-repeat', name: 'Repeat enquiry question', text: 'Hi {client}, thanks for reaching out again about {service}. Is this about your earlier enquiry, or a new requirement? – {me}, Aali Conssultancy' },
    { id: 'tp-thanks', name: 'Thank you after go-live', text: 'Hi {client}, {project} is now live. Thank you for choosing Aali Conssultancy! Please reach out anytime for support. – {me}' },
  ],
  cadences: [
    { id: 'cd-new', name: 'New lead – 7 days', steps: [
      { day: 0, action: 'call', text: 'First call' }, { day: 1, action: 'whatsapp', text: 'Send first follow-up message' },
      { day: 3, action: 'call', text: 'Second call' }, { day: 7, action: 'call', text: 'Final call; mark Hot/Warm/Cold' } ] },
    { id: 'cd-quote', name: 'After quotation – 10 days', steps: [
      { day: 2, action: 'call', text: 'Call to discuss the quotation' }, { day: 5, action: 'whatsapp', text: 'Reminder message' },
      { day: 10, action: 'call', text: 'Closing call' } ] },
  ],
  macros: [
    { id: 'mc-quote', name: 'Quotation sent', stage: 'proposal', followDays: 2, note: 'Quotation sent to client', startCadence: 'cd-quote' },
    { id: 'mc-noans', name: 'No answer – try tomorrow', followDays: 1, note: 'Called, no answer' },
    { id: 'mc-meet', name: 'Meeting fixed', stage: 'meeting', followDays: 3, note: 'Meeting / demo fixed' },
  ],
  projectTemplates: [
    { id: 'pt-web', name: '5-page website', tasks: [
      { title: 'Collect content and logo from client', days: 2 }, { title: 'Design home page', days: 5, milestone: false },
      { title: 'Design approved by client', days: 7, milestone: true }, { title: 'Build all pages', days: 14 },
      { title: 'Contact form + WhatsApp button', days: 15 }, { title: 'Testing on mobile and desktop', days: 17 },
      { title: 'Website ready for client review', days: 18, milestone: true }, { title: 'Go live + domain connect', days: 20, milestone: true } ] },
    { id: 'pt-app', name: 'Mobile app', tasks: [
      { title: 'Requirement workshop', days: 3 }, { title: 'Screen designs approved', days: 10, milestone: true },
      { title: 'App development', days: 35 }, { title: 'Testing', days: 42 }, { title: 'Store publishing', days: 45, milestone: true } ] },
    { id: 'pt-amc', name: 'AMC setup', tasks: [ { title: 'Access and backups set up', days: 2 }, { title: 'Monthly maintenance checklist', days: 5, milestone: true } ] },
  ],
  integrations: {},
};
