#!/usr/bin/env node
// Bootstrap-Skript: legt einen Nutzer an oder aktualisiert ihn, falls der Nutzername bereits
// existiert. Wird vor allem gebraucht, um den ALLERERSTEN Admin-Nutzer anzulegen (danach lassen
// sich weitere Nutzer bequem im Admin-Panel der App verwalten, siehe Phase 2.1.1).
//
// Beispiele:
//   npm run create-admin -- --username admin --password geheim123 --display-name "Admin" --admin --local --online
//   npm run create-admin -- --username betreuer1 --password geheim456 --local
//   npm run create-admin -- --username betreuer2 --password geheim789 --online --case-management

const path = require('path');
const SERVER_ROOT = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(SERVER_ROOT, '.env') });
const db = require('../../src/database/index');
const { hashPassword } = require('../../src/middleware/authentication');

function parseArgs(argv) {
  const out = { admin: false, local: false, online: false, caseManagement: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--username': out.username = argv[++i]; break;
      case '--password': out.password = argv[++i]; break;
      case '--display-name': out.displayName = argv[++i]; break;
      case '--admin': out.admin = true; break;
      case '--local': out.local = true; break;
      case '--online': out.online = true; break;
      case '--case-management': out.caseManagement = true; break;
      default:
        console.warn(`Unbekannte Option ignoriert: ${arg}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username || !args.password) {
    console.error('Benoetigt mindestens --username und --password.');
    console.error('Optionen: --display-name <Name> --admin --local --online');
    process.exitCode = 1;
    return;
  }
  if (!args.local && !args.online) {
    console.error('Mindestens einer von --local / --online muss gesetzt sein, sonst kann sich der Nutzer nirgends anmelden.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(args.password);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(args.username);

  if (existing) {
    db.prepare(`
      UPDATE users SET password_hash = ?, display_name = ?, allow_local = ?, allow_online = ?, is_admin = ?, allow_case_management = ?
      WHERE id = ?
    `).run(passwordHash, args.displayName || args.username, args.local ? 1 : 0, args.online ? 1 : 0, args.admin ? 1 : 0, args.caseManagement ? 1 : 0, existing.id);
    console.log(`Nutzer "${args.username}" aktualisiert (id ${existing.id}).`);
  } else {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, allow_local, allow_online, is_admin, allow_case_management)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(args.username, passwordHash, args.displayName || args.username, args.local ? 1 : 0, args.online ? 1 : 0, args.admin ? 1 : 0, args.caseManagement ? 1 : 0);
    console.log(`Nutzer "${args.username}" angelegt (id ${info.lastInsertRowid}).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
