'use strict';

// ===== 反爬保护 =====
(function(){
  // 1. 禁用右键
  document.addEventListener('contextmenu',e=>e.preventDefault());
  // 2. 禁用拖拽
  document.addEventListener('dragstart',e=>e.preventDefault());
  // 3. 封锁快捷键
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&['s','S','u','U','p','P'].includes(e.key)){e.preventDefault();return false}
    if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&['I','i','C','c','J','j'].includes(e.key))){e.preventDefault();return false}
  });
  // 4. DevTools 检测
  let detections=0, warned=false;
  function showWarning(){
    if(warned) return; warned=true;
    document.body.style.filter='blur(6px)';
    document.body.style.pointerEvents='none';
    const ov=document.createElement('div');
    ov.id='secOv'; ov.innerHTML='<div style="position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;flex-direction:column;font-family:system-ui,sans-serif"><h1 style="font-size:28px;color:#ef4444">&#x26A0;&#xFE0F; 安全警告</h1><p style="font-size:17px;color:#e2e8f0;margin-top:12px">检测到开发者工具已打开</p><p style="font-size:14px;color:#94a3b8;margin-top:4px">请关闭开发者工具后刷新页面继续使用</p></div>';
    document.body.appendChild(ov);
    // 持续清理控制台
    setInterval(()=>{console.clear();console.log('%c关闭开发者工具后刷新页面','color:red;font-size:20px')},500);
  }
  // 方法 A: debugger 定时陷阱（DevTools 开着时 debugger 会暂停，耗时明显增加）
  let debugTimer=setInterval(()=>{
    const t=performance.now();
    debugger;
    if(performance.now()-t>50) detections++;
    if(detections>=2) showWarning();
  },12000);
  // 方法 B: 窗口尺寸差检测
  let resizeTimer=setInterval(()=>{
    const d=(window.outerWidth-window.innerWidth)+(window.outerHeight-window.innerHeight);
    if(d>180) detections++;
    if(detections>=2) showWarning();
  },10000);
})();
// ======================

const KEY='meta_screener_pro_v1';
const SETTINGS_KEY='meta_screener_pro_v1_settings';
const LICENSE_KEY='meta_screener_pro_license';
const DEVICE_KEY='meta_screener_device_id';
const OLD_KEYS=['meta_original_study_screener_v3','meta_original_study_screener_v2'];

// ===== AOP Builder constants =====
const AOP_KEY='meta_screener_aops_v1';
const AOP_NODE_TYPES={
  stressor:{label:'Stressor',w:200,h:80,color:'#f59e0b',cls:'stressor'},
  mie:{label:'MIE',w:200,h:80,color:'#ef4444',cls:'mie'},
  ke:{label:'KE',w:200,h:80,color:'#3b82f6',cls:'ke'},
  ao:{label:'AO',w:200,h:80,color:'#22c55e',cls:'ao'}
};
const AOP_WIKI_API='https://aopwiki-api.cloud.vhp4safety.nl';

// Supabase config
const SUPABASE_HOST='jzzxkjwvwlwzmdymwjah.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6enhrand2d2x3em1keW13amFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMzE4OTUsImV4cCI6MjA5NjcwNzg5NX0.iQJO8p1n2p_mhrdC1GJpXHGE0WSExwIw6CcvhSHBJSk';

// ===== 中继代理配置 =====
// 部署阿里云函数后，将下面的地址替换为你的函数 URL
// 留空则直连 Supabase（需梯子）
const PROXY_URL='';  // 例如: 'https://123456.apigw.aliyuncs.com/my-proxy'
// =========================

// 实际使用的 Supabase 基础 URL
function supabaseBase(){
  return PROXY_URL||('https://'+SUPABASE_HOST);
}
// auth 接口走 GoTrue（/auth/v1），rest 接口走 PostgREST（/rest/v1）
function authUrl(path){return supabaseBase()+'/auth/v1'+path}
function restUrl(path){return supabaseBase()+'/rest/v1'+path}

const SOURCE_META={
  pubmed:{label:'PubMed',className:'src-pubmed',capability:'direct'},
  europepmc:{label:'Europe PMC',className:'src-europepmc',capability:'direct'},
  crossref:{label:'Crossref',className:'src-crossref',capability:'direct'},
  openalex:{label:'OpenAlex',className:'src-openalex',capability:'direct'},
  cnki:{label:'CNKI',className:'src-cnki',capability:'assisted',searchUrl:'https://kns.cnki.net/kns8s/search'},
  wanfang:{label:'万方',className:'src-wanfang',capability:'assisted',searchUrl:'https://www.wanfangdata.com.cn/'},
  vip:{label:'维普',className:'src-vip',capability:'assisted',searchUrl:'https://qikan.cqvip.com/Qikan/Search/Index'},
  cbm:{label:'SinoMed/CBM',className:'src-cbm',capability:'assisted',searchUrl:'https://www.sinomed.ac.cn/'},
  embase:{label:'Embase',className:'src-embase',capability:'manual'},
  wos:{label:'Web of Science',className:'src-wos',capability:'manual'},
  scopus:{label:'Scopus',className:'src-scopus',capability:'manual'},
  cochrane:{label:'Cochrane Library',className:'src-cochrane',capability:'manual'},
  'google-scholar':{label:'Google Scholar',className:'src-google-scholar',capability:'manual'},
  other:{label:'其他',className:'src-other',capability:'manual'},
  unknown:{label:'未知来源',className:'src-unknown',capability:'manual'}
};

let rec=[];
let scoreTimer=null;
let filterTimer=null;
let fetchAbort=false;
let prismaDirty=true;
const PAGE_SIZE=100;

const $=id=>document.getElementById(id);

// AOP global state
let activeTab='tabScreening';
let aopList=[];
let aopCurrentIdx=-1;
let aopZoom=0.7;
let aopPanX=20;
let aopPanY=20;
let aopEdgeMode=false;
let aopEdgeSourceId=null;
let aopSelectedNodeId=null;
let aopDragState=null;
let aopPanState=null;
let aopContextNodeId=null;
let aopSaveTimer=null;
let aopCache=null;      // cached AOP list from API
let aopCacheTime=0;     // timestamp when cache was populated

function getDeviceId(){
  let id=localStorage[DEVICE_KEY];
  if(!id){id=crypto.randomUUID();localStorage[DEVICE_KEY]=id}
  return id;
}

// === Auth: Supabase GoTrue REST API（无需外部 SDK） ===
// Session 存储在 localStorage 中
const AUTH_SESSION_KEY='meta_screener_auth_session';

function saveAuthSession(session){
  if(session) localStorage[AUTH_SESSION_KEY]=JSON.stringify(session);
  else localStorage.removeItem(AUTH_SESSION_KEY);
}
function getAuthSession(){
  try{return JSON.parse(localStorage[AUTH_SESSION_KEY]||'null')}catch{return null}
}

// GoTrue API 请求头
function authHeaders(token){
  const h={
    'apikey':SUPABASE_KEY,
    'Content-Type':'application/json'
  };
  if(token) h['Authorization']='Bearer '+token;
  return h;
}

// 刷新 access token
async function refreshSession(){
  const session=getAuthSession();
  if(!session||!session.refresh_token) return null;
  try{
    const res=await fetch(authUrl('/token?grant_type=refresh_token'),{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({refresh_token:session.refresh_token})
    });
    if(!res.ok) return null;
    const data=await res.json();
    const newSession={access_token:data.access_token,refresh_token:data.refresh_token,user:data.user,expires_at:Date.now()+(data.expires_in||3600)*1000};
    saveAuthSession(newSession);
    return newSession;
  }catch{return null}
}

// 获取当前用户（自动刷新 token）
async function getCurrentUser(){
  let session=getAuthSession();
  if(!session||!session.access_token) return null;
  // 如果 token 即将过期，先刷新
  if(session.expires_at&&Date.now()>session.expires_at-60*1000){
    session=await refreshSession();
    if(!session) return null;
  }
  try{
    const res=await fetch(authUrl('/user'),{headers:authHeaders(session.access_token)});
    if(!res.ok){
      // Token 过期，尝试刷新后重试
      session=await refreshSession();
      if(!session) return null;
      const retry=await fetch(authUrl('/user'),{headers:authHeaders(session.access_token)});
      if(!retry.ok) return null;
      const user=await retry.json();
      return {user,session};
    }
    const user=await res.json();
    return {user,session};
  }catch{return null}
}

async function checkAuth(){
  // 试用模式
  if(isTrial()){
    $('authOverlay').style.display='none';
    $('mainApp').style.display='';
    $('aboutLicense').textContent='当前：试用模式（每次获取限 15 条）';
    return true;
  }

  const lic=localStorage[LICENSE_KEY];
  const hasSession=!!getAuthSession();

  // 离线激活：有本地 license 但无 Supabase 会话 → 秒进，不联网
  if(lic&&!hasSession){
    $('authOverlay').style.display='none';
    $('mainApp').style.display='';
    $('aboutLicense').textContent='已激活：'+lic;
    return true;
  }

  // 在线模式：有 Supabase 会话时验证
  if(hasSession){
    const current=await getCurrentUser();
    if(current&&current.user){
      const user=current.user;
      if(lic){
        verifyLicenseInBackground(lic, user.id);
        $('authOverlay').style.display='none';
        $('mainApp').style.display='';
        $('aboutLicense').textContent='已登录：'+user.email;
        return true;
      }else{
        showLicenseBinding(user);
        return false;
      }
    }
    // 会话过期 → 清除
    saveAuthSession(null);
  }

  // 无会话 → 显示激活界面
  $('authOverlay').style.display='';
  $('mainApp').style.display='none';
  setTimeout(()=>{ if(document.activeElement) document.activeElement.blur(); },50);
  return false;
}

function fetchWithTimeout(url,opts,timeoutMs=8000){
  return new Promise((resolve,reject)=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{controller.abort();reject(new Error('连接超时'))},timeoutMs);
    fetch(url,{...opts,signal:controller.signal}).then(r=>{clearTimeout(timer);resolve(r)}).catch(e=>{clearTimeout(timer);reject(e)});
  });
}

const SUPABASE_HEADERS={
  'apikey':SUPABASE_KEY,
  'Authorization':'Bearer '+SUPABASE_KEY,
  'Content-Type':'application/json',
  'Prefer':'return=representation'
};

// 查询激活码
async function queryLicenseFromSupabase(code){
  const res=await fetchWithTimeout(
    restUrl('/licenses?code=eq.')+encodeURIComponent(code)+'&order=activated_at.desc&limit=1',
    {headers:SUPABASE_HEADERS},5000
  );
  if(!res.ok) throw new Error('服务器错误');
  const rows=await res.json();
  return rows.length?rows[0]:null;
}

// 原子认领：PATCH 仅在 used=false 时生效
async function claimLicenseOnSupabase(code,userId){
  const res=await fetchWithTimeout(
    restUrl('/licenses?code=eq.')+encodeURIComponent(code)+'&used=is.false',
    {method:'PATCH',headers:SUPABASE_HEADERS,body:JSON.stringify({used:true,device_id:userId,activated_at:new Date().toISOString()})},5000
  );
  if(!res.ok) return false;
  const updated=await res.json();
  return Array.isArray(updated)&&updated.length>0;
}

// 首次注册激活码
async function registerLicenseOnSupabase(code,userId){
  const res=await fetchWithTimeout(
    restUrl('/licenses'),
    {method:'POST',headers:SUPABASE_HEADERS,body:JSON.stringify({code,used:true,device_id:userId,activated_at:new Date().toISOString()})},5000
  );
  return res.ok;
}

// 查询用户绑定的激活码
async function queryLicenseByUserId(userId){
  const res=await fetchWithTimeout(
    restUrl('/licenses?device_id=eq.')+encodeURIComponent(userId)+'&order=activated_at.desc&limit=1',
    {headers:SUPABASE_HEADERS},5000
  );
  if(!res.ok) return null;
  const rows=await res.json();
  return rows.length?rows[0]:null;
}
// === 登录（GoTrue REST API） ===
async function handleLogin(e){
  e.preventDefault();
  const email=$('loginEmail').value.trim();
  const password=$('loginPassword').value;
  if(!email||!password){$('loginError').textContent='请填写邮箱和密码';return false}

  const btn=$('loginBtn');
  btn.disabled=true;btn.textContent='登录中…';
  $('loginError').textContent='';

  try{
    // GoTrue password grant
    const res=await fetchWithTimeout(authUrl('/token?grant_type=password'),{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({email,password})
    },10000);

    const data=await res.json();
    if(!res.ok){
      const msg=data.error_description||data.msg||data.message||'';
      const code=data.code||'';
      if(msg.includes('Invalid login')||msg.includes('invalid')) $('loginError').textContent='邮箱或密码错误';
      else if(msg.includes('Email not confirmed')) $('loginError').textContent='邮箱未验证，请检查收件箱（含垃圾邮件）点击确认链接';
      else if(code===429||msg.includes('rate limit')) $('loginError').textContent='服务器繁忙，请稍后再试';
      else $('loginError').textContent='登录失败 ['+code+']：'+(msg||'未知错误');
      btn.disabled=false;btn.textContent='登录';return false;
    }

    // 保存会话
    const session={
      access_token:data.access_token,
      refresh_token:data.refresh_token,
      user:data.user,
      expires_at:Date.now()+(data.expires_in||3600)*1000
    };
    saveAuthSession(session);

    // 检查是否有绑定的激活码
    const licRow=await queryLicenseByUserId(data.user.id);
    if(licRow){
      localStorage[LICENSE_KEY]=licRow.code;
    }
    if(!localStorage[LICENSE_KEY]){
      showLicenseBinding(data.user);
      btn.disabled=false;btn.textContent='登录';
      return false;
    }

    checkAuth();initApp();
  }catch(err){
    if(err.message==='连接超时'){
      $('loginError').textContent='连接超时（>10秒），请检查网络或刷新重试';
    }else if(err.message&&err.message.includes('Failed to fetch')){
      $('loginError').textContent='无法连接到服务器，请检查是否需要代理/VPN';
    }else{
      $('loginError').textContent='网络错误：'+(err.message||'未知');
    }
  }
  btn.disabled=false;btn.textContent='登录';
  return false;
}

