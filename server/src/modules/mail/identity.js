'use strict';
// Opaque correlation only: no contact or case information leaves the application.
const HEADER = 'x-betreuungsbuero-mail-id';
function dispatchId(value) { return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || '')) ? String(value).toLowerCase() : ''; }
function fromHeaders(headers) {
  if (Array.isArray(headers)) return dispatchId(headers.find(h => String(h.name).toLowerCase() === HEADER)?.value);
  if (headers?.get) return dispatchId(headers.get(HEADER));
  const line = String(headers || '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).find(l => l.slice(0, l.indexOf(':')).toLowerCase() === HEADER);
  return dispatchId(line?.slice(line.indexOf(':') + 1).trim());
}
module.exports = { HEADER, dispatchId, fromHeaders };
