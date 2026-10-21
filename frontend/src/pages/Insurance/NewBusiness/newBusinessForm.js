import { getApplication } from '../../../services/api/insurance';
import { getRecord } from '../../../services/api/records';

export const STEPS = [
  { key: 'product', label: 'Product' },
  { key: 'main', label: 'Main member' },
  { key: 'family', label: 'Family' },
  { key: 'payment', label: 'Payment' },
  { key: 'quote', label: 'Quote' },
  { key: 'acceptance', label: 'Acceptance' },
  { key: 'review', label: 'Review & submit' },
];

export const CHANNELS = [
  { value: 'branch', label: 'Branch' },
  { value: 'telephone', label: 'Telephone' },
  { value: 'website', label: 'Website' },
];

// Same values as the premium transaction's payment_method picklist.
export const PAYMENT_METHODS = [
  { value: 'debit_order', label: 'Debit order' },
  { value: 'eft_manual', label: 'EFT / manual' },
  { value: 'pay_at', label: 'Pay@' },
  { value: 'easypay', label: 'EasyPay' },
  { value: 'online_gateway', label: 'Online gateway (card)' },
];

export const emptyPerson = () => ({ name: '', id_number: '', email: '', phone: '', age: '' });

export const EMPTY_FORM = {
  productVersionId: '',
  channel: 'branch',
  leadId: '',
  main: { ...emptyPerson(), cover_amount: '', client_id: '' },
  payerSame: true,
  payer: emptyPerson(),
  spouse: { enabled: false, ...emptyPerson() },
  children: [],
  extended: [],
  beneficiary: { enabled: false, ...emptyPerson() },
  payment: { payment_method: 'debit_order', provider_reference: '' },
};

const blankToUndefined = (v) => (v === '' || v === null ? undefined : v);

/**
 * Identity keys the server matches clients on (ID number, passport, email,
 * phone — in that order) plus the display name used when it creates one.
 */
export const personPayload = (p, extra = {}) => {
  const body = {
    name: blankToUndefined(p.name?.trim()),
    id_number: blankToUndefined(p.id_number?.trim()),
    email: blankToUndefined(p.email?.trim()),
    phone: blankToUndefined(p.phone?.trim()),
    ...extra,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
};

export const toNumber = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

/** Strip the "(relation)" suffix the server appends to insured-life names. */
const lifeName = (life) => String(life?.name || '').replace(/\s*\([a-z_]+\)\s*$/, '');

const clientPerson = (client, life) => ({
  name: client?.name || lifeName(life) || '',
  id_number: client?.id_number || '',
  email: client?.email || '',
  phone: client?.phone || '',
  age: life?.age ?? '',
});

/**
 * Rebuild wizard state from a saved application, so a refresh or a return
 * visit resumes where the user left off. Returns { form, step, status, policy }.
 */
export const loadSavedApplication = async (applicationId) => {
  const state = await getApplication(applicationId);
  const policy = state.policy || {};
  const lives = state.insured_lives || [];
  const parties = state.parties || [];

  const clientIds = new Set(
    [
      policy.main_member,
      policy.premium_payer,
      ...lives.map((l) => l.client),
      ...parties.filter((p) => p.role === 'beneficiary').map((p) => p.client),
    ].filter(Boolean),
  );
  const clients = Object.fromEntries(
    await Promise.all(
      [...clientIds].map(async (id) => [id, await getRecord('client', id).catch(() => null)]),
    ),
  );

  const mainLife = lives.find((l) => l.relation === 'main_member');
  const spouseLife = lives.find((l) => l.relation === 'spouse');
  const beneficiary = parties.find((p) => p.role === 'beneficiary');
  const payerSame = !policy.premium_payer || policy.premium_payer === policy.main_member;

  const form = {
    ...EMPTY_FORM,
    productVersionId: policy.product_version || '',
    channel: policy.application_channel || 'branch',
    leadId: policy.lead || '',
    main: {
      ...clientPerson(clients[policy.main_member], mainLife),
      cover_amount: mainLife?.cover_amount ?? '',
      client_id: '',
    },
    payerSame,
    payer: payerSame ? emptyPerson() : clientPerson(clients[policy.premium_payer]),
    spouse: spouseLife
      ? { enabled: true, ...clientPerson(clients[spouseLife.client], spouseLife) }
      : { enabled: false, ...emptyPerson() },
    children: lives
      .filter((l) => l.relation === 'child')
      .map((l) => clientPerson(clients[l.client], l)),
    extended: lives
      .filter((l) => l.relation === 'extended_family')
      .map((l) => ({ ...clientPerson(clients[l.client], l), cover_amount: l.cover_amount ?? '' })),
    beneficiary: beneficiary
      ? { enabled: true, ...clientPerson(clients[beneficiary.client]) }
      : { enabled: false, ...emptyPerson() },
    payment: {
      payment_method: policy.payment_method || 'debit_order',
      provider_reference: policy.payment_provider_reference || '',
    },
  };

  // Resume at the quote once the essentials are in, otherwise at the main member.
  const step = !mainLife ? 1 : state.acceptance ? 6 : 4;
  return { form, step, status: policy.status, policy, acceptance: state.acceptance };
};
