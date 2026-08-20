import assert from 'node:assert/strict';

function makeStorage(initial = {}) {
  return Object.assign({
    getItem(key) { return Object.prototype.hasOwnProperty.call(this, key) ? String(this[key]) : null; },
    setItem(key, value) { this[key] = String(value); },
    removeItem(key) { delete this[key]; }
  }, initial);
}

globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

const elements = {
  pop: { value: 'silicosis' },
  openAlexApiKey: { value: 'openalex-secret' },
  pubMedApiKey: { value: 'ncbi-secret' },
  apiContactEmail: { value: 'researcher@example.org' }
};
globalThis.document = {
  getElementById(id) { return elements[id] || null; },
  querySelectorAll() { return []; }
};

const storage = await import('../js/storage.js?security-test');

const collected = storage.collectSettings();
assert.equal(collected.pop, 'silicosis');
assert.equal(collected.openAlexApiKey, undefined);
assert.equal(collected.pubMedApiKey, undefined);
assert.equal(collected.apiContactEmail, undefined);

const sessionSecrets = JSON.parse(sessionStorage.getItem('meta_screener_session_secrets_v1'));
assert.equal(sessionSecrets.openAlexApiKey, 'openalex-secret');
assert.equal(sessionSecrets.pubMedApiKey, 'ncbi-secret');
assert.equal(sessionSecrets.apiContactEmail, 'researcher@example.org');

storage.saveSettings({ pop: 'silicosis', openAlexApiKey: 'must-not-persist' });
const persisted = JSON.parse(localStorage.meta_screener_pro_v1_settings);
assert.equal(persisted.pop, 'silicosis');
assert.equal(persisted.openAlexApiKey, undefined);

elements.openAlexApiKey.value = '';
storage.applySettings({ pop: 'updated', openAlexApiKey: 'backup-must-not-import' });
assert.equal(elements.pop.value, 'updated');
assert.equal(elements.openAlexApiKey.value, 'openalex-secret');

console.log('security storage tests passed');
