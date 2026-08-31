// KI-Proxy fuer die Browser-Extension (Plan Abschnitt BR, Phase E4): der ERSTE serverseitige
// Provider-Adapter dieses Projekts. Bisher rief ausschliesslich der Browser die KI-Anbieter auf
// (Keys werden beim Online-Login entschluesselt ausgeliefert, decryptedOfficeConfig) - die
// Extension bekommt die Keys bewusst NIE: dieser Proxy nutzt office_ai_config direkt und
// liefert nur die Antwort aus. Text-Prompt + striktes JSON-Schema; optional Datei-Anhaenge
// (Bilder/PDF als multimodale Eingabe, Feature v0.2.1) je Provider im passenden Format.

const db = require('../../database/index');
const cryptoHelper = require('../../security/crypto');

// Präferenz-Reihenfolge, wenn mehrere Anbieter konfiguriert sind (gleiches Namensuniversum wie
// AI_PROVIDERS in routes/admin.js / ensureAIConfig() im Client).
const PROVIDER_ORDER = ['openai', 'anthropic', 'gemini', 'ionos', 'ollama'];

const listConfigStmt = db.prepare('SELECT provider, api_key_encrypted, model, endpoint FROM office_ai_config');

function decryptedConfigs() {
  const out = {};
  for (const row of listConfigStmt.all()) {
    let apiKey = '';
    try { apiKey = row.api_key_encrypted ? cryptoHelper.decrypt(row.api_key_encrypted) : ''; } catch (_e) { apiKey = ''; }
    out[row.provider] = { apiKey, model: row.model || '', endpoint: row.endpoint || '' };
  }
  return out;
}

function pickProvider() {
  const cfgs = decryptedConfigs();
  const forced = (process.env.EXT_AI_PROVIDER || '').trim().toLowerCase();
  if (forced && cfgs[forced]) return { provider: forced, cfg: cfgs[forced] };
  for (const p of PROVIDER_ORDER) {
    const c = cfgs[p];
    if (!c) continue;
    if (p === 'ollama') { if (c.model) return { provider: p, cfg: c }; continue; }
    if (c.apiKey && c.model) return { provider: p, cfg: c };
  }
  return null;
}

function isConfigured() { return !!pickProvider(); }

// Tolerante JSON-Extraktion: manche Modelle liefern Prosa um das JSON herum.
function extractJson(text) {
  if (!text) throw new Error('Leere KI-Antwort.');
  try { return JSON.parse(text); } catch (_e) { /* weiter */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_e) { /* weiter */ } }
  const start = text.indexOf('{');
  if (start >= 0) {
    // Klammern balancieren (Strings beruecksichtigen)
    let depth = 0, inStr = false, escNext = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escNext) { escNext = false; continue; }
      if (ch === '\\') { escNext = true; continue; }
      if (ch === '"') inStr = !inStr;
      else if (!inStr && ch === '{') depth++;
      else if (!inStr && ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch (_e) { break; } } }
    }
  }
  throw new Error('KI-Antwort war kein gültiges JSON.');
}

async function httpJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || data.message || JSON.stringify(data).slice(0, 300);
      const err = new Error('KI-Anbieter HTTP ' + res.status + ': ' + msg);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

function schemaInstruction(schema) {
  return '\n\nAntworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt (kein Text davor/danach), das exakt diesem JSON-Schema entspricht:\n' + JSON.stringify(schema);
}