// === 注册（GoTrue REST API） ===
async function handleRegister(e){
  e.preventDefault();
  const email=$('regEmail').value.trim();
  const password=$('regPassword').value;
  const passwordConfirm=$('regPasswordConfirm').value;
  const licenseCode=$('regLicense').value.trim().toUpperCase();

  if(!email||!password||!licenseCode){$('registerError').textContent='请填写所有字段';return false}
  if(password!==passwordConfirm){$('registerError').textContent='两次密码输入不一致';return false}
  if(password.length<6){$('registerError').textContent='密码至少需要6位';return false}

  const btn=$('registerBtn');
  btn.disabled=true;btn.textContent='注册中…';
  $('registerError').textContent='';

  try{
    // 第一步：验证激活码
    $('registerError').textContent='正在验证激活码…';
    const licenseRow=await queryLicenseFromSupabase(licenseCode);
    if(!licenseRow){
      $('registerError').textContent='激活码无效：未在数据库中查到 ['+licenseCode+']。请检查是否输入正确，或联系管理员获取有效激活码。';
      btn.disabled=false;btn.textContent='注册';return false;
    }
    if(licenseRow.used){
      $('registerError').textContent='此激活码已被其他用户使用';
      btn.disabled=false;btn.textContent='注册';return false;
    }

    // 第二步：注册账号
    $('registerError').textContent='正在注册账号…';
    const res=await fetchWithTimeout(authUrl('/signup'),{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({email,password})
    },10000);

    const data=await res.json();
    if(!res.ok){
      const msg=data.msg||data.message||'';
      const code=data.code||'';
      if(msg.includes('already registered')||msg.includes('already exists')||msg.includes('unique')) $('registerError').textContent='该邮箱已注册，请切换到登录页面直接登录';
      else if(code===429||msg.includes('rate limit')) $('registerError').textContent='服务器繁忙（邮件发送限流），请稍后再试';
      else if(msg.includes('password')) $('registerError').textContent='密码不符合要求（至少6位）';
      else $('registerError').textContent='注册失败 ['+code+']：'+ (msg||'未知错误');
      btn.disabled=false;btn.textContent='注册';return false;
    }

    // GoTrue 返回格式：关闭邮箱确认时有 data.user.id，开启时直接 data.id
    const userId=data.user?.id||data.id;
    if(!userId){
      $('registerError').textContent='注册失败：服务器返回异常，请稍后重试';
      btn.disabled=false;btn.textContent='注册';return false;
    }

    // 第三步：认领激活码
    const claimed=await claimLicenseOnSupabase(licenseCode,userId);
    if(!claimed){
      const retry=await queryLicenseFromSupabase(licenseCode);
      if(retry&&retry.used&&retry.device_id!==userId){
        $('registerError').textContent='此激活码已被其他人抢先激活';
      }else{
        $('registerError').textContent='激活失败，请稍后重试';
      }
      btn.disabled=false;btn.textContent='注册';return false;
    }

    localStorage[LICENSE_KEY]=licenseCode;
    const usedCodes=JSON.parse(localStorage.getItem('meta_offline_used')||'{}');
    usedCodes[licenseCode]=userId;
    localStorage.setItem('meta_offline_used',JSON.stringify(usedCodes));

    // 如果 Supabase 关闭了邮箱确认，data.session 存在则直接登录
    if(data.access_token){
      saveAuthSession({
        access_token:data.access_token,
        refresh_token:data.refresh_token,
        user:data.user,
        expires_at:Date.now()+(data.expires_in||3600)*1000
      });
      checkAuth();initApp();
    }else{
      alert('注册成功！请检查邮箱（含垃圾邮件）点击确认链接后，再返回此页面登录。');
      switchAuthTab('login');
    }
  }catch(err){
    if(err.message==='连接超时'){
      $('registerError').textContent='连接超时（>10秒），请刷新重试';
    }else if(err.message&&err.message.includes('Failed to fetch')){
      $('registerError').textContent='无法连接到服务器，请检查是否需要代理/VPN';
    }else{
      $('registerError').textContent='网络错误：'+(err.message||'未知');
    }
  }
  btn.disabled=false;btn.textContent='注册';
  return false;
}

// === 登录后绑定激活码 ===
function showLicenseBinding(user){
  $('authOverlay').style.display='';
  $('mainApp').style.display='none';
  // 切换登录表单为绑定激活码模式
  $('loginForm').style.display='none';
  $('registerForm').style.display='none';
  $('tabLoginBtn').style.display='none';
  $('tabRegisterBtn').style.display='none';
  $('authOverlay').querySelector('h2').textContent='绑定激活码';
  $('authOverlay').querySelector('.auth-desc')&&($('authOverlay').querySelector('.auth-desc').textContent='您已登录 '+user.email+'，请输入激活码完成绑定');

  // 动态创建绑定界面（如果还不存在）
  let bindDiv=$('licenseBindDiv');
  if(!bindDiv){
    bindDiv=document.createElement('div');
    bindDiv.id='licenseBindDiv';
    bindDiv.innerHTML=`
      <div class="auth-input-wrap"><input type="text" id="bindLicenseInput" placeholder="请输入激活码"></div>
      <div id="bindLicenseError" class="auth-error"></div>
      <div class="auth-form-actions">
        <button class="auth-btn-primary" onclick="handleBindLicense()">绑定激活码</button>
      </div>
    `;
    $('authOverlay').querySelector('.auth-box').insertBefore(bindDiv, $('authOverlay').querySelector('.auth-trial-link'));
  }
  bindDiv.style.display='';
  setTimeout(()=>{ if(document.activeElement) document.activeElement.blur(); },50);
}

async function handleBindLicense(){
  const code=($('bindLicenseInput')||{}).value;
  if(!code||!code.trim()){$('bindLicenseError').textContent='请输入激活码';return}
  const licenseCode=code.trim().toUpperCase();

  const current=await getCurrentUser();
  if(!current||!current.user){$('bindLicenseError').textContent='登录已过期，请重新登录';return}

  const userId=current.user.id;

  try{
    const licenseRow=await queryLicenseFromSupabase(licenseCode);
    if(!licenseRow){$('bindLicenseError').textContent='激活码无效';return}
    if(licenseRow.used&&licenseRow.device_id!==userId){$('bindLicenseError').textContent='此激活码已被其他用户使用';return}

    if(!licenseRow.used){
      const claimed=await claimLicenseOnSupabase(licenseCode,userId);
      if(!claimed){$('bindLicenseError').textContent='激活失败，请稍后重试';return}
    }

    localStorage[LICENSE_KEY]=licenseCode;
    await checkAuth();initApp();
  }catch(err){
    $('bindLicenseError').textContent='网络错误，请重试';
  }
}

// === 后台验证 ===
async function verifyLicenseInBackground(code,userId){
  try{
    const row=await queryLicenseFromSupabase(code);
    if(!row) return;
    if(row.used&&row.device_id&&row.device_id!==userId){
      localStorage.removeItem(LICENSE_KEY);
      alert('您的激活码已被绑定到其他账号，当前设备已锁定。\n如需帮助，请联系管理员。');
      location.reload();
    }
  }catch(e){/* 网络错误静默跳过 */}
}

// === 退出登录 ===
async function handleLogout(){
  const session=getAuthSession();
  if(session&&session.access_token){
    try{
      await fetch(authUrl('/logout'),{
        method:'POST',
        headers:authHeaders(session.access_token)
      });
    }catch(e){/* 静默 */}
  }
  saveAuthSession(null);
  localStorage.removeItem(LICENSE_KEY);
  $('authOverlay').style.display='';
  $('mainApp').style.display='none';
  const bindDiv=$('licenseBindDiv');if(bindDiv) bindDiv.style.display='none';
  $('loginForm').style.display='';
  $('registerForm').style.display='none';
  $('tabLoginBtn').style.display='';
  $('tabRegisterBtn').style.display='';
  $('tabLoginBtn').classList.add('active');
  $('tabRegisterBtn').classList.remove('active');
  $('authOverlay').querySelector('h2').textContent='Meta分析文献筛选器 Pro';
}

// === 试用模式 ===
function enterTrial(){
  localStorage[LICENSE_KEY]='trial';
  checkAuth();
  initApp();
}
function isTrial(){return localStorage[LICENSE_KEY]==='trial'}

// === 主激活流程（离线优先，无网也能用）===
// 管理员可扩充此列表，将新码发给用户
const OFFLINE_CODES=['META-PRO-2024-FULL','META-PRO-2025-FULL','MAS-2024-TEST01','META-OFFLINE-001'];

function isValidOfflineCode(code){
  if(OFFLINE_CODES.includes(code)) return true;
  if(code.startsWith('MAS-')||code.startsWith('META-')) return true;
  return false;
}

async function activateLicense(){
  const code=($('licenseInput')?.value||'').trim().toUpperCase();
  if(!code){$('activateError').textContent='请输入激活码';return}
  $('activateError').textContent='';

  // 本地验证
  if(!isValidOfflineCode(code)){
    $('activateError').textContent='无效的激活码，请检查后重试';
    return;
  }

  // 检查同浏览器是否已使用
  const deviceId=getDeviceId();
  const usedCodes=JSON.parse(localStorage.getItem('meta_offline_used')||'{}');
  if(usedCodes[code]&&usedCodes[code]!==deviceId){
    $('activateError').textContent='此激活码已在本设备使用过';
    return;
  }

  // 后台尝试 Supabase 同步（有网则互斥，无网静默跳过）
  try{
    const row=await queryLicenseFromSupabase(code);
    if(row){
      if(row.used&&row.device_id!==deviceId){
        $('activateError').textContent='此激活码已被其他用户在线激活';
        return;
      }
      if(!row.used){
        await claimLicenseOnSupabase(code,deviceId);
      }
    }
  }catch(e){/* 网络不通，走纯离线 */}

  // 激活成功
  usedCodes[code]=deviceId;
  localStorage.setItem('meta_offline_used',JSON.stringify(usedCodes));
  localStorage[LICENSE_KEY]=code;
  checkAuth();initApp();
}

// === 离线激活面板（收折） ===
function toggleOfflineActivation(){
  const box=$('offlineActivationBox');
  box.style.display=box.style.display==='none'?'':'none';
  $('activateError').textContent='';
}
function switchAuthTab(tab){
  const isLogin=tab==='login';
  $('loginForm').style.display=isLogin?'':'none';
  $('registerForm').style.display=isLogin?'none':'';
  $('tabLoginBtn').classList.toggle('active',isLogin);
  $('tabRegisterBtn').classList.toggle('active',!isLogin);
  $('loginError').textContent='';
  $('registerError').textContent='';
}
function getMaxFetch(){
  if(isTrial()) return 15;
  const v=+$('max').value;
  return v<=0?0:v;
}

// === Overlays ===
function showLicenseManager(){
  // 已激活用户无需操作
  $('activateError').textContent='';
  alert('当前已激活，无需重新输入。如需更改，请先退出登录。');
}
function showHelp(){$('helpOverlay').style.display=''}
function hideHelp(){$('helpOverlay').style.display='none'}
function showAbout(){$('aboutOverlay').style.display=''}
function hideAbout(){$('aboutOverlay').style.display='none'}
function showManual(){$('manualOverlay').style.display=''}
function hideManual(){$('manualOverlay').style.display='none'}

// === Utilities ===
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function escAttr(s){return String(s||'').replace(/'/g,'&#39;')}
function stripTags(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function escapeRegExp(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function normDoi(doi){return String(doi||'').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i,'').replace(/^doi:/i,'').trim().toLowerCase()}
function normTitle(title){return String(title||'').toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim()}
function normText(s){return String(s||'').toLowerCase().replace(/[‐-―]/g,'-').replace(/\s+/g,' ').trim()}
function extractYear(v){const m=String(v||'').match(/(19|20)\d{2}/);return m?m[0]:String(v||'').slice(0,4)}
function dl(n,t,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type}));a.download=n;a.click()}

function sourceInfo(src){return SOURCE_META[src]||SOURCE_META.unknown}
function sourceLabelFor(src){return sourceInfo(src).label}
function sourceBadge(src,label){const m=sourceInfo(src);return `<span class="src-badge ${m.className}">${esc(label||m.label)}</span>`}

// === Record normalization ===
function defaultSourceForRecord(r){
  if(r.source) return r.source;
  if(r.pmid) return 'pubmed';
  return 'unknown';
}
function normalizeSourceEntry(entry){
  if(!entry) return null;
  if(typeof entry==='string') return {source:entry,sourceLabel:sourceLabelFor(entry),sourceId:'',sourceUrl:''};
  const source=entry.source||'unknown';
  return {source,sourceLabel:entry.sourceLabel||sourceLabelFor(source),sourceId:entry.sourceId||'',sourceUrl:entry.sourceUrl||''};
}
function mergeSourceEntries(entries){
  const map=new Map();
  (entries||[]).forEach(entry=>{
    const item=normalizeSourceEntry(entry);
    if(!item) return;
    const key=`${item.source}::${item.sourceId||item.sourceUrl||''}`;
    if(!map.has(key)) map.set(key,item);
  });
  return [...map.values()];
}
function makeDedupeKey(r){
  if(r.pmid) return `pmid:${String(r.pmid).trim()}`;
  if(r.doi) return `doi:${normDoi(r.doi)}`;
  const title=normTitle(r.title);
  if(title&&r.year) return `titleyear:${title}:${r.year}`;
  if(title) return `title:${title}`;
  return `source:${r.source||'unknown'}:${r.sourceId||Math.random().toString(36).slice(2,8)}`;
}
function normalizeRecord(r){
  const source=defaultSourceForRecord(r||{});
  const sourceId=r?.sourceId||r?.pmid||r?.doi||'';
  const sourceUrl=r?.sourceUrl||((r?.pmid)?`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`:'');
  let sources=Array.isArray(r?.sources)&&r.sources.length?r.sources.map(normalizeSourceEntry).filter(Boolean):[{source,sourceLabel:r?.sourceLabel||sourceLabelFor(source),sourceId,sourceUrl}];
  const normalized={
    id:r?.id||'',source,sourceLabel:r?.sourceLabel||sourceLabelFor(source),sourceId,sourceUrl,sources:mergeSourceEntries(sources),
    pmid:r?.pmid||'',doi:normDoi(r?.doi||''),title:r?.title||'',year:String(r?.year||'').trim(),journal:r?.journal||'',authors:r?.authors||'',abstract:r?.abstract||'',
    publicationTypes:Array.isArray(r?.publicationTypes)?r.publicationTypes.filter(Boolean):[],
    language:r?.language||'',recordType:r?.recordType||'',queryUsed:r?.queryUsed||'',
    fetchedAt:r?.fetchedAt||'',importMethod:r?.importMethod||'api',importBatch:r?.importBatch||'',
    score:Number(r?.score||0),decision:r?.decision||'待人工判断',hits:r?.hits||'',reason:r?.reason||'',
    studyType:r?.studyType||'unclear',humanScore:Number(r?.humanScore||0),animalScore:Number(r?.animalScore||0),
    scoreDetails:Array.isArray(r?.scoreDetails)?r.scoreDetails:[],manual:Boolean(r?.manual),
    manualNote:r?.manualNote||'',mergedCount:Number(r?.mergedCount||1),dedupeKey:r?.dedupeKey||'',
    createdAt:r?.createdAt||new Date().toISOString()
  };
  normalized.dedupeKey=makeDedupeKey(normalized);
  normalized.id=normalized.id||normalized.dedupeKey||`record-${Math.random().toString(36).slice(2,10)}`;
  return normalized;
}
// === Dedup & merge ===
function sameTitleYear(a,b){return normTitle(a.title)&&normTitle(a.title)===normTitle(b.title)&&String(a.year||'')===String(b.year||'')}
function findDuplicateIndex(item){
  return rec.findIndex(existing=>{
    if(item.pmid&&existing.pmid&&String(item.pmid)===String(existing.pmid)) return true;
    if(item.doi&&existing.doi&&normDoi(item.doi)===normDoi(existing.doi)) return true;
    if(sameTitleYear(item,existing)) return true;
    const at=normTitle(item.title),bt=normTitle(existing.title);
    if(at&&bt&&at===bt) return true;
    return false;
  });
}
function preferLonger(a,b){return String(b||'').length>String(a||'').length?b:a}
function mergeRecord(existing,incoming){
  existing.sources=mergeSourceEntries([...(existing.sources||[]),...(incoming.sources||[]),{source:incoming.source,sourceLabel:incoming.sourceLabel,sourceId:incoming.sourceId,sourceUrl:incoming.sourceUrl}]);
  existing.pmid=existing.pmid||incoming.pmid;
  existing.doi=existing.doi||incoming.doi;
  existing.title=preferLonger(existing.title,incoming.title);
  existing.abstract=preferLonger(existing.abstract,incoming.abstract);
  existing.journal=existing.journal||incoming.journal;
  existing.authors=preferLonger(existing.authors,incoming.authors);
  existing.year=existing.year||incoming.year;
  existing.publicationTypes=[...new Set([...(existing.publicationTypes||[]),...(incoming.publicationTypes||[])].filter(Boolean))];
  existing.source=existing.source||incoming.source;
  existing.sourceLabel=existing.sourceLabel||incoming.sourceLabel;
  existing.sourceId=existing.sourceId||incoming.sourceId;
  existing.sourceUrl=existing.sourceUrl||incoming.sourceUrl;
  existing.importMethod=existing.importMethod||incoming.importMethod;
  existing.fetchedAt=existing.fetchedAt||incoming.fetchedAt;
  existing.mergedCount=(Number(existing.mergedCount)||1)+(Number(incoming.mergedCount)||1);
  existing.dedupeKey=makeDedupeKey(existing);
  return existing;
}
function addRecords(records){
  let added=0,merged=0;
  for(const raw of records){
    const item=normalizeRecord(raw);
    const idx=findDuplicateIndex(item);
    if(idx>=0){mergeRecord(rec[idx],item);merged++}else{rec.push(item);added++}
  }
  prismaDirty=true;
  return {added,merged,total:records.length};
}
function addRecordsAndScore(records){
  const result=addRecords(records);
  screenAll();
  return result;
}

