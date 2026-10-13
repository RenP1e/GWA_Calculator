/* Small helpers that decide what a piece of OCR text means: a number, a mark, units, a course code, a status. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GwaTokens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Letters that OCR often puts where a digit belongs. Only used inside text that already holds a real digit.
  var LOOK = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };

  function isStep(x) { return x >= 1 && x <= 5 && Math.abs(x * 4 - Math.round(x * 4)) < 1e-6; }

  // "1.50", "(3)", "1,50", "l.25", "2.OO" -> { v, intLike, dec, digits, paren } or null
  function normNum(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var paren = /^\(/.test(s) || /\)$/.test(s);
    s = s.replace(/^[|\s]+|[|\s]+$/g, '').replace(/^[(\[{\s]+|[)\]}\s]+$/g, '').replace(/^[^\w.,|!]+|[^\w.,|!]+$/g, '').replace(/[.,:;]+$/, '');
    if (!/\d/.test(s)) return null;
    s = s.replace(/(\d),(\d{1,2})$/, '$1.$2');
    s = s.replace(/[A-Za-z|!]/g, function (c) { return LOOK[c] !== undefined ? LOOK[c] : '#'; });
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var dot = s.indexOf('.');
    return { v: parseFloat(s), text: s, intLike: dot < 0, dec: dot < 0 ? 0 : s.length - dot - 1, digits: s.replace('.', '').length, paren: paren };
  }

  // A mark such as 1.25. A 3-digit number such as 175 is read as 1.75 because OCR often drops the dot.
  // A lone 1, 2, 3 or 5 is only a last resort ("bare").
  function asGrade(n, allowBare) {
    if (!n) return null;
    if (!n.intLike) return n.dec <= 2 && isStep(n.v) ? { value: n.v, fixed: false } : null;
    if (n.digits === 3 && n.v >= 100 && n.v <= 500 && isStep(n.v / 100)) return { value: n.v / 100, fixed: true };
    if (allowBare && n.digits === 1 && (n.v === 1 || n.v === 2 || n.v === 3 || n.v === 5)) return { value: n.v, fixed: true, bare: true };
    return null;
  }

  // Units: 1 to 12 in halves. "(3)" means the school does not count them.
  function asUnits(n) {
    if (!n) return null;
    if (n.intLike) return n.digits <= 2 && n.v >= 1 && n.v <= 12 ? { value: n.v, paren: n.paren } : null;
    return n.dec <= 2 && n.v >= 0.5 && n.v <= 12 && Math.abs(n.v * 2 - Math.round(n.v * 2)) < 1e-6 ? { value: n.v, paren: n.paren, decimal: true } : null;
  }

  // Marks that have no number. Returns INC, DRP, W, UW, AW, NG, UD, NC, FAILED or ''.
  function statusOf(text) {
    var s = String(text || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    if (s === 'INC' || s === 'INCOMPLETE') return 'INC';
    if (s === 'DRP' || s === 'DROPPED' || s === 'DROP') return 'DRP';
    if (s === 'UW' || s === 'AW' || s === 'NG' || s === 'UD' || s === 'NC') return s;
    if (s === 'FAILED' || s === 'FAIL') return 'FAILED';
    return '';
  }

  // Words that are never the letters of a course code.
  var NOT_CODE = /^(semester|sem|year|term|page|total|units?|grades?|student|section|level|summer|midyear|school|college|number|no|ay|sy|gwa|average)$/i;

  var ONE_TOKEN = /^([A-Z]{2,8})[-.]?(\d{1,3}[A-Za-z]{0,2})$/; // IT201, CS-101, IT2n (a garbled 211)
  var LETTERS = /^[A-Z]{2,8}$/;                              // IT, GE, NSTP, PATHFIT
  var LETTERS_LOOSE = /^[A-Z][a-z]{1,7}$/;                   // Math, Elec (only tried when no all-caps codes exist)
  var NUMBER_PART = /^[\dOl]{1,3}[A-Za-z]?$/;                // 101, 2O1, 101L

  function fixCodeNumber(s) { return s.replace(/[Ol]/g, function (c) { return c === 'O' ? '0' : '1'; }); }

  // Is this word the start of a course code? Returns { text, span } (span = words used) or null.
  function codeAt(words, i, loose) {
    var w = words[i], t = w.t.replace(/[,;:]+$/, '');
    if (NOT_CODE.test(t)) return null;
    var m = ONE_TOKEN.exec(t);
    if (m && !NOT_CODE.test(m[1])) return { text: m[1] + ' ' + m[2], span: 1 };
    var okLetters = LETTERS.test(t) || (loose && LETTERS_LOOSE.test(t));
    var nx = words[i + 1];
    if (okLetters && nx) {
      var n = nx.t.replace(/[,;:]+$/, '');
      var gap = nx.x0 - w.x1, hh = Math.max(w.y1 - w.y0, nx.y1 - nx.y0);
      if (/\d/.test(n) && NUMBER_PART.test(n) && gap < 2.4 * hh && Math.abs(nx.cy - w.cy) < 0.6 * hh) {
        return { text: t + ' ' + fixCodeNumber(n), span: 2 };
      }
    }
    return null;
  }

  return { normNum: normNum, asGrade: asGrade, asUnits: asUnits, statusOf: statusOf, codeAt: codeAt, isStep: isStep };
});
