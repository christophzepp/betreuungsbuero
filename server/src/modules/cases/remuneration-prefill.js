'use strict';
const rules = require('../../shared/remuneration-prefill');

// Return only the billing stage of THIS case's assigned guardian. Qualification records
// (certificates, hours, notes, etc.) remain behind viewAllQualifications.
function stageForCase(db, cd) {
  const guardian = String(cd?.rechtlicherBetreuer || '').trim();
  const row = db.prepare("SELECT data_json FROM office_json WHERE key='qualifikationen'").get();
  const store = row ? JSON.parse(row.data_json) : {};
  const persons = db.prepare('SELECT id, first_name AS firstName, last_name AS lastName FROM persons').all();
  return {guardian, stage: rules.guardianStage(guardian, persons, store.entries)};
}
module.exports = {stageForCase};
