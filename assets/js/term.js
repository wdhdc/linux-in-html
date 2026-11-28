/* 串口终端渲染器：UTF-8 文本 → DOM（\r 覆盖、\b、制表、软换行、SGR 颜色、CSI 清屏）
 * 派生自 Toy Linux 的 term.js（作者 LING不道 / 凌徐鲲，GPL-3.0-or-later，https://gitee.com/ling-xukun/toylinux），
 * 本项目按 GPL-3.0-or-later 继续分发，改动见 NOTICE.md。 */
(function (global) {
  'use strict';
  var W = 92, MAX_ROWS = 2000, SGR = {
    0: '', 1: 'b', 22: '', 30: 'c0', 31: 'c1', 32: 'c2', 33: 'c3', 34: 'c4',
    35: 'c5', 36: 'c6', 37: 'c7', 39: '', 90: 'c8', 91: 'c1', 92: 'c2', 93: 'c3',
    94: 'c4', 95: 'c5', 96: 'c6', 97: 'c7'
  };

  function LihTerm(el, opts) {
    this.el = el; this.opts = opts || {};
    this.cols = this.opts.cols || W;
    this.rows = [[]]; this.row = 0; this.col = 0;
    this.attr = ''; this.pending = ''; this.state = 0; this.csi = '';
    this.raw = ''; this.dirty = false; this._raf = null;
    this._schedule();
  }
  LihTerm.prototype.bytes = function (str) {
    this.raw += str; this.pending += str;
    if (this.pending.length > 8192) { this._flush(); return; }
    if (this._flushTimer) return;
    var self = this;
    this._flushTimer = setTimeout(function () { self._flushTimer = null; self._flush(); }, 50);
  };
  LihTerm.prototype.text = function () { return this.raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); };
  LihTerm.prototype.clear = function () { this.rows = [[]]; this.row = 0; this.col = 0; this.dirty = true; this._schedule(); };

  LihTerm.prototype._flush = function () {
    var s = this.pending; this.pending = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], code = s.charCodeAt(i);
      if (this.state === 1) { if (ch === '[') { this.state = 2; this.csi = ''; } else if (ch === ']') this.state = 3; else this.state = 0; continue; }
      if (this.state === 3) { if (code === 7) this.state = 0; continue; }
      if (this.state === 2) {
        if (/[0-9;?]/.test(ch)) { this.csi += ch; continue; }
        this.state = 0; this._csi(ch, this.csi); continue;
      }
      if (code === 27) { this.state = 1; continue; }
      if (ch === '\r') { this.col = 0; continue; }
      if (ch === '\n') { this._newline(); continue; }
      if (ch === '\b') { if (this.col > 0) this.col--; continue; }
      if (ch === '\t') { var n = 8 - (this.col % 8); for (var k = 0; k < n; k++) this._put(' '); continue; }
      if (code === 7 || code < 32) continue;
      this._put(ch);
    }
    this.dirty = true; this._schedule();
  };
  LihTerm.prototype._csi = function (final, p) {
    if (final === 'J' && (p === '2' || p === '3')) { this.rows = [[]]; this.row = 0; this.col = 0; return; }
    if (final === 'K') { this.rows[this.row] = this.rows[this.row].slice(0, this.col); return; }
    if (final === 'H' || final === 'f') { this.col = 0; return; }
    if (final === 'm') {
      var codes = p.split(';').filter(Boolean);
      if (!codes.length) { this.attr = ''; return; }
      var self = this;
      codes.forEach(function (c) {
        if (SGR[c] === undefined) return;
        if (SGR[c] === '') self.attr = '';
        else if (SGR[c] === 'b') self.attr = (self.attr + ' b').trim();
        else self.attr = (self.attr.replace(/\bc\d\b/g, '') + ' ' + SGR[c]).trim();
      });
    }
  };
  LihTerm.prototype._newline = function () {
    this.row++; this.col = 0;
    while (this.rows.length <= this.row) this.rows.push([]);
    if (this.rows.length > MAX_ROWS) { this.rows.splice(0, this.rows.length - MAX_ROWS); this.row = this.rows.length - 1; }
  };
  LihTerm.prototype._put = function (ch) {
    if (this.col >= this.cols) this._newline();
    var line = this.rows[this.row] || (this.rows[this.row] = []);
    while (line.length < this.col) line.push({ c: ' ', s: this.attr });
    line[this.col] = { c: ch, s: this.attr };
    this.col++;
  };
  LihTerm.prototype.reflow = function (cols) {
    cols = Math.max(20, Math.min(400, cols | 0));
    if (cols === this.cols) return;
    var flat = [], r, c, line;
    for (r = 0; r < this.rows.length; r++) {
      line = this.rows[r];
      for (c = 0; c < line.length; c++) flat.push(line[c] || { c: ' ', s: '' });
      flat.push(null);
    }
    this.cols = cols; this.rows = [[]]; this.row = 0; this.col = 0;
    for (var i = 0; i < flat.length; i++) {
      if (flat[i] === null) { this._newline(); continue; }
      if (this.col >= this.cols) this._newline();
      line = this.rows[this.row] || (this.rows[this.row] = []);
      line[this.col] = flat[i]; this.col++;
    }
    this.dirty = true; this._schedule();
  };
  LihTerm.prototype._schedule = function () {
    if (this._raf) return;
    var self = this;
    this._raf = (global.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      self._raf = null; self.render();
    });
  };
  LihTerm.prototype.render = function () {
    if (!this.dirty) return;
    this.dirty = false;
    var prevTop = this.el.scrollTop, prevH = this.el.scrollHeight;
    var atBottom = (prevH - prevTop - this.el.clientHeight) < 40;
    var out = '';
    for (var r = 0; r < this.rows.length; r++) {
      var line = this.rows[r], cur = '', cls = '';
      for (var c = 0; c < line.length; c++) {
        var cell = line[c] || { c: ' ', s: '' };
        if (cell.s !== cls) {
          if (cur) out += cls ? '<span class="' + cls + '">' + esc(cur) + '</span>' : esc(cur);
          cur = ''; cls = cell.s;
        }
        cur += cell.c;
      }
      if (cur) out += cls ? '<span class="' + cls + '">' + esc(cur) + '</span>' : esc(cur);
      if (r === this.row && this.opts.cursor) out += '<span class="cur"></span>';
      out += '\n';
    }
    if (out !== this._lastHtml) { this._lastHtml = out; this.el.innerHTML = out; }
    /* 滚动稳定性：贴底时继续贴底；不在底部时按高度差补偿，画面不往上跳 */
    if (atBottom) {
      this.el.scrollTop = this.el.scrollHeight;
    } else {
      var dH = this.el.scrollHeight - prevH;
      if (dH) this.el.scrollTop = prevTop + dH;
    }
    if (this.opts.onRender) this.opts.onRender(this);
  };
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  global.LihTerm = LihTerm;
})(window);
