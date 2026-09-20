'use strict';

function revokeSessions(db, userId) {
  const remove = db.prepare('DELETE FROM sessions WHERE sid=?');
  for (const session of db.prepare('SELECT sid,data FROM sessions').all()) {
    let data; try { data = JSON.parse(session.data); } catch (_) { continue; }
    if (data && Number(data.userId) === userId) remove.run(session.sid);
  }
}

// Old demo package builders could inherit DB_PATH and create this technical account
// in the live database. Match its original credential as well as its name: a real
// account with the same name must never be removed by a migration.
function retire(db) {
  if (process.env.DEMO_PACKAGE_BUILD === '1') return;
  const user = db.prepare("SELECT * FROM users WHERE lower(username)='paketbau'").get();
  if (!user || !require('bcrypt').compareSync('Wegwerf-Paketbau-0000!', user.password_hash)) return;
  const replacement = db.prepare('SELECT id FROM users WHERE id<>? AND is_admin=1 AND is_demo=0 AND active=1 AND allow_online=1 ORDER BY id').get(user.id);
  // Never reopen first-run setup or renumber an existing installation. If no real
  // administrator exists yet, quarantine the public build login until recovery.
  if (!replacement) {
    db.transaction(() => {
      db.prepare('UPDATE users SET active=0,is_demo=1,allow_local=0,allow_online=0 WHERE id=?').run(user.id);
      revokeSessions(db, user.id);
    })();
    return;
  }
  const personal = new Set(['sessions','api_tokens','user_ui_prefs','user_settings_overrides','mail_prefs','chat_user_status','chat_participants','addressbook_preferences','addressbook_views']);
  db.transaction(() => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const {name} of tables) {
      const table = '"' + name.replace(/"/g, '""') + '"';
      for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all().filter(f => f.table === 'users')) {
        const column = '"' + fk.from.replace(/"/g, '""') + '"';
        if (personal.has(name)) db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(user.id);
        else if (name === 'persons') db.prepare(`UPDATE persons SET aktiv=0,user_id=NULL WHERE user_id=?`).run(user.id);
        else {
          const field = db.prepare(`PRAGMA table_info(${table})`).all().find(f => f.name === fk.from);
          // Keep business records. Transfer ownership; historical attribution may be null.
          const ownership = /owner|fahrer|assigned/.test(fk.from);
          db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(field.notnull || field.pk || ownership ? replacement.id : null, user.id);
        }
      }
    }
    // Legacy ownership column predates the FK schema.
    db.prepare('UPDATE cases SET owner_user_id=? WHERE owner_user_id=?').run(replacement.id,user.id);
    revokeSessions(db, user.id);
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  })();
}
module.exports = { retire };
