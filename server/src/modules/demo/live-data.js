'use strict';

const { DEMO_CASES } = require('./data-identities');
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const ids = DEMO_CASES.map(c => quote(c.id)).join(',');

// Explicit read boundary. Writes, migrations and recovery use the original tables.
// The isolated demo package has its own DB connection and must see its sample rows.
function install(db) {
  const packageBuild = process.env.DEMO_PACKAGE_BUILD === '1';
  const filters = {
    cases: `id NOT IN (${ids})`,
    users: 'COALESCE(is_demo,0)=0',
    persons: 'user_id IS NULL OR user_id IN (SELECT id FROM live_users)',
    audit_log: `COALESCE(case_id,'') NOT IN (${ids}) AND (actor_user_id IS NULL OR actor_user_id IN (SELECT id FROM live_users))`,
    doc_files: `COALESCE(case_id,'') NOT IN (${ids})`,
    doc_folders: `COALESCE(case_id,'') NOT IN (${ids})`,
    doc_activity: `COALESCE(case_id,'') NOT IN (${ids})`,
    doc_case_roots: `COALESCE(case_id,'') NOT IN (${ids})`,
  };
  for (const table of ['case_documents','case_reports','case_doku_entries','case_contacts','case_access','betreuung_overview_entries']) {
    filters[table] = `COALESCE(case_id,'') NOT IN (${ids})`;
  }
  for (const table of ['calendar_events','todos','outgoing_invoices']) {
    filters[table] = `COALESCE(case_id,'') NOT IN (${ids}) AND (COALESCE(case_id,'')<>'' OR NOT EXISTS (SELECT 1 FROM main.cases demo WHERE demo.id IN (${ids}) AND demo.label=${table}.case_label AND NOT EXISTS (SELECT 1 FROM live_cases real WHERE real.label=demo.label)))`;
  }
  filters.finance_receipts = 'uploaded_by IS NULL OR uploaded_by IN (SELECT id FROM live_users)';
  filters.mileage_trips = `NOT EXISTS (SELECT 1 FROM main.cases demo WHERE demo.id IN (${ids}) AND demo.label=mileage_trips.case_label AND NOT EXISTS (SELECT 1 FROM live_cases real WHERE real.label=demo.label))`;
  for (const [table, predicate] of Object.entries(filters)) {
    // TEMP views avoid changing backup schemas and are installed for each connection.
    db.exec(`CREATE TEMP VIEW IF NOT EXISTS live_${table} AS SELECT * FROM main.${table} WHERE ${packageBuild ? '1' : '(' + predicate + ')'}`);
  }
}
module.exports = { install };
