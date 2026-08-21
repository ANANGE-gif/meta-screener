import assert from 'node:assert/strict';
import {
  isTrialAllowedControl,
  isTrialLicense,
  shouldBlockTrialTarget
} from '../js/entitlement.js';

assert.equal(isTrialLicense('trial'), true);
assert.equal(isTrialLicense('META-PRO-PAID'), false);

const allowedFilter = { id: 'f', matches: () => false };
const blockedFetch = { id: 'btnFetch', matches: () => false };
const allowedTab = { id: '', matches: selector => selector.includes('.meta-tab') };
assert.equal(isTrialAllowedControl(allowedFilter), true);
assert.equal(isTrialAllowedControl(blockedFetch), false);
assert.equal(isTrialAllowedControl(allowedTab), true);

const main = { contains: control => control === blockedFetch || control === allowedFilter };
const target = { closest: () => blockedFetch };
assert.equal(shouldBlockTrialTarget(target, main), true);
assert.equal(shouldBlockTrialTarget({ closest: () => allowedFilter }, main), false);

console.log('entitlement tests passed');