// === Persistence ===
function loadRecords(){
  let raw=localStorage[KEY];
  if(!raw){for(const k of OLD_KEYS){if(localStorage[k]){raw=localStorage[k];break}}}
  let parsed=[];
  try{parsed=JSON.parse(raw||'[]')}catch{parsed=[]}
  if(!Array.isArray(parsed)) parsed=parsed.records||[];
  return parsed.map(normalizeRecord);
}
let saveTimer=null;
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{localStorage[KEY]=JSON.stringify(rec)},800);
}
function saveNow(){clearTimeout(saveTimer);localStorage[KEY]=JSON.stringify(rec)}
function saveSettings(){
  const ids=['mode','studyMode','pop','animalTerms','expo','outcome','design','yf','yt','max','sort','incWords','excWords','incCut','excCut','manualSource','advTitleMul','advSynergy','advExcPenalty','advPubTypeExc','advHumanPos','advAnimalPos','cnPop','cnAnimal','cnExpo'];
  const settings={};
  ids.forEach(id=>settings[id]=$(id)?.value||'');
  settings.sources=selectedSources();
  settings.cnSources=selectedCnSources();
  localStorage[SETTINGS_KEY]=JSON.stringify(settings);
}
function loadSettings(){
  try{
    const settings=JSON.parse(localStorage[SETTINGS_KEY]||'{}');
    Object.entries(settings).forEach(([k,v])=>{
      if(k==='sources'&&Array.isArray(v)){
        document.querySelectorAll('.db-check').forEach(box=>box.checked=v.includes(box.value));
      }else if(k==='cnSources'&&Array.isArray(v)){
        document.querySelectorAll('.db-check-cn').forEach(box=>box.checked=v.includes(box.value));
      }else if($(k)&&typeof v==='string'&&v){
        $(k).value=v;
      }
    });
  }catch{}
}
function selectedSources(){return [...document.querySelectorAll('.db-check:checked')].map(x=>x.value)}
function selectedCnSources(){return [...document.querySelectorAll('.db-check-cn:checked')].map(x=>x.value)}

// === Query building ===
function L(id){return $(id).value.split(/\n+/).map(x=>x.trim()).filter(Boolean)}
function groups(id){return L(id).map(x=>x.split(/[;；,，]/).map(y=>y.trim()).filter(Boolean)).filter(x=>x.length)}
function tg(a){return '('+a.map(x=>'"'+x+'"[Title/Abstract]').join(' OR ')+')'}
function genericGroup(a){return '('+a.map(x=>'"'+x+'"').join(' OR ')+')'}

function buildQuery(){
  const mode=$('mode').value;
  const parts=[...groups('pop'),...groups('expo')];
  if($('studyMode').value==='animal') parts.push(...groups('animalTerms'));
  if(mode==='middle'||mode==='strict') parts.push(...groups('outcome'));
  if(mode==='strict') parts.push(...groups('design'));
  const pubmed=parts.filter(x=>x.length).map(tg).join(' AND ');
  const generic=parts.filter(x=>x.length).map(genericGroup).join(' AND ');
  const yf=$('yf').value.trim(),yt=$('yt').value.trim();
  const pubmedWithYear=pubmed+(yf||yt?`${pubmed?' AND ':''}("${yf||1800}"[Date - Publication] : "${yt||3000}"[Date - Publication])`:'');
  $('pubmedQuery').textContent=pubmedWithYear;
  $('genericQuery').textContent=generic;
  buildCnQueries();
  saveSettings();
  return {pubmed:pubmedWithYear,generic};
}

// === Chinese DB query generators ===
function cnGroups(cnId,fallbackId){
  const cn=groups(cnId);
  return cn.length?cn:groups(fallbackId);
}
function flattenGroups(arr){
  return [...new Set((arr||[]).flat().map(x=>String(x||'').trim()).filter(Boolean))];
}
function chineseQueryParts(){
  return {
    pops:flattenGroups(cnGroups('cnPop','pop')),
    animals:flattenGroups(cnGroups('cnAnimal','animalTerms')),
    expos:flattenGroups(cnGroups('cnExpo','expo')),
    includeAnimals:$('studyMode').value==='animal'
  };
}
function buildCNKIQuery(){
  const {pops,animals,expos,includeAnimals}=chineseQueryParts();
  const parts=[];
  if(pops.length) parts.push("SU='"+pops.join("' + '")+"'");
  if(includeAnimals&&animals.length) parts.push("SU='"+animals.join("' + '")+"'");
  if(expos.length) parts.push("SU='"+expos.join("' + '")+"'");
  return parts.join(' AND ');
}
function buildWanfangQuery(){
  const {pops,animals,expos,includeAnimals}=chineseQueryParts();
  const parts=[];
  if(pops.length) parts.push('('+pops.map(t=>`"${t}"`).join(' OR ')+')');
  if(includeAnimals&&animals.length) parts.push('('+animals.map(t=>`"${t}"`).join(' OR ')+')');
  if(expos.length) parts.push('('+expos.map(t=>`"${t}"`).join(' OR ')+')');
  return parts.join(' AND ');
}
function buildVIPQuery(){
  const {pops,animals,expos,includeAnimals}=chineseQueryParts();
  const parts=[];
  if(pops.length) parts.push('M='+pops.join(' + '));
  if(includeAnimals&&animals.length) parts.push('M='+animals.join(' + '));
  if(expos.length) parts.push('M='+expos.join(' + '));
  return parts.join(' * ');
}
function buildCBMQuery(){
  const {pops,animals,expos,includeAnimals}=chineseQueryParts();
  const parts=[];
  if(pops.length) parts.push('('+pops.map(t=>`"${t}"`).join(' OR ')+')');
  if(includeAnimals&&animals.length) parts.push('('+animals.map(t=>`"${t}"`).join(' OR ')+')');
  if(expos.length) parts.push('('+expos.map(t=>`"${t}"`).join(' OR ')+')');
  return parts.join(' AND ');
}


function buildCnQueries(){
  const chosen=selectedCnSources();
  const panel=$('cnQueryPanel');
  if(!chosen.length){panel.innerHTML='';return}
  const builders={cnki:buildCNKIQuery,wanfang:buildWanfangQuery,vip:buildVIPQuery,cbm:buildCBMQuery};
  const steps={
    cnki:'1. 打开 CNKI → 点击"专业检索"标签 → 2. 粘贴检索式 → 3. 选择时间范围 → 4. 全选结果导出 RIS/Refworks 格式 → 5. 在下方选择"CNKI"导入',
    wanfang:'1. 打开万方检索 → 2. 粘贴检索式到搜索框 → 3. 全选结果导出 RIS → 4. 在下方选择"万方"导入',
    vip:'1. 打开维普 → 点击"检索式检索" → 2. 粘贴检索式 → 3. 全选结果导出 RIS → 4. 在下方选择"维普"导入',
    cbm:'1. 打开 SinoMed → 2. 粘贴检索式到搜索框 → 3. 全选结果导出 → 4. 在下方选择"SinoMed/CBM"导入'
  };
  panel.innerHTML=chosen.map(src=>{
    const meta=SOURCE_META[src];
    const query=(builders[src]&&builders[src]())||'';
    return `<div class="cn-query-card">
      <b>${esc(meta.label)}</b>
      <div class="q" style="margin:6px 0;font-size:13px">${esc(query)}</div>
      <div class="actions">
        <button onclick="copyCnQuery('${src}')">复制检索式</button>
        <button onclick="window.open('${meta.searchUrl}','_blank')">打开${esc(meta.label)}</button>
      </div>
      <p class="note">${esc(steps[src]||'')}</p>
    </div>`;
  }).join('');
}
function copyCnQuery(src){
  const builders={cnki:buildCNKIQuery,wanfang:buildWanfangQuery,vip:buildVIPQuery,cbm:buildCBMQuery};
  const q=(builders[src]&&builders[src]())||'';
  navigator.clipboard?.writeText(q);
  $('status').textContent=`已复制 ${sourceLabelFor(src)} 检索式`;
}

// === Scoring ===
function termVariants(term){
  const t=String(term||'').toLowerCase().trim();
  if(!t) return [];
  const set=new Set([t,t.replace(/-/g,' '),t.replace(/\s+/g,'-')]);
  return [...set].filter(Boolean);
}
function matchTerm(text,term){
  const source=normText(text);
  const raw=String(term||'').trim();
  if(!raw) return false;
  return termVariants(raw).some(v=>{
    if(v.length<=2&&/^[a-z0-9]+$/i.test(v)) return new RegExp(`(^|[^a-z0-9])${escapeRegExp(v)}([^a-z0-9]|$)`,'i').test(source);
    return source.includes(v.toLowerCase());
  });
}
function matchTermInTitle(title,term){return matchTerm(title,term)}
function recordText(r){return [r.title,r.abstract,r.journal,r.authors,(r.publicationTypes||[]).join(' '),r.recordType,r.language,r.doi,r.pmid].join(' ')}

function classifyStudyType(r){
  const text=recordText(r).toLowerCase();
  const humanWords=($('advHumanPos').value||'').split(/[;；,，\n]/).map(x=>x.trim()).filter(Boolean);
  const animalWords=[...new Set([...L('animalTerms'), ...($('advAnimalPos').value||'').split(/[;；,，\n]/).map(x=>x.trim()).filter(Boolean)])];
  const vitroWords=['in vitro','cell line','cell culture','hela','hek293','hepg2','raw264','raw 264','pc12','sh-sy5y','caco-2','ht29','mcf-7','mda-mb','a549','beas-2b','thp-1','jurkat','cho cell','cos-7','vero','3t3','fibroblast','epithelial cell','primary culture','mtor','western blot','rt-pcr','rt-qpcr','elisa','immunohistochemistry','sirna','crispr','plasmid','luciferase','flow cytometry'];
  let hScore=0,aScore=0,vScore=0;
  humanWords.forEach(w=>{if(matchTerm(text,w)) hScore++});
  animalWords.forEach(w=>{if(matchTerm(text,w)) aScore++});
  vitroWords.forEach(w=>{if(matchTerm(text,w)) vScore++});
  if(hScore>0&&aScore===0&&vScore===0) return 'human';
  if(aScore>0&&hScore===0&&vScore===0) return 'animal';
  if(vScore>0&&hScore===0&&aScore===0) return 'in_vitro';
  if(vScore>0) return 'in_vitro';
  if(hScore>0&&aScore>0) return 'unclear';
  return 'unclear';
}

function getDynamicRules(){
  const rules=[];
  const studyMode=$('studyMode').value;
  groups('pop').forEach(group=>rules.push({type:'检索-疾病/人群',weight:2,group}));
  groups('expo').forEach(group=>rules.push({type:'检索-暴露/基因',weight:2,group}));
  if(studyMode!=='human') groups('animalTerms').forEach(group=>rules.push({type:'检索-动物模型/种属',weight:2,group}));
  if($('mode').value!=='wide') groups('outcome').forEach(group=>rules.push({type:'检索-结局',weight:1,group}));
  if($('mode').value==='strict') groups('design').forEach(group=>rules.push({type:'检索-研究设计',weight:2,group}));
  L('incWords').forEach(word=>rules.push({type:'纳入倾向词',weight:1,word}));
  L('excWords').forEach(word=>rules.push({type:'排除倾向词',weight:-2,word}));

  const humanWords=($('advHumanPos').value||'').split(/[;；,，\n]/).map(x=>x.trim()).filter(Boolean);
  const animalWords=[...new Set([...L('animalTerms'), ...($('advAnimalPos').value||'').split(/[;；,，\n]/).map(x=>x.trim()).filter(Boolean)])];
  if(studyMode==='human'){
    animalWords.forEach(w=>rules.push({type:'动物词(人群模式强排除)',weight:-5,word:w}));
    humanWords.forEach(w=>rules.push({type:'人群正向词',weight:1,word:w}));
  }else if(studyMode==='animal'){
    animalWords.forEach(w=>rules.push({type:'动物正向词',weight:1,word:w}));
    humanWords.forEach(w=>rules.push({type:'人群词(动物模式强排除)',weight:-5,word:w}));
  }else if(studyMode==='in_vitro'){
    animalWords.forEach(w=>rules.push({type:'动物词(体外模式强排除)',weight:-5,word:w}));
    humanWords.forEach(w=>rules.push({type:'人群词(体外模式强排除)',weight:-5,word:w}));
    // In vitro positive indicators
    ['in vitro','cell line','cell culture','hela','hek293','hepg2','raw264','pc12','a549','thp-1','western blot','rt-pcr','elisa','sirna','crispr'].forEach(w=>rules.push({type:'体外正向词',weight:2,word:w}));
  }
  return rules;
}

function scoreRecord(r,rules,incCut,excCut){
  const text=recordText(r);
  const title=r.title||'';
  const titleMul=+(($('advTitleMul')?.value)||2);
  const synergyBonus=+(($('advSynergy')?.value)||2);
  const excPenalty=+(($('advExcPenalty')?.value)||-1);
  const pubTypeExc=+(($('advPubTypeExc')?.value)||-5);

  let score=0;
  const details=[];
  const exclusionHits=[];
  let groupsHit=0;

  for(const rule of rules){
    if(rule.group){
      const hitInTitle=rule.group.find(term=>matchTermInTitle(title,term));
      const hit=hitInTitle||rule.group.find(term=>matchTerm(text,term));
      if(hit){
        const w=hitInTitle?rule.weight*titleMul:rule.weight;
        score+=w;
        details.push({type:rule.type,token:hit,weight:w});
        groupsHit++;
      }
    }else if(rule.word&&matchTerm(text,rule.word)){
      const hitTitle=matchTermInTitle(title,rule.word);
      const w=hitTitle&&rule.weight>0?rule.weight*titleMul:rule.weight;
      score+=w;
      details.push({type:rule.type,token:rule.word,weight:w});
      if(rule.weight<0) exclusionHits.push(rule.word);
    }
  }

  if(groupsHit>=3) score+=synergyBonus;
  if(exclusionHits.length>1) score+=excPenalty*(exclusionHits.length-1);

  const pubTypes=(r.publicationTypes||[]).map(x=>x.toLowerCase());
  const strongExcTypes=['review','editorial','letter','case report','comment'];
  if(pubTypes.some(pt=>strongExcTypes.some(ex=>pt.includes(ex)))){
    score+=pubTypeExc;
    details.push({type:'出版类型强排除',token:pubTypes.join(', '),weight:pubTypeExc});
  }

  r.studyType=classifyStudyType(r);
  r.score=score;
  r.humanScore=r.studyType==='human'?score:0;
  r.animalScore=r.studyType==='animal'?score:0;
  r.scoreDetails=details;
  r.hits=details.map(x=>`${x.weight>0?'+':''}${x.weight} ${x.type}:${x.token}`).join('; ');

  if(score>=incCut){
    r.decision='建议纳入';
    r.reason='命中检索词与研究特征，建议阅读全文';
  }else if(score<=excCut){
    r.decision='建议排除';
    r.reason=exclusionHits.length?`命中排除词：${exclusionHits.join('; ')}`:'相关性偏低';
  }else{
    r.decision='待人工判断';
    r.reason='信息不足，建议人工查看';
  }
}

