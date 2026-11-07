// Test fonctionnel du patch "actions multiples par timeslot" (scheduler-card fork)
// Charge le bundle construit dans un DOM jsdom, monte <scheduler-main-panel>,
// clique "Add action" et vérifie que l'action est AJOUTÉE (et non substituée).
import { JSDOM } from 'jsdom';
import fs from 'fs';

const BUNDLE = process.env.BUNDLE || '/home/batman/ha-forks/scheduler-card/dist/scheduler-card.js';
const code = fs.readFileSync(BUNDLE, 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView = () => {};

// charge le bundle DANS le contexte jsdom (lit y trouve window/document/HTMLElement)
window.eval(code);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const PanelCls = window.customElements.get('scheduler-main-panel');
check('custom element scheduler-main-panel enregistré', !!PanelCls);
const EditorCls = window.customElements.get('scheduler-timeslot-editor');
check('custom element scheduler-timeslot-editor enregistré', !!EditorCls);

const makeHass = () => ({
  locale: { language: 'fr' },
  language: 'fr',
  states: {
    'sun.sun': {
      entity_id: 'sun.sun',
      attributes: {
        next_rising: '2026-11-04T06:30:00+00:00',
        next_setting: '2026-11-04T16:45:00+00:00',
      },
    },
  },
  services: {
    script: {
      ventilo_arret: { name: 'Arrêt', fields: {} },
      ventilo_down: { name: 'Down', fields: {} },
      ventilo_vitesse_3: { name: 'Vitesse 3', fields: {} },
      a: { name: 'A', fields: {} },
      b: { name: 'B', fields: {} },
      c: { name: 'C', fields: {} },
    },
    light: {
      turn_on: { name: 'Turn on', fields: { brightness: { name: 'Brightness', selector: { number: {} } } } },
    },
    climate: { set_temperature: { name: 'Set temperature', fields: {} } },
    switch: { turn_on: { name: 'Turn on', fields: {} }, turn_off: { name: 'Turn off', fields: {} } },
  },
  entities: {},
  devices: {},
  areas: {},
  localize: (k) => k,
  callService: async () => {},
});

const mkSlot = (actions) => ({
  start: '00:05:00',
  actions,
  conditions: { type: 'and', items: [], track_changes: false },
});

const mkSchedule = (slot) => ({ entries: [{ weekdays: ['daily'], slots: [slot] }] });

// ---------- 1) ADD ACTION : doit empiler, pas remplacer ----------
{
  let el;
  try {
  el = window.document.createElement('scheduler-main-panel');
  el.hass = makeHass();
  el.config = { customize: {} };
  el.viewMode = 'single';
  el.selectedEntry = 0;
  el.selectedSlot = 0;
  el.schedule = mkSchedule(mkSlot([{ service: 'script.ventilo_arret', service_data: {} }]));
  window.document.body.appendChild(el);
  await el.updateComplete;
  } catch (e) { check('rendu du panneau sans exception', false, e.message); }
  if (!el || !el.shadowRoot) { console.log('\nAbandon : panneau non rendu'); process.exit(1); }

  const addBtn = el.shadowRoot.querySelector('.action-add ha-button');
  check('bouton "Add action" rendu avec 1 action déjà présente', !!addBtn);

  // intercepte le dialogue HA et confirme immédiatement une 2e action
  window.document.addEventListener(
    'show-dialog',
    (ev) => {
      ev.detail.dialogParams.confirm({ service: 'script.ventilo_down', service_data: {} });
    },
    { once: true }
  );

  addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
  await new Promise((r) => setTimeout(r, 50));
  await el.updateComplete;

  const actions = el.schedule.entries[0].slots[0].actions;
  check('après clic Add action : 2 actions dans le timeslot', actions.length === 2, `actions=${JSON.stringify(actions.map((a) => a.service))}`);
  check(
    "l'action d'origine est conservée en position 0",
    actions[0]?.service === 'script.ventilo_arret',
    `[0]=${actions[0]?.service}`
  );
  check('la nouvelle action est ajoutée en position 1', actions[1]?.service === 'script.ventilo_down', `[1]=${actions[1]?.service}`);

  // deux blocs d'action doivent être rendus
  const sections = el.shadowRoot.querySelectorAll('scheduler-collapsible-section');
  check('2 sections d\'action rendues dans l\'UI', sections.length === 2, `sections=${sections.length}`);

  // ---------- 2) DELETE de l'index 0 ne doit supprimer QUE celle-ci ----------
  el._actionItemOptionsClick({ detail: { item: { value: 'delete' } } }, 0);
  await el.updateComplete;
  const afterDelete = el.schedule.entries[0].slots[0].actions;
  check(
    'delete index 0 : il reste 1 action, et c\'est la 2e',
    afterDelete.length === 1 && afterDelete[0].service === 'script.ventilo_down',
    `actions=${JSON.stringify(afterDelete.map((a) => a.service))}`
  );

  // ---------- 3) _updateAction modifie la bonne action ----------
  el._updateAction(0, { ...afterDelete[0], service_data: { brightness: 42 } });
  await el.updateComplete;
  const edited = el.schedule.entries[0].slots[0].actions;
  check(
    '_updateAction écrit dans la bonne action, sans perte',
    edited.length === 1 && edited[0].service_data.brightness === 42,
    JSON.stringify(edited)
  );
}

// ---------- 4) timeslot-editor affiche "+N" ----------
{
  let ed;
  try {
  ed = window.document.createElement('scheduler-timeslot-editor');
  ed.hass = makeHass();
  ed.config = { customize: {} };
  ed.schedule = {
    weekdays: ['daily'],
    slots: [
      mkSlot([{ service: 'script.a', service_data: {} }, { service: 'script.b', service_data: {} }]),
      { start: '12:00:00', actions: [{ service: 'script.c', service_data: {} }], conditions: { type: 'and', items: [], track_changes: false } },
    ],
  };
  ed.selectedSlot = null;
  window.document.body.appendChild(ed);
  await ed.updateComplete;
  ed._width = 900;
  ed.requestUpdate();
  await ed.updateComplete;
  } catch (e) { check('rendu du timeslot-editor sans exception', false, e.message); }
  if (!ed || !ed.shadowRoot) { console.log('\nAbandon'); process.exit(1); }
  const txt = ed.shadowRoot.textContent.replace(/\s+/g, ' ');
  check('timeslot-editor affiche "+1" pour un créneau à 2 actions', /\+\s?1/.test(txt), `texte="${txt.trim().slice(0, 120)}"`);
}

// ---------- 5) jours par creneau : UI + masque ----------
{
  let el;
  try {
    el = window.document.createElement('scheduler-main-panel');
    el.hass = makeHass();
    el.config = { customize: {} };
    el.viewMode = 'scheme';
    el.selectedEntry = 0;
    el.selectedSlot = 1;
    el.schedule = {
      entries: [
        {
          weekdays: ['daily'],
          slots: [
            { start: '00:00:00', stop: '05:15:00', actions: [{ service: 'script.a', service_data: {} }], conditions: { type: 'and', items: [], track_changes: false } },
            { start: '05:15:00', stop: '06:45:00', weekdays: ['wednesday'], actions: [{ service: 'script.b', service_data: {} }], conditions: { type: 'and', items: [], track_changes: false } },
          ],
        },
      ],
    };
    window.document.body.appendChild(el);
    await el.updateComplete;
  } catch (e) {
    check('rendu du panneau (mode scheme) sans exception', false, e.message);
  }
  if (el && el.shadowRoot) {
    const rows = [...el.shadowRoot.querySelectorAll('scheduler-settings-row')];
    check('ligne "jours" rendue pour le creneau (mode scheme)', rows.length >= 1, `rows=${rows.length}`);

    // le dialogue renvoie mardi -> doit etre stocke dans le creneau
    window.document.addEventListener(
      'show-dialog',
      (ev) => {
        ev.detail.dialogParams.confirm(['tuesday']);
      },
      { once: true }
    );
    const btn = el.shadowRoot.querySelector('scheduler-settings-row ha-button');
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 50));
    await el.updateComplete;
    const wd = el.schedule.entries[0].slots[1].weekdays;
    check('le choix de jours est ecrit dans le creneau', JSON.stringify(wd) === '["tuesday"]', JSON.stringify(wd));
  }
}
{
  let ed;
  try {
    ed = window.document.createElement('scheduler-timeslot-editor');
    ed.hass = makeHass();
    ed.config = { customize: {} };
    ed.schedule = {
      weekdays: ['daily'],
      slots: [
        { start: '00:00:00', stop: '06:45:00', actions: [{ service: 'script.a', service_data: {} }], conditions: { type: 'and', items: [], track_changes: false } },
        { start: '06:45:00', stop: '07:30:00', weekdays: ['wednesday'], actions: [{ service: 'script.b', service_data: {} }], conditions: { type: 'and', items: [], track_changes: false } },
      ],
    };
    window.document.body.appendChild(ed);
    await ed.updateComplete;
    ed._width = 900;
    ed.requestUpdate();
    await ed.updateComplete;
    const txt = ed.shadowRoot.textContent.replace(/\s+/g, ' ');
    const slots = [...ed.shadowRoot.querySelectorAll('.slot')];
    const titles = slots.map((x) => x.getAttribute('title') || '');
    check(
      'masque de jours --m---- present dans la barre (texte ou infobulle)',
      /--m----/.test(txt) || titles.some((t) => t.includes('--m----')),
      `titles=${JSON.stringify(titles)}`
    );
  } catch (e) {
    check('rendu du timeslot-editor avec jours sans exception', false, e.message);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
process.exit(failed.length ? 1 : 0);
