/**
 * Test unitaire de l'export carte -> backend pour `weekdays` par creneau.
 * Lancement : cd ~/ha-forks/scheduler-card && npx --yes tsx ../card-tests/test_export_slot_weekdays.ts
 */
import { exportSchedule } from '/home/batman/ha-forks/scheduler-card/src/data/store/save_schedule.ts';
import { convertLegacySchedule } from '/home/batman/ha-forks/scheduler-card/src/data/store/convert_legacy_schedule.ts';
import { TWeekday } from '/home/batman/ha-forks/scheduler-card/src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const slot = (start: string, stop: string | undefined, value: number, weekdays?: TWeekday[]) => ({
  start,
  stop,
  weekdays,
  conditions: { type: 'and' as any, items: [], track_changes: false },
  actions: [
    {
      service: 'climate.set_temperature',
      service_data: { temperature: value },
      target: { entity_id: 'climate.clim_zonage_alice' },
    },
  ],
});

// 1) export : les jours par creneau partent bien vers le backend
const schedule: any = {
  entries: [
    {
      weekdays: [TWeekday.Daily],
      slots: [
        slot('00:00:00', '05:15:00', 19),
        slot('05:15:00', '06:45:00', 21),
        slot('06:45:00', '07:30:00', 19, [TWeekday.Monday, TWeekday.Tuesday, TWeekday.Thursday, TWeekday.Friday]),
        slot('07:30:00', '12:00:00', 19, [TWeekday.Wednesday]),
        slot('21:30:00', '00:00:00', 19, [TWeekday.Saturday, TWeekday.Sunday]),
      ],
    },
  ],
  repeat_type: 'repeat',
  enabled: true,
  name: 'Filles',
};

const payload: any = exportSchedule(schedule);
check('le schedule garde weekdays=daily', JSON.stringify(payload.weekdays) === '["daily"]', JSON.stringify(payload.weekdays));
check('creneau sans restriction : pas de cle weekdays', payload.timeslots[0].weekdays === undefined, JSON.stringify(payload.timeslots[0]));
check(
  'creneau SEM exporte ["mon","tue","thu","fri"]',
  JSON.stringify(payload.timeslots[2].weekdays) === '["mon","tue","thu","fri"]',
  JSON.stringify(payload.timeslots[2].weekdays)
);
check(
  'creneau mercredi exporte ["wed"]',
  JSON.stringify(payload.timeslots[3].weekdays) === '["wed"]',
  JSON.stringify(payload.timeslots[3].weekdays)
);
check(
  'creneau week-end exporte ["sat","sun"]',
  JSON.stringify(payload.timeslots[4].weekdays) === '["sat","sun"]',
  JSON.stringify(payload.timeslots[4].weekdays)
);

// 2) import : ce que le backend renvoie est relu dans le modele
const reloaded: any = convertLegacySchedule({
  ...payload,
  enabled: true,
  entity_id: 'switch.schedule_filles',
  timestamps: [],
  next_entries: [],
} as any);
const slots = reloaded.entries[0].slots;
check('relecture : 5 creneaux', slots.length === 5, String(slots.length));
check('relecture : creneau 0 sans restriction', slots[0].weekdays === undefined, JSON.stringify(slots[0].weekdays));
check(
  'relecture : creneau 2 -> lundi/mardi/jeudi/vendredi',
  JSON.stringify(slots[2].weekdays) ===
    JSON.stringify([TWeekday.Monday, TWeekday.Tuesday, TWeekday.Thursday, TWeekday.Friday]),
  JSON.stringify(slots[2].weekdays)
);
check('relecture : creneau 3 -> mercredi', JSON.stringify(slots[3].weekdays) === JSON.stringify([TWeekday.Wednesday]), JSON.stringify(slots[3].weekdays));

// 3) aller-retour complet : export(import(x)) == x
const roundtrip: any = exportSchedule(reloaded);
check(
  'aller-retour sans perte (weekdays des 5 creneaux)',
  JSON.stringify(roundtrip.timeslots.map((s: any) => s.weekdays)) ===
    JSON.stringify(payload.timeslots.map((s: any) => s.weekdays)),
  JSON.stringify(roundtrip.timeslots.map((s: any) => s.weekdays))
);

// 4) retro-compatibilite : un ancien payload (sans weekdays de creneau) est inchange
const legacy: any = convertLegacySchedule({
  weekdays: ['mon', 'tue'],
  timeslots: [{ start: '06:45:00', actions: [{ service: 'script.x' }] }],
  enabled: true,
  entity_id: 'switch.schedule_old',
  timestamps: [],
  next_entries: [],
  repeat_type: 'repeat',
} as any);
check('legacy : jours du schedule conserves', JSON.stringify(legacy.entries[0].weekdays) === JSON.stringify([TWeekday.Monday, TWeekday.Tuesday]), JSON.stringify(legacy.entries[0].weekdays));
check('legacy : creneau sans weekdays', legacy.entries[0].slots[0].weekdays === undefined, JSON.stringify(legacy.entries[0].slots[0].weekdays));

console.log(`\n${failures === 0 ? 'TOUS LES TESTS OK' : failures + ' ECHEC(S)'}`);
process.exit(failures ? 1 : 0);