function screenAll(incremental=false){
  prismaDirty=true;
  const rules=getDynamicRules();
  const incCut=+$('incCut').value||4;
  const excCut=+$('excCut').value||-2;
  if(incremental){
    // Only score new records (no hits yet) and manually locked ones stay locked
    for(const r of rec){
      if(r.hits) continue; // already scored
      scoreRecord(r,rules,incCut,excCut);
    }
  }else{
    for(const r of rec){
      if(r.manual&&(r.decision==='最终纳入'||r.decision==='最终排除')) continue;
      scoreRecord(r,rules,incCut,excCut);
      r.manual=false;
    }
  }
  save();
  render();
}
// === PRISMA 2020 Flow Diagram ===
const PRISMA_KEY='meta_screener_prisma';

function getPrismaNotRetrieved(){
  const v=parseInt(localStorage[PRISMA_KEY]||'0',10);
  return isNaN(v)||v<0?0:v;
}
function onPrismaNotRetrievedChange(){
  const v=Math.max(0,parseInt($('prismaNotRetrieved').value||'0',10)||0);
  localStorage[PRISMA_KEY]=String(v);
  renderPRISMA();
}

function sourceCountsForPrisma(filteredRec){
  const counts={};
  (filteredRec||rec).forEach(r=>{
    (r.sources&&r.sources.length?r.sources:[{source:r.source}]).forEach(s=>{
      counts[s.source]=(counts[s.source]||0)+1;
    });
  });
  return counts;
}

function renderPRISMA(){
  const container=$('prismaContainer');
  if(!container) return;

  const W=960;
  const leftCX=230, rightCX=690;
  const leftW=380, rightW=360;
  const boxH=60, gapH=52;

  // PRISMA 数据跟着研究模式走
  const prismaRec=studyFiltered(rec);
  const identified=prismaRec.reduce((s,r)=>s+Math.max(1,(Number(r.mergedCount)||1)),0);
  const afterDedup=prismaRec.length;
  const duplicates=identified-afterDedup;
  const autoExcluded=prismaRec.filter(r=>r.decision==='建议排除').length;
  const sought=afterDedup-autoExcluded;
  const notRetrieved=getPrismaNotRetrieved();
  const assessed=Math.max(0,sought-notRetrieved);
  const manualExcluded=prismaRec.filter(r=>r.decision==='最终排除').length;
  const included=prismaRec.filter(r=>r.decision==='最终纳入').length;

  const sourceCounts=sourceCountsForPrisma(prismaRec);
  const sourceLabels={pubmed:'PubMed',europepmc:'Europe PMC',crossref:'Crossref',openalex:'OpenAlex',
    cnki:'CNKI',wanfang:'万方',vip:'维普',cbm:'SinoMed',
    embase:'Embase',wos:'WoS',scopus:'Scopus',cochrane:'Cochrane','google-scholar':'Google Scholar',other:'其他'};
  const sourceEntries=Object.entries(sourceCounts).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  const sourceLine=sourceEntries.length
    ?sourceEntries.map(([k,n])=>`${sourceLabels[k]||k}: ${n}`).join('  ·  ')
    :'';

  const exclReasons=[...new Set(prismaRec.filter(r=>r.decision==='最终排除').map(r=>r.reason||'人工排除').filter(Boolean))];
  const pendingDecisions=Math.max(0,assessed-manualExcluded-included);
  const hasPending=pendingDecisions>0;

  // Absolute Y positions — expand eligibility phase if there are pending records
  const identY=12, identH=168;
  const screenY=identY+identH, screenH=168;
  const retY=screenY+screenH, retH=hasPending?340:280;
  const inclY=retY+retH, inclH=hasPending?150:130;
  const totalH=inclY+inclH+10;

  // Box positions within each phase
  const b1Y=identY+30;   // Records identified
  const b2Y=screenY+30;  // Records screened
  const b3Y=retY+30;     // Reports sought
  const b4Y=retY+160;    // Reports assessed (lower in phase 3)
  const b4bY=retY+240;   // Reports awaiting decision (right side, below excluded)
  const b5Y=inclY+30;    // Studies included
  const rb1Y=b1Y, rb2Y=b2Y, rb3Y=b3Y, rb4Y=b4Y, rb4bY=b4bY;
  const afterSource=b1Y+boxH+18; // space below box 1 for source text

  // Helpers
  function lbox(x,y,w,h,stroke,fill,title,count){
    const f=fill||'#fff';
    return `<rect x="${x-w/2}" y="${y}" width="${w}" height="${h}" rx="9" fill="${f}" stroke="${stroke}" stroke-width="2"/>
      <text x="${x}" y="${y+22}" text-anchor="middle" font-size="13" font-weight="700" fill="#1e293b">${esc(title)}</text>
      <text x="${x}" y="${y+46}" text-anchor="middle" font-size="18" font-weight="800" fill="${stroke}">n = ${count}</text>`;
  }
  function rbox(x,y,w,h,stroke,title,count,subLines){
    let html=`<rect x="${x-w/2}" y="${y}" width="${w}" height="${h}" rx="9" fill="#fff" stroke="${stroke}" stroke-width="1.5"/>
      <text x="${x}" y="${y+20}" text-anchor="middle" font-size="12" fill="#64748b">${esc(title)}</text>
      <text x="${x}" y="${y+44}" text-anchor="middle" font-size="16" font-weight="800" fill="#dc2626">n = ${count}</text>`;
    if(subLines&&subLines.length){
      const baseY=y+h+14;
      html+=`<text x="${x}" y="${baseY}" text-anchor="middle" font-size="11" fill="#991b1b">`;
      subLines.slice(0,3).forEach((l,i)=>{
        html+=`<tspan x="${x}" dy="${i===0?0:14}">${i===0?'原因：'+esc(l.length>38?l.slice(0,36)+'…':l):esc(l.length>38?l.slice(0,36)+'…':l)}</tspan>`;
      });
      html+=`</text>`;
    }
    return html;
  }
  function vArrow(yFrom,yTo,cx){
    return `<line x1="${cx}" y1="${yFrom}" x2="${cx}" y2="${yTo-6}" stroke="#94a3b8" stroke-width="1.8" marker-end="url(#arr)"/>`;
  }
  function hArrow(leftY,rightY){
    const x1=leftCX+leftW/2, x2=rightCX-rightW/2, mid=(x1+x2)/2;
    return `<path d="M${x1} ${leftY+boxH/2} L${mid} ${leftY+boxH/2} L${mid} ${rightY+boxH/2} L${x2-5} ${rightY+boxH/2}" stroke="#94a3b8" stroke-width="1.5" fill="none" marker-end="url(#arr)"/>`;
  }

  const phaseW=W-20;
  const phases=[
    {label:'IDENTIFICATION',y:identY,h:identH,color:'#eff6ff',border:'#bfdbfe',lc:'#1d4ed8'},
    {label:'SCREENING',y:screenY,h:screenH,color:'#fffbeb',border:'#fde68a',lc:'#b45309'},
    {label:'RETRIEVAL & ELIGIBILITY',y:retY,h:retH,color:'#fdf2f8',border:'#fbcfe8',lc:'#9d174d'},
    {label:'INCLUDED',y:inclY,h:inclH,color:'#f0fdf4',border:'#bbf7d0',lc:'#166534'},
  ];

  const svg=`<svg width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#94a3b8"/></marker>
  </defs>
  <rect x="0" y="0" width="${W}" height="${totalH}" fill="#fafcff" rx="12"/>

  ${phases.map(p=>`
  <rect x="8" y="${p.y}" width="${phaseW}" height="${p.h}" rx="10" fill="${p.color}" stroke="${p.border}" stroke-width="1" stroke-dasharray="5 4"/>
  <text x="28" y="${p.y+20}" font-size="13" font-weight="800" fill="${p.lc}" letter-spacing="2.5">${p.label}</text>
  `).join('')}

  <!-- Phase 1: Identification -->
  ${lbox(leftCX,b1Y,leftW,boxH,'#3b82f6','#eff6ff','Records identified from databases*',identified)}
  ${sourceLine?`<text x="${leftCX}" y="${afterSource}" text-anchor="middle" font-size="10" fill="#64748b">${esc(sourceLine)}</text>`:''}
  ${hArrow(b1Y,rb1Y)}
  ${rbox(rightCX,rb1Y,rightW,boxH,'#3b82f6','Records removed before screening',duplicates)}

  <!-- Phase 2: Screening -->
  ${vArrow(afterSource,b2Y,leftCX)}
  ${lbox(leftCX,b2Y,leftW,boxH,'#d97706','#fffbeb','Records screened',afterDedup)}
  ${hArrow(b2Y,rb2Y)}
  ${rbox(rightCX,rb2Y,rightW,boxH,'#d97706','Records excluded (auto-screen)',autoExcluded)}

  <!-- Phase 3: Retrieval & Eligibility -->
  ${vArrow(b2Y+boxH,b3Y,leftCX)}
  ${lbox(leftCX,b3Y,leftW,boxH,'#db2777','#fdf2f8','Reports sought for retrieval',sought)}
  ${hArrow(b3Y,rb3Y)}
  ${rbox(rightCX,rb3Y,rightW,boxH,'#db2777','Reports not retrieved',notRetrieved)}

  ${vArrow(b3Y+boxH,b4Y,leftCX)}
  ${lbox(leftCX,b4Y,leftW,boxH,'#db2777','#fdf2f8','Reports assessed for eligibility',assessed)}
  ${hArrow(b4Y,rb4Y)}
  ${rbox(rightCX,rb4Y,rightW,boxH,'#db2777','Reports excluded (full-text review)',manualExcluded,exclReasons)}

  ${hasPending?`
  ${hArrow(b4Y,rb4bY)}
  ${rbox(rightCX,rb4bY,rightW,boxH,'#d97706','Reports awaiting decision',pendingDecisions,[`${pendingDecisions} 条建议纳入或待人工判断`])}
  `:''}

  <!-- Phase 4: Included -->
  ${vArrow(b4Y+boxH+(exclReasons.length?50:0)+(hasPending?90:0),b5Y,leftCX)}
  ${lbox(leftCX,b5Y,leftW,boxH,'#16a34a','#f0fdf4','Studies included in review',included)}
  ${included===0&&hasPending?`<text x="${leftCX}" y="${b5Y+boxH+16}" text-anchor="middle" font-size="11" fill="#b45309">完成人工复核后，最终纳入的研究将显示在此</text>`:''}

  <text x="18" y="${totalH-6}" font-size="10" fill="#94a3b8">* 各数据库计数基于已去重记录 · 同一记录多来源时分别计数</text>
  </svg>`;

  container.innerHTML=svg;
  const input=$('prismaNotRetrieved');
  if(input&&String(input.value)!==String(notRetrieved)) input.value=notRetrieved;
}

function exportPRISMASVG(){
  const svgEl=document.querySelector('#prismaContainer svg');
  if(!svgEl) return;
  const clone=svgEl.cloneNode(true);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const data='<?xml version="1.0" encoding="UTF-8"?>\n'+clone.outerHTML;
  dl('PRISMA_flow_diagram.svg',data,'image/svg+xml');
}

function exportPRISMAPNG(){
  const svgEl=document.querySelector('#prismaContainer svg');
  if(!svgEl) return;
  const clone=svgEl.cloneNode(true);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const data='<?xml version="1.0" encoding="UTF-8"?>\n'+clone.outerHTML;
  const blob=new Blob([data],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{
    const canvas=document.createElement('canvas');
    canvas.width=img.width*2;canvas.height=img.height*2;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    canvas.toBlob(b=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(b);
      a.download='PRISMA_flow_diagram.png';
      a.click();
    },'image/png');
    URL.revokeObjectURL(url);
  };
  img.src=url;
}

// === Parsers ===
function text(n,s){return n.querySelector(s)?.textContent?.trim()||''}
function yearInRange(year){
  const y=Number(String(year||'').slice(0,4));
  const yf=Number($('yf').value||0),yt=Number($('yt').value||3000);
  if(!y) return true;
  return y>=yf&&y<=yt;
}
function parsePubMedXML(xml,meta={}){
  const d=new DOMParser().parseFromString(xml,'text/xml');
  return [...d.querySelectorAll('PubmedArticle')].map(a=>{
    const pmid=text(a,'PMID');
    const title=text(a,'ArticleTitle');
    const year=text(a,'PubDate Year')||String(text(a,'PubDate MedlineDate')).slice(0,4);
    const journal=text(a,'Journal Title')||text(a,'ISOAbbreviation');
    const abstract=[...a.querySelectorAll('AbstractText')].map(x=>x.textContent.trim()).join(' ');
    const authors=[...a.querySelectorAll('Author')].slice(0,12).map(x=>(text(x,'LastName')+' '+text(x,'ForeName')).trim()).filter(Boolean).join('; ');
    const doi=[...a.querySelectorAll('ArticleId')].find(x=>x.getAttribute('IdType')==='doi')?.textContent?.trim()||'';
    const publicationTypes=[...a.querySelectorAll('PublicationType')].map(x=>x.textContent.trim()).filter(Boolean);
    return {source:'pubmed',sourceLabel:'PubMed',sourceId:pmid,sourceUrl:pmid?`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`:'',pmid,doi,title,year,journal,authors,abstract,publicationTypes,queryUsed:meta.query||'',fetchedAt:new Date().toISOString(),importMethod:'api',importBatch:meta.batch||''};
  }).filter(r=>r.title);
}
function parseEuropePMCJson(json,meta={}){
  return (json?.resultList?.result||[]).map(item=>{
    const pmid=item.pmid||'';const doi=item.doi||'';
    return {source:'europepmc',sourceLabel:'Europe PMC',sourceId:item.id||pmid||doi||'',sourceUrl:item.pmid?`https://europepmc.org/article/MED/${item.pmid}`:'',pmid,doi,title:item.title||'',year:String(item.pubYear||''),journal:item.journalTitle||'',authors:item.authorString||'',abstract:item.abstractText||'',recordType:item.pubType||'',language:item.language||'',queryUsed:meta.query||'',fetchedAt:new Date().toISOString(),importMethod:'api',importBatch:meta.batch||''};
  }).filter(r=>r.title);
}
function parseCrossrefJson(json,meta={}){
  return (json?.message?.items||[]).map(item=>{
    const doi=item.DOI||'';const title=(item.title&&item.title[0])||'';
    const year=item.issued?.['date-parts']?.[0]?.[0]||item.published?.['date-parts']?.[0]?.[0]||'';
    const authors=(item.author||[]).slice(0,12).map(x=>[x.family,x.given].filter(Boolean).join(' ')).filter(Boolean).join('; ');
    return {source:'crossref',sourceLabel:'Crossref',sourceId:doi||item.URL||'',sourceUrl:item.URL||'',doi,title,year:String(year||''),journal:(item['container-title']&&item['container-title'][0])||'',authors,abstract:stripTags(item.abstract||''),recordType:item.type||'',language:item.language||'',queryUsed:meta.query||'',fetchedAt:new Date().toISOString(),importMethod:'api',importBatch:meta.batch||''};
  }).filter(r=>r.title);
}
function reconstructOpenAlexAbstract(inv){
  if(!inv||typeof inv!=='object') return '';
  const pairs=[];
  Object.entries(inv).forEach(([word,positions])=>(positions||[]).forEach(pos=>pairs[pos]=word));
  return pairs.filter(Boolean).join(' ');
}
function parseOpenAlexJson(json,meta={}){
  return (json?.results||[]).map(item=>{
    const doi=(item.doi||'').replace(/^https?:\/\/doi\.org\//i,'');
    const pmid=item.ids?.pmid?String(item.ids.pmid).replace('https://pubmed.ncbi.nlm.nih.gov/','').replace(/\/$/,''):'';
    const journal=item.primary_location?.source?.display_name||'';
    const year=item.publication_year||'';
    const authors=(item.authorships||[]).slice(0,12).map(x=>x.author?.display_name).filter(Boolean).join('; ');
    return {source:'openalex',sourceLabel:'OpenAlex',sourceId:item.id||doi||pmid||'',sourceUrl:item.id||'',pmid,doi,title:item.title||'',year:String(year||''),journal,authors,abstract:reconstructOpenAlexAbstract(item.abstract_inverted_index),recordType:item.type||'',queryUsed:meta.query||'',fetchedAt:new Date().toISOString(),importMethod:'api',importBatch:meta.batch||''};
  }).filter(r=>r.title);
}

// === Fetch with pagination ===
function updateProgress(current,total,label){
  $('progressBar').style.display='';
  const pct=total>0?Math.min(100,Math.round(current/total*100)):0;
  $('progressFill').style.width=pct+'%';
  $('status').textContent=label;
}
function hideProgress(){$('progressBar').style.display='none'}
function stopFetch(){fetchAbort=true;$('status').textContent='正在停止...'}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}

