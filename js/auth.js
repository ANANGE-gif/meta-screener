// auth.js — Supabase GoTrue REST 认证 + 激活码管理。

import { SUPABASE } from './config.js?v=20260722b';
import { STORAGE_KEYS } from './config.js?v=20260722b';
import { fetchWithTimeout } from './utils.js?v=20260722b';
import { getDeviceId, getStoredAuth, setStoredAuth, clearAuth as clearStoredAuth, clearSessionSecrets, getLicense, setLicense, clearLicense, getOfflineUsedCodes, setOfflineUsedCode } from './storage.js?v=20260820b';

export class AuthService {
  #eventBus;

  constructor(eventBus) {
    this.#eventBus = eventBus;
  }

  // ===== URL Helpers =====

  get supabaseBase() {
    return SUPABASE.PROXY_URL || ('https://' + SUPABASE.HOST);
  }

  authUrl(path) {
    return this.supabaseBase + '/auth/v1' + path;
  }

  restUrl(path) {
    return this.supabaseBase + '/rest/v1' + path;
  }

  authHeaders(token) {
    const h = {
      'apikey': SUPABASE.KEY,
      'Content-Type': 'application/json'
    };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  supabaseHeaders() {
    return {
      'apikey': SUPABASE.KEY,
      'Authorization': 'Bearer ' + SUPABASE.KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  // ===== Session Management =====

  getSession() {
    return getStoredAuth();
  }

  async refreshSession() {
    const session = getStoredAuth();
    if (!session || !session.refresh_token) return null;
    try {
      const res = await fetchWithTimeout(
        this.authUrl('/token?grant_type=refresh_token'),
        { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const newSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000
      };
      setStoredAuth(newSession);
      return newSession;
    } catch {
      return null;
    }
  }

  async getCurrentUser() {
    let session = getStoredAuth();
    if (!session || !session.access_token) return null;
    if (session.expires_at && Date.now() > session.expires_at - 60 * 1000) {
      session = await this.refreshSession();
      if (!session) return null;
    }
    try {
      const res = await fetch(this.authUrl('/user'), { headers: this.authHeaders(session.access_token) });
      if (!res.ok) {
        session = await this.refreshSession();
        if (!session) return null;
        const retry = await fetch(this.authUrl('/user'), { headers: this.authHeaders(session.access_token) });
        if (!retry.ok) return null;
        const user = await retry.json();
        return { user, session };
      }
      const user = await res.json();
      return { user, session };
    } catch {
      return null;
    }
  }

  // ===== License Queries =====

  async queryLicenseFromSupabase(code) {
    const res = await fetchWithTimeout(
      this.restUrl('/licenses?code=eq.') + encodeURIComponent(code) + '&order=activated_at.desc&limit=1',
      { headers: this.supabaseHeaders() }, 5000
    );
    if (!res.ok) throw new Error('服务器错误');
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  }

  async claimLicenseOnSupabase(code, userId) {
    const res = await fetchWithTimeout(
      this.restUrl('/licenses?code=eq.') + encodeURIComponent(code) + '&used=is.false',
      { method: 'PATCH', headers: this.supabaseHeaders(), body: JSON.stringify({ used: true, device_id: userId, activated_at: new Date().toISOString() }) },
      5000
    );
    if (!res.ok) return false;
    const updated = await res.json();
    return Array.isArray(updated) && updated.length > 0;
  }

  async queryLicenseByUserId(userId) {
    const res = await fetchWithTimeout(
      this.restUrl('/licenses?device_id=eq.') + encodeURIComponent(userId) + '&order=activated_at.desc&limit=1',
      { headers: this.supabaseHeaders() }, 5000
    );
    if (!res.ok) throw new Error('授权服务器错误');
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  }

  async verifyLicenseInBackground(code, userId) {
    try {
      const row = await this.queryLicenseFromSupabase(code);
      if (!row) return;
      if (row.used && row.device_id && row.device_id !== userId) {
        clearLicense();
        alert('您的激活码已被绑定到其他账号，当前设备已锁定。\n如需帮助，请联系管理员。');
        location.reload();
      }
    } catch { /* 网络错误静默跳过 */ }
  }

  // ===== Login =====

  async login(email, password) {
    try {
      const res = await fetchWithTimeout(
        this.authUrl('/token?grant_type=password'),
        { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ email, password }) },
        10000
      );

      const data = await res.json();
      if (!res.ok) {
        const msg = data.error_description || data.msg || data.message || '';
        const code = data.code || '';
        if (msg.includes('Invalid login') || msg.includes('invalid')) return { error: '邮箱或密码错误' };
        if (msg.includes('Email not confirmed')) return { error: '邮箱未验证，请检查收件箱（含垃圾邮件）点击确认链接' };
        if (code === 429 || msg.includes('rate limit')) return { error: '服务器繁忙，请稍后再试' };
        return { error: '登录失败 [' + code + ']：' + (msg || '未知错误') };
      }

      const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000
      };
      setStoredAuth(session);
      clearLicense();

      // 检查绑定的激活码
      const licRow = await this.queryLicenseByUserId(data.user.id);
      const hasBoundLicense = Boolean(licRow?.used && licRow.device_id === data.user.id && licRow.code);
      if (hasBoundLicense) {
        setLicense(licRow.code);
        this.#eventBus?.emit('auth:changed', { state: 'online', user: data.user });
      } else {
        clearLicense();
      }

      return { success: true, session, hasLicense: hasBoundLicense };
    } catch (err) {
      if (err.message === '连接超时') return { error: '连接超时（>10秒），请检查网络或刷新重试' };
      if (err.message?.includes('Failed to fetch')) return { error: '无法连接到服务器，请检查是否需要代理/VPN' };
      return { error: '网络错误：' + (err.message || '未知') };
    }
  }

  // ===== Register =====

  async register(email, password, licenseCode) {
    try {
      // 1. 验证激活码
      const licenseRow = await this.queryLicenseFromSupabase(licenseCode);
      if (!licenseRow) return { error: '激活码无效：未在数据库中查到 [' + licenseCode + ']。请检查是否输入正确，或联系管理员获取有效激活码。' };
      if (licenseRow.used) return { error: '此激活码已被其他用户使用' };

      // 2. 注册账号
      const res = await fetchWithTimeout(
        this.authUrl('/signup'),
        { method: 'POST', headers: this.authHeaders(), body: JSON.stringify({ email, password }) },
        10000
      );

      const data = await res.json();
      if (!res.ok) {
        const msg = data.msg || data.message || '';
        const code = data.code || '';
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('unique')) return { error: '该邮箱已注册，请切换到登录页面直接登录' };
        if (code === 429 || msg.includes('rate limit')) return { error: '服务器繁忙（邮件发送限流），请稍后再试' };
        if (msg.includes('password')) return { error: '密码不符合要求（至少6位）' };
        return { error: '注册失败 [' + code + ']：' + (msg || '未知错误') };
      }

      const userId = data.user?.id || data.id;
      if (!userId) return { error: '注册失败：服务器返回异常，请稍后重试' };

      // 3. 认领激活码
      const claimed = await this.claimLicenseOnSupabase(licenseCode, userId);
      if (!claimed) {
        const retry = await this.queryLicenseFromSupabase(licenseCode);
        if (retry && retry.used && retry.device_id !== userId) return { error: '此激活码已被其他人抢先激活' };
        return { error: '激活失败，请稍后重试' };
      }

      // 如果 Supabase 关闭了邮箱确认，直接登录
      if (data.access_token) {
        setStoredAuth({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: data.user,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000
        });
        setLicense(licenseCode);
        setOfflineUsedCode(licenseCode, userId);
        this.#eventBus?.emit('auth:changed', { state: 'online', user: data.user });
        return { success: true, autoLogin: true };
      }

      clearLicense();
      return { success: true, needEmailConfirm: true };
    } catch (err) {
      if (err.message === '连接超时') return { error: '连接超时（>10秒），请刷新重试' };
      if (err.message?.includes('Failed to fetch')) return { error: '无法连接到服务器，请检查是否需要代理/VPN' };
      return { error: '网络错误：' + (err.message || '未知') };
    }
  }

