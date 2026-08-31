const db = require('../../database/index');

const STORE_KEY = 'user_theme_preferences';

const getStore = db.prepare(`
  SELECT data_json, updated_at
  FROM office_json
  WHERE key = ?
`);

const upsertStore = db.prepare(`
  INSERT INTO office_json (key, data_json, updated_by)
  VALUES (@key, @dataJson, @updatedBy)
  ON CONFLICT(key) DO UPDATE SET
    data_json = excluded.data_json,
    updated_at = datetime('now'),
    updated_by = excluded.updated_by
`);

function normalizePreference(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    preference: normalizePreference(source.preference),
    scheduleEnabled: source.scheduleEnabled === true,
  };
}

function loadStore() {
  const row = getStore.get(STORE_KEY);
  if (!row) return { version: 1, users: {} };

  try {
    const parsed = JSON.parse(row.data_json || '{}');
    return {
      version: 1,
      users: parsed && typeof parsed.users === 'object' && parsed.users ? parsed.users : {},
    };
  } catch (_error) {
    return { version: 1, users: {} };
  }
}

function saveStore(store, updatedBy) {
  upsertStore.run({
    key: STORE_KEY,
    dataJson: JSON.stringify({
      version: 1,
      users: store && typeof store.users === 'object' && store.users ? store.users : {},
    }),
    updatedBy: Number(updatedBy) || null,
  });
}

function getThemeSettings(userId) {
  const store = loadStore();
  return normalizeSettings(store.users[String(userId)]);
}

function setThemeSettings(userId, input, updatedBy) {
  const id = String(userId);
  const store = loadStore();
  const current = normalizeSettings(store.users[id]);
  const source = input && typeof input === 'object' ? input : {};
  const next = {
    preference: source.preference == null
      ? current.preference
      : normalizePreference(source.preference),
    scheduleEnabled: source.scheduleEnabled == null
      ? current.scheduleEnabled
      : source.scheduleEnabled === true,
  };

  store.users[id] = next;
  saveStore(store, updatedBy);
  return next;
}

function removeThemeSettings(userId, updatedBy) {
  const store = loadStore();
  const id = String(userId);
  if (!Object.prototype.hasOwnProperty.call(store.users, id)) return;
  delete store.users[id];
  saveStore(store, updatedBy);
}

module.exports = {
  getThemeSettings,
  setThemeSettings,
  removeThemeSettings,
};