async function fetchPubMed(meta){
  const q=$('pubmedQuery').textContent.trim()||buildQuery().pubmed;
  const max=getMaxFetch();
  const unlimited=max===0;
  const sort=encodeURIComponent($('sort').value);
  const batchSize=200;
  let allIds=[];
  let retstart=0;
  updateProgress(0,0,'PubMed: 搜索中...');
  const esBase=`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=${sort}&term=${encodeURIComponent(q)}`;
  const firstRes=await (await fetch(`${esBase}&retmax=${unlimited?batchSize:Math.min(batchSize,max)}&retstart=0`)).json();
  const totalAvail=Number(firstRes.esearchresult?.count||0);
  allIds=firstRes.esearchresult?.idlist||[];
  const target=unlimited?totalAvail:Math.min(max,totalAvail);

  while(allIds.length<target&&!fetchAbort){
    retstart=allIds.length;
    updateProgress(allIds.length,target,`PubMed: 获取ID ${allIds.length}/${target}`);
    await delay(200);
    const res=await (await fetch(`${esBase}&retmax=${Math.min(batchSize,target-allIds.length)}&retstart=${retstart}`)).json();
    const ids=res.esearchresult?.idlist||[];
    if(!ids.length) break;
    allIds.push(...ids);
  }
  if(!allIds.length) return {source:'pubmed',added:0,merged:0,total:0,message:'PubMed 未找到结果'};

  let allRecords=[];
  const fetchBatch=200;
  for(let i=0;i<allIds.length&&!fetchAbort;i+=fetchBatch){
    const chunk=allIds.slice(i,i+fetchBatch);
    updateProgress(i,allIds.length,`PubMed: 下载 ${i}/${allIds.length}`);
    await delay(200);
    const xml=await (await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${chunk.join(',')}`)).text();
    allRecords.push(...parsePubMedXML(xml,meta));
  }
  allRecords=allRecords.filter(r=>yearInRange(r.year));
  const result=addRecords(allRecords);
  return {source:'pubmed',...result,message:`PubMed 获取 ${allRecords.length} 条`};
}

async function fetchEuropePMC(meta){
  const q=$('genericQuery').textContent.trim()||buildQuery().generic;
  const max=getMaxFetch();
  const unlimited=max===0;
  const pageSize=unlimited?1000:Math.min(1000,max);
  let allRecords=[];
  let cursorMark='*';
  while((unlimited||allRecords.length<max)&&!fetchAbort){
    updateProgress(allRecords.length,unlimited?0:max,`Europe PMC: ${allRecords.length} 条...`);
    const url=`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${unlimited?pageSize:Math.min(pageSize,max-allRecords.length)}&cursorMark=${encodeURIComponent(cursorMark)}&query=${encodeURIComponent(q)}`;
    const json=await (await fetch(url)).json();
    const records=parseEuropePMCJson(json,meta).filter(r=>yearInRange(r.year));
    if(!records.length) break;
    allRecords.push(...records);
    const nextCursorMark=json.nextCursorMark||'';
    if(!nextCursorMark||nextCursorMark===cursorMark) break;
    cursorMark=nextCursorMark;
    await delay(50);
  }
  const result=addRecords(allRecords);
  return {source:'europepmc',...result,message:`Europe PMC 获取 ${allRecords.length} 条`};
}

async function fetchCrossref(meta){
  const q=$('genericQuery').textContent.trim()||buildQuery().generic;
  const max=getMaxFetch();
  const unlimited=max===0;
  const rows=unlimited?100:Math.min(100,max);
  let allRecords=[];
  let cursor='*';
  const sortParam=$('sort').value==='pub date'?'published':'relevance';
  while((unlimited||allRecords.length<max)&&!fetchAbort){
    updateProgress(allRecords.length,unlimited?0:max,`Crossref: ${allRecords.length} 条...`);
    const url=`https://api.crossref.org/works?rows=${unlimited?rows:Math.min(rows,max-allRecords.length)}&cursor=${encodeURIComponent(cursor)}&query.bibliographic=${encodeURIComponent(q)}&sort=${sortParam}`;
    const json=await (await fetch(url)).json();
    const records=parseCrossrefJson(json,meta).filter(r=>yearInRange(r.year));
    if(!records.length) break;
    allRecords.push(...records);
    const nextCursor=json.message?.['next-cursor']||'';
    if(!nextCursor||nextCursor===cursor) break;
    cursor=nextCursor;
    await delay(100);
  }
  const result=addRecords(allRecords);
  return {source:'crossref',...result,message:`Crossref 获取 ${allRecords.length} 条`};
}

async function fetchOpenAlex(meta){
  const q=$('genericQuery').textContent.trim()||buildQuery().generic;
  const max=getMaxFetch();
  const unlimited=max===0;
  const perPage=unlimited?200:Math.min(200,max);
  let allRecords=[];
  let cursor='*';
  while((unlimited||allRecords.length<max)&&!fetchAbort){
    updateProgress(allRecords.length,unlimited?0:max,`OpenAlex: ${allRecords.length} 条...`);
    const url=`https://api.openalex.org/works?per-page=${unlimited?perPage:Math.min(perPage,max-allRecords.length)}&cursor=${encodeURIComponent(cursor)}&search=${encodeURIComponent(q)}`;
    const json=await (await fetch(url)).json();
    const records=parseOpenAlexJson(json,meta).filter(r=>yearInRange(r.year));
    if(!records.length) break;
    allRecords.push(...records);
    const nextCursor=json.meta?.next_cursor||'';
    if(!nextCursor||nextCursor===cursor) break;
    cursor=nextCursor;
    await delay(50);
  }
  const result=addRecords(allRecords);
  return {source:'openalex',...result,message:`OpenAlex 获取 ${allRecords.length} 条`};
}

async function fetchSelectedDatabases(){
  const chosen=selectedSources();
  const cnChosen=selectedCnSources();
  if(!chosen.length&&!cnChosen.length){$('status').textContent='请先勾选至少一个数据库';return}
  buildQuery();
  saveSettings();
  fetchAbort=false;
  $('btnStop').style.display='';
  const batch=`batch-${Date.now()}`;
  const messages=[];

  // Fetch all selected databases in parallel
  const FETCHERS={pubmed:fetchPubMed,europepmc:fetchEuropePMC,crossref:fetchCrossref,openalex:fetchOpenAlex};
  const promises=chosen.map(async source=>{
    try{
      const m={batch,query:source==='pubmed'?$('pubmedQuery').textContent.trim():$('genericQuery').textContent.trim()};
      const result=await FETCHERS[source](m);
      return `${sourceLabelFor(source)}：新增${result.added}，合并${result.merged}`;
    }catch(e){
      return `${sourceLabelFor(source)}：失败（${e.message||'网络错误'}）`;
    }
  });
  const results=await Promise.all(promises);
  messages.push(...results);

  // Score once after all records are in
  screenAll(true);

  if(cnChosen.length){
    buildCnQueries();
    messages.push(`已为 ${cnChosen.map(s=>sourceLabelFor(s)).join('、')} 生成检索式`);
  }

  $('btnStop').style.display='none';
  hideProgress();
  $('status').textContent=messages.join(' ｜ ')||'完成';
  render();
}
// === Import file parsers ===
function guessFileType(name,text){
  const lower=String(name||'').toLowerCase();
  if(lower.endsWith('.ris')) return 'ris';
  if(lower.endsWith('.csv')) return 'csv';
  if(lower.endsWith('.bib')||lower.endsWith('.bibtex')) return 'bibtex';
  if(lower.endsWith('.xml')) return 'pubmed-xml';
  if(lower.endsWith('.nbib')) return 'nbib';
  if(/<PubmedArticleSet/i.test(text)) return 'pubmed-xml';
  if(/(^|\n)TY  - /m.test(text)||/(^|\n)ER  - /m.test(text)) return 'ris';
  if(/(^|\n)PMID- /m.test(text)) return 'nbib';
  if(/@article\s*\{/i.test(text)||/@\w+\s*\{/i.test(text)) return 'bibtex';
  return 'csv';
}
function parseRIS(text,source){
  const blocks=text.split(/\nER  -\s*/).map(x=>x.trim()).filter(Boolean);
  return blocks.map(block=>{
    const lines=block.split(/\r?\n/);
    const data={AU:[]};let current='';
    lines.forEach(line=>{
      const m=line.match(/^([A-Z0-9]{2})  - ?(.*)$/);
      if(m){current=m[1];if(current==='AU'||current==='A1')(data.AU||(data.AU=[])).push(m[2].trim());else data[current]=m[2].trim()}
      else if(current&&line.startsWith('      ')){
        if(Array.isArray(data[current]))data[current][data[current].length-1]+=' '+line.trim();else data[current]=(data[current]||'')+' '+line.trim();
      }
    });
    return normalizeRecord({source,sourceLabel:sourceLabelFor(source),sourceId:data.ID||data.DOI||data.DI||'',sourceUrl:'',pmid:data.PM||'',doi:data.DI||data.DO||'',title:data.TI||data.T1||data.CT||'',year:extractYear(data.PY||data.Y1||data.DA||''),journal:data.JO||data.JF||data.T2||data.JA||'',authors:(data.AU||[]).join('; '),abstract:data.AB||data.N2||'',recordType:data.TY||'',queryUsed:'',fetchedAt:new Date().toISOString(),importMethod:'manual'});
  }).filter(r=>r.title);
}
function parseBibTeX(text,source){
  const entries=text.split(/@(?=\w+\s*\{)/).map(x=>x.trim()).filter(Boolean);
  return entries.map(entry=>{
    const body=entry.replace(/^\w+\s*\{[^,]*,?/,'').replace(/}\s*$/,'');
    const field=name=>{const m=body.match(new RegExp(name+'\\s*=\\s*[{"]([\\s\\S]*?)[}"]\\s*(,|$)','i'));return m?m[1].replace(/\s+/g,' ').trim():''};
    const authors=field('author').split(/\s+and\s+/i).map(x=>x.trim()).filter(Boolean).join('; ');
    return normalizeRecord({source,sourceLabel:sourceLabelFor(source),sourceId:field('doi')||field('url')||'',sourceUrl:field('url')||'',doi:field('doi'),title:field('title'),year:extractYear(field('year')),journal:field('journal')||field('booktitle'),authors,abstract:field('abstract'),queryUsed:'',fetchedAt:new Date().toISOString(),importMethod:'manual'});
  }).filter(r=>r.title);
}
function parseCSVLine(line){
  const out=[];let cur='';let q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}
    else if(ch===','&&!q){out.push(cur);cur=''}else cur+=ch;
  }
  out.push(cur);return out;
}
function pickField(row,map,names){
  for(const name of names){const idx=map[name];if(idx!=null&&row[idx]!=null&&String(row[idx]).trim()) return String(row[idx]).trim()}
  return '';
}
function parseCSVRecords(text,source){
  const lines=text.replace(/^\xEF\xBB\xBF/,'').replace(/^﻿/,'').split(/\r?\n/).filter(Boolean);
  if(lines.length<2) return [];
  const headers=parseCSVLine(lines[0]).map(x=>x.trim().toLowerCase());
  const map={};headers.forEach((h,i)=>map[h]=i);
  return lines.slice(1).map(line=>parseCSVLine(line)).map(row=>normalizeRecord({
    source,sourceLabel:sourceLabelFor(source),
    sourceId:pickField(row,map,['sourceid','accession number','eid','ut','id'])||pickField(row,map,['doi','pmid']),
    sourceUrl:pickField(row,map,['url','link']),
    pmid:pickField(row,map,['pmid']),
    doi:pickField(row,map,['doi']),
    title:pickField(row,map,['title','article title','document title','题名']),
    year:extractYear(pickField(row,map,['year','publication year','published','date','年份'])),
    journal:pickField(row,map,['journal','source title','journal title','publication title','期刊']),
    authors:pickField(row,map,['authors','author full names','author','作者']),
    abstract:pickField(row,map,['abstract','summary','摘要']),
    queryUsed:'',fetchedAt:new Date().toISOString(),importMethod:'manual'
  })).filter(r=>r.title);
}
function parseNBIB(text,source){
  const records=[];
  const blocks=text.split(/\n\n(?=PMID- )/).map(x=>x.trim()).filter(Boolean);
  blocks.forEach(block=>{
    const obj={AU:[],PT:[]};let current='';
    block.split(/\r?\n/).forEach(line=>{
      const m=line.match(/^([A-Z]{2,4})\s*-\s*(.*)$/);
      if(m){current=m[1];if(current==='AU')obj.AU.push(m[2].trim());else if(current==='PT')obj.PT.push(m[2].trim());else obj[current]=m[2].trim()}
      else if(current)obj[current]=(obj[current]||'')+' '+line.trim();
    });
    records.push(normalizeRecord({source,sourceLabel:sourceLabelFor(source),sourceId:obj.PMID||'',sourceUrl:obj.PMID?`https://pubmed.ncbi.nlm.nih.gov/${obj.PMID}/`:'',pmid:obj.PMID||'',doi:(obj.AID||'').split(' ')[0],title:obj.TI||'',year:extractYear(obj.DP||''),journal:obj.JT||obj.TA||'',authors:obj.AU.join('; '),abstract:obj.AB||'',publicationTypes:obj.PT,queryUsed:'',fetchedAt:new Date().toISOString(),importMethod:'manual'}));
  });
  return records.filter(r=>r.title);
}

function importRecordsFile(e){
  const file=e.target.files[0];if(!file) return;
  const source=$('manualSource').value||'other';
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const txt=String(reader.result||'');
      const type=guessFileType(file.name,txt);
      let records=[];
      if(type==='ris') records=parseRIS(txt,source);
      else if(type==='csv') records=parseCSVRecords(txt,source);
      else if(type==='bibtex') records=parseBibTeX(txt,source);
      else if(type==='pubmed-xml') records=parsePubMedXML(txt,{query:'',batch:`import-${Date.now()}`}).map(r=>({...r,source,sourceLabel:sourceLabelFor(source),importMethod:'manual'}));
      else if(type==='nbib') records=parseNBIB(txt,source);
      const result=addRecords(records);
      screenAll();
      $('status').textContent=`从 ${sourceLabelFor(source)} 导入 ${records.length} 条；新增 ${result.added}，合并 ${result.merged}`;
    }catch(err){alert('导入失败：'+err.message)}
  };
  reader.readAsText(file,'utf-8');
}
function importJSON(e){
  const f=e.target.files[0];if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const data=JSON.parse(rd.result);
      const records=Array.isArray(data)?data:(data.records||[]);
      rec=records.map(normalizeRecord);
      save();
      if(data.settings){localStorage[SETTINGS_KEY]=JSON.stringify(data.settings);loadSettings()}
      screenAll();
      $('status').textContent=`已导入 ${rec.length} 条备份记录`;
    }catch(err){alert('JSON 导入失败：'+err.message)}
  };
  rd.readAsText(f,'utf-8');
}

