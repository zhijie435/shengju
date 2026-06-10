/**
 * 分端登录存储 - 求职者端、政企端、管理端 token 分 key 存放，同一手机号可同时保持多端登录。
 * Token 优先 sessionStorage：关闭浏览器后需重新登录（同设备多标签页仍共享本会话）。
 * 求职者端：authToken_jobseeker, userId_jobseeker 等
 * 政企端：authToken_enterprise, userId_enterprise 等
 * 管理端：authToken（无前缀）
 */
(function() {
  var PREFIX = { jobseeker: '_jobseeker', enterprise: '_enterprise', admin: '' };
  var KEY_NAMES = ['authToken', 'userId', 'username', 'userType', 'email', 'refreshToken', 'currentCompanyId', 'enterpriseId'];
  var ALL_TYPES = ['jobseeker', 'enterprise', 'admin'];

  function keyOf(type, name) {
    return type === 'admin' ? name : name + PREFIX[type];
  }

  function getItem(k) {
    return sessionStorage.getItem(k) || localStorage.getItem(k);
  }

  function setItemPreferSession(k, v) {
    try {
      sessionStorage.setItem(k, String(v));
    } catch (e) {}
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }

  /** 登录某端时仅清理无前缀的旧版 key，避免覆盖其他端已存的 _jobseeker / _enterprise token */
  function clearOtherTypes(exceptType) {
    void exceptType;
    ['authToken', 'userId', 'username', 'userType', 'email', 'refreshToken', 'currentCompanyId', 'enterpriseId'].forEach(
      function (name) {
        try {
          localStorage.removeItem(name);
          sessionStorage.removeItem(name);
        } catch (e) {}
      }
    );
  }

  /** API 基址变化（换 IP/域名/服务器）时清空各端登录态，避免旧 token 串环境 */
  (function migrateAuthOnApiBaseChange() {
    try {
      var cur = (typeof window !== 'undefined' && window.API_BASE_URL) ? String(window.API_BASE_URL).replace(/\/$/, '') : '';
      if (!cur) return;
      var key = 'sj_last_api_base_for_auth';
      var prev = localStorage.getItem(key) || '';
      if (prev && prev !== cur) {
        ALL_TYPES.forEach(function(t) {
          KEY_NAMES.forEach(function(name) {
            var k = keyOf(t, name);
            localStorage.removeItem(k);
            sessionStorage.removeItem(k);
          });
        });
        ['authToken', 'userId', 'username', 'userType', 'email', 'currentCompanyId', 'enterpriseId'].forEach(function(n) {
          localStorage.removeItem(n);
          sessionStorage.removeItem(n);
        });
      }
      localStorage.setItem(key, cur);
    } catch (e) {}
  })();

  window.AuthHelper = {
    get: function(type) {
      var t = type || 'jobseeker';
      var token = getItem(keyOf(t, 'authToken'));
      if (!token && t !== 'admin') {
        var ut = sessionStorage.getItem('userType') || localStorage.getItem('userType');
        if (ut === t) {
          return {
            token: getItem('authToken'),
            userId: getItem('userId'),
            username: getItem('username'),
            userType: ut,
            email: getItem('email'),
            currentCompanyId: getItem('currentCompanyId'),
            enterpriseId: getItem('enterpriseId')
          };
        }
      }
      if (!token) return null;
      var o = { token: token };
      KEY_NAMES.forEach(function(name) {
        if (name === 'authToken') return;
        var v = getItem(keyOf(t, name));
        if (v) o[name] = v;
      });
      o.userType = o.userType || t;
      if (t === 'enterprise') {
        o.currentCompanyId = o.currentCompanyId || o.userId;
        o.enterpriseId = o.enterpriseId || o.userId;
      }
      return o;
    },
    set: function(type, data) {
      var t = type || 'jobseeker';
      if (!data || !data.token) return;
      clearOtherTypes(t);
      var d = Object.assign({}, data);
      if (t === 'enterprise') {
        d.currentCompanyId = d.currentCompanyId || d.userId;
        d.enterpriseId = d.enterpriseId || d.userId;
      }
      KEY_NAMES.forEach(function(name) {
        var v = name === 'authToken' ? d.token : d[name];
        if (v != null) setItemPreferSession(keyOf(t, name), v);
      });
    },
    clear: function(type) {
      var t = type || 'jobseeker';
      KEY_NAMES.forEach(function(name) {
        var k = keyOf(t, name);
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      // 子审核等流程会额外写入无前缀的 authToken/userType；仅删 _enterprise 时 get('enterprise') 仍可能读到 token，
      // login.html 会在「已登录」时立刻跳回企业中心，表现为「退不出去」。
      if (t === 'enterprise') {
        try {
          var ut = (sessionStorage.getItem('userType') || localStorage.getItem('userType') || '').toLowerCase();
          if (ut === 'enterprise' || ut === 'company') {
            ['authToken', 'userId', 'username', 'userType', 'email', 'refreshToken', 'currentCompanyId', 'enterpriseId'].forEach(function(name) {
              try {
                sessionStorage.removeItem(name);
                localStorage.removeItem(name);
              } catch (e) {}
            });
          }
        } catch (e1) {}
        try {
          localStorage.removeItem('enterpriseLoginKind');
          sessionStorage.removeItem('enterpriseLoginKind');
        } catch (e2) {}
      }
    },
    /**
     * 政企端 API 专用：只使用企业端存储的 token，或明确为企业/管理员会话时的无前缀 authToken。
     * 避免误用求职者等其它端的 authToken 调用 /companies/me 导致 403。
     */
    getEnterpriseApiToken: function() {
      var ent = this.get('enterprise');
      if (ent && ent.token) return ent.token;
      var kEnt = keyOf('enterprise', 'authToken');
      var te = getItem(kEnt);
      if (te) return te;
      var ut = (sessionStorage.getItem('userType') || localStorage.getItem('userType') || '').toLowerCase();
      // 勿用管理端 session 的 authToken 当作企业端（会导致 /companies/me 等得到 403，与「企业招聘中心」身份不符）
      if (ut === 'enterprise' || ut === 'company') {
        return getItem('authToken');
      }
      return null;
    }
  };
})();
