import assert from 'node:assert/strict';

class WebStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

const backing = new WebStorage();
globalThis.localStorage = new Proxy(backing, {
  get(target, key) {
    if (key in target) {
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return target.getItem(key);
  },
  set(target, key, value) { target.setItem(key, value); return true; }
});
globalThis.sessionStorage = new WebStorage();

const { AuthService } = await import('../js/auth.js');
const LICENSE_KEY = 'meta_screener_pro_license';
const SESSION_KEY = 'meta_screener_auth_session';
const user = { id: 'user-123', email: 'reader@example.test' };
const session = { access_token: 'token', refresh_token: 'refresh', user, expires_at: Date.now() + 600_000 };

function jsonResponse(data, ok = true) {
  return { ok, json: async () => data };
}

// A stale local license must not unlock a logged-in account.
localStorage[LICENSE_KEY] = 'STALE-CODE';
localStorage[SESSION_KEY] = JSON.stringify(session);
globalThis.fetch = async url => String(url).includes('/auth/v1/user')
  ? jsonResponse(user)
  : jsonResponse([]);
let service = new AuthService({ emit() {} });
let result = await service.checkAuth();
assert.equal(result.authenticated, false);
assert.equal(result.mode, 'need-license');
assert.equal(localStorage[LICENSE_KEY], null);

// Only a used license bound to the current Supabase user unlocks Pro.
localStorage[LICENSE_KEY] = 'PAID-CODE';
localStorage[SESSION_KEY] = JSON.stringify(session);
globalThis.fetch = async url => String(url).includes('/auth/v1/user')
  ? jsonResponse(user)
  : jsonResponse([{ code: 'PAID-CODE', used: true, device_id: user.id }]);
service = new AuthService({ emit() {} });
result = await service.checkAuth();
assert.equal(result.authenticated, true);
assert.equal(result.mode, 'online');

// A valid account can recover its entitlement when the local code is missing.
localStorage.removeItem(LICENSE_KEY);
localStorage[SESSION_KEY] = JSON.stringify(session);
globalThis.fetch = async url => String(url).includes('/auth/v1/user')
  ? jsonResponse(user)
  : jsonResponse([{ code: 'RECOVERED-CODE', used: true, device_id: user.id }]);
service = new AuthService({ emit() {} });
result = await service.checkAuth();
assert.equal(result.authenticated, true);
assert.equal(localStorage[LICENSE_KEY], 'RECOVERED-CODE');

console.log('auth entitlement tests passed');
