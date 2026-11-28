/* Linux in HTML 桥接层：Toy JS SDK 可选增强 + 明确的失败原因（不做静默降级）
 * 派生自 Toy Linux 的 toy-bridge.js（作者 LING不道 / 凌徐鲲，GPL-3.0-or-later，https://gitee.com/ling-xukun/toylinux），
 * 本项目按 GPL-3.0-or-later 继续分发，改动见 NOTICE.md。 */
(function (global) {
  'use strict';
  var LS = 'toylinux:';
  var state = { loaded: false, probed: false, caps: {}, inApp: false };

  function sdk() { return global.toy || null; }
  function mkErr(code, msg, raw) { var e = new Error(msg); e.code = code; e.raw = raw; return e; }

  function probe(api) {
    var t = sdk();
    if (!t || typeof t.isSupport !== 'function') return false;
    try {
      var r = t.isSupport(api);
      if (typeof r === 'boolean') return r;
      if (r && typeof r === 'object') {
        if (r.support === true || r.isSupport === true || r.supported === true) return true;
        if (typeof r.code === 'number' && r.code === 0) return true;
        if (r.support === false || r.supported === false) return false;
      }
    } catch (e) {}
    return false;
  }

  /* 统一调用：按函数 arity 决定是否注入回调，兼容 Promise / 回调 / 同步 */
  function invoke(name, args) {
    args = args || [];
    return new Promise(function (resolve, reject) {
      var t = sdk();
      if (!t || typeof t[name] !== 'function') { reject(mkErr('UNSUPPORTED', name + ' 在当前环境不可用')); return; }
      var fn = t[name];
      var wantCb = fn.length > args.length;
      var settled = false;
      function ok(v) { if (!settled) { settled = true; resolve(normalize(v)); } }
      function bad(e) { if (!settled) { settled = true; reject(e); } }
      var cb = function (res) {
        if (res && typeof res === 'object' && typeof res.code === 'number' && res.code !== 0) {
          bad(mkErr('SDK_' + res.code, res.msg || res.message || '调用被拒绝', res)); return;
        }
        ok(res);
      };
      var ret;
      try {
        ret = wantCb ? fn.apply(t, args.concat([cb])) : fn.apply(t, args);
      } catch (e) {
        if (wantCb) { bad(mkErr('THROW', (e && e.message) || String(e), e)); return; }
        try { ret = fn.apply(t, args.concat([cb])); wantCb = true; }
        catch (e2) { bad(mkErr('THROW', (e2 && e2.message) || String(e2), e2)); return; }
      }
      if (ret && typeof ret.then === 'function') {
        ret.then(ok, function (e) { bad(mkErr('SDK_REJECT', (e && e.message) || String(e), e)); });
        return;
      }
      if (!wantCb) { ok(ret); return; }
      if (ret !== undefined && ret !== null && typeof ret !== 'function') { ok(ret); return; }
      setTimeout(function () { bad(mkErr('TIMEOUT', name + ' 调用超时（20 秒未返回）')); }, 20000);
    });
  }
  function normalize(r) {
    if (r && typeof r === 'object' && typeof r.code === 'number' && r.code === 0 && 'data' in r) return r.data;
    return r;
  }

  /* ---------- 摄像头 ---------- */
  function asStream(r) {
    var cands = [r, r && r.stream, r && r.mediaStream, r && r.data, r && r.data && r.data.stream,
                 r && r.result, r && r.data && r.data.mediaStream];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c && typeof c.getTracks === 'function') return c;
      if (c && typeof c.getVideoTracks === 'function') return c;
    }
    return null;
  }
  function mediaErr(e) {
    var n = (e && e.name) || '';
    var map = {
      NotAllowedError: '权限被拒绝（用户未授权，或被页面策略拦截）',
      PermissionDeniedError: '权限被拒绝（用户未授权）',
      NotFoundError: '没有检测到摄像头设备',
      DevicesNotFoundError: '没有检测到摄像头设备',
      NotReadableError: '摄像头被其它程序占用',
      TrackStartError: '摄像头无法启动',
      SecurityError: '安全上下文不足（需要 HTTPS）',
      OverconstrainedError: '摄像头不支持所请求的参数',
      AbortError: '摄像头启动被中断'
    };
    var msg = map[n] || (e && e.message) || '未知错误';
    var err = mkErr(n || 'CAMERA', msg, e);
    err.name = n || 'Error';
    return err;
  }
  function webCamera(opts) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(mkErr('NO_API', '浏览器不提供 getUserMedia'));
    }
    var constraints = { video: opts || { facingMode: 'environment' }, audio: false };
    return navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
      s.__from = 'web';
      return s;
    }).catch(function (e) { throw mediaErr(e); });
  }

  var Bridge = {
    state: state,
    init: function () {
      state.loaded = !!sdk();
      state.inApp = /bili|toy/i.test(navigator.userAgent || '');
      if (!state.loaded) {
        var t0 = Date.now();
        var iv = setInterval(function () {
          if (sdk()) { clearInterval(iv); state.loaded = true; state.probed = false; }
          else if (Date.now() - t0 > 8000) clearInterval(iv);
        }, 250);
      }
      return state;
    },
    isLoaded: function () { return !!sdk(); },
    support: function (api) { return probe(api); },
    isApp: function () { return state.inApp; },
    invoke: invoke,

    getUserProfile: function () { return invoke('getUserProfile', []); },
    getAuthorProfile: function (uid) { return invoke('getAuthorProfile', [uid]); },
    getAuthorRelation: function (uid) { return invoke('getAuthorRelation', [uid]); },
    getAuthorVideos: function (uid) { return invoke('getAuthorVideos', [uid]); },
    getVideoUserActions: function () { return invoke('getVideoUserActions', []); },
    getAnnualReport: function () { return invoke('getAnnualReport', []); },
    getQrCode: function (o) { return invoke('getQrCode', [o || {}]); },

    getChargeUnlock: function () { return invoke('getChargeUnlock', []); },
    openChargePanel: function (o) { return invoke('openChargePanel', [o || {}]); },
    onChargeUnlockChange: function (cb) {
      var t = sdk();
      if (!t || typeof t.onChargeUnlockChange !== 'function') return false;
      try { t.onChargeUnlockChange(cb); return true; } catch (e) { return false; }
    },

    store: {
      set: function (k, v) {
        if (sdk() && typeof sdk().setCloudStorage === 'function') return invoke('setCloudStorage', [k, v]);
        try { localStorage.setItem(LS + k, JSON.stringify(v)); return Promise.resolve({ local: true }); }
        catch (e) { return Promise.reject(mkErr('LOCAL', '本地存储不可用')); }
      },
      get: function (k) {
        if (sdk() && typeof sdk().getCloudStorage === 'function') return invoke('getCloudStorage', [k]);
        try { return Promise.resolve(JSON.parse(localStorage.getItem(LS + k) || 'null')); }
        catch (e) { return Promise.resolve(null); }
      }
    },

    submitScore: function (score, extra) { return invoke('submitScore', [score, extra || {}]); },
    getRankList: function (o) { return invoke('getRankList', [o || {}]); },
    getMyRank: function () { return invoke('getMyRank', []); },

    /* 摄像头：不因 isSupport 误判而跳过真实调用；SDK 失败再回落 getUserMedia */
    requestCamera: function (opts) {
      opts = opts || { facingMode: 'environment' };
      var t = sdk();
      if (t && typeof t.requestCamera === 'function') {
        /* 1.9.9：SDK 在非 B 站 App 环境里可能既不 resolve 也不 reject（一直挂着），
           于是相机停在「正在申请」直到 15s 兜底。这里给 SDK 2.5s 竞速，超时就直接回落浏览器 getUserMedia。 */
        var call = invoke('requestCamera', [opts]);
        var raced = new Promise(function (res, rej) {
          var done = false;
          var timer = setTimeout(function () {
            if (done) return; done = true;
            rej(mkErr('SDK_TIMEOUT', 'Toy SDK requestCamera 2.5s 无响应'));
          }, 2500);
          call.then(function (v) { if (done) return; done = true; clearTimeout(timer); res(v); },
                    function (e) { if (done) return; done = true; clearTimeout(timer); rej(e); });
        });
        return raced.then(function (r) {
          var s = asStream(r);
          if (s) { s.__from = 'toy'; return s; }
          throw mkErr('NO_STREAM', 'SDK 未返回 MediaStream（返回：' + shortType(r) + '）');
        }).catch(function (e) {
          return webCamera(opts).then(function (s) {
            s.__fallbackReason = e && e.message;
            return s;
          }).catch(function (e2) {
            e.toyReason = e.message;
            e.message = e.message + '；浏览器直连也失败：' + e2.message;
            throw e;
          });
        });
      }
      return webCamera(opts);
    },
    requestMicrophone: function (opts) {
      var t = sdk();
      if (t && typeof t.requestMicrophone === 'function') return invoke('requestMicrophone', [opts || {}]).then(asStream);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(mkErr('NO_API', '浏览器不提供 getUserMedia'));
      return navigator.mediaDevices.getUserMedia({ audio: true }).catch(function (e) { throw mediaErr(e); });
    },
    stopMedia: function (stream) {
      var t = sdk();
      try { if (stream && t && typeof t.stopMedia === 'function') t.stopMedia(stream); } catch (e) {}
      try {
        if (stream && stream.getTracks) stream.getTracks().forEach(function (tr) { tr.stop(); });
        else if (stream && stream.stop) stream.stop();
      } catch (e) {}
      return Promise.resolve(true);
    },
    cameraDiagnostics: function () {
      var t = sdk();
      var info = {
        sdk: !!t,
        hasRequestCamera: !!(t && typeof t.requestCamera === 'function'),
        isSupport: null,
        isSupportError: null,
        featurePolicy: null,
        secureContext: !!global.isSecureContext,
        mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      };
      if (t && typeof t.isSupport === 'function') {
        try { info.isSupport = t.isSupport('requestCamera'); } catch (e) { info.isSupportError = (e && e.message) || String(e); }
      }
      try {
        if (document.featurePolicy && document.featurePolicy.allowsFeature) info.featurePolicy = document.featurePolicy.allowsFeature('camera');
      } catch (e) {}
      return info;
    },

    checkInputSafety: function (text) {
      var t = sdk();
      if (!t || typeof t.checkInputSafety !== 'function') return Promise.resolve({ pass: true, local: true });
      return invoke('checkInputSafety', [text]);
    },
    share: function (o) { return invoke('share', [o || {}]); },
    sharePicture: function (o) { return invoke('sharePicture', [o || {}]); },
    saveImageToAlbum: function (url) {
      var t = sdk();
      if (t && typeof t.saveImageToAlbum === 'function') return invoke('saveImageToAlbum', [{ url: url, dataUrl: url }]);
      return Bridge.download(url);
    },
    download: function (dataUrl, filename) {
      try {
        var a = document.createElement('a');
        a.href = dataUrl; a.download = filename || ('toy-linux-' + Date.now() + '.png');
        document.body.appendChild(a); a.click();
        setTimeout(function () { a.remove(); }, 800);
        return Promise.resolve({ downloaded: true, local: true });
      } catch (e) { return Promise.reject(mkErr('DOWNLOAD', '保存失败')); }
    },
    navigate: function (url) {
      var t = sdk();
      if (t && typeof t.navigate === 'function') return invoke('navigate', [url]);
      try { location.href = url; return Promise.resolve(true); } catch (e) { return Promise.reject(e); }
    },
    raw: function () { return sdk(); }
  };

  function shortType(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v !== 'object') return typeof v;
    try { return Object.keys(v).slice(0, 6).join(',') || '{}'; } catch (e) { return 'object'; }
  }

  global.LihBridge = Bridge;
})(window);
