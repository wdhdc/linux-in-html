/* Linux in HTML · 首启向导、串口文件注入、设置扩展（改编自 Toy Linux 的 extras.js，作者 LING不道，GPL-3.0-or-later）
 * 依赖 WM / LihApps / VM；guest 默认以 root 登录，无需 sudo。 */
(function (global) {
  var FR_KEY = 'lih:firstrun';
  var DB_NAME = 'lih-files', STORE = 'files';

  function cfg() { try { return JSON.parse(localStorage.getItem(FR_KEY) || 'null'); } catch (e) { return null; } }
  function saveCfg(c) { localStorage.setItem(FR_KEY, JSON.stringify(c)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function q(s) { return document.querySelector(s); }

  /* ---------------- 首启向导 ---------------- */
  var WIZ = { step: 1, host: 'debian-vm', tz: 'Asia/Shanghai', theme: 'light' };
  function validHost(h) { return /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(h); }
  function renderWizard() {
    var old = document.getElementById('wiz'); if (old) old.remove();
    if (cfg() && cfg().done) return;
    var s = (global.LihSys && LihSys.settings) || {};
    if (WIZ.step === 1) WIZ.host = WIZ.host || s.host || 'debian-vm';
    if (WIZ.step === 2) WIZ.tz = s.tz || 'Asia/Shanghai';
    if (WIZ.step === 3) WIZ.theme = s.theme || 'light';
    var root = document.createElement('div');
    root.id = 'wiz';
    root.innerHTML =
      '<div class="wiz-card wiz-step" data-step="' + WIZ.step + '">' +
      '<div class="wiz-logo"><img src="assets/icons/logo.svg" alt=""></div>' +
      '<div class="wiz-title">Linux in HTML 初始设置</div>' +
      '<div class="wiz-steps"><i class="' + (WIZ.step >= 1 ? 'on' : '') + '"></i><i class="' + (WIZ.step >= 2 ? 'on' : '') + '"></i><i class="' + (WIZ.step >= 3 ? 'on' : '') + '"></i></div>' +
      wizBody() +
      '<div class="wiz-foot">' +
      (WIZ.step > 1 ? '<button class="tbtn" id="wiz-back">上一步</button>' : '<span class="tiny">登录固定为 root / root，可在设置里改主机名与时区</span>') +
      '<span class="wiz-gap"></span>' +
      '<button class="tbtn" id="wiz-skip">跳过</button>' +
      '<button class="tbtn primary" id="wiz-next">' + (WIZ.step === 3 ? '完成' : '下一步') + '</button>' +
      '</div><div class="wiz-err" id="wiz-err"></div></div>';
    document.body.appendChild(root);
    var err = function (m) { root.querySelector('#wiz-err').textContent = m || ''; };
    if (WIZ.step === 1) {
      var hi = root.querySelector('#wiz-host');
      hi.value = WIZ.host;
      hi.oninput = function () { WIZ.host = hi.value.trim(); };
      hi.focus();
    }
    if (WIZ.step === 2) {
      var sel = root.querySelector('#wiz-tz');
      sel.value = WIZ.tz;
      sel.onchange = function () { WIZ.tz = sel.value; };
    }
    if (WIZ.step === 3) {
      var th = root.querySelector('#wiz-theme');
      th.value = WIZ.theme;
      th.onchange = function () { WIZ.theme = th.value; };
    }
    root.querySelector('#wiz-skip').onclick = function () {
      saveCfg({ done: true, host: 'debian-vm', tz: 'Asia/Shanghai', theme: 'light', skipped: true });
      root.remove();
      applyWizard();
    };
    if (root.querySelector('#wiz-back')) root.querySelector('#wiz-back').onclick = function () { WIZ.step = Math.max(1, WIZ.step - 1); renderWizard(); };
    root.querySelector('#wiz-next').onclick = function () {
      if (WIZ.step === 1) {
        if (!validHost(WIZ.host || '')) { err('主机名只能用小写字母、数字与连字符，2-32 位'); return; }
        WIZ.step = 2; renderWizard(); return;
      }
      if (WIZ.step === 2) { WIZ.step = 3; renderWizard(); return; }
      saveCfg({ done: true, host: WIZ.host, tz: WIZ.tz, theme: WIZ.theme, skipped: false });
      root.remove(); applyWizard();
    };
  }
  function applyWizard() {
    var c = cfg() || {};
    if (global.LihSys) {
      if (c.host) LihSys.settings.host = c.host;
      if (c.tz) LihSys.settings.tz = c.tz;
      if (c.theme) LihSys.settings.theme = c.theme;
      LihSys.save(); LihSys.applySettings();
    }
    provisionSoon();
  }
  function wizBody() {
    if (WIZ.step === 1) return '<label class="wiz-lab">主机名<input id="wiz-host" class="wiz-in" spellcheck="false"></label><p class="tiny">它会出现在提示符与 uname 里。</p>';
    if (WIZ.step === 2) return '<label class="wiz-lab">时区<select id="wiz-tz" class="wiz-in">' +
      [['Asia/Shanghai', 'Asia/Shanghai（中国）'], ['UTC', 'UTC'], ['Asia/Tokyo', 'Asia/Tokyo'], ['Europe/London', 'Europe/London'], ['America/New_York', 'America/New_York']]
        .map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') +
      '</select></label><p class="tiny">会写入 guest 的 /etc/timezone 与 /etc/localtime。</p>';
    return '<label class="wiz-lab">主题<select id="wiz-theme" class="wiz-in">' +
      '<option value="light">亮色（Adwaita）</option><option value="dark">暗色（Yaru Dark）</option>' +
      '</select></label><p class="tiny">随时可以点顶栏右侧的圆点按钮切换。</p>';
  }

  /* ---------------- 串口落账号 ---------------- */
  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function provisionSoon() {
    var tries = 0;
    (function tick() {
      var vm = global.VM, ready = vm && vm.raw && vm.raw();
      var booted = !document.body.classList.contains('booting');
      if (!ready || !booted) {
        if (tries++ < 240) return setTimeout(tick, 500);
        showProvision(['虚拟机未就绪，配置未能写入（刷新后可重试）']); return;
      }
      /* 等 VM 的 ready（root shell 与网络就绪）后再写，避免开机瞬间 exec 失败 */
      var wait = (global.LihVM && global.LihVM.ready) ? global.LihVM.ready : Promise.resolve();
      Promise.resolve(wait).then(function () {
        return Promise.resolve(provision(vm, cfg() || { host: 'debian-vm', tz: 'Asia/Shanghai' }));
      }).then(function () { return replayDebs(vm); }).catch(function () {});
    })();
  }
  function provision(vm, c) {
    var out = [];
    var host = c.host || 'debian-vm';
    var tz = c.tz || 'Asia/Shanghai';
    var cmds = [
      ['hostname', 'hostname ' + shq(host) + '; printf %s ' + shq(host) + ' | tee /etc/hostname >/dev/null && echo HOST_OK'],
      ['timezone', 'printf "TIMEZONE=%s\n" ' + shq(tz) + ' | tee /etc/timezone >/dev/null; if [ -e /usr/share/zoneinfo/' + tz + ' ]; then ln -sf /usr/share/zoneinfo/' + tz + ' /etc/localtime; fi; echo TZ_OK'],
      ['verify', 'hostname; cat /etc/timezone 2>/dev/null; date']
    ];
    function waitQuiet(n) {
      return vm.exec('echo SHELL_READY', 6000).then(function (r) {
        if (/SHELL_READY/.test(r.out || '')) return true;
        if (n <= 0) return false;
        return sleep(700).then(function () { return waitQuiet(n - 1); });
      });
    }
    function runOnce(pair) { return vm.exec(pair[1], 12000).then(function (r) { return { out: (r.out || '').trim(), ok: r.ok }; }); }
    return waitQuiet(6).then(function (ready) {
      if (!ready) out.push('提示：串口暂时没有应答，仍按序执行');
      var seq = Promise.resolve();
      cmds.forEach(function (pair) {
        seq = seq.then(function () {
          return runOnce(pair).then(function (r) {
            out.push('$ ' + pair[1] + '\n' + (r.out || '(无输出)'));
            if (!r.ok) out.push('  → ' + pair[0] + ' 超时未返回');
          });
        }).then(function () { return sleep(120); });
      });
      return seq;
    }).then(function () { global.LihProvisionLog = out; showProvision(out); });
  }

  function showProvision(lines) {
    /* 不再弹浮动面板：配置结果只写控制台，桌面保持干净 */
    try { console.info('[lih] guest 配置结果：\n' + lines.join('\n')); } catch (e) {}
  }

  /* ---------------- IndexedDB 文件库 ---------------- */
  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode) { return db().then(function (d) { return d.transaction(STORE, mode).objectStore(STORE); }); }
  function put(rec) { return tx('readwrite').then(function (s) { return new Promise(function (res, rej) { var q = s.put(rec); q.onsuccess = function () { res(rec); }; q.onerror = function () { rej(q.error); }; }); }); }
  function all() { return tx('readonly').then(function (s) { return new Promise(function (res, rej) { var q = s.getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { rej(q.error); }; }); }); }
  function del(id) { return tx('readwrite').then(function (s) { return new Promise(function (res) { var q = s.delete(id); q.onsuccess = function () { res(); }; q.onerror = function () { res(); }; }); }); }
  function clearAll() { return tx('readwrite').then(function (s) { return new Promise(function (res) { var q = s.clear(); q.onsuccess = function () { res(); }; q.onerror = function () { res(); }; }); }); }

  function sha256(buf) {
    if (!(global.crypto && crypto.subtle)) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', buf).then(function (h) {
      return [].map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }

  var UP = { busy: false, cancel: false, progress: 0, msg: '' };
  function guestDir() { return '/root/uploads'; }
  function inject(vm, rec, onProgress) {
    var name = rec.name;
    var finalPath = guestDir() + '/' + name;
    var tmp = '/tmp/.lihup-' + Math.random().toString(36).slice(2, 8);
    var data = new Uint8Array(rec.data);
    var CH = 1024;
    var total = Math.ceil(data.length / CH), k = 0;
    var prep = ': > ' + shq(tmp) + ' && echo READY';
    return vm.exec(prep, 8000).then(function (r) {
      if (!r.ok) throw new Error('串口写超时（准备临时文件失败）');
      var chain = Promise.resolve();
      for (k = 0; k < total; k++) (function (k) {
        chain = chain.then(function () {
          if (UP.cancel) throw new Error('已取消');
          var chunk = data.subarray(k * CH, Math.min(data.length, (k + 1) * CH));
          var cmd = "printf %s " + shq(b64(chunk)) + " | base64 -d >> " + shq(tmp) + " && echo ACK";
          return withAck(vm, cmd, 3).then(function () {
            UP.progress = (k + 1) / total;
            if (onProgress) onProgress(UP.progress, k + 1, total);
          });
        });
      })(k);
      return chain;
    }).then(function () {
      var land = 'mkdir -p ' + shq(guestDir()) + ' && mv -f ' + shq(tmp) + ' ' + shq(finalPath) + ' && echo LANDED';
      return vm.exec(land, 12000);
    }).then(function (r) {
      if (!(r.ok && /LANDED/.test(r.out || ''))) throw new Error('落盘失败：' + (r.out || '无输出'));
      return vm.exec('sha256sum ' + shq(finalPath) + ' | cut -d" " -f1; stat -c %s ' + shq(finalPath), 12000);
    }).then(function (r) {
      var lines = (r.out || '').trim().split('\n');
      var gotSha = (lines[0] || '').trim(), gotSize = parseInt(lines[1] || '0', 10);
      if (gotSize !== data.length) throw new Error('校验不符：字节数 ' + gotSize + ' ≠ ' + data.length);
      if (rec.sha256 && gotSha && gotSha !== rec.sha256) throw new Error('校验不符：sha256 不一致');
      return { path: finalPath, sha256: gotSha, size: gotSize };
    });
  }
  function withAck(vm, cmd, tries) {
    return vm.exec(cmd, 12000).then(function (r) {
      if (r.ok && /(^|\n)ACK\s*$/m.test((r.out || '').trim())) return true;
      if (tries > 1) return withAck(vm, cmd, tries - 1);
      throw new Error('串口写超时（ACK 未返回）');
    });
  }

  /* ---------------- 上传面板 ---------------- */
  function classify(err, rec) {
    var m = String(err && err.message || err);
    if (/已取消/.test(m)) return '已取消';
    if (/校验不符/.test(m)) return '校验不符';
    if (/超时/.test(m)) return '串口写超时';
    if (/memory|内存/i.test(m)) return '内存不足';
    if (rec && rec.size > 40 * 1024 * 1024) return '超体积（单文件上限 40 MB）';
    return '失败：' + m;
  }


  /* ---- 用户自带 deb：装进虚机并出现在桌面 ---- */
  var APPKEY = 'lih:deskapps';
  function savedApps() { try { return JSON.parse(localStorage.getItem(APPKEY) || '[]'); } catch (e) { return []; } }
  function saveApps(a) { try { localStorage.setItem(APPKEY, JSON.stringify(a)); } catch (e) {} renderDeskApps(); }
  function renderDeskApps() {
    var desk = document.getElementById('desktop'); if (!desk) return;
    var box = document.getElementById('desk-icons');
    if (!box) { box = document.createElement('div'); box.id = 'desk-icons'; desk.appendChild(box); }
    var apps = savedApps(); box.innerHTML = '';
    apps.forEach(function (a) {
      var b = document.createElement('button'); b.className = 'desk-app'; b.title = a.exec;
      b.innerHTML = '<span class="da-ic"></span><span class="da-nm">' + a.name + '</span>';
      b.onclick = function () { launchGuest(a); };
      b.oncontextmenu = function (ev) { ev.preventDefault(); if (confirm('从桌面移除 ' + a.name + '？')) saveApps(savedApps().filter(function (x) { return x.id !== a.id; })); };
      box.appendChild(b);
    });
  }
  function launchGuest(a) {
    var vm = global.VM;
    if (!vm || !vm.raw()) { WM.toast('虚拟机尚未启动，无法运行 ' + a.name); return; }
    WM.open(LihApps.terminal);
    setTimeout(function () {
      vm.exec('cd /root 2>/dev/null; (' + a.exec + ') 2>&1 | head -200', 20000).then(function (r) {
        WM.toast(a.name + '：' + ((r.out || '').split('\n').slice(-1)[0] || '已启动'));
      });
    }, 400);
  }
  function replayDebs(vm) {
    return all().then(function (recs) {
      var debs = recs.filter(function (r) { return /\.deb$/i.test(r.name); });
      if (!debs.length) return null;
      var seq = Promise.resolve();
      debs.forEach(function (rec) {
        seq = seq.then(function () {
          return inject(vm, rec).then(function (res) { return installDeb(vm, res.path, rec.name); }).catch(function () {});
        });
      });
      return seq;
    });
  }
  function installDeb(vm, path, name) {
    return vm.exec('mkdir -p /usr/share/applications /usr/share/icons /usr/share/pixmaps; dpkg -i ' + path + ' 2>&1; echo RC=$?', 60000).then(function (r) {
      var out = r.out || '';
      if (!/RC=0/.test(out)) return { ok: false, out: out };
      return vm.exec('p=$(dpkg-deb -f ' + path + ' Package 2>/dev/null); echo PKG=$p; dpkg -L "$p" 2>/dev/null | grep "\.desktop$" | head -3', 20000).then(function (r2) {
        var pkg = ((r2.out || '').match(/PKG=(\S+)/) || [])[1] || name.replace(/\.deb$/, '');
        var files = (r2.out || '').split('\n').filter(function (l) { return /\.desktop$/.test(l); });
        if (!files.length) return { ok: true, pkg: pkg, app: null, out: out };
        return vm.exec('grep -h -m1 "^Name=" ' + files[0] + '; grep -h -m1 "^Exec=" ' + files[0], 15000).then(function (r3) {
          var t = r3.out || '';
          var nm = ((t.match(/^Name=(.+)$/m) || [])[1] || pkg).trim();
          var ex = ((t.match(/^Exec=(.+)$/m) || [])[1] || '').replace(/%[fFuU]/g, '').trim();
          if (ex) { var list = savedApps().filter(function (x) { return x.id !== pkg; }); list.push({ id: pkg, name: nm, exec: ex }); saveApps(list); }
          return { ok: true, pkg: pkg, app: ex ? { name: nm, exec: ex } : null, out: out };
        });
      });
    });
  }

  function openUploads() {
    var app = {
      id: 'uploads', title: '已上传文件', icon: 'files', width: 680, height: 480,
      mount: function (body) {
        body.innerHTML = '<div class="up-wrap"><div class="up-top">' +
          '<label class="tbtn primary">选择文件<input type="file" id="up-file" style="display:none"></label>' +
          '<span class="tiny" id="up-hint">也可以把文件拖进这个窗口</span><span class="wiz-gap"></span>' +
          '<span class="tiny" id="up-use"></span></div>' +
          '<div class="up-drop" id="up-drop">拖拽到这里，或点「选择文件」</div>' +
          '<div class="up-prog" id="up-prog" hidden><div class="up-bar"><i></i></div><span class="tiny" id="up-msg"></span>' +
          '<button class="tbtn" id="up-cancel">取消</button></div>' +
          '<div class="up-list" id="up-list"></div></div>';
        var listEl = body.querySelector('#up-list'), drop = body.querySelector('#up-drop');
        var prog = body.querySelector('#up-prog'), bar = prog.querySelector('i'), msg = body.querySelector('#up-msg');
        var useEl = body.querySelector('#up-use');

        function refresh() {
          all().then(function (recs) {
            var used = recs.reduce(function (a, r) { return a + (r.size || 0); }, 0);
            useEl.textContent = '本地缓存 ' + recs.length + ' 个文件 · ' + (used / 1048576).toFixed(2) + ' MB';
            if (!recs.length) { listEl.innerHTML = '<div class="tiny" style="padding:8px">还没有文件。上传的文件只存在浏览器 IndexedDB 里，需要时再注入虚拟机。</div>'; return; }
            listEl.innerHTML = '';
            recs.sort(function (a, b) { return b.ts - a.ts; }).forEach(function (r) {
              var row = document.createElement('div'); row.className = 'up-row';
              row.innerHTML = '<b>' + r.name + '</b><span class="tiny">' + (r.size / 1024).toFixed(1) + ' KB · ' + (r.sha256 || '').slice(0, 12) + ' · ' + (r.guest || '') + '</span>';
              var b1 = document.createElement('button'); b1.className = 'tbtn'; b1.textContent = '重新注入';
              var b2 = document.createElement('button'); b2.className = 'tbtn'; b2.textContent = '下载';
              var b3 = document.createElement('button'); b3.className = 'tbtn'; b3.textContent = '删除';
              b1.onclick = function () { if (UP.busy) return; runInject(r); };
              b2.onclick = function () {
                var blob = new Blob([r.data]); var a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = r.name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
              };
              b3.onclick = function () { del(r.id).then(refresh); };
              row.appendChild(b1); row.appendChild(b2); row.appendChild(b3);
              listEl.appendChild(row);
            });
          });
        }
        function runInject(rec) {
          var vm = global.VM;
          if (!vm || !vm.raw()) { msg.textContent = '虚拟机尚未启动'; prog.hidden = false; return; }
          UP.busy = true; UP.cancel = false; prog.hidden = false; bar.style.width = '0%';
          msg.textContent = '注入 ' + rec.name + ' …';
          inject(vm, rec, function (p, i, n) { bar.style.width = (p * 100).toFixed(1) + '%'; msg.textContent = '注入 ' + rec.name + ' ' + i + '/' + n; })
            .then(function (res) {
              prog.classList.add('done');
              msg.textContent = '完成：' + res.path + '（' + res.size + ' 字节，sha256 ' + (res.sha256 || '').slice(0, 12) + '…）';
              rec.guest = res.path; rec.sha256 = res.sha256 || rec.sha256; put(rec).then(refresh);
              if (/\.deb$/i.test(rec.name)) {
                msg.textContent = '安装包已注入，正在用 dpkg 安装…';
                installDeb(vm, res.path, rec.name).then(function (r) {
                  if (!r.ok) { msg.textContent = 'dpkg 安装失败：' + ((r.out || '').split('\n').slice(-3).join(' ')); return; }
                  msg.textContent = r.app ? ('已安装 ' + r.pkg + '，桌面已添加 ' + r.app.name) : ('已安装 ' + r.pkg + '（没有 .desktop，未加桌面图标）');
                }).catch(function (e) { msg.textContent = '安装出错：' + (e && e.message || e); });
              }
            })
            .catch(function (e) { msg.textContent = classify(e, rec); })
            .then(function () { UP.busy = false; });
        }
        function handle(file) {
          if (!file) return;
          if (file.size > 40 * 1024 * 1024) { msg.textContent = '超体积：单文件上限 40 MB'; prog.hidden = false; return; }
          var rd = new FileReader();
          rd.onload = function () {
            var buf = rd.result;
            sha256(buf).then(function (h) {
              var rec = { id: 'f' + Date.now() + Math.random().toString(36).slice(2, 6), name: file.name, size: buf.byteLength, sha256: h, data: buf, ts: Date.now(), guest: guestDir() + '/' + file.name };
              put(rec).then(function () { refresh(); runInject(rec); });
            });
          };
          rd.readAsArrayBuffer(file);
        }
        body.querySelector('#up-file').onchange = function (e) { handle(e.target.files[0]); };
        ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
        ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
        drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
        prog.querySelector('#up-cancel').onclick = function () { UP.cancel = true; msg.textContent = '正在取消…'; };
        refresh();
      }
    };
    try { WM.open(app); } catch (e) { console.error(e); }
  }

  /* ---------------- 设置项与应用 ---------------- */
  function applyLook() {
    var s = (global.LihSys && global.LihSys.settings) || {};
    try { var raw = JSON.parse(localStorage.getItem('lih:settings') || '{}'); for (var k in raw) s[k] = raw[k]; } catch (e) {}
    document.documentElement.dataset.theme = s.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('no-anim', s.anims === false);
    document.documentElement.style.setProperty('--term-size', (s.termSize || 13) + 'px');
    if (s.termFont) document.documentElement.style.setProperty('--term-font', s.termFont);
  }
  function cacheUsage() {
    if (!global.caches) return Promise.resolve(null);
    return caches.keys().then(function (keys) {
      if (!keys.length) return { keys: [], bytes: 0 };
      return caches.open(keys[0]).then(function (c) { return c.keys(); }).then(function (reqs) {
        return Promise.all(reqs.map(function (r) { return caches.match(r).then(function (res) { return res ? res.blob() : null; }).then(function (b) { return b ? b.size : 0; }); }))
          .then(function (sizes) { return { keys: keys, bytes: sizes.reduce(function (a, b) { return a + b; }, 0) }; });
      });
    }).catch(function () { return null; });
  }
  function clearCache() {
    if (!global.caches) return Promise.resolve();
    return caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); });
  }
  function applyProvisionNow() { provisionSoon(); }

  global.LihExtras = {
    renderWizard: renderWizard, provisionSoon: provisionSoon, applyProvisionNow: applyProvisionNow,
    openUploads: openUploads, renderDeskApps: renderDeskApps, installDeb: installDeb, replayDebs: replayDebs, applyLook: applyLook, cacheUsage: cacheUsage, clearCache: clearCache,
    uploadsClear: clearAll, uploadsList: all, cfg: cfg
  };

  document.addEventListener('DOMContentLoaded', function () {
    applyLook();
    setTimeout(renderWizard, 60);
  });
})(window);