  // ===== Logout =====

  async logout() {
    const session = getStoredAuth();
    clearStoredAuth();
    clearLicense();
    clearSessionSecrets();
    this.#eventBus?.emit('auth:changed', { state: 'logged-out' });
    if (session && session.access_token) {
      void fetchWithTimeout(
        this.authUrl('/logout'),
        { method: 'POST', headers: this.authHeaders(session.access_token) },
        4000
      ).catch(() => {});
    }
  }

  // ===== License-code activation =====

  isValidOfflineCode(code) {
    return /^[A-Z0-9][A-Z0-9-]{7,63}$/.test(String(code || '').trim().toUpperCase());
  }

  async activateOffline(code) {
    const deviceId = getDeviceId();
    const usedCodes = getOfflineUsedCodes();

    if (usedCodes[code] && usedCodes[code] !== deviceId) {
      return { error: '此激活码已在本设备使用过' };
    }

    // 激活码必须由服务端确认。静态前端内置“万能码”无法形成有效的商业授权。
    try {
      const row = await this.queryLicenseFromSupabase(code);
      if (!row) return { error: '激活码不存在或已失效' };
      if (row.used && row.device_id !== deviceId) {
        return { error: '此激活码已被其他设备激活' };
      }
      if (!row.used) {
        const claimed = await this.claimLicenseOnSupabase(code, deviceId);
        if (!claimed) return { error: '激活码绑定失败，请稍后重试' };
      }
    } catch (error) {
      return { error: `无法连接授权服务器：${error.message || '网络错误'}` };
    }

    setOfflineUsedCode(code, deviceId);
    setLicense(code);
    this.#eventBus?.emit('auth:changed', { state: 'activated' });
    return { success: true };
  }

