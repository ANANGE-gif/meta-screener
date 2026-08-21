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
localStorage.meta_screener_pro_license = 'PAID-TEST';
localStorage.meta_screener_device_id = 'test-device';

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
const persisted = JSON.parse(storage.getProjectStorage().getItem('meta_screener_pro_v1_settings'));
assert.equal(persisted.pop, 'silicosis');
assert.equal(persisted.openAlexApiKey, undefined);

elements.openAlexApiKey.value = '';
storage.applySettings({ pop: 'updated', openAlexApiKey: 'backup-must-not-import' });
assert.equal(elements.pop.value, 'updated');
assert.equal(elements.openAlexApiKey.value, 'openalex-secret');
storage.clearSessionSecrets();
storage.applySettings({ pop: 'updated-again' });
assert.equal(elements.openAlexApiKey.value, '');
assert.equal(elements.pubMedApiKey.value, '');
assert.equal(elements.apiContactEmail.value, '');

// Trial projects must never read or overwrite the paid project's local data.
const paidStore = storage.getProjectStorage();
paidStore.setItem('meta_screener_pro_v1', JSON.stringify([{ title: 'paid-private-record' }]));
localStorage.meta_screener_pro_license = 'trial';
storage.saveNow([{ title: 'trial-demo-record' }]);
assert.equal(JSON.parse(paidStore.getItem('meta_screener_pro_v1'))[0].title, 'paid-private-record');
assert.equal(JSON.parse(sessionStorage.meta_screener_pro_v1)[0].title, 'trial-demo-record');
assert.equal(storage.loadRecords()[0].title, 'trial-demo-record');
localStorage.meta_screener_pro_license = 'PAID-TEST';
assert.equal(storage.loadRecords()[0].title, 'paid-private-record');

// Two paid accounts on one browser receive separate project namespaces.
localStorage.meta_screener_auth_session = JSON.stringify({ user: { id: 'user-a' } });
storage.saveNow([{ title: 'account-a-record' }]);
localStorage.meta_screener_auth_session = JSON.stringify({ user: { id: 'user-b' } });
assert.equal(storage.loadRecords().length, 0);
storage.saveNow([{ title: 'account-b-record' }]);
localStorage.meta_screener_auth_session = JSON.stringify({ user: { id: 'user-a' } });
assert.equal(storage.loadRecords()[0].title, 'account-a-record');

console.log('security storage tests passed');
