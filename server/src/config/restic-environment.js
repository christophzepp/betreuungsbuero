'use strict';

/*
 * Positive Umgebungslisten für externe Prüf-/Restic-Prozesse.
 *
 * Der Anwendungsprozess benötigt selbst SESSION_SECRET, ENCRYPTION_KEY und
 * weitere hochsensible Werte. Ein Kindprozess darf diese nicht allein durch
 * normales Environment-Inheritance erhalten. Provider-Zugangsdaten kommen
 * ausschließlich aus der bereits validierten Positivliste des Backup-Runners.
 */

const RUNTIME_KEYS = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL',
  'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_TIME',
  'LC_NUMERIC', 'LC_COLLATE', 'LC_MONETARY', 'LC_PAPER', 'LC_NAME',
  'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
  'RESTIC_CACHE_DIR', 'RESTIC_COMPRESSION', 'RESTIC_PACK_SIZE'
]);

const PROVIDER_KEYS = Object.freeze([
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_DEFAULT_REGION', 'AWS_REGION', 'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE',
  'RESTIC_REST_USERNAME', 'RESTIC_REST_PASSWORD',
  'B2_ACCOUNT_ID', 'B2_ACCOUNT_KEY',
  'AZURE_ACCOUNT_NAME', 'AZURE_ACCOUNT_KEY',
  'GOOGLE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
  'RCLONE_CONFIG',
  'OS_AUTH_URL', 'OS_USERNAME', 'OS_USER_ID', 'OS_PASSWORD',
  'OS_REGION_NAME', 'OS_TENANT_ID', 'OS_TENANT_NAME',
  'OS_PROJECT_ID', 'OS_PROJECT_NAME',
  'OS_APPLICATION_CREDENTIAL_ID', 'OS_APPLICATION_CREDENTIAL_SECRET',
  'OS_USER_DOMAIN_NAME', 'OS_PROJECT_DOMAIN_NAME',
  'OS_TRUST_ID', 'OS_STORAGE_URL', 'OS_AUTH_TOKEN'
]);

function copyAllowed(target, source, keys) {
  const input = source && typeof source === 'object' ? source : {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = String(input[key] == null ? '' : input[key]);
    if (!value || value.length > 8192 || value.includes('\0')) continue;
    target[key] = value;
  }
}

function runtimeEnvironment(baseEnvironment) {
  const result = {};
  copyAllowed(result, baseEnvironment || process.env, RUNTIME_KEYS);
  return result;
}

function resticEnvironment(providerEnvironment, baseEnvironment) {
  const base = baseEnvironment || process.env;
  const result = runtimeEnvironment(base);
  // Legacy-/Instanzrollen dürfen weiterhin über eine ausdrücklich freigegebene
  // Provider-Variable kommen. Eine validierte Credential-Datei überschreibt
  // denselben Schlüssel gezielt, ohne andere App-Variablen mitzunehmen.
  copyAllowed(result, base, PROVIDER_KEYS);
  copyAllowed(result, providerEnvironment, PROVIDER_KEYS);
  return result;
}

module.exports = {
  RUNTIME_KEYS,
  PROVIDER_KEYS,
  runtimeEnvironment,
  resticEnvironment
};