// ===== Datei-Anhaenge (Feature v0.2.1): Bilder + PDF als multimodale Eingabe =====
// attachments = [{ name, mime, base64 }] (base64 OHNE data:-Praefix). Jeder Provider hat ein
// eigenes Format; nicht unterstuetzte Typen werden je Provider stillschweigend uebersprungen.
function isImage(a) { return /^image\//.test(a.mime || ''); }
function isPdf(a) { return (a.mime || '') === 'application/pdf'; }
function dataUrl(a) { return 'data:' + (a.mime || 'application/octet-stream') + ';base64,' + a.base64; }

function openAiContent(text, attachments) {
  if (!attachments || !attachments.length) return text; // reiner Text: unveraendertes Format
  const parts = [{ type: 'text', text }];
  for (const a of attachments) {
    if (isImage(a)) parts.push({ type: 'image_url', image_url: { url: dataUrl(a) } });
    else if (isPdf(a)) parts.push({ type: 'file', file: { filename: a.name || 'dokument.pdf', file_data: dataUrl(a) } });
  }
  return parts;
}
function anthropicContent(text, attachments) {
  const blocks = [{ type: 'text', text }];
  for (const a of (attachments || [])) {
    if (isImage(a)) blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.base64 } });
    else if (isPdf(a)) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } });
  }
  return blocks;
}
function geminiParts(text, attachments) {
  const parts = [{ text }];
  for (const a of (attachments || [])) {
    if (isImage(a) || isPdf(a)) parts.push({ inline_data: { mime_type: a.mime, data: a.base64 } });
  }
  return parts;
}

// ===== Provider-Adapter (Chat-Completions-Stil, JSON-Ausgabe erzwungen wo moeglich) =====

async function callOpenAiCompatible(baseUrl, apiKey, model, prompt, schema, attachments) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { Authorization: 'Bearer ' + apiKey };
  const content = openAiContent(prompt + schemaInstruction(schema), attachments);
  // 1) natives json_schema (OpenAI + teils IONOS), 2) Fallback json_object + Schema im Prompt.
  try {
    const data = await httpJson(url, headers, {
      model, messages: [{ role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'antwort', strict: true, schema } }
    });
    return extractJson(data.choices?.[0]?.message?.content || '');
  } catch (e) {
    if (e.status !== 400) throw e;
    const data = await httpJson(url, headers, {
      model, messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' }
    });
    return extractJson(data.choices?.[0]?.message?.content || '');
  }
}

async function callAnthropic(apiKey, model, prompt, schema, attachments) {
  const data = await httpJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey, 'anthropic-version': '2023-06-01'
  }, {
    model, max_tokens: 4096,
    messages: [{ role: 'user', content: anthropicContent(prompt + schemaInstruction(schema), attachments) }]
  });
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return extractJson(text);
}

async function callGemini(apiKey, model, prompt, schema, attachments) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = await httpJson(url, {}, {
    contents: [{ role: 'user', parts: geminiParts(prompt + schemaInstruction(schema), attachments) }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return extractJson(text);
}

async function callOllama(endpoint, model, prompt, schema, attachments) {
  const url = (endpoint || 'http://localhost:11434').replace(/\/+$/, '') + '/api/chat';
  const images = (attachments || []).filter(isImage).map(a => a.base64); // Ollama: nur Bilder (Vision)
  const msg = { role: 'user', content: prompt + schemaInstruction(schema) };
  if (images.length) msg.images = images;
  const data = await httpJson(url, {}, {
    model, stream: false, format: 'json', messages: [msg]
  }, 180000);
  return extractJson(data.message?.content || '');
}

// Haupteinstieg: prompt + striktes JSON-Schema (+ optionale Datei-Anhaenge) -> geparstes Objekt.
async function aiProxyCall(prompt, schema, attachments) {
  const picked = pickProvider();
  if (!picked) throw new Error('Kein KI-Anbieter konfiguriert (Admin-Panel → KI-Zugangsdaten).');
  const { provider, cfg } = picked;
  const att = Array.isArray(attachments) ? attachments : [];
  if (provider === 'openai') return callOpenAiCompatible(cfg.endpoint || 'https://api.openai.com/v1', cfg.apiKey, cfg.model, prompt, schema, att);
  if (provider === 'ionos') return callOpenAiCompatible(cfg.endpoint || 'https://openai.inference.de-txl.ionos.com/v1', cfg.apiKey, cfg.model, prompt, schema, att);
  if (provider === 'anthropic') return callAnthropic(cfg.apiKey, cfg.model, prompt, schema, att);
  if (provider === 'gemini') return callGemini(cfg.apiKey, cfg.model, prompt, schema, att);
  if (provider === 'ollama') return callOllama(cfg.endpoint, cfg.model, prompt, schema, att);
  throw new Error('Unbekannter KI-Anbieter: ' + provider);
}

module.exports = { aiProxyCall, isConfigured, pickProvider };
