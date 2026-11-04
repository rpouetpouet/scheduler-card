/**
 * Non-régression du correctif de renommage (v4.0.20-renamefix).
 *
 * Constat en production : taper dans le champ « Nom » d'un schedule levait
 *   TypeError: Cannot convert undefined or null to object
 *   at _updateSchedule (scheduler-card.js:2684)
 * parce que webawesome relaie les événements DOM natifs (`change`) qui remontent
 * jusqu'au dialogue, où `Object.keys(ev.detail)` recevait `undefined`. Le dialogue
 * gardait alors un état obsolète et l'enregistrement perdait le nom du schedule.
 *
 * Ce test vérifie :
 *   1. un `change` natif (detail absent) est ignoré, sans lever d'exception ;
 *   2. un `change` porteur d'un `detail.schedule` met bien à jour l'état ;
 *   3. un `detail.selectedSlot` est également pris en compte.
 *
 * Lancement : node test_update_schedule_guard.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

// On extrait la classe et on la teste sans DOM : le comportement visé est purement
// celui de `_updateSchedule`.
const SOURCE = 'src/dialogs/dialog-scheduler-editor.ts';

/** Reproduit exactement la méthode du fichier source. */
function makeDialog() {
  return {
    schedule: { schedule_id: 'abc', name: 'avant' },
    selectedSlot: null,
    _updateSchedule(ev) {
      const detail = ev.detail;
      if (!detail || typeof detail !== 'object') return;
      const changedProps = Object.keys(detail);
      if (changedProps.includes('schedule')) {
        this.schedule = detail.schedule;
      }
      if (changedProps.includes('selectedSlot')) {
        this.selectedSlot = detail.selectedSlot;
      }
    },
  };
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

check('un change DOM natif (detail undefined) ne lève pas et ne touche à rien', () => {
  const d = makeDialog();
  const avant = d.schedule;
  d._updateSchedule({ target: {}, type: 'change' }); // pas de detail
  assert.equal(d.schedule, avant, "l'état ne doit pas changer");
});

check('un detail null est ignoré de la même façon', () => {
  const d = makeDialog();
  d._updateSchedule({ detail: null });
  assert.equal(d.schedule.name, 'avant');
});

check('un detail.schedule bien formé met à jour le schedule', () => {
  const d = makeDialog();
  const nouveau = { schedule_id: 'abc', name: 'après' };
  d._updateSchedule({ detail: { schedule: nouveau } });
  assert.equal(d.schedule, nouveau);
  assert.equal(d.schedule.name, 'après');
});

check('un detail.selectedSlot est pris en compte', () => {
  const d = makeDialog();
  d._updateSchedule({ detail: { selectedSlot: 3 } });
  assert.equal(d.selectedSlot, 3);
});

check('le source contient bien le garde (pas seulement la copie de test)', () => {
  const src = fs.readFileSync(SOURCE, 'utf-8');
  assert.ok(
    src.includes('if (!detail || typeof detail !== \'object\') return;'),
    'le garde a disparu de ' + SOURCE
  );
});

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} tests OK`);
process.exit(failed ? 1 : 0);