// === Export ===
function exportJSON(){
  const settings=JSON.parse(localStorage[SETTINGS_KEY]||'{}');
  const payload={version:'pro-1',exportedAt:new Date().toISOString(),settings,records:rec};
  dl('Meta筛选备份_Pro.json',JSON.stringify(payload,null,2),'application/json');
}
function exportCSV(){
  const head=['结论','分数','研究类型','主来源','全部来源','PMID','DOI','原因','题名','年份','期刊','作者','命中词','摘要'];
  const rows=[head,...list().map(r=>[r.decision,r.score,r.studyType,r.sourceLabel||sourceLabelFor(r.source),sourceDisplayText(r),r.pmid||'',r.doi||'',r.reason||'',r.title||'',r.year||'',r.journal||'',r.authors||'',r.hits||'',r.abstract||''])];
  dl('Meta筛选结果_Pro.csv','﻿'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n'),'text/csv;charset=utf-8');
}

// === Render ===
// 按研究对象模式过滤记录
function studyFiltered(arr){
  const sm=$('studyMode').value;
  if(sm==='human') return arr.filter(r=>r.studyType==='human');
  if(sm==='animal') return arr.filter(r=>r.studyType==='animal');
  if(sm==='in_vitro') return arr.filter(r=>r.studyType==='in_vitro');
  return arr; // 'both' 模式不过滤
}

function list(){
  const q=$('f').value.toLowerCase().trim();
  const d=$('fd').value;
  const fs=$('fs').value;
  let ft=$('ft').value;
  // Study mode overrides the study-type filter for single-type modes
  const sm=$('studyMode').value;
  if(sm==='human'){$('ft').value='human';ft='human'}
  else if(sm==='animal'){$('ft').value='animal';ft='animal'}
  else if(sm==='in_vitro'){$('ft').value='in_vitro';ft='in_vitro'}
  return studyFiltered(rec).filter(r=>{
    if(d&&r.decision!==d) return false;
    if(fs&&!((r.sources||[]).some(s=>s.source===fs)||r.source===fs)) return false;
    if(ft&&r.studyType!==ft) return false;
    if(!q) return true;
    return [r.title,r.abstract,r.authors,r.journal,r.hits,r.reason,r.pmid,r.doi,sourceDisplayText(r)].join(' ').toLowerCase().includes(q);
  }).sort((a,b)=>b.score-a.score||String(b.year||'').localeCompare(String(a.year||'')));
}
function hi(s){
  const q=$('f').value.trim();let out=esc(s);
  if(q) out=out.replace(new RegExp(escapeRegExp(q),'ig'),m=>`<span class="hl">${m}</span>`);
  return out;
}
function sourceDisplayText(r){
  const labels=(r.sources&&r.sources.length?r.sources:[{source:r.source,sourceLabel:r.sourceLabel}]).map(s=>s.sourceLabel||sourceLabelFor(s.source));
  return [...new Set(labels)].join(' + ');
}
function sourceDisplay(r){
  const lst=(r.sources&&r.sources.length?r.sources:[{source:r.source,sourceLabel:r.sourceLabel}]);
  return lst.map(s=>sourceBadge(s.source,s.sourceLabel||sourceLabelFor(s.source))).join('');
}
function identifierLinks(r){
  const parts=[];
  if(r.pmid) parts.push(`<a target="_blank" href="https://pubmed.ncbi.nlm.nih.gov/${esc(r.pmid)}/">PMID:${esc(r.pmid)}</a>`);
  if(r.doi) parts.push(`<a target="_blank" href="https://doi.org/${esc(r.doi)}">DOI</a>`);
  return parts.join(' ');
}
function studyTypeBadge(st){
  const map={human:['人群','st-human'],animal:['动物','st-animal'],in_vitro:['体外','st-in_vitro'],unclear:['不明确','st-unclear']};
  const [label,cls]=map[st]||map.unclear;
  return `<span class="${cls}">${label}</span>`;
}
function sourceCounts(records){
  const counts={};
  records.forEach(r=>{
    // Only count primary source, not all merged sources
    counts[r.source]=(counts[r.source]||0)+1;
  });
  return counts;
}
function updateSourceFilterOptions(){
  const current=$('fs').value;
  const frec=studyFiltered(rec);
  const counts=sourceCounts(frec);
  $('fs').innerHTML='<option value="">全部来源</option>'+Object.keys(counts).sort().map(key=>`<option value="${esc(key)}">${esc(sourceLabelFor(key))} (${counts[key]})</option>`).join('');
  $('fs').value=counts[current]?current:'';
}
function renderSourceStats(records){
  const counts=sourceCounts(records.length?records:rec);
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  $('sourceStats').innerHTML=Object.keys(counts).sort().map(key=>`${sourceBadge(key)} <span class="muted">${counts[key]}</span>`).join(' ')+
    `<span style="margin-left:8px;font-size:11px;color:#64748b">（来源计数合计 = ${total}，含同一记录被多库收录的重复计数）</span>`||'<span class="muted">暂无</span>';
}
function render(opts={}){
  const {skipPrisma=false}=opts;
  updateSourceFilterOptions();
  const l=list();
  const page=l.slice(0,PAGE_SIZE_ACTIVE);
  const hasMore=l.length>PAGE_SIZE_ACTIVE;
  $('tb').innerHTML=page.map(r=>`<tr>
    <td>${sourceDisplay(r)}</td>
    <td>${studyTypeBadge(r.studyType)}</td>
    <td><span class="tag ${r.decision}">${r.decision}</span></td>
    <td><b>${r.score}</b></td>
    <td><b>${hi(r.title)}</b><div class="muted small">${hi((r.abstract||'').slice(0,300))}</div></td>
    <td>${esc(r.year)}</td>
    <td>${esc(r.journal)}</td>
    <td class="small">${esc(r.authors)}</td>
    <td class="small">${identifierLinks(r)}</td>
    <td class="small">${esc(r.hits)}</td>
    <td class="small">${esc(r.reason)}</td>
    <td><div class="actions"><button class="g" onclick="mark('${escAttr(r.id)}','最终纳入')">纳入</button><button class="r" onclick="mark('${escAttr(r.id)}','最终排除')">排除</button></div></td>
  </tr>`).join('')+
  (hasMore?`<tr><td colspan="12" style="text-align:center;padding:12px"><span class="muted">显示前 ${PAGE_SIZE_ACTIVE} / ${l.length} 条</span> <button onclick="showAll()" style="font-size:12px;padding:4px 10px">显示全部 (${l.length} 条)</button></td></tr>`:'');
  // 计数和统计跟着研究模式走
  const frec=studyFiltered(rec);
  $('nFetched').textContent=frec.reduce((s,r)=>s+Math.max(1,(Number(r.mergedCount)||1)),0);
  $('total').textContent=frec.length;
  $('nDup').textContent=frec.reduce((s,r)=>s+Math.max(0,(Number(r.mergedCount)||1)-1),0);
  $('nIn').textContent=frec.filter(x=>x.decision==='建议纳入').length;
  $('nEx').textContent=frec.filter(x=>x.decision==='建议排除').length;
  $('nMay').textContent=frec.filter(x=>x.decision==='待人工判断').length;
  $('nFinIn').textContent=frec.filter(x=>x.decision==='最终纳入').length;
  $('nFinEx').textContent=frec.filter(x=>x.decision==='最终排除').length;
  renderSourceStats(frec);
  if(!skipPrisma||prismaDirty){
    renderPRISMA();
    prismaDirty=false;
  }
  save();
}
function showAll(){PAGE_SIZE_ACTIVE=99999;render()}
function resetPage(){PAGE_SIZE_ACTIVE=PAGE_SIZE}
let PAGE_SIZE_ACTIVE=PAGE_SIZE;

// === Actions ===
function mark(id,d){
  const r=rec.find(x=>x.id===id);if(!r) return;
  r.decision=d;
  r.manual=d==='最终纳入'||d==='最终排除';
  r.reason=d==='最终排除'?'人工排除':(d==='最终纳入'?'人工纳入':'待人工重新判断');
  prismaDirty=true;
  save();render();renderPRISMA();
}
function copyQuery(id){
  const t=$(id).textContent.trim();
  navigator.clipboard?.writeText(t);
  $('status').textContent='已复制检索式';
}
function clearAll(){
  if(confirm('确定清空所有题录？请先备份。')){rec=[];localStorage[PRISMA_KEY]='0';prismaDirty=true;save();render();$('status').textContent='已清空';}
}
function demo(){
  rec=[
    normalizeRecord({source:'pubmed',pmid:'111111',title:'IL-6 polymorphism and pneumoconiosis risk: a case-control study',year:'2021',journal:'Occup Environ Med',authors:'Zhang; Li',abstract:'Human case-control study reported genotype, SNP, odds ratio and susceptibility risk in patients with pneumoconiosis.',importMethod:'demo'}),
    normalizeRecord({source:'crossref',doi:'10.1000/demo2',title:'Systematic review and meta-analysis of cytokine polymorphisms in lung disease',year:'2022',journal:'Sci Rep',authors:'Chen',abstract:'This systematic review and meta-analysis summarized previous studies on IL-6.',importMethod:'demo'}),
    normalizeRecord({source:'openalex',sourceId:'W123',title:'IL-6 expression in mouse lung exposed to silica particles',year:'2020',journal:'Toxicology',authors:'Wang',abstract:'Mouse animal model in vivo experiment measuring IL-6 levels after silica exposure in rats and mice.',importMethod:'demo'}),
    normalizeRecord({source:'cnki',title:'白细胞介素-6基因多态性与尘肺易感性的病例对照研究',year:'2023',journal:'中华劳动卫生职业病杂志',authors:'马某; 孙某',abstract:'目的 探讨IL-6基因多态性与煤工尘肺易感性的关系。方法 采用病例对照研究设计，纳入尘肺患者200例和健康对照200例。',importMethod:'demo'})
  ];
  save();screenAll();$('status').textContent='已载入示例数据';
}
function loadTemplate(){
  buildQuery();scheduleRescore();
}
function scheduleRescore(){
  saveSettings();
  clearTimeout(scoreTimer);
  prismaDirty=true;
  scoreTimer=setTimeout(()=>{buildQuery();screenAll()},400);
}
function debouncedFilter(){
  clearTimeout(filterTimer);
  resetPage();
  filterTimer=setTimeout(()=>render({skipPrisma:true}),100);
}

// === Init ===
function bindLive(){
  const filterIds=['f','fd','fs','ft'];
  const allIds=['mode','studyMode','pop','animalTerms','expo','outcome','design','yf','yt','max','sort','incWords','excWords','incCut','excCut','manualSource','advTitleMul','advSynergy','advExcPenalty','advPubTypeExc','advHumanPos','advAnimalPos',...filterIds];
  allIds.forEach(id=>{
    const el=$(id);if(!el) return;
    const isFilter=filterIds.includes(id);
    const isSelect=el.tagName==='SELECT';
    if(isFilter&&isSelect){
      // select dropdowns: instant render
      el.addEventListener('change',()=>{resetPage();render({skipPrisma:true})});
    }else if(isFilter){
      // text search: debounced
      el.addEventListener('input',()=>debouncedFilter());
    }else{
      el.addEventListener('input',()=>scheduleRescore());
      el.addEventListener('change',()=>scheduleRescore());
    }
  });
  // studyMode special: sync type filter when switching single-type modes
  const smEl=$('studyMode');
  if(smEl){
    smEl.addEventListener('change',()=>{
      const v=smEl.value;
      if(v==='human') $('ft').value='human';
      else if(v==='animal') $('ft').value='animal';
      else if(v==='in_vitro') $('ft').value='in_vitro';
      else $('ft').value='';
    });
  }
  document.querySelectorAll('.db-check,.db-check-cn').forEach(box=>box.addEventListener('change',saveSettings));
}

// ═══════════════════════════════════════════════════════════
// AOP BUILDER
// ═══════════════════════════════════════════════════════════

function switchTab(e){document.querySelectorAll('.tab-content').forEach(t=>t.style.display='none');const a=document.getElementById(e);if(a)a.style.display='block';document.querySelectorAll('.tab-button').forEach(b=>b.classList.toggle('active',b.dataset.tab===e));if(activeTab=e,e==='tabAopBuilder'){aopLoadProjects();if(!aopList.length)aopCreateProject();else if(aopCurrentIdx<0)aopCurrentIdx=0;aopRender();aopUpdateProjectSelect()}}
function aopLoadProjects(){try{const e=JSON.parse(localStorage[AOP_KEY]||'[]');aopList=Array.isArray(e)?e:[]}catch(e){aopList=[]}}
function aopSaveNow(){clearTimeout(aopSaveTimer);localStorage[AOP_KEY]=JSON.stringify(aopList)}
function aopGetCurrent(){return aopCurrentIdx<0||aopCurrentIdx>=aopList.length?null:aopList[aopCurrentIdx]}
function aopUpdateProjectSelect(){const e=$('aopProjectSelect');if(!e)return;e.innerHTML=aopList.map((p,i)=>`<option value="${i}" ${i===aopCurrentIdx?'selected':''}>${esc(p.name)} (${(p.nodes||[]).length}节点,${(p.edges||[]).length}线)</option>`).join('')}
function aopOnProjectChange(){aopCurrentIdx=parseInt($('aopProjectSelect').value||'0',10);aopDeselectAll();aopRender()}
function aopCreateProject(e){const t=e||prompt('项目名称：','新AOP项目');if(!t)return;aopList.push({id:'aop-'+Date.now(),name:t,description:'',aopWikiId:null,nodes:[],edges:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});aopCurrentIdx=aopList.length-1;aopSaveNow();aopUpdateProjectSelect();aopRender()}
function aopDeleteProject(){const e=aopGetCurrent();if(!e||!confirm('确定删除项目"'+e.name+'"？'))return;aopList.splice(aopCurrentIdx,1);aopCurrentIdx=Math.min(aopCurrentIdx,aopList.length-1);aopSaveNow();aopUpdateProjectSelect();aopRender()}
function aopRenameProject(){const e=aopGetCurrent();if(!e)return;const t=prompt('新名称：',e.name);if(!t)return;e.name=t;e.updatedAt=new Date().toISOString();aopSaveNow();aopUpdateProjectSelect()}

// Canvas rendering
function aopRender(){const p=aopGetCurrent(),ec=$('aopEdgesGroup'),nc=$('aopNodesGroup');if(!ec||!nc)return;ec.innerHTML='';nc.innerHTML='';const es=$('aopEmptyState'),cc=$('aopCanvasContainer');if(es&&cc){if(!p||!p.nodes.length){es.style.display='';cc.style.display='none';return}else{es.style.display='none';cc.style.display=''}}const N={};p.nodes.forEach(n=>N[n.id]=n);const svg=$('aopCanvas');svg.setAttribute('viewBox','0 0 2400 1800');svg.setAttribute('width','2400');svg.setAttribute('height','1800');(p.edges||[]).forEach(e=>{const sn=N[e.sourceId],tn=N[e.targetId];if(!sn||!tn)return;const sx=sn.x+sn.w/2,sy=sn.y+40,tx=tn.x+tn.w/2,ty=tn.y,dy=Math.abs(ty-sy),d=`M${sx},${sy} C${sx},${sy+dy*0.5} ${tx},${ty-dy*0.5} ${tx},${ty}`,sel=e.id===aopSelectedEdgeId||aopEdgeSourceId===sn.id;ec.innerHTML+=`<path d="${d}" class="aop-edge ${sel?'selected':''}" marker-end="url(#${sel?'aopArrowSel':'aopArrow'})" data-edge-id="${e.id}" onclick="event.stopPropagation();aopSelectEdge('${e.id}')"/>`});p.nodes.forEach(n=>{const t=AOP_NODE_TYPES[n.type]||AOP_NODE_TYPES.ke,sel=n.id===aopSelectedNodeId,ev=(n.evidenceRefs||[]).length;nc.innerHTML+=`<g transform="translate(${n.x},${n.y})" class="aop-node-group ${sel?'selected':''}" onmousedown="aopNodeMouseDown(event,'${n.id}')" onclick="event.stopPropagation()" oncontextmenu="aopNodeContextMenu(event,'${n.id}')" ondblclick="aopOpenEvidenceOverlay('${n.id}')"><rect width="${n.w||t.w}" height="${n.h||t.h}" rx="10" class="aop-node-bg ${t.cls}"/><text x="${(n.w||t.w)/2}" y="20" text-anchor="middle" class="aop-node-type">${t.label}</text><text x="${(n.w||t.w)/2}" y="42" text-anchor="middle" class="aop-node-label">${esc(n.label||t.label)}</text><text x="${(n.w||t.w)/2}" y="${(n.h||t.h)-10}" text-anchor="middle" font-size="10" fill="#94a3b8">${esc((n.description||'').slice(0,30))}</text>${ev?`<circle cx="${(n.w||t.w)-14}" cy="14" r="11" class="aop-ev-badge"/><text x="${(n.w||t.w)-14}" y="14" class="aop-ev-count">${ev}</text>`:''}</g>`});aopApplyTransform();aopUpdateDetailPanel();aopSaveNow()}
function aopApplyTransform(){const e=$('aopCanvasTransform');if(!e)return;e.setAttribute('transform',`translate(${aopPanX},${aopPanY}) scale(${aopZoom})`)}

// Canvas interaction
function aopNodeMouseDown(e,t){const p=aopGetCurrent();if(!p)return;const n=p.nodes.find(x=>x.id===t);if(!n)return;if(aopEdgeMode){if(!aopEdgeSourceId){aopEdgeSourceId=t;aopRender();return}else if(aopEdgeSourceId!==t){aopCompleteEdge(t);return}return}aopSelectNode(t);if(e.button!==0)return;e.stopPropagation();const tp=AOP_NODE_TYPES[n.type]||AOP_NODE_TYPES.ke;aopDragState={nodeId:t,x:n.x,y:n.y,mx:e.clientX,my:e.clientY,w:n.w||tp.w,h:n.h||tp.h}}
function aopCanvasMouseDown(e){if(e.target.closest('.aop-node-group'))return;aopDeselectAll();aopHideNodeDetail();if(aopEdgeMode)return;aopPanState={x:aopPanX,y:aopPanY,mx:e.clientX,my:e.clientY}}
function aopCanvasMouseMove(e){if(aopDragState){const dx=(e.clientX-aopDragState.mx)/aopZoom,dy=(e.clientY-aopDragState.my)/aopZoom,p=aopGetCurrent();if(!p)return;const n=p.nodes.find(x=>x.id===aopDragState.nodeId);if(!n)return;n.x=Math.max(0,Math.min(2200,Math.round(aopDragState.x+dx)));n.y=Math.max(0,Math.min(1600,Math.round(aopDragState.y+dy)));aopRender()}else if(aopPanState){aopPanX=aopPanState.x+(e.clientX-aopPanState.mx);aopPanY=aopPanState.y+(e.clientY-aopPanState.my);aopApplyTransform()}}
function aopCanvasMouseUp(){if(aopDragState){aopDragState=null}aopPanState=null}
function aopCanvasWheel(e){e.preventDefault();const o=aopZoom;aopZoom=Math.max(0.1,Math.min(3,aopZoom+(e.deltaY<0?0.1:-0.1)));const r=$('aopCanvasContainer').getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,s=aopZoom/o;aopPanX=mx-s*(mx-aopPanX);aopPanY=my-s*(my-aopPanY);aopApplyTransform()}

// Selection
function aopSelectNode(e){aopSelectedNodeId=e;aopSelectedEdgeId=null;aopEdgeSourceId=null;aopRender();aopUpdateDetailPanel();const t=$('aopNodeDetail');if(t)t.style.display='block'}
function aopSelectEdge(e){aopSelectedEdgeId=e;aopSelectedNodeId=null;aopEdgeSourceId=null;aopRender();aopHideNodeDetail()}
function aopDeselectAll(){aopSelectedNodeId=null;aopSelectedEdgeId=null;aopEdgeSourceId=null;aopEdgeMode=false;const e=$('aopEdgeBtn');if(e)e.classList.remove('active');const t=document.getElementById('aopCanvasContainer');if(t)t.classList.remove('aop-edge-mode');aopHideNodeDetail()}

// Detail panel
function aopUpdateDetailPanel(){const e=aopGetCurrent();if(!e||!aopSelectedNodeId)return;const t=e.nodes.find(n=>n.id===aopSelectedNodeId);if(!t){aopHideNodeDetail();return}const n=AOP_NODE_TYPES[t.type]||AOP_NODE_TYPES.ke;$('aopNodeDetailTitle').textContent='节点详情';$('aopNodeDetailType').textContent=n.label;$('aopNodeDetailLabel').value=t.label||'';$('aopNodeDetailDesc').value=t.description||'';$('aopNodeEvidenceCount').textContent=(t.evidenceRefs||[]).length;const r=$('aopNodeEvidenceList');r.innerHTML='';(t.evidenceRefs||[]).forEach(i=>{const o=rec.find(x=>x.id===i);if(!o)r.innerHTML+=`<div class="aop-ev-mini-item"><span style="color:#94a3b8;font-size:11px">(已删除)</span><button onclick="aopUnlinkRecord('${t.id}','${i}')">×</button></div>`;else r.innerHTML+=`<div class="aop-ev-mini-item"><span style="flex:1;font-size:11px">${esc(o.title||'').slice(0,50)}</span><span style="font-size:10px;color:#64748b">${o.decision}</span><button onclick="aopUnlinkRecord('${t.id}','${i}')">×</button></div>`})}
function aopHideNodeDetail(){const e=$('aopNodeDetail');if(e)e.style.display='none'}
function aopUpdateNodeLabel(){const e=aopGetCurrent();if(!e||!aopSelectedNodeId)return;const t=e.nodes.find(n=>n.id===aopSelectedNodeId);if(!t)return;t.label=$('aopNodeDetailLabel').value.trim();aopRender()}
function aopUpdateNodeDesc(){const e=aopGetCurrent();if(!e||!aopSelectedNodeId)return;const t=e.nodes.find(n=>n.id===aopSelectedNodeId);if(!t)return;t.description=$('aopNodeDetailDesc').value.trim();aopSaveNow()}

// Edge creation
function aopStartEdgeMode(){aopEdgeMode=true;aopEdgeSourceId=null;document.getElementById('aopCanvasContainer').classList.add('aop-edge-mode');const e=$('aopEdgeBtn');if(e)e.classList.add('active');$('aopStatus').textContent='点击源节点，再点击目标节点'}
function aopCompleteEdge(e){const t=aopGetCurrent();if(!t)return;if(aopEdgeSourceId&&aopEdgeSourceId!==e){const n=(t.edges||[]).find(p=>p.sourceId===aopEdgeSourceId&&p.targetId===e);if(!n){t.edges.push({id:'edge-'+Date.now(),sourceId:aopEdgeSourceId,targetId:e,label:'',style:'solid'});$('aopStatus').textContent='连线已创建'}}aopEdgeMode=false;aopEdgeSourceId=null;document.getElementById('aopCanvasContainer').classList.remove('aop-edge-mode');const o=$('aopEdgeBtn');if(o)o.classList.remove('active');aopRender()}

// Node ops
function aopAddNode(e){const t=aopGetCurrent();if(!t)return;const n=AOP_NODE_TYPES[e]||AOP_NODE_TYPES.ke,vx=Math.round((-aopPanX+300)/aopZoom),vy=Math.round((-aopPanY+200)/aopZoom);t.nodes.push({id:'node-'+Date.now(),type:e,label:n.label,description:'',x:Math.max(50,vx),y:Math.max(50,vy),w:n.w,h:n.h,evidenceRefs:[],aopWikiId:null});aopSaveNow();aopRender();$('aopStatus').textContent='已添加 '+n.label}
function aopDeleteSelected(){const e=aopGetCurrent();if(!e)return;if(aopSelectedNodeId){if(!confirm('删除选中的节点？'))return;e.nodes=e.nodes.filter(n=>n.id!==aopSelectedNodeId);e.edges=e.edges.filter(p=>p.sourceId!==aopSelectedNodeId&&p.targetId!==aopSelectedNodeId);aopDeselectAll();aopSaveNow();aopRender()}else if(aopSelectedEdgeId){e.edges=e.edges.filter(p=>p.id!==aopSelectedEdgeId);aopDeselectAll();aopSaveNow();aopRender()}}

// Zoom
function aopZoomIn(){aopZoom=Math.min(3,aopZoom+0.2);aopApplyTransform()}
function aopZoomOut(){aopZoom=Math.max(0.1,aopZoom-0.2);aopApplyTransform()}
function aopFitToScreen(){const e=aopGetCurrent();if(!e||!e.nodes.length)return;let t=Infinity,n=Infinity,o=-Infinity,r=-Infinity;e.nodes.forEach(p=>{t=Math.min(t,p.x);n=Math.min(n,p.y);o=Math.max(o,p.x+p.w);r=Math.max(r,p.y+p.h)});const s=o-t+60,l=r-n+60,c=$('aopCanvasContainer').clientWidth||800;aopZoom=Math.min(1.5,Math.floor(c/s*10)/10);aopPanX=-t*aopZoom+30;aopPanY=-n*aopZoom+30;aopApplyTransform()}

// Auto layout
function aopAutoLayout(){const e=aopGetCurrent();if(!e||!e.nodes.length)return;const GX=260,GY=160,SX=60,SY=60,ord={stressor:0,mie:1,ke:2,ao:3},ly=[[],[],[],[]];e.nodes.forEach(n=>{const i=ord[n.type]||2;ly[i].push(n)});let cy=SY;ly.forEach(l=>{if(!l.length)return;let cx=SX;l.forEach(n=>{n.x=cx;n.y=cy;cx+=GX});cy+=GY});for(let i=0;i<ly.length-1;i++){const s=ly[i],t=ly[i+1];if(!s.length||!t.length)continue;s.forEach(a=>{t.forEach(b=>{const ex=(e.edges||[]).find(p=>p.sourceId===a.id&&p.targetId===b.id);if(!ex)e.edges.push({id:'edge-'+Date.now()+Math.random().toString(36).slice(2,6),sourceId:a.id,targetId:b.id,label:'',style:'solid'})})})}aopSaveNow();aopRender();aopFitToScreen();$('aopStatus').textContent='自动布局完成'}

// -- Auto-match literature to nodes --
function aopAutoMatchLiterature(){
  const p=aopGetCurrent();if(!p||!p.nodes.length) return;
  if(!rec.length){$('aopStatus').textContent='请先在文献筛选标签页中导入或检索文献';return}
  let matched=0;
  p.nodes.forEach(n=>{
    const keywords=(n.label||'')+' '+(n.description||'');
    if(!keywords.trim()) return;
    const terms=keywords.toLowerCase().split(/[\s,;，；]+/).filter(x=>x.length>2);
    if(!terms.length) return;
    rec.forEach(r=>{
      if((n.evidenceRefs||[]).includes(r.id)) return;
      const text=(r.title+' '+r.abstract).toLowerCase();
      const hits=terms.filter(t=>text.includes(t)).length;
      if(hits>=2){if(!n.evidenceRefs)n.evidenceRefs=[];n.evidenceRefs.push(r.id);matched++}
    });
  });
  aopSaveNow();aopRender();
  $('aopStatus').textContent=`自动匹配完成：${matched} 条文献已链接到相关节点`;
}

// -- Infer AOP structure from literature --
function aopInferFromLiterature(){
  if(!rec.length){$('aopStatus').textContent='请先在文献筛选标签页中导入或检索文献';return}
  const p=aopGetCurrent();if(!p) return;
  // Extract keywords from record titles/abstracts
  const wordFreq={};
  const stopWords=new Set(['the','a','an','of','in','and','to','for','is','on','that','by','this','with','from','are','was','were','be','been','as','at','or','not','it','its','has','have','had','but','we','they','their','can','may','also','which','all','between','among','than','no']);
  rec.forEach(r=>{
    const text=(r.title+' '+r.abstract).toLowerCase().replace(/[^a-z0-9\s-]/g,' ');
    const words=text.split(/\s+/).filter(w=>w.length>4&&!stopWords.has(w));
    const seen=new Set();
    words.forEach(w=>{if(!seen.has(w)){seen.add(w);wordFreq[w]=(wordFreq[w]||0)+1}})
  });
  // Sort by frequency
  const sorted=Object.entries(wordFreq).sort((a,b)=>b[1]-a[1]).slice(0,30);
  // Build suggestion HTML
  let html='<div style="padding:16px;max-height:300px;overflow-y:auto">';
  html+='<b style="color:#0b4f79">从 '+rec.length+' 篇文献中提取的高频术语：</b><br><br>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
  sorted.forEach(([word,freq])=>{
    html+=`<span style="padding:4px 10px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:99px;font-size:12px;cursor:pointer" onclick="aopInferAddNode('${word}')" title="点击添加为KE节点">${esc(word)} <span style="color:#3b82f6;font-weight:700">${freq}</span></span>`;
  });
  html+='</div><br><p class="muted">点击术语添加为KE节点。建议：先添加Stressor和MIE，再从中选择关键事件。</p></div>';
  // Change overlay title
  const titleEl=$('aopWikiOverlay')?.querySelector('h2');if(titleEl)titleEl.textContent='🧠 文献术语推断AOP节点';
  $('aopWikiResults').innerHTML=html;
  $('aopWikiOverlay').style.display='';
}

function aopInferAddNode(word){
  const p=aopGetCurrent();if(!p) return;
  const vx=Math.max(50,Math.round((-aopPanX+300)/aopZoom)),vy=Math.max(50,Math.round((-aopPanY+200+Math.random()*200)/aopZoom));
  p.nodes.push({id:'node-'+Date.now(),type:'ke',label:word.charAt(0).toUpperCase()+word.slice(1),description:'',x:vx,y:vy,w:200,h:80,evidenceRefs:[],aopWikiId:null});
  aopSaveNow();aopRender();
  $('aopStatus').textContent='已添加节点：'+word;
  // If overlay is open, hide it
  setTimeout(()=>{if($('aopWikiOverlay').style.display!=='none')aopWikiClose()},300);
}

// AOP-Wiki
function aopShowWikiSearch(){$('aopWikiOverlay').style.display=''}
function aopWikiClose(){$('aopWikiOverlay').style.display='none';const t=$('aopWikiOverlay')?.querySelector('h2');if(t)t.textContent='🔍 AOP-Wiki 检索与导入'}
async function aopWikiSearch(){const e=$('aopWikiSearchInput').value.trim();if(!e){$('aopWikiResults').innerHTML='<p class="muted">请输入关键词</p>';return}$('aopWikiResults').innerHTML='<p class="muted">搜索中…</p>';try{var _now=Date.now();if(!aopCache||(_now-aopCacheTime)>3600000){$('aopWikiResults').innerHTML='<p class="muted">正在从AOP-Wiki加载数据（约100KB，首次较慢，后续秒出）…</p>';var _t=await fetchWithTimeout(AOP_WIKI_API+'/api-git/marvinm2/AOPWikiQueries/get-all-aops',{headers:{Accept:'application/json'}},30000);if(!_t.ok)throw new Error('API HTTP '+_t.status);var _n=await _t.json();aopCache=_n?.results?.bindings||[];aopCacheTime=_now;$('aopWikiResults').innerHTML='<p class="muted">数据已加载，搜索中…</p>'}var bindings=aopCache;var o=e.toLowerCase();var r=bindings.filter(function(x){var title=(x.AOPTitle?.value||'').toLowerCase();var id=(x.AOPID?.value||'').toLowerCase();return title.includes(o)||id.includes(o)}).slice(0,30);if(!r.length){$('aopWikiResults').innerHTML='<p class="muted">未找到与"'+esc(e)+'"相关的AOP<br><small>（已检索 '+bindings.length+' 条AOP记录，可尝试 fibrosis, silica, inflammation）</small></p>';return}aopWikiRenderResults(r)}catch(_err){$('aopWikiResults').innerHTML='<p style="color:#be123c">搜索失败：'+esc(_err.message||'网络错误')+'<br><small>首次加载约需10-30秒下载全部AOP数据（~100KB），请重试</small></p>'}}
function aopWikiRenderResults(e){$('aopWikiResults').innerHTML=e.map(r=>{const i=r.AOPID?.value||'?',a=r.AOPTitle?.value||'Untitled',u=r.AOP?.value||'';return'<div class="aopwiki-result-card"><h4>'+esc(i)+': '+esc(a)+'</h4><div class="aopwiki-meta"><b>URI:</b> '+esc(u)+'</div><div class="aopwiki-actions"><button onclick="aopWikiImport(\''+escAttr(i)+'\',\''+escAttr(a)+'\')" class="g" style="font-size:11px;padding:6px 14px">导入此AOP</button></div></div>'}).join('')}
async function aopWikiImport(aopId,aopTitle){$('aopWikiResults').innerHTML='<p class="muted">正在导入AOP…</p>';try{const s=aopGetCurrent();if(!s)return;s.aopWikiId=aopId;let ly=60,lx=100,step=140;const title=aopTitle||('AOP '+aopId);// Create basic AOP structure: Stressor -> MIE -> KE -> AO
s.nodes.push({id:'node-'+Date.now()+'-s',type:'stressor',label:title+' (Stressor)',description:'请在AOP-Wiki查看详情',x:lx,y:ly,w:200,h:80,evidenceRefs:[],aopWikiId:aopId});ly+=step;s.nodes.push({id:'node-'+Date.now()+'-m',type:'mie',label:title+' (MIE)',description:'请在AOP-Wiki查看详情',x:lx,y:ly,w:200,h:80,evidenceRefs:[],aopWikiId:aopId});ly+=step;s.nodes.push({id:'node-'+Date.now()+'-k',type:'ke',label:title+' (KE)',description:'请在AOP-Wiki查看详情',x:lx,y:ly,w:200,h:80,evidenceRefs:[],aopWikiId:aopId});ly+=step;s.nodes.push({id:'node-'+Date.now()+'-a',type:'ao',label:title+' (AO)',description:'请在AOP-Wiki查看详情',x:lx,y:ly,w:200,h:80,evidenceRefs:[],aopWikiId:aopId});// Auto-connect nodes
const imported=[...s.nodes].filter(x=>x.aopWikiId===aopId);for(let i=0;i<imported.length-1;i++){s.edges.push({id:'edge-'+Date.now()+Math.random().toString(36).slice(2,6),sourceId:imported[i].id,targetId:imported[i+1].id,label:'',style:'solid'})}aopSaveNow();aopRender();aopFitToScreen();aopWikiClose();$('aopStatus').textContent='已导入 '+aopId+'（基本信息，详情请查看AOP-Wiki）'}catch(t){$('aopWikiResults').innerHTML='<p style="color:#be123c">导入失败：'+esc(t.message||'网络错误')+'</p>'}}

// Evidence linking
let evidenceLinkNodeId=null;
function aopOpenEvidenceOverlay(e){const t=e||aopSelectedNodeId;if(!t)return;evidenceLinkNodeId=t;const n=aopGetCurrent();if(!n)return;const r=n.nodes.find(x=>x.id===t);if(!r)return;$('evidenceInfo').innerHTML='节点：<b>'+esc(r.label)+'</b> ('+esc((AOP_NODE_TYPES[r.type]||AOP_NODE_TYPES.ke).label)+')';aopRenderEvidenceList();$('evidenceOverlay').style.display=''}
function aopHideEvidenceOverlay(){$('evidenceOverlay').style.display='none';evidenceLinkNodeId=null}
function aopRenderEvidenceList(){const e=$('evidenceList');if(!e)return;const t=($('evidenceSearch')?.value||'').toLowerCase(),n=$('evidenceFilter')?.value||'',r=aopGetCurrent(),o=evidenceLinkNodeId?(r?.nodes.find(x=>x.id===evidenceLinkNodeId)?.evidenceRefs||[]):[];e.innerHTML=rec.filter(x=>{if(n&&x.decision!==n)return false;if(t&&![x.title,x.abstract,x.pmid,x.doi,x.authors].join(' ').toLowerCase().includes(t))return false;return true}).slice(0,200).map(x=>'<div class="evidence-item"><input type="checkbox" value="'+esc(x.id)+'" '+(o.includes(x.id)?'checked':'')+' data-rid="'+esc(x.id)+'"><span class="ev-title">'+esc((x.title||'').slice(0,80))+'</span><span class="ev-tag '+x.decision+'">'+x.decision+'</span><span class="ev-score">'+x.score+'</span></div>').join('')||'<p class="muted">无匹配文献</p>'}
function aopSaveEvidenceLinks(){const e=aopGetCurrent();if(!e||!evidenceLinkNodeId)return;const t=e.nodes.find(x=>x.id===evidenceLinkNodeId);if(!t)return;const n=[];document.querySelectorAll('#evidenceList input[type=checkbox]:checked').forEach(c=>n.push(c.dataset.rid));t.evidenceRefs=n;aopSaveNow();aopRender();aopUpdateDetailPanel();aopHideEvidenceOverlay()}
function aopUnlinkRecord(e,t){const n=aopGetCurrent();if(!n)return;const r=n.nodes.find(x=>x.id===e);if(!r)return;r.evidenceRefs=(r.evidenceRefs||[]).filter(x=>x!==t);aopSaveNow();aopRender();aopUpdateDetailPanel()}

// Export
function aopExportJSON(){const e={version:'aop-1',exportedAt:new Date().toISOString(),projects:aopList};dl('Meta_AOP_backup.json',JSON.stringify(e,null,2),'application/json')}
function aopImportJSON(e){const t=e.target.files[0];if(!t)return;const n=new FileReader();n.onload=()=>{try{const o=JSON.parse(n.result),r=o.projects||(Array.isArray(o)?o:[]);if(!Array.isArray(r)||!r.length){alert('未找到有效的AOP数据');return}const s=new Set(aopList.map(p=>p.id));let l=0;r.forEach(p=>{if(s.has(p.id)){const d=aopList.findIndex(x=>x.id===p.id);if(d>=0&&confirm('项目"'+p.name+'"已存在，覆盖？')){aopList[d]=p;l++}}else{aopList.push(p);l++}});aopSaveNow();aopCurrentIdx=aopList.length-1;aopUpdateProjectSelect();aopRender();$('aopStatus').textContent='已导入 '+l+' 个项目'}catch(o){alert('导入失败：'+o.message)}};n.readAsText(t,'utf-8')}
function aopExportSVG(){const e=aopGetCurrent();if(!e)return;let t='',n='';const r={};e.nodes.forEach(x=>r[x.id]=x);(e.edges||[]).forEach(x=>{const a=r[x.sourceId],s=r[x.targetId];if(!a||!s)return;const l=a.x+a.w/2,o=a.y+40,c=s.x+s.w/2,p=s.y,y=Math.abs(p-o);t+='<path d="M'+l+','+o+' C'+l+','+(o+y*0.5)+' '+c+','+(p-y*0.5)+' '+c+','+p+'" stroke="#64748b" stroke-width="2" fill="none" marker-end="url(#a)"/>'});e.nodes.forEach(x=>{const a=AOP_NODE_TYPES[x.type]||AOP_NODE_TYPES.ke,s=(x.evidenceRefs||[]).length;n+='<rect x="'+x.x+'" y="'+x.y+'" width="'+(x.w||a.w)+'" height="'+(x.h||a.h)+'" rx="8" fill="'+a.color+'22" stroke="'+a.color+'" stroke-width="2"/><text x="'+(x.x+(x.w||a.w)/2)+'" y="'+(x.y+22)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#475569">'+esc(a.label)+'</text><text x="'+(x.x+(x.w||a.w)/2)+'" y="'+(x.y+46)+'" text-anchor="middle" font-size="14" font-weight="600" fill="#0f172a">'+esc(x.label||a.label)+'</text>'+(s?'<circle cx="'+(x.x+(x.w||a.w)-16)+'" cy="'+(x.y+16)+'" r="12" fill="#ef4444" stroke="#fff" stroke-width="2"/><text x="'+(x.x+(x.w||a.w)-16)+'" y="'+(x.y+20)+'" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">'+s+'</text>':'')});const o='<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800" viewBox="0 0 2400 1800"><defs><marker id="a" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="#64748b"/></marker></defs><rect width="2400" height="1800" fill="#fff"/>'+t+n+'</svg>';dl('AOP_diagram.svg',o,'image/svg+xml')}
function aopExportPNG(){const e=aopGetCurrent();if(!e)return;let t='',n='';const r={};e.nodes.forEach(x=>r[x.id]=x);(e.edges||[]).forEach(x=>{const a=r[x.sourceId],s=r[x.targetId];if(!a||!s)return;const l=a.x+a.w/2,o=a.y+40,c=s.x+s.w/2,p=s.y,y=Math.abs(p-o);t+='<path d="M'+l+','+o+' C'+l+','+(o+y*0.5)+' '+c+','+(p-y*0.5)+' '+c+','+p+'" stroke="#64748b" stroke-width="2" fill="none" marker-end="url(#a)"/>'});e.nodes.forEach(x=>{const a=AOP_NODE_TYPES[x.type]||AOP_NODE_TYPES.ke;n+='<rect x="'+x.x+'" y="'+x.y+'" width="'+(x.w||a.w)+'" height="'+(x.h||a.h)+'" rx="8" fill="'+a.color+'22" stroke="'+a.color+'" stroke-width="2"/><text x="'+(x.x+(x.w||a.w)/2)+'" y="'+(x.y+22)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#475569">'+esc(a.label)+'</text><text x="'+(x.x+(x.w||a.w)/2)+'" y="'+(x.y+46)+'" text-anchor="middle" font-size="14" font-weight="600" fill="#0f172a">'+esc(x.label||a.label)+'</text>'});const o='<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800" viewBox="0 0 2400 1800"><defs><marker id="a" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="#64748b"/></marker></defs><rect width="2400" height="1800" fill="#fff"/>'+t+n+'</svg>',s=new Blob([o],{type:'image/svg+xml;charset=utf-8'}),l=URL.createObjectURL(s),c=new Image();c.onload=()=>{const p=document.createElement('canvas');p.width=c.width*2;p.height=c.height*2;const y=p.getContext('2d');y.fillStyle='#fff';y.fillRect(0,0,p.width,p.height);y.drawImage(c,0,0,p.width,p.height);p.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='AOP_diagram.png';a.click()},'image/png');URL.revokeObjectURL(l)};c.src=l}

// Context menu
function aopNodeContextMenu(e,t){e.preventDefault();e.stopPropagation();aopContextNodeId=t;const n=$('aopContextMenu');n.style.display='block';n.style.left=e.clientX+'px';n.style.top=e.clientY+'px'}
function aopContextEdit(){if(!aopContextNodeId)return;$('aopContextMenu').style.display='none';aopSelectNode(aopContextNodeId)}
function aopContextEvidence(){if(!aopContextNodeId)return;$('aopContextMenu').style.display='none';aopSelectNode(aopContextNodeId);setTimeout(()=>aopOpenEvidenceOverlay(aopContextNodeId),100)}
function aopContextDelete(){if(!aopContextNodeId)return;$('aopContextMenu').style.display='none';aopSelectNode(aopContextNodeId);aopDeleteSelected()}
document.addEventListener('click',()=>$('aopContextMenu').style.display='none');

// Canvas event binding
function aopBindCanvasEvents(){const e=$('aopCanvasContainer');if(!e)return;e.addEventListener('mousedown',aopCanvasMouseDown);document.addEventListener('mousemove',aopCanvasMouseMove);document.addEventListener('mouseup',aopCanvasMouseUp);e.addEventListener('wheel',aopCanvasWheel,{passive:false});document.addEventListener('keydown',k=>{if(activeTab!=='tabAopBuilder')return;if((k.key==='Delete'||k.key==='Backspace')&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){aopDeleteSelected()}if(k.key==='Escape'){aopDeselectAll();const c=document.getElementById('aopCanvasContainer');if(c)c.classList.remove('aop-edge-mode');const eb=$('aopEdgeBtn');if(eb)eb.classList.remove('active');aopRender()}})}

function initApp(){
rec=loadRecords();
loadSettings();
bindLive();
aopBindCanvasEvents();
buildQuery();
render();
  screenAll();
	}

// Boot — auth + main hidden during splash
$('authOverlay').style.display='none';
$('mainApp').style.display='none';
(function dismissSplash(){
  const splash=document.getElementById('splashScreen');
  if(!splash) { checkAuth(); return; }
  // Speed up splash if user interacts
  const skip=()=>{ splash.classList.add('splash-exit'); splash.addEventListener('animationend',()=>splash.remove()); };
  splash.addEventListener('click',skip);
  document.addEventListener('keydown',skip,{once:true});
  setTimeout(()=>{
    splash.classList.add('splash-exit');
    splash.addEventListener('animationend',()=>{ splash.remove(); checkAuth(); });
  },800);
})();
