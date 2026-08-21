// entitlement.js — 免费演示沙盒与专业版功能边界。

export const TRIAL_LICENSE = 'trial';

const TRIAL_ALLOWED_CONTROL_IDS = new Set([
  'btnContinueProject', 'btnNextAction', 'btnCockpitNext',
  'btnHomeDemo', 'btnFullDemo', 'btnDemo',
  'btnTrialUpgrade',
  'btnHelp', 'btnAbout', 'btnLogout',
  'btnHideHelp', 'btnHideAbout', 'btnHideManual',
  'f', 'fd', 'fs', 'ft'
]);

export function isTrialLicense(license) {
  return license === TRIAL_LICENSE;
}

export function isTrialAllowedControl(control) {
  if (!control) return false;
  if (TRIAL_ALLOWED_CONTROL_IDS.has(control.id)) return true;
  return Boolean(control.matches?.('.review-tab, .meta-tab'));
}

export function shouldBlockTrialTarget(target, mainApp) {
  const control = target?.closest?.('button, input, textarea, select');
  if (!control || !mainApp?.contains(control)) return false;
  return !isTrialAllowedControl(control);
}
