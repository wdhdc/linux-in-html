/* Linux in HTML · 引导器与桌面外壳
 * 改编自 Toy Linux 1.9.9 的 boot.js（作者 LING不道，GPL-3.0-or-later）
 * 本文件负责：v86 启动、Debian 磁盘按块加载、IndexedDB 磁盘增量、串口登录与网络配置、
 * 桌面顶栏 / Dock / 电源菜单 / 诊断面板。桌面 UI、窗口管理器、终端与应用来自同源的 Toy Linux 前端。
 */
(function (global) {
  'use strict';

  var S = {};
  function settings() { return (global.LihSys && global.LihSys.settings) || S; }

  var MOBILE = (function () {
    try {
      var n = global.navigator || {};
      var touch = (n.maxTouchPoints || 0) > 0;
      var ua = /Android|iPhone|iPad|iPod|Mobile/i.test(n.userAgent || '');
      var small = (global.innerWidth || 1024) < 900;
      return (touch || ua) && small;
    } catch (e) { return false; }
  })();
  var isLocal = ['localhost', '127.0.0.1', '0.0.0.0', ''].indexOf(location.hostname) >= 0;
  var defaultWisp = (isLocal && location.protocol !== 'file:')
    ? ((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/wisp/')
    : '';
  var qs = new URLSearchParams(location.search);

  var CFG = {
    wasm: 'lib/v86.wasm',
    bios: 'lib/seabios.bin',
    vgabios: 'lib/vgabios.bin',
    kernel: 'images/vmlinuz',
    initrd: 'images/initrd.img',
    diskUrl: 'images/disk.img',
    diskSize: 384 * 1024 * 1024,
    chunk: 32 * 1024 * 1024,
    cmdline: 'console=tty0 console=ttyS0,115200 root=/dev/sda rw',
    vgaMem: 2 * 1024 * 1024
  };
  var ASSET = (qs.get('assets') || '').replace(/\/+$/, '');
  function A(p) { return ASSET ? ASSET + '/' + p : p; }

  var BLOCK = 256;            /* v86 block_cache 以 256 字节为一块 */
  var DB_NAME = 'linux-in-html';

  var serial = '', listeners = [], bytesRx = 0, t0 = 0, kernelVer = '', emu = null;
  var pending = [], dec = new TextDecoder('utf-8');
  var bootErr = null, readyResolve, readyPromise = new Promise(function (r) { readyResolve = r; });
  var bootState = { finished: false, touched: false, tries: 0, man: null, watchdog: null, logReady: false };
  var login = { sent: false, pwSent: false, tries: 0, at: 0, shell: false };
  var net = { relay: '', guest: 'idle', label: '未连接' };

  /* ---------------- 磁盘增量（IndexedDB） ---------------- */
  var overlay = new Map(), writing = new Set(), flushing = false, flushTimer = 0, dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('blocks')) db.createObjectStore('blocks');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    }).catch(function (err) { dbPromise = null; throw err; });
    return dbPromise;
  }
  function loadOverlay() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('blocks', 'readonly');
        var store = tx.objectStore('blocks');
        var req = store.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) return;
          overlay.set(Number(cur.key), new Uint8Array(cur.value));
          cur.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = resolve;
        tx.onabort = resolve;
      });
    }).catch(function (err) {
      console.warn('[lih] 磁盘增量读取失败：', err);
    });
  }
  function flushOverlay() {
    if (flushing || !writing.size) return Promise.resolve();
    flushing = true;
    var ids = Array.from(writing); writing.clear();
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('blocks', 'readwrite');
        var store = tx.objectStore('blocks');
        ids.forEach(function (id) { var b = overlay.get(id); if (b) store.put(b, id); });
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
      });
    }).catch(function (err) { console.warn('[lih] 磁盘增量写回失败：', err); })
      .then(function () {
        flushing = false;
        if (writing.size) return scheduleFlush();
      });
  }
  function scheduleFlush() {
    if (flushTimer || flushing || !writing.size) return;
    flushTimer = setTimeout(function () { flushTimer = 0; flushOverlay(); }, 600);
  }
  function recordWrite(offset, data) {
    var first = Math.floor(offset / BLOCK), last = Math.ceil((offset + data.length) / BLOCK);
    for (var idx = first; idx < last; idx++) {
      var blockStart = idx * BLOCK;
      var from = Math.max(0, blockStart - offset);
      var to = Math.min(data.length, blockStart + BLOCK - offset);
      if (to <= from) continue;
      var block = overlay.get(idx);
      if (!block) block = new Uint8Array(BLOCK);
      block.set(data.subarray(from, to), Math.max(0, offset - blockStart));
      overlay.set(idx, block);
      writing.add(idx);
    }
    scheduleFlush();
  }
  function attachOverlay() {
    var disk = null;
    try {
      var ide = emu && emu.v86 && emu.v86.cpu && emu.v86.cpu.devices && emu.v86.cpu.devices.ide;
      var drive = ide && ide.primary && ide.primary.master;
      var buf = drive && drive.buffer;
      if (buf && typeof buf.set === 'function' && buf.block_cache instanceof Map) disk = buf;
    } catch (e) { disk = null; }
    if (!disk) { console.warn('[lih] 未找到 v86 磁盘缓冲，磁盘增量未挂载'); return false; }
    overlay.forEach(function (bytes, idx) {
      disk.block_cache.set(idx, bytes);
      disk.block_cache_is_write.add(idx);
    });
    var originalSet = disk.set.bind(disk);
    disk.set = function (offset, data, cb) {
      originalSet(offset, data, cb);
      try { recordWrite(offset, data); } catch (e) { console.warn('[lih] 记录磁盘写失败：', e); }
    };
    console.info('[lih] 磁盘增量已挂载：' + overlay.size + ' 块');
    return true;
  }
  function clearDisk() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('blocks', 'readwrite');
        tx.objectStore('blocks').clear();
        tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
      });
    }).then(function () {
      overlay.clear(); writing.clear();
      location.reload();
    });
  }

  /* ---------------- VM API / 串口 exec ----------------
   * 桌面应用通过 exec 在 guest 里执行命令：引导完成后会在 ttyS1（v86 uart1）上再开一个
   * root shell 专门给宿主执行命令用，终端窗口看到的 ttyS0 就不会被内部的 A/B 标记命令刷屏。
   */
  var execListeners = [], execRaw = '', execBytes = [], execPort = 0, execInflight = null;

  function emit(s) {
    serial += s;
    if (serial.length > 400000) serial = serial.slice(-300000);
    listeners.forEach(function (cb) { try { cb(s); } catch (e) {} });
  }
  function pushExecBytes(b) {
    execBytes.push(b & 0xff);
    execRaw += String.fromCharCode(b & 0xff);
    if (execRaw.length > 300000) {
      var cut = execRaw.length - 150000;
      execRaw = execRaw.slice(cut);
      execBytes.splice(0, execBytes.length - execRaw.length);
    }
    if (execInflight) execInflight.check();
  }
  function stripAnsi(s) {
    return String(s).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '')
      .replace(/\x1b[@-_]/g, '');
  }
  function execSend(str) {
    if (!emu) return;
    try {
      if (execPort === 1 && typeof emu.serial_send_bytes === 'function') {
        emu.serial_send_bytes(1, new TextEncoder().encode(str));
      } else {
        emu.serial0_send(str);
      }
    } catch (e) { /* ignore */ }
  }

  var queue = Promise.resolve();
  function exec(cmd, timeout) {
    var job = function () {
      return new Promise(function (resolve) {
        if (!emu || !login.shell) { resolve({ ok: false, out: '虚拟机尚未就绪（还没有拿到 root shell）' }); return; }
        var id = Math.random().toString(36).slice(2, 8);
        var A = '__LIH_', B = 'DONE_' + id + '__';
        var marker = A + B;
        var start = execBytes.length;
        var done = false;
        var timer = null;
        function finish(ok) {
          if (done) return;
          done = true;
          execInflight = null;
          clearInterval(timer);
          var raw = '';
          try { raw = new TextDecoder('utf-8').decode(new Uint8Array(execBytes.slice(start))); } catch (e) { raw = execRaw.slice(start); }
          resolve({ ok: ok, out: clean(raw, marker) });
        }
        execInflight = {
          check: function () {
            if (stripAnsi(execRaw.slice(start)).indexOf(marker) >= 0) finish(true);
          }
        };
        try {
          execSend('A=' + A + '; B=' + B + '; { ' + cmd + ' ; } 2>&1; echo "$A$B"\n');
        } catch (e) { finish(false); return; }
        timer = setInterval(function () {
          if (!done && stripAnsi(execRaw.slice(start)).indexOf(marker) >= 0) finish(true);
        }, 80);
        setTimeout(function () { finish(false); }, timeout || 8000);
      });
    };
    queue = queue.then(job, job);
    return queue;
  }
  function clean(raw, marker) {
    var lines = stripAnsi(raw).replace(/\r/g, '').split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var at = l.indexOf(marker);
      if (at >= 0) {
        /* 命令输出没有换行时，标记会接在最后一行后面：保留标记之前的内容 */
        var pre = l.slice(0, at);
        if (pre.trim()) out.push(pre.replace(/\s+$/, ''));
        break;
      }
      if (l.indexOf('echo "$A$B"') >= 0) continue;
      if (/^A=__LIH_;\s*B=DONE_/.test(l)) continue;
      if (l.indexOf('; } 2>&1; echo "$A$B"') >= 0) continue;
      out.push(l);
    }
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.join('\n');
  }

  function relayForV86() {
    if (!net.relay) return null;
    if (!/^(wss?|wisps?):\/\//i.test(net.relay)) return null;
    return net.relay.replace(/^ws(s?):/i, 'wisp$1:');
  }

  function setNetworkBadge(kind, text) {
    net.guest = kind; net.label = text || text;
    var el = document.getElementById('net-guest-badge');
    if (el) {
      el.textContent = 'guest 网络：' + text;
      el.className = 'badge' + (kind === 'ok' ? '' : kind === 'fail' ? ' off' : ' warn');
    }
    var tb = document.getElementById('tb-network');
    if (tb) tb.classList.toggle('ok', kind === 'ok');
    var note = document.getElementById('net-note');
    if (note) {
      note.textContent = net.relay
        ? ('中继：' + net.relay + (kind === 'ok' ? ' · guest 网络已启用' : ' · guest 网络待配置'))
        : '未配置中继：虚拟机可以启动，但 guest 里没有外网';
    }
  }

  function configureGuestNetwork() {
    if (!net.relay) { setNetworkBadge('off', '无中继'); WM.toast('没有配置 WISP 中继，guest 无法联网'); return Promise.resolve(false); }
    setNetworkBadge('busy', '配置中…');
    var cmd = 'IF=$(ls /sys/class/net | grep -v "^lo" | head -n1); ip link set $IF up; ' +
      'ip addr add 192.168.86.100/24 dev $IF 2>/dev/null; ip route replace default via 192.168.86.1 dev $IF; ' +
      "printf 'nameserver 192.168.86.1\\n' > /etc/resolv.conf; ip -4 addr show $IF | grep 'inet '";
    return exec(cmd, 20000).then(function (r) {
      var ok = /inet 192\.168\.86\.100/.test(r.out || '');
      setNetworkBadge(ok ? 'ok' : 'fail', ok ? '已启用' : '配置失败');
      if (ok) WM.toast('guest 网络已启用（192.168.86.100）');
      return ok;
    }).catch(function () { setNetworkBadge('fail', '配置失败'); return false; });
  }

  var VM = global.LihVM = {
    kernel: '', ready: readyPromise,
    bootError: function () { return bootErr; },
    send: function (s) { if (emu) { try { emu.serial0_send(s); } catch (e) {} } },
    onData: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
    backlog: function () { return serial; },
    uptime: function () { return t0 ? (Date.now() - t0) / 1000 : 0; },
    uptimeText: function () { return t0 ? Math.round((Date.now() - t0) / 1000) + ' 秒' : '—'; },
    bytes: function () { return bytesRx; },
    setMuted: function (m) { try { if (emu && emu.speaker) emu.speaker.muted = m; } catch (e) {} },
    raw: function () { return emu; },
    isRunning: function () { try { return !!(emu && emu.is_running && emu.is_running()); } catch (e) { return false; } },
    exec: exec,
    restart: restart,
    clearDisk: clearDisk,
    configureGuestNetwork: configureGuestNetwork,
    netStatus: function () { return { relay: net.relay, guest: net.guest, label: net.label }; },
    wispDefault: defaultWisp,
    setRelay: function (url) {
      net.relay = url || '';
      try { localStorage.setItem('lih-wisp', net.relay); } catch (e) {}
      setNetworkBadge('off', '未连接');
    },
    diskInfo: function () { return { blocks: overlay.size, pending: writing.size, disabled: !overlay.size && false }; }
  };
  global.VM = VM;

  /* ---------------- 开机动画 ---------------- */
  var lastPct = 0, bootElapsedTimer = null;
  function step(pct, text) {
    lastPct = Math.max(lastPct, Math.min(100, pct));
    var bar = document.getElementById('boot-progress');
    var ph = document.getElementById('boot-phase');
    if (bar) bar.style.width = lastPct + '%';
    if (ph && text) ph.textContent = text;
    var root = document.getElementById('boot');
    if (root) root.style.setProperty('--boot-p', (lastPct / 100).toFixed(3));
    var log = document.getElementById('boot-log');
    if (log && lastPct >= 22 && log.hidden && settings().showLog !== false) log.hidden = false;
    if (log && lastPct >= 24 && !log.classList.contains('show')) {
      log.classList.add('show');
      if (root) root.classList.add('logging');
    }
  }
  function finish() {
    if (bootState.finished) return;
    bootState.finished = true;
    step(100, '就绪');
    disableLiveLog();
    if (bootElapsedTimer) { clearInterval(bootElapsedTimer); bootElapsedTimer = null; }
    setTimeout(function () {
      var s = document.getElementById('boot');
      if (!s) return;
      s.classList.add('out');
      document.body.classList.remove('booting');
      setTimeout(function () { s.hidden = true; }, 650);
      setTimeout(function () {
        if (bootState.touched) return;
        try { if (!document.querySelector('.win')) WM.open(LihApps.terminal); } catch (e) {}
      }, 260);
      WM.toast('已进入桌面 · 终端就是 guest 的 root shell');
    }, 380);
  }
  function fail(err) {
    bootErr = err;
    var msg = (err && err.message) || String(err);
    var ph = document.getElementById('boot-phase');
    if (ph) { ph.textContent = '启动失败：' + msg; ph.classList.add('err'); }
    var s = document.getElementById('boot');
    if (s) { s.classList.add('failed'); s.style.setProperty('--boot-p', '1'); }
    var acts = document.getElementById('boot-actions');
    if (acts) acts.hidden = false;
    var banner = document.getElementById('boot-error');
    if (banner) { banner.hidden = false; banner.querySelector('.be-msg').textContent = msg; }
    document.body.classList.remove('booting');
    try { console.error('[LinuxInHTML] 启动失败：', err); } catch (e) {}
  }

  /* ---------------- 启动虚拟机 ---------------- */

  /* v86 把客户机的 53 端口交给 browser fetch 做 DoH（默认 cloudflare-dns.com）。
   * 公网 DoH 在部分网络里不可达，所以先打到同源 server.js 的 /dns-query（UDP 问真实 DNS），
   * 拿不到 2xx 再回落到 v86 原本的公网 DoH；Pages 上没有该路由时会直接回落。 */
  var dnsProxyInstalled = false;
  function installDnsProxy() {
    if (dnsProxyInstalled) return;
    dnsProxyInstalled = true;
    var raw = global.fetch;
    if (typeof raw !== 'function') return;
    if (!/^https?:$/.test(location.protocol) || location.hostname === '') return;
    var proxyUrl = '/dns-query';
    global.fetch = function (input, init) {
      var isDohPost = typeof input === 'string' && /\/dns-query(\?|$)/.test(input) &&
        init && String(init.method || '').toUpperCase() === 'POST' && init.body;
      if (!isDohPost) return raw.call(global, input, init);
      var opts = {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message' },
        body: init.body,
        cache: 'no-store',
        signal: init.signal
      };
      return raw.call(global, proxyUrl, opts).then(function (res) {
        return res.ok ? res : raw.call(global, input, init);
      }).catch(function () {
        return raw.call(global, input, init);
      });
    };
  }

  function memLadder() {
    var base = parseInt((settings().memSet ? settings().mem : 0), 10) || 256;
    var out = [];
    [base, 320, 256, 192, 128].forEach(function (m) { if (out.indexOf(m) < 0 && m <= base) out.push(m); });
    return out.length ? out : [base];
  }
  function startEmu() {
    installDnsProxy();
    var ladder = memLadder();
    var mbSize = ladder[Math.min(bootState.tries, ladder.length - 1)];
    var Ctor = global.V86 || global.V86Starter;
    if (!Ctor) { fail(new Error('未能加载 v86 运行时（lib/v86.js）')); return; }
    if (typeof WebAssembly === 'undefined') { fail(new Error('当前浏览器不支持 WebAssembly')); return; }
    step(20, '启动虚拟机（客户机内存 ' + mbSize + ' MB）…');
    t0 = Date.now();
    var cfg = {
      wasm_path: CFG.wasm,
      memory_size: mbSize * 1048576,
      vga_memory_size: CFG.vgaMem,
      bios: { url: CFG.bios },
      vga_bios: { url: CFG.vgabios },
      bzimage: { url: A(CFG.kernel) },
      initrd: { url: A(CFG.initrd) },
      hda: {
        url: A(CFG.diskUrl), size: CFG.diskSize, async: true,
        use_parts: true, fixed_chunk_size: CFG.chunk
      },
      cmdline: CFG.cmdline,
      screen_container: document.getElementById('screen_container'),
      autostart: false,
      disable_speaker: true,
      uart1: true
    };
    var relay = relayForV86();
    if (relay) cfg.net_device = { type: 'virtio', relay_url: relay, id: 0 };
    try {
      emu = new Ctor(cfg);
    } catch (e) {
      retryEmu('虚拟机创建失败：' + ((e && e.message) || e));
      return;
    }
    wire(emu);
    clearTimeout(bootState.watchdog);
    bootState.watchdog = setTimeout(function () {
      if (login.shell || bootState.finished) return;
      retryEmu('30 秒内没有收到 guest 的串口输出');
    }, 30000);
    step(26, '虚拟机已启动，等待内核输出…');
  }
  function retryEmu(reason) {
    clearTimeout(bootState.watchdog);
    try { if (emu && emu.destroy) emu.destroy(); } catch (e) {}
    emu = null;
    bootState.tries++;
    var ladder = memLadder();
    if (bootState.tries >= ladder.length) {
      fail(new Error(reason + '（已按 ' + ladder.join('/') + ' MB 依次重试，可能是浏览器内存不足，请关闭其他页面后重试）'));
      return;
    }
    step(20, '重试启动：' + reason);
    setTimeout(startEmu, 500);
  }
  function restart() {
    if (!emu) { WM.toast('虚拟机尚未启动'); return; }
    serial = ''; pending.length = 0;
    login = { sent: false, pwSent: false, tries: 0, at: 0, shell: false };
    bootState.finished = false;
    bootState.shellCalled = false;
    bootState.ran = true;
    execPort = 0; execRaw = ''; execBytes = []; execInflight = null;
    listeners.forEach(function (cb) { try { cb('\x1b[2J\x1b[H'); } catch (e) {} });
    try { emu.restart(); } catch (e) { console.error(e); }
    WM.toast('虚拟机已重启，等待重新登录…');
    step(40, '重启中…');
    setTimeout(function () { step(70, '等待 guest 登录…'); }, 2000);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 在 ttyS1（v86 uart1）再开一个 root shell，专门给宿主 exec 用；
     终端窗口里的 ttyS0 就不会被内部的 A/B 标记命令刷屏。 */
  function ensureExecChannel() {
    execPort = 0; execRaw = ''; execBytes = [];
    VM.send("setsid sh -c 'exec sh </dev/ttyS1 >/dev/ttyS1 2>&1' </dev/null >/dev/null 2>&1 &\r");
    return sleep(350).then(function () {
      execPort = 1;
      return exec('echo LIH_EXEC_OK', 5000);
    }).then(function (r) {
      if (r && r.ok && /LIH_EXEC_OK/.test(r.out || '')) {
        console.info('[lih] 宿主命令通道已启用（ttyS1）');
        return true;
      }
      execPort = 0;
      console.warn('[lih] ttyS1 命令通道不可用，回落 ttyS0');
      return false;
    });
  }

  function wire(e) {
    e.add_listener('emulator-ready', function () {
      step(30, '虚拟机就绪，挂载磁盘增量…');
      attachOverlay();
      if (!bootState.ran) {
        bootState.ran = true;
        try { emu.run(); } catch (err) { retryEmu('启动失败：' + ((err && err.message) || err)); }
      }
    });
    e.add_listener('download-error', function (ev) {
      fail(new Error('资源加载失败：' + (ev && (ev.file_name || ev.url) || '未知文件') + '（检查 images/ 是否完整）'));
    });
    e.add_listener('emulator-started', function () {
      step(40, '内核接管中…');
    });
    e.add_listener('emulator-stopped', function () {
      if (!bootState.finished) fail(new Error('虚拟机意外停止'));
    });
    e.add_listener('serial0-output-byte', function (b) {
      bytesRx++;
      pending.push(b);
      if (pending.length > 8192) flush();
    });
    e.add_listener('serial1-output-byte', pushExecBytes);
    setInterval(flush, 50);
  }

  function flush() {
    if (!pending.length) return;
    var chunk = dec.decode(new Uint8Array(pending), { stream: true });
    pending.length = 0;
    emit(chunk);
    analyzeSerial();
    if (bootTerm) bootTerm.bytes(chunk);
    if (bootState.watchdog) { clearTimeout(bootState.watchdog); bootState.watchdog = null; }
  }

  function tail(n) { return serial.slice(-(n || 4000)); }
  function analyzeSerial() {
    var t = stripAnsi(tail(8000));
    if (!kernelVer) {
      var m = t.match(/Linux version (\S+)/);
      if (m) {
        kernelVer = m[1]; VM.kernel = kernelVer;
        var k = document.getElementById('tb-kernel'); if (k) k.textContent = kernelVer;
        step(60, '内核已接管：' + kernelVer);
      }
    }
    if (/Run \/init as init process/.test(t) && lastPct < 75) step(75, '启动用户空间…');
    var end = t.slice(-500);
    if (!login.sent && /login:\s*$/.test(end) && settings().autologin !== false) {
      login.sent = true; login.at = Date.now();
      VM.send('root\r');
      step(82, '自动登录 guest（root）…');
      return;
    }
    if (login.sent && !login.pwSent && !login.shell && /Password:\s*$/.test(end)) {
      login.pwSent = true;
      VM.send('root\r');
      step(86, '校验 root 密码…');
      return;
    }
    var atShell = /root@[^\r\n:]+:[^\r\n]*#\s*$/.test(end);
    if (!login.shell && atShell) {
      login.shell = true;
      onShellReady();
      return;
    }
    if (!login.shell && login.sent && Date.now() - login.at > 4000 && /login:\s*$/.test(end) && login.tries < 2) {
      login.tries++; login.sent = false; login.pwSent = false;
    }
  }

  function onShellReady() {
    if (bootState.shellCalled) return;
    bootState.shellCalled = true;
    if (bootState.watchdog) { clearTimeout(bootState.watchdog); bootState.watchdog = null; }
    step(94, '已登录 guest，准备宿主命令通道…');
    var done = function () {
      step(99, '完成');
      readyResolve(VM);
      finish();
    };
    ensureExecChannel().then(function (channelOk) {
      step(channelOk ? 96 : 95, channelOk ? '命令通道就绪（ttyS1），配置网络…' : '配置网络（ttyS0 回落）…');
      if (!net.relay) { setNetworkBadge('off', '无中继'); done(); return; }
      return configureGuestNetwork().then(done, done);
    });
  }

  /* ---------------- 引导日志 ---------------- */
  var bootTerm = null, bootElapsedTimer2 = null;
  function startElapsed() {
    if (bootElapsedTimer2) return;
    var t = (global.performance && performance.now()) || Date.now();
    bootElapsedTimer2 = setInterval(function () {
      if (bootState.finished) { clearInterval(bootElapsedTimer2); bootElapsedTimer2 = null; return; }
      var secs = Math.round((((global.performance && performance.now()) || Date.now()) - t) / 1000);
      var ph = document.getElementById('boot-phase');
      if (ph) ph.textContent = ph.textContent.replace(/\s*·?\s*已等待 \d+s$/, '') + ' · 已等待 ' + secs + 's';
      var log = document.getElementById('boot-log');
      var term = document.getElementById('bl-term');
      if (log && log.classList.contains('live') && term && !term.textContent.trim()) {
        term.textContent = '等待 guest 串口输出…（解压与引导需要时间，通常 20-40 秒）';
      }
    }, 500);
  }
  function enableLiveLog() {
    if (settings().showLog === false) return;
    var log = document.getElementById('boot-log');
    var root = document.getElementById('boot');
    if (!log || !root || !root.classList.contains('mini')) return;
    log.hidden = false;
    log.classList.add('live', 'show');
    if (log.parentNode !== document.body) document.body.appendChild(log);
    startElapsed();
  }
  function disableLiveLog() {
    var log = document.getElementById('boot-log');
    if (!log || !log.classList.contains('live')) return;
    log.classList.add('out');
    setTimeout(function () { if (log.parentNode) log.parentNode.removeChild(log); }, 420);
  }

  /* ---------------- 桌面外壳 ---------------- */
  function icon(name) { return '<svg aria-hidden="true"><use href="assets/icons/sprite.svg#i-' + name + '"/></svg>'; }

  function buildDock() {
    var dock = document.getElementById('dock');
    if (!dock) return;
    dock.innerHTML = '';
    LihApps.list.forEach(function (app) {
      var b = document.createElement('button');
      b.className = 'dock-item'; b.dataset.app = app.id; b.dataset.tip = app.title;
      b.innerHTML = icon(app.icon) + '<span class="dot"></span>';
      b.addEventListener('click', function () {
        b.classList.remove('launch'); void b.offsetWidth; b.classList.add('launch');
        var win = WM.open(app);
        try { b.blur(); } catch (e) {}
        var ta = (win && win.el && win.el.querySelector('.term-input')) || document.querySelector('.win.focus .term-input');
        if (ta) { try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (e2) {} } }
      });
      dock.appendChild(b);
    });
    WM.onChange(function (wins) {
      var open = {};
      wins.forEach(function (w) { open[w.app.id] = true; });
      dock.querySelectorAll('.dock-item').forEach(function (b) { b.classList.toggle('running', !!open[b.dataset.app]); });
    });
  }

  function buildActivities() {
    var btn = document.getElementById('tb-activities'), menu = document.getElementById('activities');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); menu.hidden = !menu.hidden;
      btn.classList.toggle('active', !menu.hidden);
      if (!menu.hidden) render();
    });
    document.addEventListener('click', function () { menu.hidden = true; btn.classList.remove('active'); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    function render() {
      menu.innerHTML = '<div class="act-brand"><img src="assets/icons/logo.svg" alt="Linux in HTML"><span>Linux in HTML</span></div><div class="act-title">窗口</div>';
      if (!WM.windows.length) menu.insertAdjacentHTML('beforeend', '<div class="act-empty">没有打开的窗口</div>');
      WM.windows.forEach(function (w) {
        var b = document.createElement('button');
        b.className = 'act-item';
        b.innerHTML = icon(w.app.icon || 'terminal') + '<span></span>';
        b.querySelector('span').textContent = w.title;
        b.onclick = function () { menu.hidden = true; WM.focusApp(w.app.id); };
        menu.appendChild(b);
      });
      menu.insertAdjacentHTML('beforeend', '<div class="act-title">工作区</div><div class="act-ws"></div>');
      var box = menu.querySelector('.act-ws');
      [1, 2].forEach(function (n) {
        var b = document.createElement('button');
        b.className = 'act-item' + (WM.workspace === n ? ' on' : '');
        b.textContent = '工作区 ' + n;
        b.onclick = function () { WM.setWorkspace(n); menu.hidden = true; };
        box.appendChild(b);
      });
    }
  }

  function startClock() {
    var clock = document.getElementById('tb-clock');
    if (!clock) return;
    var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function tick() {
      var d = new Date();
      clock.textContent = days[d.getDay()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    tick(); setInterval(tick, 15000);
  }

  function initNetMenu() {
    var input = document.getElementById('net-wisp');
    if (input) {
      input.value = net.relay;
      input.addEventListener('change', function () { VM.setRelay(input.value.trim()); });
    }
    var relayBadge = document.getElementById('net-relay-badge');
    if (relayBadge) relayBadge.textContent = net.relay ? '已配置中继' : '未配置中继';
    setNetworkBadge(net.guest, net.guest === 'ok' ? '已启用' : net.guest === 'fail' ? '配置失败' : '未配置');
  }

  function bindStatus() {
    var netBtn = document.getElementById('tb-network'), netMenu = document.getElementById('netmenu');
    if (netBtn && netMenu) {
      netBtn.addEventListener('click', function (e) {
        e.stopPropagation(); netMenu.hidden = !netMenu.hidden;
      });
      document.addEventListener('click', function () { netMenu.hidden = true; });
      netMenu.addEventListener('click', function (e) { e.stopPropagation(); });
      netMenu.querySelector('[data-act="reconnect"]').onclick = function () {
        var input = document.getElementById('net-wisp');
        var value = (input && input.value || '').trim();
        if (value && !/^(wss?|wisps?):\/\//i.test(value)) { WM.toast('WISP 地址需要以 ws:// 或 wss:// 开头'); return; }
        VM.setRelay(value);
        if (!confirm('保存中继地址并重新加载页面？当前未落盘的磁盘改动可能丢失。')) return;
        flushOverlay().then(function () { location.reload(); });
      };
      netMenu.querySelector('[data-act="guest-net"]').onclick = function () { configureGuestNetwork(); };
      netMenu.querySelector('[data-act="clear-disk"]').onclick = function () {
        if (!confirm('清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。')) return;
        clearDisk();
      };
    }

    var vol = document.getElementById('tb-volume');
    if (vol) vol.addEventListener('click', function () {
      var s = settings();
      s.sound = !s.sound; LihSys.save(); LihSys.applySettings();
      WM.toast(s.sound ? '扬声器已打开' : '扬声器已静音');
    });

    var power = document.getElementById('tb-power'), menu = document.getElementById('powermenu');
    if (power && menu) {
      power.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
      document.addEventListener('click', function () { menu.hidden = true; });
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.querySelector('[data-act="restart"]').onclick = function () { menu.hidden = true; restart(); };
      menu.querySelector('[data-act="clear-disk"]').onclick = function () {
        menu.hidden = true;
        if (confirm('清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。')) clearDisk();
      };
      menu.querySelector('[data-act="diag"]').onclick = function () {
        menu.hidden = true;
        document.getElementById('diag').hidden = false;
        diagnose();
      };
      menu.querySelector('[data-act="about"]').onclick = function () { menu.hidden = true; WM.open(LihApps.settings); };
    }
  }

  function bindTheme() {
    var btn = document.getElementById('tb-theme');
    if (!btn || !global.LihSys) return;
    function paint() {
      var dark = settings().theme === 'dark';
      btn.innerHTML = icon(dark ? 'sun' : 'moon');
      btn.setAttribute('title', dark ? '切换到亮色主题' : '切换到暗色主题');
      btn.setAttribute('aria-label', btn.getAttribute('title'));
    }
    btn.addEventListener('click', function () {
      var s = settings();
      s.theme = s.theme === 'dark' ? 'light' : 'dark';
      LihSys.save(); LihSys.applySettings(); paint();
    });
    paint();
  }

  function startStats() {
    setInterval(function () {
      var dot = document.getElementById('tb-dot');
      var running = false;
      try { running = !!(emu && emu.is_running && emu.is_running()); } catch (e) {}
      if (dot) dot.className = running ? 'tb-dot live' : 'tb-dot';
      if (kernelVer) { var k = document.getElementById('tb-kernel'); if (k && k.textContent !== kernelVer) k.textContent = kernelVer; }
    }, 1000);
  }

  /* ---------------- 诊断 ---------------- */
  function diagnose() {
    var box = document.getElementById('diag-body');
    if (!box) return;
    box.textContent = '检查中…';
    var rows = [];
    var urls = [CFG.kernel, CFG.initrd, 'images/disk-0-' + CFG.chunk + '.img', CFG.wasm, CFG.bios, 'lib/v86.js', 'assets/js/boot.js', 'assets/js/apps.js'];
    var chain = Promise.resolve();
    urls.forEach(function (u) {
      chain = chain.then(function () {
        var s0 = performance.now();
        return fetch(u, { cache: 'no-store' }).then(function (r) {
          return r.arrayBuffer().then(function (b) {
            rows.push([u, r.status, b.byteLength + ' B', r.headers.get('content-type') || '-', Math.round(performance.now() - s0) + ' ms']);
          });
        }).catch(function (e) { rows.push([u, 'ERR', String(e.message || e), '-', '-']); });
      });
    });
    chain.then(function () {
      var memMB = (settings().memSet ? settings().mem : (MOBILE ? 256 : 256));
      var info = [
        ['WebAssembly', typeof WebAssembly === 'object' ? '支持' : '不支持'],
        ['安全上下文', global.isSecureContext ? '是' : '否'],
        ['设备内存提示', (navigator.deviceMemory || '未知') + ''],
        ['WISP 中继', net.relay || '未配置'],
        ['guest 网络', net.guest === 'ok' ? '已启用（192.168.86.100）' : net.guest === 'busy' ? '配置中' : net.guest === 'fail' ? '配置失败' : '未配置'],
        ['串口输出', bytesRx + ' 字节'],
        ['内核', kernelVer || '未识别'],
        ['磁盘增量', overlay.size + ' 块（' + (overlay.size * BLOCK / 1024).toFixed(0) + ' KB）'],
        ['客户机内存', memMB + ' MB']
      ];
      var html = '<table><tr><th>资源</th><th>状态</th><th>大小</th><th>类型</th><th>耗时</th></tr>';
      rows.forEach(function (r) { html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>'; });
      html += '</table><table>';
      info.forEach(function (r) { html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; });
      box.innerHTML = html + '</table>';
    });
  }
  function cameraPolicy() {
    try {
      if (document.featurePolicy && document.featurePolicy.allowsFeature) {
        return document.featurePolicy.allowsFeature('camera') ? '允许（featurePolicy）' : '未放行（featurePolicy）';
      }
    } catch (e) {}
    return '无法读取（浏览器无 featurePolicy）';
  }

  /* ---------------- 主流程 ---------------- */
  function loadSettings() {
    if (global.LihSys) { LihSys.load(); LihSys.applySettings(); S = LihSys.settings; }
    net.relay = (qs.get('wisp') || localStorage.getItem('lih-wisp') || defaultWisp || '').trim();
    if (net.relay && !/^(wss?|wisps?):\/\//i.test(net.relay)) net.relay = '';
  }

  function main() {
    if (location.protocol === 'file:') {
      fail(new Error('请用 node server.js 启动本地服务后访问 http://127.0.0.1:8080/；直接双击 index.html 时浏览器不允许读取虚拟机镜像。'));
      return;
    }
    loadSettings();
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      global.addEventListener(ev, function () { bootState.touched = true; }, { passive: true });
    });
    if (global.LihTerm && document.getElementById('bl-term')) {
      bootTerm = new global.LihTerm(document.getElementById('bl-term'), { cursor: false });
    }
    if (global.LihBridge && LihBridge.init) LihBridge.init();
    WM.init();
    buildDock(); buildActivities(); startClock(); bindStatus(); bindTheme(); initNetMenu();
    try { if (global.LihExtras && LihExtras.renderDeskApps) LihExtras.renderDeskApps(); } catch (e) {}
    startStats();
    var skip = document.getElementById('boot-skip');
    if (skip) skip.addEventListener('click', finish);
    var retry = document.getElementById('boot-retry');
    if (retry) retry.addEventListener('click', function () { location.reload(); });
    var dclose = document.getElementById('diag-close');
    if (dclose) dclose.addEventListener('click', function () { document.getElementById('diag').hidden = true; });
    var beRetry = document.getElementById('boot-error-retry');
    if (beRetry) beRetry.addEventListener('click', function () { location.reload(); });
    var beDiag = document.getElementById('boot-error-diag');
    if (beDiag) beDiag.addEventListener('click', function () { document.getElementById('diag').hidden = false; diagnose(); });

    setTimeout(function () {
      var s = document.getElementById('boot');
      if (s && !bootState.finished) { s.classList.add('mini'); enableLiveLog(); startElapsed(); }
    }, 900);

    step(3, '读取内核与磁盘镜像…');
    Promise.resolve(loadOverlay()).then(function () {
      step(10, '探测资源可用性…');
      return Promise.all([
        fetch(A(CFG.kernel), { method: 'HEAD' }).then(function (r) { if (!r.ok) throw new Error('内核 HTTP ' + r.status); }),
        fetch(A(CFG.initrd), { method: 'HEAD' }).then(function (r) { if (!r.ok) throw new Error('initrd HTTP ' + r.status); }),
        fetch(A('images/disk-0-' + CFG.chunk + '.img'), { method: 'HEAD' }).then(function (r) { if (!r.ok) throw new Error('磁盘分块 HTTP ' + r.status); })
      ]);
    }).then(function () {
      step(15, '加载引擎…');
      try {
        if (global.WebAssembly && WebAssembly.compileStreaming) {
          WebAssembly.compileStreaming(fetch(CFG.wasm)).catch(function () {});
        }
      } catch (e) {}
      return new Promise(function (r) { setTimeout(r, 60); });
    }).then(function () {
      startEmu();
    }).catch(function (e) {
      fail(new Error('启动资源缺失：' + ((e && e.message) || e) + '。请确认用 node server.js 启动并且 images/、lib/ 完整。'));
    });

    global.addEventListener('pagehide', function () { flushOverlay(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushOverlay();
    });
    setTimeout(function () {
      if (!login.shell && !bootState.finished && !bootErr) {
        fail(new Error('90 秒内没有完成登录（检查控制台串口日志，或点诊断看资源加载情况）'));
      }
    }, 90000);
  }

  global.LihBoot = {
    diagnose: diagnose, fail: fail, cameraPolicy: cameraPolicy,
    finish: finish, restart: restart,
    configureGuestNetwork: configureGuestNetwork
  };
  global.ToyBoot = global.LihBoot;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})(window);