  // ===== Trial Mode =====

  enterTrial() {
    setLicense('trial');
    this.#eventBus?.emit('auth:changed', { state: 'trial' });
  }

  isTrial() {
    return getLicense() === 'trial';
  }

  // ===== Boot Check =====

  async checkAuth() {
    // 免费试用（演示沙盒）
    if (this.isTrial()) {
      this.#eventBus?.emit('auth:changed', { state: 'trial' });
      return { authenticated: true, mode: 'trial' };
    }

    const lic = getLicense();
    const hasSession = !!getStoredAuth();

    // 激活码模式：每次启动由授权服务器确认，防止仅修改 localStorage 绕过授权。
    if (lic && !hasSession) {
      try {
        const row = await this.queryLicenseFromSupabase(lic);
        const deviceId = getDeviceId();
        if (row && row.used && row.device_id === deviceId) {
          this.#eventBus?.emit('auth:changed', { state: 'licensed', license: lic });
          return { authenticated: true, mode: 'licensed' };
        }
        clearLicense();
        return { authenticated: false, mode: 'invalid-license' };
      } catch {
        return { authenticated: false, mode: 'license-server-unavailable' };
      }
    }

    // 在线验证
    if (hasSession) {
      const current = await this.getCurrentUser();
      if (current && current.user) {
        try {
          const row = lic
            ? await this.queryLicenseFromSupabase(lic)
            : await this.queryLicenseByUserId(current.user.id);
          if (row && row.used && row.device_id === current.user.id) {
            if (row.code) setLicense(row.code);
            this.#eventBus?.emit('auth:changed', { state: 'online', user: current.user });
            return { authenticated: true, mode: 'online', user: current.user };
          }
          clearLicense();
          return { authenticated: false, mode: 'need-license', user: current.user };
        } catch {
          return { authenticated: false, mode: 'license-server-unavailable', user: current.user };
        }
      }
      clearStoredAuth();
    }

    this.#eventBus?.emit('auth:changed', { state: 'unauthenticated' });
    return { authenticated: false, mode: 'unauthenticated' };
  }

  // ===== After-login license binding =====

  async bindLicense(userId, code) {
    try {
      const licenseRow = await this.queryLicenseFromSupabase(code);
      if (!licenseRow) return { error: '激活码无效' };
      if (licenseRow.used && licenseRow.device_id !== userId) return { error: '此激活码已被其他用户使用' };

      if (!licenseRow.used) {
        const claimed = await this.claimLicenseOnSupabase(code, userId);
        if (!claimed) return { error: '激活失败，请稍后重试' };
      }

      setLicense(code);
      this.#eventBus?.emit('auth:changed', { state: 'license-bound', code });
      return { success: true };
    } catch {
      return { error: '网络错误，请重试' };
    }
  }
}
