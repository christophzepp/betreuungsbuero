'use strict';

const cryptoHelper = require('../../security/crypto');
const SERVICES = ['ebo', 'simplefax'];
const FIELDS = ['username', 'password', 'loginUrl', 'inboxUrl', 'composeUrl'];
const configured = value => !!value && FIELDS.some(key => String(value[key] || '').trim());

function officeValues(db) {
  return Object.fromEntries(db.prepare('SELECT * FROM office_send_credentials').all()
    .filter(row => SERVICES.includes(row.service))
    .map(row => [row.service, {
      username: row.username, password: cryptoHelper.decrypt(row.password_encrypted),
      loginUrl: row.login_url, inboxUrl: row.inbox_url, composeUrl: row.compose_url
    }]));
}

// One precedence rule per service: a configured office account is authoritative.
// Personal values for another service remain usable and never erase office defaults.
function resolve(db, personal) {
  const office = officeValues(db), values = {}, sources = {};
  for (const service of SERVICES) {
    const fromOffice = configured(office[service]);
    const own = personal && personal[service];
    values[service] = fromOffice ? office[service] : (configured(own) ? own : {});
    sources[service] = fromOffice ? 'admin' : (configured(own) ? 'user' : 'none');
  }
  return { values, sources };
}

module.exports = { SERVICES, configured, officeValues, resolve };
