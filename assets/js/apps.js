/* Linux in HTML · 系统应用（改编自 Toy Linux 的 apps.js，作者 LING不道，GPL-3.0-or-later）
 * 文件 / 编辑器 / 系统信息通过串口读写真实 Debian 虚拟机。 */
(function (global) {
  'use strict';
  var B = global.LihBridge;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) { var d = document.createElement(tag); if (cls) d.className = cls; if (text !== undefined) d.textContent = text; return d; }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function docsBase() {
    var path = location.pathname.replace(/index\.html$/, '');
    if (!/\/$/.test(path)) path += '/';
    return path;
  }
  function docLinksHTML() {
    var base = docsBase();
    return '<p class="about-links">' +
      '<a class="tbtn" href="' + base + 'usage.html" target="_blank" rel="opener">打开使用说明</a> ' +
      '<a class="tbtn" href="' + base + 'licenses/GPL-3.0.md" target="_blank" rel="opener">GPL-3.0 全文</a> ' +
      '<a class="tbtn" href="' + base + 'THIRD-PARTY-NOTICES.md" target="_blank" rel="opener">第三方许可</a></p>';
  }

  function icon(n) { return '<svg aria-hidden="true"><use href="assets/icons/sprite.svg#i-' + n + '"/></svg>'; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

  var Sys = global.LihSys = {
    photos: [], fsIndex: null, fsLoaded: false,
    settings: { wallpaper: 1, scale: 1, sound: true, theme: 'light', anims: true, termSize: 13, termFont: '', mem: 256, memSet: false, tz: 'Asia/Shanghai', keymap: 'us', autologin: true, showLog: true, host: 'debian-vm' },
    load: function () {
      try {
        var s = JSON.parse(localStorage.getItem('lih:settings') || 'null');
        if (s) Object.assign(Sys.settings, s);
        var p = JSON.parse(localStorage.getItem('lih:photos') || '[]');
        if (p && p.length) Sys.photos = p;
      } catch (e) {}
    },
    save: function () {
      try {
        localStorage.setItem('lih:settings', JSON.stringify(Sys.settings));
        localStorage.setItem('lih:photos', JSON.stringify(Sys.photos.slice(-24)));
      } catch (e) {}
    },
    applySettings: function () {
      var d = document.getElementById('desktop');
      if (d) d.className = 'wp-' + Sys.settings.wallpaper;
      document.documentElement.style.fontSize = (13 * Sys.settings.scale) + 'px';
      document.documentElement.dataset.theme = Sys.settings.theme === 'dark' ? 'dark' : 'light';
      if (global.VM && global.VM.setMuted) global.VM.setMuted(!Sys.settings.sound);
      if (global.LihExtras && global.LihExtras.applyLook) global.LihExtras.applyLook();
    },
    addPhoto: function (url, meta) {
      var p = { id: 'p' + Date.now(), url: url, t: new Date().toLocaleString('zh-CN'), meta: meta || '' };
      Sys.photos.push(p); Sys.save(); return p;
    },
    loadFs: function () {
      if (Sys.fsLoaded) return Promise.resolve(Sys.fsIndex);
      Sys.fsLoaded = true;
      Sys.fsIndex = { map: {}, items: [], root: '/', count: 0 };
      return Promise.resolve(Sys.fsIndex);
    }
  };

  /* ---------- 终端 ---------- */
  var termApp = {
    id: 'terminal', title: '终端', icon: 'terminal', width: 780, height: 480,
    mount: function (body, api) {
      var wrap = el('div', 'term-wrap');
      body.appendChild(wrap);
      var view = el('div', 'app-term');
      wrap.appendChild(view);
      /* 移动端软键盘：用透明 textarea 作输入代理，必须在用户手势内聚焦 */
      var proxy = document.createElement('textarea');
      proxy.className = 'term-input';
      proxy.setAttribute('autocapitalize', 'off');
      proxy.setAttribute('autocorrect', 'off');
      proxy.setAttribute('autocomplete', 'off');
      proxy.setAttribute('spellcheck', 'false');
      proxy.setAttribute('aria-label', '终端输入');
      proxy.rows = 1;
      wrap.appendChild(proxy);
      function focusTerm() { try { proxy.focus({ preventScroll: true }); } catch (e) { try { proxy.focus(); } catch (e2) {} } }
      var t = new global.LihTerm(view, { cursor: true });
      t.bytes(global.VM ? global.VM.backlog() : '');
      var off = global.VM ? global.VM.onData(function (s) { t.bytes(s); }) : null;
      var KEYS = { ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
        Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', Escape: '\x1b', PageUp: '\x1b[5~', PageDown: '\x1b[6~' };
      function selText() { var s = String(window.getSelection ? window.getSelection() : ''); return s; }
      function onKey(e) {
        /* 1.9.9：view 与 proxy 都挂了监听时，冒泡会让同一个事件进两次；用标记去重 */
        if (e.__toyKeyHandled) return;
        e.__toyKeyHandled = true;
        e.stopPropagation();
        if (!global.VM) return;
        var k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.shiftKey && (k === 'C' || k === 'c')) {
          var sel = selText();
          if (sel && navigator.clipboard) { e.preventDefault(); navigator.clipboard.writeText(sel); return; }
        }
        if (ctrl && e.shiftKey && (k === 'V' || k === 'v')) {
          e.preventDefault();
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(function (txt) { if (txt) global.VM.send(txt.replace(/\r\n/g, '\r')); }).catch(function () {});
          }
          return;
        }
        if (ctrl && !e.shiftKey && k.toLowerCase() === 'l') { e.preventDefault(); t.clear(); global.VM.send('\x0c'); return; }
        if (ctrl && !e.shiftKey && k.toLowerCase() === 'c') {
          if (selText()) { e.preventDefault(); return; }
          e.preventDefault(); global.VM.send('\x03'); return;
        }
        if (ctrl && !e.shiftKey && k.toLowerCase() === 'd') { e.preventDefault(); global.VM.send('\x04'); return; }
        if (ctrl && !e.shiftKey && /^[a-z]$/i.test(k)) { e.preventDefault(); global.VM.send(String.fromCharCode(k.toLowerCase().charCodeAt(0) - 96)); return; }
        if (k === 'Enter') { e.preventDefault(); global.VM.send('\r'); return; }
        if (k === 'Backspace') { e.preventDefault(); global.VM.send('\x7f'); return; }
        if (k === 'Tab') { e.preventDefault(); global.VM.send('\t'); return; }
        if (KEYS[k]) { e.preventDefault(); global.VM.send(KEYS[k]); return; }
        if (k === 'PageUp' || k === 'PageDown') return;
        /* 1.9.9：输入法组合中的按键不在这里发，交给 input 事件；
           可打印字符必须 preventDefault，否则 textarea 也收到一份，input 再发一次 = 一个键出两个字符 */
        if (e.isComposing || e.keyCode === 229) return;
        if (k.length === 1 && !ctrl) { e.preventDefault(); global.VM.send(k); }
      }
      /* proxy 不一定在 view 内，两处都挂并靠 __toyKeyHandled 去重，
         这样焦点在 textarea 上时退格、回车、方向键也能到 guest */
      view.addEventListener('keydown', onKey);
      proxy.addEventListener('keydown', onKey);
      // 手机输入法走 input 事件，取走内容后清空，避免重复
      proxy.addEventListener('input', function () {
        var v = proxy.value;
        if (!v) return;
        proxy.value = '';
        if (global.VM) global.VM.send(v.replace(/\r\n|\n/g, '\r'));
      });
      ['pointerdown', 'touchend', 'click'].forEach(function (ev) {
        view.addEventListener(ev, function (e) { if (e.target !== proxy) focusTerm(); }, { passive: true });
      });
      view.addEventListener('paste', function (e) {
        var cd = e.clipboardData || window.clipboardData;
        var txt = cd ? cd.getData('text') : '';
        if (txt && global.VM) { e.preventDefault(); global.VM.send(txt.replace(/\r\n/g, '\r')); }
      });
      function syncCols() {
        var cs = getComputedStyle(view);
        var fs = parseFloat(cs.fontSize) || 13;
        var probe = document.createElement('span');
        probe.textContent = 'M'.repeat(20);
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font:inherit';
        view.appendChild(probe);
        var cw = probe.getBoundingClientRect().width / 20 || fs * 0.6;
        if (probe.parentNode) probe.parentNode.removeChild(probe);
        var cols = Math.max(20, Math.floor(((view.clientWidth || 640) - 18) / cw));
        if (cols !== t.cols) t.reflow(cols);
      }
      setTimeout(syncCols, 60);
      if (window.ResizeObserver) { var ro = new ResizeObserver(function () { syncCols(); }); ro.observe(view); api._ro = ro; }
      view.tabIndex = 0;
      focusTerm();
      setTimeout(focusTerm, 120);
      if (api && api.win && api.win.el) {
        api.win.el.addEventListener('pointerup', function (e) {
          if (!e.target.closest('button')) focusTerm();
        });
      }
      api._cleanup = function () { if (off) off(); if (api._ro) api._ro.disconnect(); };
      api.term = t;
    },
    onClose: function (api) { if (api._cleanup) api._cleanup(); }
  };

  /* ---------- 虚拟机屏幕 ---------- */
  var screenApp = {
    id: 'screen', title: '虚拟机屏幕', icon: 'monitor', width: 640, height: 440,
    mount: function (body, api) {
      var wrap = el('div', 'screen-wrap-app');
      var c = document.getElementById('screen_container');
      if (c) { c.hidden = false; wrap.appendChild(c); }
      var bar = el('div', 'screen-bar');
      bar.appendChild(el('span', 'tiny', 'guest 内部 VGA 文本控制台（tty1，图形模式时是画面）'));
      var b = el('button', 'tbtn', '最大化');
      b.style.marginLeft = 'auto';
      b.onclick = function () { api.win.max = !api.win.max; api.win.el.classList.toggle('max', api.win.max); };
      bar.appendChild(b);
      body.appendChild(wrap); body.appendChild(bar);
    },
    onClose: function () {
      var c = document.getElementById('screen_container');
      var holder = document.getElementById('screen-holder');
      if (c && holder) holder.appendChild(c);
    }
  };

  /* ---------- 文件（真实 rootfs 索引 + 串口读取内容） ---------- */
  var filesApp = {
    id: 'files', title: '文件', icon: 'files', width: 780, height: 500,
    mount: function (body, api) {
      var cur = '/';
      var wrap = h('<div class="files"><div class="side"></div><div class="main"><div class="crumb"></div><div class="list"></div></div></div>');
      body.appendChild(wrap);
      var viewer = el('div', 'viewer');
      wrap.querySelector('.main').appendChild(viewer);
      var side = wrap.querySelector('.side');
      [['根目录 /', '/'], ['/etc', '/etc'], ['/usr/bin', '/usr/bin'], ['/usr/local/bin', '/usr/local/bin'],
       ['/var/log', '/var/log'], ['/root', '/root'], ['/tmp', '/tmp'], ['/proc (实时)', '/proc']].forEach(function (p) {
        var b = el('button', '', p[0]);
        b.onclick = function () { go(p[1]); };
        side.appendChild(b);
      });
      side.appendChild(el('div', 'tiny', '目录来自 guest 里真实的 ls -la / cat，串口实时读取。'));

      go('/');

      function openFile(full, size) {
        viewer.innerHTML = '<pre>读取中…</pre>';
        var vp = viewer.querySelector('pre');
        if (!global.VM || !VM.raw || !VM.raw()) { vp.textContent = '虚拟机未启动'; return; }
        if (size > 200000) { vp.textContent = '文件较大（' + fmtSize(size) + '），请在终端执行：cat ' + full; return; }
        VM.exec('cat "' + full + '" 2>&1 | head -c 20000', 12000).then(function (r) { vp.textContent = r.out || '（空文件）'; })
          .catch(function (e) { vp.textContent = '读取失败：' + e.message; });
      }
      function lsReal(path, list) {
        list.innerHTML = '<div class="tiny" style="padding:6px 8px">读取 ' + path + ' …</div>';
        VM.exec('ls -la --time-style=+%s "' + path + '" 2>&1', 15000).then(function (r) {
          var out = (r.out || '').replace(/\r/g, '');
          var lines = out.split('\n').filter(function (l) { return /^[-dlbcps]/.test(l); });
          list.innerHTML = '';
          if (!lines.length) {
            list.appendChild(el('div', 'tiny', /Permission denied|No such/.test(out) ? out.split('\n')[0] : '（空目录）'));
            return;
          }
          var rows = [];
          lines.forEach(function (l) {
            var m = l.match(/^([-dl])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}|\d+)\s+(.+)$/);
            if (!m) return;
            var nm = m[4].replace(/ ->.*$/, '');
            if (nm === '.' || nm === '..') return;
            rows.push({ d: m[1] === 'd', s: +m[2], n: nm });
          });
          rows.sort(function (a, b) { return (a.d === b.d ? 0 : a.d ? -1 : 1) || a.n.localeCompare(b.n); });
          rows.forEach(function (it) {
            var full = (path === '/' ? '' : path) + '/' + it.n;
            var row = el('div', 'fl');
            row.innerHTML = icon(it.d ? 'files' : 'edit');
            row.appendChild(el('span', 'nm', it.n));
            if (!it.d) row.appendChild(el('span', 'sz', fmtSize(it.s)));
            row.onclick = function () { it.d ? go(full) : openFile(full, it.s); };
            list.appendChild(row);
          });
        }).catch(function (e) {
          list.innerHTML = '';
          list.appendChild(el('div', 'tiny', '读取失败：' + e.message));
        });
      }
      function go(path) {
        cur = path;
        wrap.querySelector('.crumb').textContent = path;
        var list = wrap.querySelector('.list'); list.innerHTML = '';
        if (global.VM && VM.raw && VM.raw()) { lsReal(path, list); return; }
        list.appendChild(el('div', 'tiny', '虚拟机尚未就绪：等桌面出现 root shell 后再打开文件应用。'));
      }
      function fmtSize(n) {
        if (n === undefined) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' K';
        return (n / 1048576).toFixed(1) + ' M';
      }
      api.pushTerminal = function () {
        WM.open(LihApps.terminal);
        setTimeout(function () { global.VM.send('cd "' + cur + '" && ls -la\n'); }, 400);
      };
    }
  };

  /* ---------- 相机 ---------- */
  var cameraApp = {
    id: 'camera', title: '相机', icon: 'camera', width: 600, height: 520,
    mount: function (body, api) {
      var stage = el('div', 'cam-stage');
      var note = el('div', 'cam-empty', '正在申请摄像头权限…');
      stage.appendChild(note);
      var tools = el('div', 'cam-tools');
      var bOpen = el('button', 'tbtn primary', '开启摄像头');
      var bShot = el('button', 'tbtn', '拍照'); bShot.disabled = true;
      var bStop = el('button', 'tbtn', '关闭摄像头'); bStop.disabled = true;
      var bDiag = el('button', 'tbtn', '诊断');
      tools.appendChild(bOpen); tools.appendChild(bShot); tools.appendChild(bStop); tools.appendChild(bDiag);
      var status = el('div', 'cam-status');
      body.appendChild(stage); body.appendChild(status); body.appendChild(tools);

      var stream = null, video = null;

      function setStatus(text, kind) {
        status.textContent = text;
        status.className = 'cam-status' + (kind ? ' ' + kind : '');
      }

      var CAM_TIMEOUT = 15000;
      function openCam() {
        bOpen.disabled = true;
        var settled = false;
        var guard = setTimeout(function () {
          if (settled) return;
          settled = true; bOpen.disabled = false; bOpen.textContent = '重新授权';
          setStatus('摄像头授权没有响应（可能被浏览器拦截或没有可用设备）', 'warn');
          stage.innerHTML = '<div class="cam-empty">等不到授权结果<br><span class="tiny">浏览器没有返回允许或拒绝。请点「重新授权」再试；' +
            '若一直没有弹窗，检查站点权限设置或换一个支持摄像头的浏览器。</span></div>';
        }, CAM_TIMEOUT);
        setStatus('正在申请摄像头权限…（浏览器 getUserMedia）');
        B.requestCamera({ facingMode: 'environment' }).then(function (s) {
          settled = true; clearTimeout(guard);
          stream = s;
          stage.innerHTML = '';
          video = document.createElement('video');
          video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
          video.srcObject = s;
          stage.appendChild(video);
          var p = video.play();
          if (p && p.catch) p.catch(function () { /* 交给用户再点一次 */ });
          video.onloadedmetadata = function () {
            setStatus('预览中 · ' + video.videoWidth + '×' + video.videoHeight +
              ' · 来源：浏览器 getUserMedia', 'ok');
          };
          bShot.disabled = false; bStop.disabled = false; bOpen.disabled = true;
        }).catch(function (e) {
          settled = true; clearTimeout(guard);
          bOpen.disabled = false;
          bOpen.textContent = '重新授权';
          setStatus('摄像头权限被拒绝或不可用：' + e.message + '（' + (e.name || e.code || '') + '）', 'err');
          stage.innerHTML = '<div class="cam-empty">无法打开摄像头<br><span class="tiny">' +
            esc(e.message) + '<br>点「重新授权」再试一次（浏览器提示时选择允许）<br>或点「诊断」查看 isSupport / featurePolicy / 安全上下文</span></div>';
        });
      }
      bOpen.onclick = openCam;

      bShot.onclick = function () {
        if (!video || !video.videoWidth) { setStatus('画面还没就绪', 'warn'); return; }
        var c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        Sys.addPhoto(c.toDataURL('image/png'), '摄像头');
        setStatus('已拍照并加入图库', 'ok');
      };

      function stop() {
        B.stopMedia(stream).then(function () {
          stream = null;
          if (video) { video.srcObject = null; video = null; }
          stage.innerHTML = '<div class="cam-empty">摄像头已关闭</div>';
          bShot.disabled = true; bStop.disabled = true; bOpen.disabled = false;
          setStatus('已停止摄像头，媒体流已释放', 'ok');
        });
      }
      bStop.onclick = stop;
      bDiag.onclick = function () {
        var d = B.cameraDiagnostics();
        setStatus('诊断：featurePolicy=' + JSON.stringify(d.featurePolicy) +
          ' · 安全上下文=' + d.secureContext + ' · getUserMedia=' + d.mediaDevices);
      };
      api._stop = stop;
      // 进入相机即自动申请权限并出预览，不需要用户再点按钮
      setStatus('正在申请摄像头权限…（浏览器 getUserMedia）');
      openCam();
    },
    onClose: function (api) { if (api._stop) api._stop(); }
  };

  /* ---------- 图库 ---------- */
  var galleryApp = {
    id: 'gallery', title: '图库', icon: 'gallery', width: 680, height: 470,
    mount: function (body, api) {
      var grid = el('div', 'gal'), bar = el('div', 'cam-tools');
      var bSave = el('button', 'tbtn', '保存到相册'); bSave.disabled = true;
      var bDel = el('button', 'tbtn', '删除'); bDel.disabled = true;
      var info = el('span', 'tiny'); info.style.marginLeft = 'auto';
      bar.appendChild(bSave); bar.appendChild(bDel); bar.appendChild(info);
      body.appendChild(grid); body.appendChild(bar);
      var sel = null;
      function render() {
        grid.innerHTML = '';
        if (!Sys.photos.length) { grid.innerHTML = '<div class="tiny" style="padding:12px">还没有照片。打开「相机」拍照后会出现在这里。</div>'; return; }
        Sys.photos.slice().reverse().forEach(function (p) {
          var f = document.createElement('figure');
          var img = document.createElement('img'); img.src = p.url; img.alt = '照片';
          var cap = el('figcaption');
          cap.appendChild(el('span', '', p.t.split(' ')[1] || p.t));
          var d = el('button', 'tbtn', '删'); d.style.padding = '0 6px';
          d.onclick = function (ev) {
            ev.stopPropagation();
            Sys.photos = Sys.photos.filter(function (x) { return x.id !== p.id; });
            Sys.save(); render();
          };
          cap.appendChild(d);
          f.appendChild(img); f.appendChild(cap);
          f.onclick = function () {
            sel = p; bSave.disabled = false; bDel.disabled = false;
            grid.querySelectorAll('figure').forEach(function (x) { x.style.outline = ''; });
            f.style.outline = '2px solid var(--accent)';
            info.textContent = p.t;
          };
          grid.appendChild(f);
        });
      }
      bSave.onclick = function () {
        if (!sel) return;
        B.saveImageToAlbum(sel.url).then(function (r) {
          api.toast('照片已下载到本机');
        }).catch(function (e) { api.toast('保存失败：' + e.message); });
      };
      bDel.onclick = function () {
        if (!sel) return;
        Sys.photos = Sys.photos.filter(function (x) { return x.id !== sel.id; });
        Sys.save(); sel = null; bSave.disabled = true; bDel.disabled = true; render();
      };
      render();
    }
  };

  /* ---------- 计算器 ---------- */
  var calcApp = {
    id: 'calc', title: '计算器', icon: 'calc', width: 320, height: 430,
    mount: function (body) {
      var wrap = h('<div class="calc"><div class="out">0</div><div class="keys"></div></div>');
      body.appendChild(wrap);
      var out = wrap.querySelector('.out'), keys = wrap.querySelector('.keys'), expr = '';
      ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '←', '=']
        .forEach(function (k) {
          var b = el('button', ('/*-+'.indexOf(k) >= 0 && k.length === 1) ? 'op' : (k === '=' ? 'eq' : ''), k);
          b.onclick = function () { press(k); };
          keys.appendChild(b);
        });
      function press(k) {
        if (k === 'C') { expr = ''; }
        else if (k === '←') { expr = expr.slice(0, -1); }
        else if (k === '=') {
          try {
            if (!/^[0-9+\-*/(). ]+$/.test(expr)) throw new Error('非法字符');
            var v = Function('"use strict";return (' + expr + ')')();
            expr = String(parseFloat(Number(v).toPrecision(12)));
          } catch (e) { expr = '错误'; }
        } else expr += k;
        out.textContent = expr || '0';
      }
      body.tabIndex = 0;
      body.addEventListener('keydown', function (e) {
        if (/^[0-9+\-*/().]$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Enter') { press('='); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('←'); e.preventDefault(); }
      });
      setTimeout(function () { body.focus(); }, 60);
    }
  };

  /* ---------- 文本编辑器（可读写真实文件） ---------- */
  var editorApp = {
    id: 'editor', title: '文本编辑器', icon: 'edit', width: 660, height: 480,
    mount: function (body, api) {
      var wrap = h('<div class="editor"><div class="cam-tools">' +
        '<button class="tbtn" data-a="open">打开虚机文件</button>' +
        '<button class="tbtn" data-a="new">新建</button>' +
        '<button class="tbtn primary" data-a="save">写入虚机</button>' +
        '<button class="tbtn" data-a="down">导出</button>' +
        '<span class="tiny" data-role="st" style="margin-left:auto"></span></div>' +
        '<div class="edit-path"><input class="field" data-role="path" value="/tmp/lih-note.txt" spellcheck="false"></div>' +
        '<textarea spellcheck="false"></textarea></div>');
      body.appendChild(wrap);
      var ta = wrap.querySelector('textarea'), st = wrap.querySelector('[data-role="st"]'), pathIn = wrap.querySelector('[data-role="path"]');
      try { ta.value = localStorage.getItem('lih:note') || ''; } catch (e) {}
      function stat() { st.textContent = ta.value.length + ' 字符 · ' + ta.value.split('\n').length + ' 行'; }
      ta.addEventListener('input', function () { stat(); try { localStorage.setItem('lih:note', ta.value); } catch (e) {} });
      wrap.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          var a = b.dataset.a;
          if (a === 'new') { ta.value = ''; stat(); return; }
          if (a === 'down') {
            var blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob); link.download = 'lih-note.txt';
            document.body.appendChild(link); link.click();
            setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
            return;
          }
          if (!global.VM) { api.toast('虚拟机未启动'); return; }
          var p = pathIn.value.trim() || '/tmp/lih-note.txt';
          if (a === 'open') {
            st.textContent = '读取 ' + p + ' …';
            global.VM.exec('cat "' + p + '" 2>&1', 12000).then(function (r) {
              ta.value = r.out; stat();
            });
            return;
          }
          if (a === 'save') {
            if (!/^[\w./-]+$/.test(p)) { api.toast('路径不合法'); return; }
            var b64 = btoa(unescape(encodeURIComponent(ta.value)));
            var chunks = b64.match(/[\s\S]{1,600}/g) || [''];
            st.textContent = '写入 ' + p + ' · ' + chunks.length + ' 块…';
            global.VM.exec('rm -f "' + p + '"', 8000).then(function () {
              var seq = Promise.resolve();
              chunks.forEach(function (c, i) {
                seq = seq.then(function () {
                  st.textContent = '写入 ' + p + ' ' + (i + 1) + '/' + chunks.length;
                  return global.VM.exec('printf %s "' + c + '" | base64 -d >> "' + p + '"', 12000);
                });
              });
              return seq;
            }).then(function () {
              return global.VM.exec('wc -c < "' + p + '"; sha256sum "' + p + '" | cut -c1-12', 12000).then(function (r) {
                st.textContent = '已写入 ' + p + ' · ' + (r.out || '').trim().replace(/\n/g, ' · ') + ' 字节';
              });
            }).catch(function (e) { st.textContent = '写入失败：' + e.message; });
          }
        };
      });
      stat();
    }
  };

  /* ---------- 设置 ---------- */
  var settingsApp = {
    id: 'settings', title: '设置', icon: 'settings', width: 640, height: 480,
    mount: function (body) {
      var wrap = h('<div class="settings"><div class="side"></div><div class="pane"></div></div>');
      body.appendChild(wrap);
      var side = wrap.querySelector('.side'), pane = wrap.querySelector('.pane');
      [['外观', viewLook], ['声音', viewSound], ['网络', viewNetwork], ['高级', viewAdv], ['性能', viewPerf], ['系统信息', viewAbout]].forEach(function (t, i) {
        var b = el('button', '', t[0]);
        b.onclick = function () {
          side.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on'); pane.innerHTML = ''; t[1](pane);
          pane.classList.remove('pane-in'); void pane.offsetWidth; pane.classList.add('pane-in');
        };
        side.appendChild(b);
        if (i === 0) setTimeout(function () { b.click(); }, 0);
      });

      function viewLook(p) {
        p.appendChild(el('h3', '', '墙纸'));
        var sw = el('div', 'swatches');
        [1, 2, 3].forEach(function (n) {
          var b = el('button', 'swatch' + (Sys.settings.wallpaper === n ? ' on' : ''));
          b.style.background = n === 1 ? 'linear-gradient(135deg,#3b424a,#21252a)' : n === 2 ? 'linear-gradient(135deg,#4a4038,#201d1a)' : 'linear-gradient(135deg,#1f2a33,#1b2126)';
          b.onclick = function () {
            Sys.settings.wallpaper = n; Sys.save(); Sys.applySettings();
            sw.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
          };
          sw.appendChild(b);
        });
        p.appendChild(sw);
        p.appendChild(el('h3', '', '界面缩放'));
        var row = el('div', 'row');
        [0.9, 1, 1.1, 1.25].forEach(function (s) {
          var b = el('button', 'tbtn' + (Sys.settings.scale === s ? ' primary' : ''), Math.round(s * 100) + '%');
          b.onclick = function () {
            Sys.settings.scale = s; Sys.save(); Sys.applySettings();
            row.querySelectorAll('button').forEach(function (x) { x.classList.remove('primary'); });
            b.classList.add('primary');
          };
          row.appendChild(b);
        });
        p.appendChild(row);
      }

      function viewSound(p) {
        p.appendChild(el('h3', '', '虚拟机声音'));
        var r = el('div', 'set-row');
        r.appendChild(el('span', '', 'PC 扬声器'));
        var sw = el('button', 'switch' + (Sys.settings.sound ? ' on' : ''));
        sw.appendChild(el('i'));
        sw.onclick = function () {
          Sys.settings.sound = !Sys.settings.sound; Sys.save(); Sys.applySettings();
          sw.classList.toggle('on', Sys.settings.sound);
        };
        r.appendChild(sw); p.appendChild(r);
      }


      function viewAdv(p) {
        function row(title, hint) {
          var r = el('div', 'set-row');
          r.appendChild(el('span', '', title));
          p.appendChild(r);
          if (hint) p.appendChild(el('p', 'tiny', hint));
          return r;
        }
        function toggle(key, label) {
          var r = row(label);
          var b = el('button', 'switch' + (Sys.settings[key] ? ' on' : ''));
          b.appendChild(el('i'));
          b.onclick = function () { Sys.settings[key] = !Sys.settings[key]; Sys.save(); Sys.applySettings(); b.classList.toggle('on', Sys.settings[key]); };
          r.appendChild(b);
        }
        function pick(key, label, opts, after) {
          var r = row(label);
          var sel = document.createElement('select'); sel.className = 'wiz-in';
          opts.forEach(function (o) {
            var op = document.createElement('option'); op.value = String(o[0]); op.textContent = o[1];
            if (String(Sys.settings[key]) === String(o[0])) op.selected = true;
            sel.appendChild(op);
          });
          sel.onchange = function () {
            Sys.settings[key] = isNaN(parseInt(sel.value, 10)) ? sel.value : parseInt(sel.value, 10);
            Sys.save(); Sys.applySettings(); if (after) after(Sys.settings[key]);
          };
          r.appendChild(sel);
          return r;
        }
        var pushRow = row('下发到虚机', '把主机名、时区、键盘布局真正写进 guest（root 串口 shell），不是只存浏览器。');
        var pushBtn = el('button', 'tbtn primary', '写入虚机');
        pushBtn.onclick = function () {
          if (!global.VM || !VM.raw || !VM.raw()) { WM.toast('虚拟机未启动'); return; }
          var tz = Sys.settings.tz || 'Asia/Shanghai';
          var km = Sys.settings.keymap || 'us';
          var host = Sys.settings.host || 'debian-vm';
          pushBtn.disabled = true; pushBtn.textContent = '写入中…';
          var cmd = 'hostname ' + host + '; printf %s ' + host + ' | tee /etc/hostname >/dev/null; ' +
            'printf "TIMEZONE=%s\n" ' + tz + ' | tee /etc/timezone >/dev/null; ' +
            'if [ -e /usr/share/zoneinfo/' + tz + ' ]; then ln -sf /usr/share/zoneinfo/' + tz + ' /etc/localtime; fi; ' +
            'printf "XKBMODEL=\"pc105\"\nXKBLAYOUT=\"%s\"\n" ' + km + ' | tee /etc/default/keyboard >/dev/null; ' +
            'echo "TZ=$(cat /etc/timezone) HOST=$(hostname) KB=$(grep XKBLAYOUT /etc/default/keyboard)"';
          VM.exec(cmd, 20000).then(function (r) {
            var out = (r.out || '').trim().split('\n').slice(-1)[0];
            pushBtn.disabled = false; pushBtn.textContent = '写入虚机';
            WM.toast('已写入：' + (out || '无回显'));
            var st = p.querySelector('[data-role="push-st"]');
            if (st) st.textContent = out || '';
          }).catch(function (e) { pushBtn.disabled = false; pushBtn.textContent = '写入虚机'; WM.toast('写入失败：' + e.message); });
        };
        pushRow.appendChild(pushBtn);
        p.appendChild(el('div', 'tiny', '')).setAttribute('data-role', 'push-st');
        p.appendChild(el('h3', '', '外观与终端'));
        toggle('anims', '界面动效');
        pick('termSize', '终端字号', [[12, '12 px'], [13, '13 px'], [14, '14 px'], [16, '16 px']]);
        pick('termFont', '终端字体', [['', '等宽默认'], ['monospace', 'monospace'], ['"DejaVu Sans Mono", monospace', 'DejaVu Sans Mono'], ['"Courier New", monospace', 'Courier New']]);
        pick('theme', '主题', [['dark', '暗色（Yaru Dark）'], ['light', '亮色（Adwaita）']]);
        p.appendChild(el('h3', '', '引导与系统'));
        pick('mem', '客户机内存（需重新加载页面）', [[256, '256 MB（默认）'], [320, '320 MB'], [192, '192 MB'], [128, '128 MB（最小）']], function () {
          Sys.settings.memSet = true; Sys.save();
        });
        toggle('showLog', '开机时显示引导日志');
        toggle('autologin', '开机自动登录（免登录提示）');
        pick('tz', '时区', [['Asia/Shanghai', 'Asia/Shanghai'], ['UTC', 'UTC'], ['Asia/Tokyo', 'Asia/Tokyo'], ['Europe/London', 'Europe/London'], ['America/New_York', 'America/New_York']], function (v) {
          if (global.VM && global.VM.raw()) global.VM.exec('ln -sf /usr/share/zoneinfo/' + v + ' /etc/localtime && date', 6000);
        });
        pick('keymap', '键盘布局', [['us', 'us'], ['de', 'de'], ['fr', 'fr'], ['jp', 'jp']]);
        p.appendChild(el('h3', '', '存储'));
        var info = el('p', 'tiny', '磁盘增量：读取中…'); p.appendChild(info);
        if (global.LihVM && global.LihVM.diskInfo) {
          var di = global.LihVM.diskInfo();
          info.textContent = '磁盘增量：已记录 ' + di.blocks + ' 块（' + (di.blocks * 256 / 1024).toFixed(0) + ' KB，存浏览器 IndexedDB）';
        }
        var r1 = row('磁盘改动');
        var b1 = el('button', 'tbtn', '清除并重载');
        b1.onclick = function () {
          if (!confirm('清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。')) return;
          if (global.LihVM && global.LihVM.clearDisk) global.LihVM.clearDisk();
        };
        r1.appendChild(b1);
        var r2 = row('已上传文件');
        var b2 = el('button', 'tbtn', '打开上传面板'); b2.onclick = function () { global.LihExtras.openUploads(); };
        var b3 = el('button', 'tbtn', '全部清除'); b3.onclick = function () { global.LihExtras.uploadsClear().then(function () { info.textContent = '上传缓存已清空'; }); };
        r2.appendChild(b2); r2.appendChild(b3);
        var r3 = row('首次向导');
        var b5 = el('button', 'tbtn', '重新打开');
        b5.onclick = function () { localStorage.removeItem('lih:firstrun'); global.LihExtras.renderWizard(); };
        r3.appendChild(b5);
        var r4 = row('关于与许可');
        var b6 = el('button', 'tbtn', '打开'); b6.onclick = function () { WM.open(LihApps.about); };
        r4.appendChild(b6);
      }
      function viewPerf(p) {
        var r = el('div', 'set-row');
        var perf = global.LihPerf ? global.LihPerf() : null;
        if (!perf) { r.innerHTML = '<div class="tiny">本次会话没有采集到耗时数据。</div>'; p.appendChild(r); return; }
        var names = { ui: '界面可用', mini: '引导收成角标', manifest: '清单就绪', 'first-byte': '首个串口字节', kernel: '内核接管', initramfs: '开始解包根文件系统', prompt: '出现提示符', 'verify-skip': '跳过重复校验' };
        var h = '<div class="tiny" style="line-height:1.7">';
        Object.keys(perf.marks).forEach(function (k) {
          if (names[k]) h += '<div>' + names[k] + '：<b>' + (perf.marks[k] / 1000).toFixed(2) + ' s</b></div>';
        });
        h += '<div class="tiny">客户机内存：' + perf.memMB + ' MB · 已收串口 ' + perf.bytesRx + ' 字节</div></div>';
        r.innerHTML = h; p.appendChild(r);
      }

      function viewAbout(p) {
        p.appendChild(el('h3', '', '系统信息（实时读取 guest）'));
        var k = el('div', 'kv'), rows = [];
        var ns = global.LihVM && global.LihVM.netStatus ? global.LihVM.netStatus() : { relay: '', guest: 'off' };
        var di = global.LihVM && global.LihVM.diskInfo ? global.LihVM.diskInfo() : { blocks: 0 };
        rows.push(['发行版', 'Debian GNU/Linux 12 (bookworm) i386']);
        rows.push(['内核', global.LihVM && global.LihVM.kernel ? global.LihVM.kernel : '识别中']);
        rows.push(['模拟器', 'v86（WebAssembly x86，BSD-2-Clause）']);
        rows.push(['客户机内存', (Sys.settings.memSet ? Sys.settings.mem : 256) + ' MB']);
        rows.push(['运行时间', global.LihVM ? global.LihVM.uptimeText() : '—']);
        rows.push(['串口数据', global.LihVM ? global.LihVM.bytes() + ' 字节' : '—']);
        rows.push(['WISP 中继', ns.relay || '未配置']);
        rows.push(['guest 网络', ns.guest === 'ok' ? '已启用（192.168.86.100）' : ns.guest === 'busy' ? '配置中' : ns.guest === 'fail' ? '配置失败' : '未配置']);
        rows.push(['磁盘增量', di.blocks + ' 块']);
        rows.forEach(function (r) { k.appendChild(el('b', '', r[0])); k.appendChild(el('span', '', r[1])); });
        p.appendChild(k);
        var live = el('pre', 'live-info', '读取中…');
        p.appendChild(live);
        if (global.LihVM) {
          global.LihVM.exec('uname -srm; free -m | head -2; df -h / | tail -1; dpkg -l 2>/dev/null | grep -c "^ii"', 12000).then(function (r) {
            live.textContent = r.out || '（无输出）';
          }).catch(function () { live.textContent = '读取失败'; });
        } else live.textContent = '虚拟机未启动';
      }

      function viewNetwork(p) {
        function row(title, hint) {
          var r = el('div', 'set-row');
          r.appendChild(el('span', '', title));
          p.appendChild(r);
          if (hint) p.appendChild(el('p', 'tiny', hint));
          return r;
        }
        p.appendChild(el('h3', '', '网络中继（WISP）'));
        var note = el('p', 'tiny', '浏览器不能直接开 TCP：guest 的 TCP 通过 WISP/WebSocket 交给 server.js 转发。本机默认用自带的 /wisp/；GitHub Pages 需要填一个公网 wss:// 中继。');
        p.appendChild(note);
        var r = row('中继地址');
        var inp = document.createElement('input');
        inp.className = 'wiz-in';
        inp.spellcheck = false;
        inp.style.minWidth = '260px';
        var ns = global.LihVM && global.LihVM.netStatus ? global.LihVM.netStatus() : { relay: '' };
        inp.value = ns.relay || '';
        r.appendChild(inp);
        var rb = el('button', 'tbtn', '保存并重连');
        rb.onclick = function () {
          var v = (inp.value || '').trim();
          if (v && !/^(wss?|wisps?):\/\//i.test(v)) { WM.toast('地址需要以 ws:// 或 wss:// 开头'); return; }
          if (!global.LihVM) return;
          global.LihVM.setRelay(v);
          if (!confirm('保存中继地址并重新加载页面？')) return;
          location.reload();
        };
        r.appendChild(rb);
        var r2 = row('guest 网络配置');
        var gb = el('button', 'tbtn primary', '立即配置');
        gb.onclick = function () {
          if (!global.LihVM) return;
          global.LihVM.configureGuestNetwork();
        };
        r2.appendChild(gb);
        var status = el('p', 'tiny', '');
        p.appendChild(status);
        if (global.LihVM && global.LihVM.exec) {
          global.LihVM.exec('ip -4 addr show | grep "inet "', 8000).then(function (res) {
            status.textContent = 'guest 当前地址：\n' + (res.out || '（无输出）');
          });
        }
        p.appendChild(el('h3', '', '磁盘'));
        var r3 = row('磁盘增量');
        var di = global.LihVM && global.LihVM.diskInfo ? global.LihVM.diskInfo() : { blocks: 0 };
        p.appendChild(el('p', 'tiny', '已记录 ' + di.blocks + ' 块磁盘改动（IndexedDB，刷新后继续）。'));
        var r4 = row('清除磁盘改动');
        var cb = el('button', 'tbtn', '清除并重载');
        cb.onclick = function () {
          if (!confirm('清除浏览器里保存的磁盘改动？虚拟机将回到初始镜像状态。')) return;
          if (global.LihVM && global.LihVM.clearDisk) global.LihVM.clearDisk();
        };
        r4.appendChild(cb);
      }
    }
  };

  /* ---------- 关于与许可（含 LOGO） ---------- */
  var aboutApp = {
    id: 'about', title: '关于与许可', icon: 'logo', width: 720, height: 520,
    mount: function (body) {
      body.appendChild(h('<div class="doc">' +
        '<div class="about-head"><img src="assets/icons/logo.svg" alt="Linux in HTML"><div>' +
        '<div class="about-name">Linux in HTML</div><div class="about-ver">浏览器里的 Debian GNU/Linux 12 (bookworm) i386</div>' +
        '<div class="about-ver">桌面 UI 改编自 Toy Linux（LING不道，GPL-3.0-or-later）· 本项目以 GPL-3.0-or-later 分发</div></div></div>' +
        docLinksHTML() +
        '<p>在浏览器里真跑 Linux：v86 用 WebAssembly 模拟 x86 CPU，引导 Debian 官方 32 位内核 6.1.0-50-686，' +
        '挂载 384 MB 的 Debian 12 i386 磁盘镜像。终端直连 guest 串口控制台，桌面上的文件 / 编辑器 / 系统信息都通过真实 shell 读写 guest。</p>' +
        '<h3>组件与许可证</h3>' +
        '<table><tr><th>组件</th><th>许可证</th><th>义务</th></tr>' +
        '<tr><td>v86（x86 模拟器）</td><td>BSD-2-Clause</td><td>保留版权与免责声明：lib/v86.js、THIRD-PARTY-NOTICES.md</td></tr>' +
        '<tr><td>Linux 内核（Debian i686）</td><td>GPL-2.0-only</td><td>未修改；随 images/vmlinuz 独立分发</td></tr>' +
        '<tr><td>SeaBIOS / SeaVGABIOS</td><td>LGPL-3.0</td><td>独立文件，可替换：lib/seabios.bin、lib/vgabios.bin</td></tr>' +
        '<tr><td>Debian 用户空间</td><td>各包自身</td><td>保留 guest 内 /usr/share/doc/*/copyright</td></tr>' +
        '<tr><td>桌面 UI / 窗口管理器 / 终端 / 应用</td><td>GPL-3.0-or-later</td><td>改编自 Toy Linux（LING不道）；源码即 assets/ 与 index.html，附 licenses/GPL-3.0.md</td></tr>' +
        '</table>' +
        '<h3>网络</h3>' +
        '<p>本项目自带 WISP 中继（server.js 的 /wisp/）：guest 的 TCP 连接经浏览器 WebSocket 转发到真实网络。' +
        '启动后页面会自动在串口控制台以 <b>root / root</b> 登录并给 guest 配好 <code>192.168.86.100/24</code>。' +
        'guest 内可 <code>curl http://example.com</code>、<code>apt-get update</code>；<code>https://</code> 需要先装 <code>ca-certificates</code>。</p>' +
        '<h3>磁盘</h3>' +
        '<p>guest 写入的磁盘块保存在浏览器 IndexedDB 里，刷新或重开浏览器后继续用，相当于每个浏览器一份持久化磁盘；' +
        '设置或电源菜单里可以「清除磁盘改动」回到初始镜像。</p>' +
        '<p class="tiny">使用说明是独立页面 usage.html（新标签打开，返回不会重开虚拟机）。</p>' +
        '</div>'));
    }
  };

  /* ---------- 帮助 ---------- */
  var helpApp = {
    id: 'help', title: '帮助', icon: 'help', width: 640, height: 500,
    mount: function (body) {
      body.appendChild(h('<div class="doc">' +
        '<h2>快速上手</h2>' +
        '<p>完整说明已经拆成独立页面：点下面的按钮会在新标签里打开 <code>usage.html</code>，' +
        '原标签的虚拟机与窗口状态都还在，返回时不会重新引导。</p>' +
        '<p class="about-links"><a class="tbtn" href="' + docsBase() + 'usage.html" target="_blank" rel="opener">打开使用说明</a> ' +
        '<a class="tbtn" href="' + docsBase() + 'licenses/GPL-3.0.md" target="_blank" rel="opener">GPL-3.0 全文</a></p>' +
        '<h3>要点</h3>' +
        '<ul><li>页面打开自动开机；引导期间是 ttyS0 实时串口日志，看到 <code>root@debian-vm:~#</code> 即完成，随后自动进桌面。</li>' +
        '<li>登录是 <b>root / root</b>；页面默认自动登录串口控制台，终端里直接就是 root shell。</li>' +
        '<li>Dock 打开应用：终端、文件、编辑器、相机、图库、计算器、设置、虚拟机屏幕、关于与许可、帮助。</li>' +
        '<li>网络由页面自动配置（WISP 中继 + guest 静态地址）；换中继在「设置 → 网络」里填地址再重连。</li>' +
        '<li>磁盘改动持久化在浏览器 IndexedDB；刷新不丢，可在设置或电源菜单里清除。</li>' +
        '<li>上传 .deb 会走 guest 真实 dpkg 安装并在桌面生成图标。</li></ul>' +
        '<p class="tiny">本项目以 GPL-3.0-or-later 分发：桌面 UI 改编自 Toy Linux（作者 LING不道）；第三方组件许可见 THIRD-PARTY-NOTICES.md。</p>' +
        '</div>'));
    }
  };

  var APPS = [screenApp, termApp, filesApp, cameraApp, galleryApp, calcApp, editorApp, settingsApp, aboutApp, helpApp];
  global.LihApps = { list: APPS };
  APPS.forEach(function (a) { global.LihApps[a.id] = a; });
})(window);
