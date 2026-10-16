// Default settings. Admins can change most of these in Settings; these are the starting values.
import { PROVIDER, SERVICE_CLAUSES, CLOSURE_CLAUSES, EXCLUDED } from './agreement-text.js';
export const TITLES = {
  admin: 'Administrator', chairman: 'Founder & Chairman', ops: 'Operations Manager', cs: 'Company Secretary',
  salesmgr: 'Sales Manager', bde: 'BDE', itmgr: 'IT Manager', itlead: 'IT Team Lead', dev: 'Developer / Designer',
};
export const TITLE_TEAM = { admin: 'management', chairman: 'management', ops: 'management', cs: 'management',
  salesmgr: 'sales', bde: 'sales', itmgr: 'it', itlead: 'it', dev: 'it' };
export const TEAMS = { sales: 'Sales', it: 'IT', management: 'Management' };
// Bills: what the money was spent on, and how the employee paid it (the form the user chose, 9 Oct 2026).
export const BILL_KINDS = ['Travel', 'Fuel', 'Food', 'Client meeting', 'Office supplies', 'Phone & internet', 'Courier', 'Other'];
export const BILL_PAID_BY = ['Cash', 'UPI', 'Card', 'Own bank transfer'];
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
  // Client agreements: the company that signs them and their standard wording (shared/agreement-text.js, from the company's own template).
  // Each agreement can still change any of it before it is signed.
  agreements: {
    ...PROVIDER, serviceClauses: SERVICE_CLAUSES, closureClauses: CLOSURE_CLAUSES, excluded: EXCLUDED,
    schedule: [['Advance to commence development', 50], ['Upon successful testing and prior to final go-live deployment', 50]],
    annex: [['Project Timeline', 'Delivery within 8–10 weeks from receipt of the advance payment and the required business/process data.'],
      ['Support', 'First 2 months of priority post-launch support complimentary.'],
      ['Domain & Hosting', 'Not included in this Agreement; to be procured by the Client or billed separately at actuals if managed by AALITECH.']],
    amc: 'Annual Maintenance Contract (AMC) — from Year 2 (bug fixes, minor workflow changes, priority support)',
    handover: ['Work delivered and live', 'Source files / code handed over', 'Admin logins and passwords handed over', 'Domain and hosting details shared', 'Training / walkthrough given', 'User guide or documents given'],
    supportDays: 60,
  },
  // Payroll rules (shared/payroll.js). HR changes them in Payroll → Rules; check rates with the company's CA when the law changes.
  // ptSlabs: Andhra Pradesh Professional Tax per month – [up to ₹, tax], the last row [0, tax] is "above that".
  payroll: { payDay: 7, basicPct: 50, hraPct: 40, pfEe: 12, pfEr: 12, pfCeiling: 15000, esiEe: 0.75, esiEr: 3.25, esiLimit: 21000,
    ptSlabs: [[15000, 0], [20000, 150], [0, 200]], freeLeaves: 2 },
  // Kinds of work a person can pick for each line of the daily report (time is added up per kind).
  workTypes: {
    sales: ['Calling', 'Information gathering', 'Client visit / meeting', 'Follow-up messages', 'Video making', 'Poster / design work', 'Client work (photo editing etc.)', 'Quotation / paperwork', 'Payment collection', 'Team management', 'Other'],
    it: ['Development', 'Design', 'Testing', 'Client changes', 'Support', 'Meeting', 'Team management', 'Other'],
  },
  leadSeesReports: false, // when on, the IT Team Lead can read the developers' daily reports
  waReports: { on: true, skip: [] }, // each submitted daily report to management on WhatsApp (server/whatsapp.js); skip: people who do not want them
  // One business, one caller (server/prospects.js). holdDays: a business stays with its BDE this long after the last call.
  // emptyHoldDays: a number that was reserved but never called is kept this long. maxTries: unanswered calls in a row before everyone must stop.
  calling: { holdDays: 15, emptyHoldDays: 2, maxTries: 3 },
  listSources: ['Google Maps', 'Instagram', 'Facebook', 'LinkedIn', 'Justdial', 'Referral', 'Walk-in', 'Other'], // where a BDE's calling list came from
  industries: ['School / college', 'Hospital / clinic', 'Pharmacy', 'Hotel / restaurant', 'Retail shop', 'Textiles / garments', 'Real estate / builder', 'Manufacturing', 'Hostel / PG',
    'Salon / beauty', 'Gym / fitness', 'Jewellery', 'Automobile', 'Travel / transport', 'Finance / insurance', 'Professional services', 'Government / NGO', 'Other'],
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
// How a client paid an advance (agreements: the advance before signing, server/logic.js docFlow).
export const PAY_MODES = ['UPI', 'Cash', 'Cheque', 'Bank transfer'];
