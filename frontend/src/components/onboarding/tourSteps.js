/**
 * Tour steps. Every step walks to a page and points at something on it, so
 * each click moves the app somewhere new and re-aims the spotlight.
 *
 * `selectors` are tried in order: the first that exists on the page wins.
 * The fallbacks (the page heading, then the content area) mean a step still
 * highlights something useful on a page whose own marker is missing — and a
 * step the signed-in user cannot reach is skipped rather than stuck on.
 */
export const TOUR_STEPS = [
  {
    path: '/',
    selectors: ['[data-tour="home"]', 'main h1', '[data-tour="page"]'],
    placement: 'right',
    title: 'Start on Home',
    body: 'Home is your landing page — your greeting, your dashboard and the latest activity in this workspace.',
  },
  {
    path: '/setup/objects',
    selectors: ['[data-tour="objects"]', 'main h1', '[data-tour="page"]'],
    placement: 'right',
    group: 'Setup',
    title: 'Shape your data model',
    body: 'Objects, fields, validations and formulas. Anything you add here appears in the navigation on the left.',
  },
  {
    path: '/setup/schema-builder',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'right',
    group: 'Setup',
    title: 'See the whole model',
    body: 'A map of every object and how they relate — useful before you change anything.',
  },
  {
    path: '/workspaces',
    selectors: ['[data-tour="workspaces"]', 'main h1', '[data-tour="page"]'],
    placement: 'right',
    title: 'Workspaces',
    body: 'Split the organisation by team. A workspace decides which objects and records its members see.',
  },
  {
    path: '/automation',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'bottom',
    title: 'Automate the busywork',
    body: 'Flows that fire when a record changes: update it, notify someone, send an email, call another flow.',
  },
  {
    path: '/approvals',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'bottom',
    title: 'Approvals',
    body: 'Records waiting on your decision, and the processes that decide who has to approve what.',
  },
  {
    path: '/setup/duplicate-rules',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'bottom',
    group: 'Setup',
    title: 'Stop duplicates before they happen',
    body: 'Rules that warn or block when a new record matches an existing one.',
  },
  {
    path: '/dashboards',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'bottom',
    title: 'Dashboards',
    body: 'Charts and counters over your own objects, with the widgets you care about.',
  },
  {
    path: '/tenders',
    selectors: ['main h1', '[data-tour="page"]'],
    placement: 'bottom',
    title: 'Tenders',
    body: 'Public tenders, tracked here and turned into leads when you want to pursue them.',
  },
  {
    path: '/profile',
    selectors: ['[data-tour="profile"]', 'main h1', '[data-tour="page"]'],
    placement: 'bottom',
    title: 'Your account, and this tour',
    body: 'Your profile and settings live here. You can start this tour again from the menu at any time.',
  },
];
