/* 轻量窗口管理器：拖动、最小化、最大化、关闭、Alt+Tab、双工作区
 * 派生自 Toy Linux 的 wm.js（作者 LING不道 / 凌徐鲲，GPL-3.0-or-later，https://gitee.com/ling-xukun/toylinux），
 * 本项目按 GPL-3.0-or-later 继续分发，改动见 NOTICE.md。 */
(function (global) {
  'use strict';

  var layer, wins = [], zTop = 10, seq = 1;
  var ws = 1, WS_COUNT = 2;
  var hooks = [];

  function icon(name) {
    return '<svg aria-hidden="true"><use href="assets/icons/sprite.svg#i-' + name + '"/></svg>';
  }

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  var MOBILE = (function () {
    try { return window.matchMedia('(max-width: 640px)').matches || (window.matchMedia('(hover: none)').matches && screen.width < 820); } catch (e) { return false; }
  })();
  function boundary() {
    var w = layer.clientWidth, h = layer.clientHeight;
    var vv = window.visualViewport;
    if (vv && vv.width && vv.width < w) w = Math.round(vv.width);
    if (vv && vv.height && vv.height < h) h = Math.round(vv.height);
    if (!w || !h) { w = document.documentElement.clientWidth || 360; h = document.documentElement.clientHeight || 640; }
    return { w: w, h: h };
  }

  function focus(win) {
    wins.forEach(function (w) { w.el.classList.remove('focus'); });
    win.el.classList.add('focus');
    win.el.style.zIndex = ++zTop;
    var cur = document.getElementById('tb-app');
    if (cur) cur.textContent = win.title;
  }

  function place(win, idx) {
    var b = boundary();
    var pad = MOBILE ? 8 : 20;
    var w = Math.min(win.width, b.w - pad * 2), h = Math.min(win.height, b.h - pad * 2);
    win.el.style.width = w + 'px';
    win.el.style.height = h + 'px';
    if (MOBILE) {
      // 手机上不级联，固定居中偏上，保证每次打开都在同一位置
      win.el.style.left = Math.round((b.w - w) / 2) + 'px';
      win.el.style.top = Math.round(Math.max(8, (b.h - h) * 0.32)) + 'px';
    } else {
      var off = ((idx == null ? wins.length : idx) % 6) * 26;
      win.el.style.left = Math.max(pad, Math.min(b.w - w - pad, 24 + off)) + 'px';
      win.el.style.top = Math.max(pad, Math.min(b.h - h - pad, 18 + off)) + 'px';
    }
  }
  function replaceAll() {
    wins.forEach(function (w) { if (!w.max && !w.min) place(w); });
  }
  window.addEventListener('orientationchange', function () { setTimeout(replaceAll, 260); });
  window.addEventListener('resize', function () { setTimeout(replaceAll, 120); });

  function open(app) {
    var existing = wins.filter(function (w) { return w.app.id === app.id; })[0];
    if (existing) {
      var wasMin = existing.min;
      existing.min = false;
      existing.el.classList.remove('min');
      if (existing.ws !== ws) existing.ws = ws;
      existing.el.hidden = false;
      if (wasMin) {
        existing.el.classList.remove('restoring'); void existing.el.offsetWidth;
        existing.el.classList.add('restoring');
        setTimeout(function () { existing.el.classList.remove('restoring'); }, 240);
      }
      focus(existing);
      notify();
      return existing;
    }

    var win = {
      id: 'w' + (seq++), app: app, title: app.title,
      width: app.width || 760, height: app.height || 480, ws: ws, min: false, max: false, api: null
    };
    win.el = el('div', 'win');
    win.el.dataset.ws = ws;
    win.el.innerHTML =
      '<div class="win-head"><div class="win-title"></div>' +
        '<div class="win-ctrls">' +
          '<button class="c-min" title="最小化">' + icon('min') + '</button>' +
          '<button class="c-max" title="最大化">' + icon('max') + '</button>' +
          '<button class="c-close" title="关闭">' + icon('close') + '</button>' +
        '</div></div>' +
      '<div class="win-body"></div>';
    win.el.querySelector('.win-title').textContent = app.title;
    /* 1.9.9：几何先算好、再进 DOM，首帧就是最终位置与尺寸，不会出现「先在 0,0 闪一下再跳回来」；
       原来这里 append 之后才 place，还额外用两层 rAF 再 place 一次，每次开窗都会弹跳好几下。 */
    place(win, wins.length);
    win.el.style.visibility = 'hidden';
    layer.appendChild(win.el);
    void win.el.offsetWidth;                 /* 先把最终几何刷进去 */
    win.el.style.visibility = '';
    win.el.classList.add('enter');
    win.el.addEventListener('animationend', function () { win.el.classList.remove('enter'); }, { once: true });
    setTimeout(function () { win.el.classList.remove('enter'); }, 400);

    var body = win.el.querySelector('.win-body');
    var api = {
      win: win,
      body: body,
      setTitle: function (t) { win.title = t; win.el.querySelector('.win-title').textContent = t; notify(); },
      close: function () { close(win); },
      toast: toast,
      isActive: function () { return win.el.classList.contains('focus'); }
    };
    win.api = api;

    try {
      if (app.mount) app.mount(body, api);
    } catch (e) {
      body.innerHTML = '<div class="pad"><p>应用启动失败：' + String(e && e.message || e) + '</p></div>';
    }

    /* 交互 */
    win.el.querySelector('.c-close').addEventListener('click', function (e) { e.stopPropagation(); close(win); });
    win.el.querySelector('.c-min').addEventListener('click', function (e) { e.stopPropagation(); minimize(win); });
    win.el.querySelector('.c-max').addEventListener('click', function (e) { e.stopPropagation(); toggleMax(win); });
    var head = win.el.querySelector('.win-head');
    head.addEventListener('dblclick', function () { toggleMax(win); });
    head.addEventListener('pointerdown', function (e) { dragStart(e, win); });
    win.el.addEventListener('pointerdown', function () { focus(win); }, true);

    wins.push(win);
    focus(win);
    notify();
    return win;
  }

  function dragStart(e, win) {
    if (e.button !== 0 || win.max) return;
    if (e.target.closest('button')) return;
    var startX = e.clientX, startY = e.clientY;
    var left = parseFloat(win.el.style.left) || 0, top = parseFloat(win.el.style.top) || 0;
    var b = boundary();
    var w = win.el.offsetWidth, h = win.el.offsetHeight;
    head_set(e.target);
    function head_set(t) { if (t.setPointerCapture) { try { t.setPointerCapture(e.pointerId); } catch (err) {} } }
    function move(ev) {
      var nl = left + (ev.clientX - startX), nt = top + (ev.clientY - startY);
      nl = Math.max(-w + 120, Math.min(b.w - 60, nl));
      nt = Math.max(0, Math.min(b.h - 40, nt));
      win.el.style.left = nl + 'px';
      win.el.style.top = nt + 'px';
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function toggleMax(win) {
    win.max = !win.max;
    win.el.classList.add('animating');
    win.el.classList.toggle('max', win.max);
    setTimeout(function () { win.el.classList.remove('animating'); }, 220);
    focus(win);
  }

  function minimize(win) {
    win.min = true;
    var el = win.el;
    var d = document.querySelector('.dock-item[data-app="' + win.app.id + '"]');
    if (d) {
      var r = d.getBoundingClientRect(), w = el.getBoundingClientRect();
      el.style.setProperty('--mx', (r.left + r.width / 2 - (w.left + w.width / 2)).toFixed(1) + 'px');
      el.style.setProperty('--my', (r.top + r.height / 2 - (w.top + w.height / 2)).toFixed(1) + 'px');
      el.style.setProperty('--ms', Math.max(0.06, Math.min(0.5, r.width / Math.max(1, w.width))).toFixed(3));
      if (d.classList) { d.classList.remove('bounce'); void d.offsetWidth; d.classList.add('bounce'); }
    }
    el.classList.add('minimizing');
    var done = false;
    function settle() {
      if (done) return;
      done = true;
      el.classList.remove('minimizing');
      el.classList.add('min');
    }
    el.addEventListener('animationend', settle, { once: true });
    setTimeout(settle, 260);
    var rest = wins.filter(function (w) { return !w.min && w.ws === win.ws; });
    if (rest.length) focus(rest[rest.length - 1]);
    notify();
  }

  function close(win) {
    try { if (win.app.onClose) win.app.onClose(win.api); } catch (e) {}
    try { win.app._closed = true; } catch (e) {}
    var el = win.el, done = false;
    function remove() {
      if (done) return;
      done = true;
      el.remove();
      wins = wins.filter(function (w) { return w !== win; });
      var rest = wins.filter(function (w) { return !w.min && w.ws === ws; });
      if (rest.length) focus(rest[rest.length - 1]);
      notify();
    }
    el.classList.add('closing');
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 240);
  }

  function setWorkspace(n) {
    ws = Math.max(1, Math.min(WS_COUNT, n));
    wins.forEach(function (w) {
      w.el.hidden = (w.ws !== ws);
    });
    var dots = document.querySelectorAll('#topbar .ws-dot');
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i + 1 === ws);
    var rest = wins.filter(function (w) { return !w.min && w.ws === ws; });
    if (rest.length) focus(rest[rest.length - 1]);
    notify();
  }

  function notify() { hooks.forEach(function (h) { try { h(wins, ws); } catch (e) {} }); }

  function toast(msg, ms) {
    var box = document.getElementById('toasts');
    var t = el('div', 'toast', '');
    t.textContent = msg;
    box.appendChild(t);
    t.classList.add('toast-in');
    setTimeout(function () { t.classList.remove('toast-in'); t.classList.add('toast-out'); }, (ms || 2600) - 320);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }

  /* Alt+Tab */
  var swIndex = 0, swOpen = false;
  function switcherItems() { return wins.filter(function (w) { return w.ws === ws && !w.min; }); }

  function showSwitcher(dir) {
    var list = switcherItems();
    if (list.length < 2) return;
    var box = document.getElementById('switcher');
    if (!swOpen) { swOpen = true; swIndex = 0; }
    swIndex = (swIndex + dir + list.length) % list.length;
    box.innerHTML = '<div class="sw-box">' + list.map(function (w, i) {
      return '<div class="sw-item' + (i === swIndex ? ' on' : '') + '">' + icon(w.app.icon || 'terminal') +
             '<div>' + escapeHtml(w.title) + '</div></div>';
    }).join('') + '</div>';
    box.hidden = false;
    box.dataset.order = list.map(function (w) { return w.id; }).join(',');
  }

  function commitSwitcher() {
    var box = document.getElementById('switcher');
    if (!swOpen) return;
    swOpen = false;
    box.hidden = true;
    var ids = (box.dataset.order || '').split(',');
    var target = wins.filter(function (w) { return w.id === ids[swIndex]; })[0];
    if (target) focus(target);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  global.WM = {
    init: function () {
      layer = document.getElementById('windows');
      document.addEventListener('keydown', function (e) {
        if (e.altKey && e.key === 'Tab') { e.preventDefault(); showSwitcher(e.shiftKey ? -1 : 1); return; }
        if (e.ctrlKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          setWorkspace(ws + (e.key === 'ArrowRight' ? 1 : -1));
        }
      });
      document.addEventListener('keyup', function (e) {
        if (e.key === 'Alt' && swOpen) commitSwitcher();
      });
      window.addEventListener('resize', function () {
        var b = boundary();
        wins.forEach(function (w) {
          if (w.max) return;
          var x = parseFloat(w.el.style.left) || 0, y = parseFloat(w.el.style.top) || 0;
          w.el.style.left = Math.min(x, Math.max(0, b.w - 160)) + 'px';
          w.el.style.top = Math.min(y, Math.max(0, b.h - 80)) + 'px';
        });
      });
      return this;
    },
    open: open,
    close: close,
    minimize: minimize,
    focus: focus,
    toast: toast,
    get windows() { return wins; },
    get workspace() { return ws; },
    setWorkspace: setWorkspace,
    onChange: function (h) { hooks.push(h); },
    focusApp: function (id) {
      var w = wins.filter(function (x) { return x.app.id === id; })[0];
      if (w) { w.min = false; w.el.classList.remove('min'); focus(w); return true; }
      return false;
    }
  };
})(window);
