/* Linux in HTML 动效层：统一调度、只用 transform/opacity、限制同时动画数量
 * 派生自 Toy Linux 1.6.0 的 anim.js（作者 LING不道 / 凌徐鲲，GPL-3.0-or-later，https://gitee.com/ling-xukun/toylinux），
 * 本项目按 GPL-3.0-or-later 继续分发，改动见 NOTICE.md。 */
(function (global) {
  'use strict';
  var reduce = global.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function off() {
    return reduce.matches || document.documentElement.classList.contains('no-anim');
  }
  /* 同时动画预算：超过 22 条就降级掉装饰性动画，给窗口与终端让路 */
  var raf = 0, busy = false, lastN = -1;
  function budget() {
    if (document.hidden) return;            /* 后台标签页不跑，避免无谓样式失效 */
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      var n = 0;
      try { n = document.getAnimations ? document.getAnimations().length : 0; } catch (e) {}
      if (n === lastN) return;               /* 数量没变就别碰 class，别让浏览器每 600ms 重算一次 */
      lastN = n;
      var want = n > 22;
      if (want !== busy) { busy = want; document.body.classList.toggle('anim-busy', busy); }
    });
  }
  setInterval(budget, 1500);

  /* ---- Dock 悬停放大（指针距离衰减） ---- */
  var dock = null, mx = -999;
  var TOUCH = (function () {
    try { return window.matchMedia && window.matchMedia('(hover: none)').matches; } catch (e) { return false; }
  })();
  function magnify() {
    if (!dock || off() || TOUCH) return;
    var items = dock.querySelectorAll('.dock-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i], r = it.getBoundingClientRect();
      if (!r.width) continue;
      var d = Math.abs(mx - (r.left + r.width / 2));
      var k = Math.exp(-(d * d) / (2 * 62 * 62));
      var sc = 1 + 0.34 * k;
      it.style.transform = 'translateY(' + (-9 * k).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
    }
  }
  function resetDock() {
    if (!dock) return;
    var items = dock.querySelectorAll('.dock-item');
    for (var i = 0; i < items.length; i++) items[i].style.transform = '';
  }
  function bindDock() {
    dock = document.getElementById('dock');
    if (!dock || dock.dataset.anim) return;
    dock.dataset.anim = '1';
    dock.addEventListener('pointermove', function (e) { if (e.pointerType === 'touch') { resetDock(); return; } mx = e.clientX; if (!off()) magnify(); }, { passive: true });
    dock.addEventListener('pointerleave', resetDock);
    dock.addEventListener('pointerdown', function (e) {
      var it = e.target.closest ? e.target.closest('.dock-item') : null;
      if (e.pointerType === 'touch') resetDock();
      if (!it || off()) return;
      it.classList.remove('bounce'); void it.offsetWidth; it.classList.add('bounce');
      setTimeout(function () { it.classList.remove('bounce'); }, 560);
    }, { passive: true });
  }

  /* ---- 窗口开：从 Dock 图标位置长出 ---- */
  function originFor(el) {
    var items = document.querySelectorAll('.dock-item.running');
    var r = el.getBoundingClientRect(), best = null, bd = 1e9;
    for (var i = 0; i < items.length; i++) {
      var q = items[i].getBoundingClientRect();
      if (!q.width) continue;
      var d = Math.abs((q.left + q.width / 2) - (r.left + r.width / 2));
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return null;
    return {
      x: (best.left + best.width / 2 - (r.left + r.width / 2)).toFixed(1) + 'px',
      y: (best.top + best.height / 2 - (r.top + r.height / 2)).toFixed(1) + 'px'
    };
  }
  function watchWins() {
    var obs = new MutationObserver(function (recs) {
      recs.forEach(function (rec) {
        for (var i = 0; i < rec.addedNodes.length; i++) {
          var n = rec.addedNodes[i];
          if (!n.classList || !n.classList.contains('win')) continue;
          if (off() || TOUCH) continue; /* 触屏不乱飞：不做从 Dock 长出的位移，避免开窗瞬间错位 */
          var o = originFor(n);
          if (o) { n.style.setProperty('--ox', o.x); n.style.setProperty('--oy', o.y); }
          n.classList.add('opening');
          setTimeout(function () { n.classList.remove('opening'); }, 300);
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ---- 主题切换过渡 ---- */
  function watchTheme() {
    var prev = document.documentElement.dataset.theme;
    new MutationObserver(function () {
      var now = document.documentElement.dataset.theme;
      if (now === prev) return;
      prev = now;
      if (off()) return;
      document.documentElement.classList.add('theme-anim');
      setTimeout(function () { document.documentElement.classList.remove('theme-anim'); }, 340);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ---- 开机进度环 ---- */
  function bootRing() {
    var b = document.getElementById('boot');
    if (!b || b.querySelector('.boot-ring')) return;
    var ring = document.createElement('div');
    ring.className = 'boot-ring';
    var anchor = b.querySelector('.boot-dots') || b.querySelector('.boot-sub') || b.firstElementChild;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(ring, anchor.nextSibling);
    setTimeout(function () { b.classList.add('ring-on'); }, 380);
  }

  /* ---- 终端聚焦：聚焦时轻推一次，避免持续动画抢占串口渲染 ---- */
  function watchFocus() {
    /* 1.9.9：只记录焦点变化，不再给窗口加 focus-pop。
       旧实现每切换一次焦点就 remove/add 一次 class，并强制 offsetWidth 触发同步布局；
       同时把 .win 上的 winIn 动画覆盖成 focusPop，220ms 后移除时 winIn 被重新应用，
       等于每次切窗都重放一遍"淡入+缩放"，这就是"一闪一闪"。 */
    var prev = null;
    new MutationObserver(function () {
      var f = document.querySelector('.win.focus');
      if (f === prev) return;
      prev = f;
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  /* ---- 桌面右键菜单（带 popIn 出现动画） ---- */
  function desktopMenu() {
    var desk = document.getElementById('desktop');
    if (!desk || desk.dataset.ctx) return;
    desk.dataset.ctx = '1';
    desk.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('.win')) return;
      e.preventDefault();
      var old = document.getElementById('ctxmenu'); if (old) old.remove();
      var m = document.createElement('div');
      m.id = 'ctxmenu'; m.className = 'pop ctx';
      m.innerHTML = '<button data-a="term">打开终端</button><button data-a="settings">设置</button><button data-a="about">关于与许可</button><button data-a="reload">重新加载页面</button>';
      m.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
      m.style.top = Math.min(e.clientY, innerHeight - 150) + 'px';
      document.body.appendChild(m);
      m.addEventListener('click', function (ev) {
        var a = ev.target.dataset && ev.target.dataset.a;
        m.remove();
        if (!a) return;
        if (a === 'term') WM.open(LihApps.terminal);
        else if (a === 'settings') WM.open(LihApps.settings);
        else if (a === 'about') WM.open(LihApps.about);
        else location.reload();
      });
      setTimeout(function () { document.addEventListener('pointerdown', function h() { var x = document.getElementById('ctxmenu'); if (x) x.remove(); document.removeEventListener('pointerdown', h); }); }, 0);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    desktopMenu();
    bindDock(); watchWins(); watchTheme(); bootRing(); watchFocus();
    setTimeout(bindDock, 1200);
    setTimeout(function () { var b = document.getElementById('boot'); if (b && b.hidden !== true) b.classList.add('ring-on'); }, 1500);
  });
  global.LihAnim = { magnify: magnify, resetDock: resetDock, off: off };
})(window);
