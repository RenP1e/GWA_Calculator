/* Turn OCR words into subject rows: { code, name, units, grade, status, term, nonCredit, include, flags }.
   words1 = text pass (every word, positions); words2 = numbers pass (digits only, same image). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tokens.js'), require('./layout.js'));
  else root.GwaParse = factory(root.GwaTokens, root.GwaLayout);
})(typeof self !== 'undefined' ? self : this, function (T, Lay) {
  'use strict';

  var CODE_SURE = 90;                 // a course code read with less confidence than this is read again on its own
  var SKIP_LINE = /\b(gwa|average|total|general|weighted|gpa|earned|summary|cumulative)\b/i;
  var REMARK = /^(passed|pass|failed|fail|remarks?|conditional|completed|credits?|units?|grades?|final|rating|status|midterm)$/i;

  function byX(a, b) { return a.w.x0 - b.w.x0; }

  function confOf(ws) { return Math.min.apply(null, ws.map(function (w) { return w.c == null ? 0 : w.c; })); }

  function overlaps(w, toks, H) {
    return toks.some(function (t) {
      return Math.abs(t.w.cx - w.cx) < 0.6 * Math.max(t.w.w, w.w, 1) && Math.abs(t.w.cy - w.cy) < 0.6 * H;
    });
  }

  // Units: the plausible token closest to the "Units" column title, or else the one nearest to the grade on its left.
  function pickUnits(toks, from, hdr) {
    var cands = [], j;
    for (j = from; j >= 0; j--) { var un = T.asUnits(toks[j].n); if (un) cands.push({ t: toks[j], un: un }); }
    if (!cands.length) return null;
    var best = cands[0];
    if (hdr && hdr.ux != null) cands.forEach(function (c) { if (Math.abs(c.t.w.cx - hdr.ux) < Math.abs(best.t.w.cx - hdr.ux)) best = c; });
    return best;
  }

  // Greedy choice for one row. toks are numeric tokens sorted left to right.
  function pickRow(toks, order, hdr) {
    var res = { g: null, gr: null, u: null, un: null }, c, best, u;
    var gcand = [];
    toks.forEach(function (t, k) { var gr = T.asGrade(t.n, false); if (gr) gcand.push({ t: t, gr: gr, k: k }); });
    if (order === 'gu') {
      u = pickUnits(toks, toks.length - 1, null);
      if (u) { res.u = u.t; res.un = u.un; }
      var left = gcand.filter(function (c2) { return !res.u || c2.t.w.x0 < res.u.w.x0; });
      if (left.length) { c = left[left.length - 1]; res.g = c.t; res.gr = c.gr; }
      return res;
    }
    if (gcand.length) {
      c = gcand[gcand.length - 1];
      if (hdr && hdr.gx != null) {
        best = gcand[0];
        gcand.forEach(function (g2) { if (Math.abs(g2.t.w.cx - hdr.gx) < Math.abs(best.t.w.cx - hdr.gx)) best = g2; });
        c = best;
      }
      res.g = c.t; res.gr = c.gr;
      u = pickUnits(toks, c.k - 1, hdr);
    } else {
      u = pickUnits(toks, toks.length - 1, hdr);
    }
    if (u) { res.u = u.t; res.un = u.un; }
    return res;
  }

  function nearestWithin(list, x, tol, test) {
    var best = null;
    list.forEach(function (t) {
      if (!test(t)) return;
      var d = Math.abs(t.w.cx - x);
      if (d <= tol && (!best || d < Math.abs(best.w.cx - x))) best = t;
    });
    return best;
  }

  // A whole number such as 3 (or 3.0). A grade written "2.00" is a mark, not a whole number.
  function isWhole(n) { return n && n.v >= 1 && n.v <= 12 && Math.floor(n.v) === n.v && n.digits <= 4 && (n.intLike || n.dec < 2); }


  // Rows share columns. Group every number in the table by its x position, work out which group is Units
  // (whole numbers) and which is the mark (values like 1.25), then read each row from those two columns.
  function columnModel(items, W, H, hdr) {
    var all = [];
    items.forEach(function (it, i) { it.toks.forEach(function (t) { all.push({ t: t, i: i }); }); });
    all.sort(function (a, b) { return a.t.w.cx - b.t.w.cx; });
    var gap = Math.max(0.025 * W, 1.5 * H), groups = [], cur = null;
    all.forEach(function (e) {
      if (cur && e.t.w.cx - cur.last <= gap) { cur.m.push(e); cur.last = e.t.w.cx; }
      else { cur = { m: [e], last: e.t.w.cx }; groups.push(cur); }
    });
    var minRows = Math.max(2, Math.ceil(0.3 * items.length)), cols = [];
    groups.forEach(function (g) {
      var rowsSeen = {}, whole = 0, mark = 0, fraction = 0;
      g.m.forEach(function (e) {
        rowsSeen[e.i] = true;
        var gr = T.asGrade(e.t.n, false), w = isWhole(e.t.n);
        if (w) whole++;
        if (gr) { mark++; if (!w) fraction++; }
      });
      var n = g.m.length, rows = Object.keys(rowsSeen).length;
      if (rows < minRows) return;
      cols.push({
        x: Lay.median(g.m.map(function (e) { return e.t.w.cx; })), n: n,
        marks: mark / n >= 0.7 && fraction / n >= 0.25, units: whole / n >= 0.8
      });
    });
    var markCols = cols.filter(function (c) { return c.marks; });
    if (!markCols.length) {
      // Not enough marks were read to show a column, but both titles are there: look under the titles (the cells get read again).
      if (hdr && hdr.ux != null && hdr.gx != null && Math.abs(hdr.gx - hdr.ux) > 2 * H) {
        return { Xu: hdr.ux, Xg: hdr.gx, tol: Math.max(14, Math.min(Math.max(gap * 0.8, 14), 0.45 * Math.abs(hdr.gx - hdr.ux))) };
      }
      return null;
    }
    var Xg = markCols[markCols.length - 1].x;
    if (hdr && hdr.gx != null) markCols.forEach(function (c) { if (Math.abs(c.x - hdr.gx) < Math.abs(Xg - hdr.gx)) Xg = c.x; });
    var unitCols = cols.filter(function (c) { return !c.marks && c.units; }), Xu = null;
    if (unitCols.length) {
      var best = unitCols[0];
      unitCols.forEach(function (c) {
        var ref = hdr && hdr.ux != null ? hdr.ux : Xg;
        if (Math.abs(c.x - ref) < Math.abs(best.x - ref)) best = c;
      });
      Xu = best.x;
    }
    // Too few units were read to show a column, but the "Units" title is there: look under it (the cells get read again).
    if (Xu === null && hdr && hdr.ux != null && Math.abs(hdr.ux - Xg) > 2 * H) Xu = hdr.ux;
    var tol = Math.max(gap * 0.8, 14);
    if (Xu !== null) tol = Math.max(14, Math.min(tol, 0.45 * Math.abs(Xg - Xu)));
    return { Xu: Xu, Xg: Xg, tol: tol };
  }

  function pickByModel(it, model) {
    var res = { g: null, gr: null, u: null, un: null };
    var g = nearestWithin(it.toks, model.Xg, model.tol, function (t) { return T.asGrade(t.n, false); });
    if (g) { res.g = g; res.gr = T.asGrade(g.n, false); }
    if (model.Xu !== null) {
      var u = nearestWithin(it.toks, model.Xu, model.tol, function (t) { return T.asUnits(t.n); });
      if (u) { res.u = u; res.un = T.asUnits(u.n); }
    }
    return res;
  }

  function cleanTitle(words, minX, picks, H) {
    var ws = words.filter(function (w) {
      var t = w.t.replace(/[^A-Za-z]/g, '');
      if (w.x0 < minX || REMARK.test(t) || T.statusOf(w.t)) return false;
      return !picks.some(function (p) { return Math.abs(w.cy - p.cy) < 0.7 * H && w.x0 >= p.x0 - 1; });
    });
    if (!ws.length) return '';
    var h = Lay.median(ws.map(function (w) { return w.h; })) || 20;
    var text = Lay.clusterLines(ws, h).map(function (L) { return L.text; }).join(' ');
    return text.replace(/^[\s\-–—:·•|]+/, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }

  function lastBefore(heads, cy) {
    var best = null;
    heads.forEach(function (h) { if (h.cy < cy && (!best || h.cy > best.cy)) best = h; });
    return best ? best.label : '';
  }

  function dedupeRows(rows) {
    var seen = {}, out = [], dropped = 0;
    rows.forEach(function (r) {
      var k = [r.code, r.units, r.grade, r.status, r.term].join('|');
      if (r.code && r.units !== '' && r.grade !== '' && seen[k]) { dropped++; return; }
      seen[k] = true; out.push(r);
    });
    return { rows: out, dropped: dropped };
  }

  function makeRow(code, name, un, gr, status, term, flags) {
    var r = {
      code: code, name: name, units: un ? un.value : '', grade: gr ? gr.value : '', status: status || '',
      term: term || '', nonCredit: !!(un && un.paren), flags: flags || []
    };
    if (!un) r.flags.push('no-units');
    if (!gr && !r.status) r.flags.push('no-grade');
    if (gr && gr.fixed) r.flags.push('dot-added');
    if (un && un.value > 6) r.flags.push('big-units');
    r.include = !!(un && gr && !r.nonCredit && !r.status);
    return r;
  }

  // Photos with no course codes: any line with a units number followed by a mark.
  function looseRows(w1, w2, H, W, meta) {
    meta.mode = 'loose';
    var p2 = w2.map(function (w) { var n = T.normNum(w.t); return n ? { n: n, w: w } : null; }).filter(Boolean);
    var pool = w2.concat(w1.filter(function (w) { return !overlaps(w, p2, H); }));
    var rows = [];
    Lay.clusterLines(pool, H).forEach(function (L) {
      if (SKIP_LINE.test(L.text)) return;
      var toks = L.words.map(function (w) { var n = T.normNum(w.t); return n ? { n: n, w: w } : null; }).filter(Boolean).sort(byX);
      var pk = pickRow(toks, 'ug', null);
      if (!pk.g || !pk.u) return;
      var name = cleanTitle(L.words.filter(function (w) { return w.x1 <= pk.u.w.x0 + 2; }), 0, [], H);
      if (!/[A-Za-z]{3}/.test(name)) return;
      rows.push(makeRow('', name, pk.un, pk.gr, '', '', []));
    });
    return { rows: rows, meta: meta };
  }

  function lastNumber(L) {
    var out = null;
    L.words.forEach(function (w) { var n = T.normNum(w.t); if (n) out = n; });
    return out;
  }

  // "Total Units: 26" and "GWA: 1.47" printed on the page. Used to double-check the rows that were read.
  function printedTotals(lines) {
    var out = { units: null, gwa: null };
    lines.forEach(function (L) {
      if (/total\s*(number\s*of\s*)?units?|units?\s*(total|earned|enrolled|taken)/i.test(L.text)) {
        var n = lastNumber(L);
        if (n && n.intLike && n.v >= 1 && n.v <= 60) out.units = n.v;
      }
      if (/\b(gwa|g\.?w\.?a\.?|weighted\s+average|general\s+average)\b/i.test(L.text)) {
        var g = lastNumber(L);
        if (g && !g.intLike && g.dec <= 3 && g.v >= 1 && g.v <= 5) out.gwa = g.v;
      }
    });
    return out;
  }

  // Cells worth reading again on their own, in a tight crop and at a larger size: numbers that are missing, a bracket
  // that may not be real, a mark whose dot was put back, and numbers only one read has seen.
  // Returns [{ field: 'units' | 'grade', reason, x0, y0, x1, y1 }] in picture coordinates.
  function cellWants(items, model, H, mode) {
    var out = [], halfU = Math.max(1.2 * H, Math.min(model.tol, 2.6 * H)), halfG = Math.max(3.2 * H, model.tol);
    function add(field, reason, cx, cy, hw) {
      out.push({ field: field, reason: reason, x0: cx - hw, y0: cy - 0.95 * H, x1: cx + hw, y1: cy + 0.95 * H });
    }
    items.forEach(function (it) {
      var p = it.pick, rowCy = p.g ? p.g.w.cy : p.u ? p.u.w.cy : it.a.cy;
      // A doubtful code with nothing in its mark column is probably not a row at all; one with some number there (even a garbled one) is.
      var nearMark = it.toks.some(function (t) { return Math.abs(t.w.cx - model.Xg) <= 2 * model.tol; });
      if (it.a.weak && !p.gr && !it.status && !nearMark) return;
      // A code the reader was unsure of (or could not make into a code at all) is read again, one line at a time.
      // The crop reaches well past the word on the right: a last letter the reader dropped lies beyond its box.
      {
        var codeWhy = (it.a.weak || (it.a.conf != null && it.a.conf < CODE_SURE)) ? 'code' : 'verify';
        (it.a.boxes || []).forEach(function (bx) {
          out.push({ field: 'code', reason: codeWhy, x0: bx.x0 - 0.6 * H, y0: bx.y0 - 0.25 * H, x1: bx.x1 + 1.2 * H, y1: bx.y1 + 0.25 * H });
        });
      }
      if (model.Xu !== null) {
        if (!p.u) add('units', 'missing', model.Xu, rowCy, halfU);
        else if (p.u.w.p !== 3) {
          var why = (p.un.paren || p.u.br) ? 'bracket' : (p.u.w.c || 0) < 80 ? 'unsure' : mode === 'all' ? 'check' : '';
          if (why) add('units', why, p.u.w.cx, p.u.w.cy, Math.max(halfU, p.u.w.w / 2 + 0.7 * H));
        }
      }
      if (!p.g) {
        if (!it.status) add('grade', 'missing', model.Xg, rowCy, halfG);
      } else if (p.g.w.p !== 3) {
        var why2 = p.gr.fixed ? 'dot' : (p.g.w.c || 0) < 80 ? 'unsure' : (p.g.w.p === 2 && mode === 'all') ? 'check' : '';
        if (why2) add('grade', why2, p.g.w.cx, p.g.w.cy, Math.max(halfG * 0.6, p.g.w.w / 2 + 0.7 * H));
      }
    });
    return out;
  }

  function parse(raw1, raw2, opts) {
    opts = opts || {};
    var w1 = Lay.prepare(raw1, 1), w2 = Lay.prepare(raw2 || [], 2), w3 = Lay.prepare(opts.recovered || [], 3), all = w1.concat(w2, w3);
    var W = opts.width || Math.max.apply(null, all.map(function (w) { return w.x1; }).concat([1]));
    var H = Lay.median(w1.filter(function (w) { return w.h > 4; }).map(function (w) { return w.h; })) || 24;
    var lines = Lay.clusterLines(w1, H);
    var loose = false, anchors = Lay.columnFilter(Lay.findAnchors(lines, false), W);
    if (!anchors.length) { loose = true; anchors = Lay.columnFilter(Lay.findAnchors(lines, true), W); }
    var meta = { H: H, W: W, anchors: anchors.length, looseCodes: loose, mode: 'coded', pitch: 0, order: 'ug' };
    if (!anchors.length) return looseRows(w1, w2, H, W, meta);

    var gaps = [];
    for (var i = 1; i < anchors.length; i++) gaps.push(anchors[i].cy - anchors[i - 1].cy);
    var pitch = gaps.length ? Lay.median(gaps) : 2.5 * H;
    meta.pitch = pitch;
    // A code the reader garbled ("lT2l1") can still be spotted: it sits in the code column and mixes letters and digits.
    var codeX = Lay.median(anchors.map(function (a) { return a.x0; })), strongLines = [];
    anchors.forEach(function (a) { (a.lines || [a.line]).forEach(function (L) { strongLines.push(L); }); });
    var yMin = anchors[0].cy - 1.6 * pitch, yMax = anchors[anchors.length - 1].cy + 1.6 * pitch, weak = [];
    // The same for a wrapped code whose top half the reader garbled ("SOCsC" over "1120").
    if (anchors.some(function (a) { return a.stacked; })) {
      var used = [];
      anchors.forEach(function (a) { (a.parts || []).forEach(function (ws) { ws.forEach(function (w) { used.push(w); }); }); });
      Lay.findStacked(lines, false, used, true).forEach(function (a) {
        if (Math.abs(a.x0 - codeX) > Math.max(0.06 * W, 40) || a.cy < yMin || a.cy > yMax || SKIP_LINE.test(a.lines[0].text)) return;
        a.weak = true; a.conf = 0;
        weak.push(a);
      });
    }
    var tolX = Math.max(0.06 * W, 40);
    var stackGap = Lay.median(anchors.filter(function (a) { return a.stacked; }).map(function (a) { return a.parts[1][0].cy - a.parts[0][0].cy; }));
    var stackWidth = Math.max.apply(null, [0].concat(anchors.filter(function (a) { return a.stacked; }).map(function (a) { return a.parts[0][0].x1 - a.parts[0][0].x0; })));
    lines.forEach(function (L) {
      if (strongLines.indexOf(L) >= 0 || L.cy < yMin || L.cy > yMax || SKIP_LINE.test(L.text)) return;
      if (weak.some(function (a) { return a.lines.indexOf(L) >= 0; })) return;      // already found as a wrapped code
      var k = 0, w0, t, w1n;
      while (k < L.words.length && Math.abs(L.words[k].x0 - codeX) > tolX) k++;     // the first word in the code column
      if (k >= L.words.length) return;
      w0 = L.words[k]; t = T.clean(w0.t); w1n = L.words[k + 1];
      if (t.length < 2 && !/^\d$/.test(t) || t.length > 12) return;
      // The letters of the code are gone altogether (the reader dropped them) and only its number is left: "1120".
      if (/^\d{3,4}[A-Za-z]?$/.test(t) && T.codeNumber(w0.t)) {
        var num = T.codeNumber(w0.t);
        // Under the code column's left edge it is the second line of a wrapped code, so the letters sit one line above.
        // Further right it is a code written on one line, and its letters should be to the left.
        if (Math.abs(w0.x0 - codeX) <= 0.9 * H) {
          var gap = stackGap > 0 ? stackGap : 2.2 * H;
          var top = { x0: codeX, x1: Math.max(w0.x1, codeX + (stackWidth || 6 * H)), y0: w0.y0 - gap, y1: w0.y1 - gap, cx: 0, cy: w0.cy - gap, c: 0 };
          weak.push({
            code: num, top: '', num: num, x0: Math.min(codeX, w0.x0), x1: w0.x1, y0: top.y0, y1: w0.y1, cy: (top.cy + w0.cy) / 2,
            line: L, lines: [L], weak: true, conf: 0, parts: [[top], [w0]], stacked: true
          });
        } else {
          var lead = { x0: codeX, x1: w0.x1, y0: w0.y0, y1: w0.y1, cy: w0.cy, c: 0 };
          weak.push({ code: num, x0: codeX, x1: w0.x1, y0: w0.y0, y1: w0.y1, cy: w0.cy, line: L, lines: [L], weak: true, conf: 0, parts: [[lead]] });
        }
        return;
      }
      var mixed = /\d/.test(t) && /[A-Za-z]/.test(t) && !T.normNum(t);
      var lettersOnly = /^[A-Za-z]{2,8}$/.test(t);
      if (!mixed && !lettersOnly) return;
      // Letters that are not quite a code ("socscl") or a code that came out as one garbled word ("80CsCl"), usually followed
      // by the number of the code in the same column: a code the reader garbled. The number is part of it.
      var hasNum = w1n && T.codeNumber(w1n.t) && w1n.x0 - w0.x1 < 2.4 * H && Math.abs(w1n.cy - w0.cy) < 0.6 * H;
      if (lettersOnly && !hasNum) return;
      var ws = hasNum ? [w0, w1n] : [w0];
      weak.push({
        code: hasNum ? t + ' ' + T.codeNumber(w1n.t) : t, x0: w0.x0, x1: ws[ws.length - 1].x1,
        y0: Math.min.apply(null, ws.map(function (w) { return w.y0; })), y1: Math.max.apply(null, ws.map(function (w) { return w.y1; })),
        cy: ws.reduce(function (a, w) { return a + w.cy; }, 0) / ws.length, line: L, lines: [L], weak: true, conf: 0, parts: [ws]
      });
    });
    if (weak.length) anchors = anchors.concat(weak).sort(function (a, b) { return a.cy - b.cy; });
    anchors.forEach(function (a) {
      a.wasWeak = !!a.weak;
      a.code0 = a.code;
      a.boxes = (a.parts || [[a]]).map(function (ws) {
        return {
          x0: Math.min.apply(null, ws.map(function (w) { return w.x0; })), y0: Math.min.apply(null, ws.map(function (w) { return w.y0; })),
          x1: Math.max.apply(null, ws.map(function (w) { return w.x1; })), y1: Math.max.apply(null, ws.map(function (w) { return w.y1; }))
        };
      });
    });
    // Code cells that were read again on their own: take the new reading when it makes a proper code and the reader is surer of it.
    function readBox(bx) {
      return w3.filter(function (w) {
        return w.cx >= bx.x0 - 0.6 * H && w.cx <= bx.x1 + 1.2 * H && w.cy >= bx.y0 - 0.25 * H && w.cy <= bx.y1 + 0.25 * H;
      }).sort(function (p, q) { return p.x0 - q.x0; });
    }
    function plain(ws) { return ws.map(function (w) { return w.t; }).join(' ').replace(/[\[\]()|{}!]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function votes(ws) { return ws.length ? Math.min.apply(null, ws.map(function (w) { return w.v == null ? 1 : w.v; })) : 0; }
    // A re-read replaces what the page read only when it is trustworthy: always for a garbled code, when most readings agreed
    // for a doubtful one, and only when both readings agreed for a code that looked fine.
    function accept(a, ws) {
      if (a.weak) return true;
      if (a.conf < CODE_SURE) return votes(ws) >= 2 || sure(ws) >= 55;
      return votes(ws) >= 2;
    }
    function sure(ws) { return ws.length ? Math.min.apply(null, ws.map(function (w) { return w.c || 0; })) : -1; }
    // Course numbers repeat down a sheet (MATH 1100, ARTS 1100, ...). When the page read and the re-read of a code differ in the
    // number, the one that other rows of the same sheet also have is the more likely to be right.
    function support(num, self) {
      var n = 0;
      anchors.forEach(function (b) {
        if (b === self || b.wasWeak) return;
        var m = /\s(\S+)$/.exec(b.code0 || '');
        if (m && m[1] === num) n++;
      });
      return n;
    }
    function betterNumber(a, oldNum, newNum) {
      if (a.weak || !oldNum || !newNum || oldNum === newNum) return true;
      var so = support(oldNum, a), sn = support(newNum, a);
      if (sn !== so) return sn > so;
      // Neither number is seen elsewhere: prefer the one with as many digits as most of the sheet's course numbers have.
      var lens = {}, best = 0, common = 0;
      anchors.forEach(function (b) {
        var m = /\s(\d+)[A-Za-z]?$/.exec(b.code0 || '');
        if (b === a || b.wasWeak || !m) return;
        lens[m[1].length] = (lens[m[1].length] || 0) + 1;
        if (lens[m[1].length] > best) { best = lens[m[1].length]; common = m[1].length; }
      });
      var lo = oldNum.replace(/\D/g, '').length, ln = newNum.replace(/\D/g, '').length;
      if (common && lo !== ln) return ln === common || lo !== common;
      return true;
    }
    if (w3.length) anchors.forEach(function (a) {
      if (!a.boxes) return;
      if (a.stacked) {
        var top = readBox(a.boxes[0]), bottom = readBox(a.boxes[1]);
        var lt = T.codeLetters(plain(top).toUpperCase(), false), nm = T.codeNumber(plain(bottom));
        var oldTop = a.top != null ? a.top : a.code.split(' ')[0], oldNum = a.num != null ? a.num : a.code.split(' ')[1];
        if (lt && accept(a, top)) oldTop = lt;
        if (nm && accept(a, bottom) && betterNumber(a, oldNum, nm)) oldNum = nm;
        a.code = (oldTop + ' ' + oldNum).trim();
        if (a.weak && lt && nm && sure(top) >= 60 && sure(bottom) >= 60) a.weak = false;
      } else {
        var got = readBox(a.boxes[0]), m = /^([A-Za-z]{2,8})\s*[-.]?\s*(\S{1,6})$/.exec(plain(got));
        if (!m || !T.codeLetters(m[1].toUpperCase(), false) || !T.codeNumber(m[2])) return;
        var was = /\s(\S+)$/.exec(a.code0 || ''), nowNum = T.codeNumber(m[2]);
        if (accept(a, got) && betterNumber(a, was && was[1], nowNum)) {
          a.code = m[1].toUpperCase() + ' ' + nowNum;
          if (sure(got) >= 60) a.weak = false;
        }
      }
    });
    var hdr = Lay.headerInfo(lines, anchors[0].cy, pitch);
    var order = hdr.order || 'ug';
    meta.order = order;
    var heads = Lay.termHeadings(lines, anchors);

    // Semester heading lines ("1st Semester 2025-2026") are not part of any row.
    function onHeading(w) {
      return heads.some(function (h) { return Math.abs(w.cy - h.cy) < 0.55 * H; });
    }
    function inAnchor(w) {
      return anchors.some(function (a) {
        if (a.stacked) return w.cx >= a.x0 - 0.3 * H && w.cx <= a.x1 + 0.3 * H && w.cy >= a.y0 - 0.3 * H && w.cy <= a.y1 + 0.3 * H;
        return w.cx >= a.x0 - 0.3 * H && w.cx <= a.x1 + 0.3 * H && Math.abs(w.cy - a.cy) < 0.7 * H;
      });
    }
    function owner(w) {
      var best = -1, bd = 1e9;
      anchors.forEach(function (a, k) { var d = Math.abs(w.cy - a.cy); if (d < bd) { bd = d; best = k; } });
      return bd <= 0.75 * pitch ? best : -1;
    }

    // Every number that was read, from the three sources: the text pass, the numbers pass, and single cells that were
    // read again on their own (opts.recovered). Where two sources saw the same spot, keep the one that looks right.
    function sameSpot(a, b) {
      return Math.abs(a.cx - b.cx) < 0.6 * Math.max(a.w, b.w, 1) && Math.abs(a.cy - b.cy) < 0.6 * H;
    }
    function tokScore(t) {
      var valid = (T.asGrade(t.n, false) || T.asUnits(t.n)) ? 1 : 0;
      return valid * 1000 + (t.w.p === 3 && (t.w.c || 0) >= 60 ? 500 : 0) + (t.w.c || 0) + (t.w.p === 2 ? 1 : 0);
    }
    function numeric(ws) {
      var out = [];
      ws.forEach(function (w) {
        var n = T.normNum(w.t);
        if (n && !inAnchor(w) && !onHeading(w)) out.push({ n: n, w: w });
      });
      return out;
    }
    var pool = [], txt = [];
    // A bracket seen by any one read of a spot is kept as a hint, even when another read wins ("(31" and "3" are the same cell).
    var BRACKET = /[\[\](){}]/;
    numeric(w3).concat(numeric(w2), numeric(w1)).forEach(function (t) {
      var k = -1, q;
      t.br = BRACKET.test(t.w.t);
      for (q = 0; q < pool.length; q++) if (sameSpot(t.w, pool[q].w)) { k = q; break; }
      if (k < 0) pool.push(t);
      else if (tokScore(t) > tokScore(pool[k])) { t.br = t.br || pool[k].br; pool[k] = t; }
      else pool[k].br = pool[k].br || t.br;
    });
    w1.forEach(function (w) { if (!T.normNum(w.t) && !inAnchor(w) && !onHeading(w)) txt.push(w); });

    // On the code's own line a number must sit right of the code. On a line below it (card layouts) it can be anywhere.
    function rightOfCode(w, a) { return Math.abs(w.cy - a.cy) >= 0.7 * H || w.x0 >= a.x1 - 0.3 * H; }
    var items = anchors.map(function (a) { return { a: a, toks: [], txt: [] }; });
    pool.forEach(function (t) {
      var k = owner(t.w);
      if (k >= 0 && rightOfCode(t.w, anchors[k])) items[k].toks.push(t);
    });
    txt.forEach(function (w) {
      var k = owner(w);
      if (k >= 0 && rightOfCode(w, anchors[k])) items[k].txt.push(w);
    });
    // Words from cells that were read again on their own can show a mark such as INC that the page read missed.
    w3.forEach(function (w) {
      if (T.normNum(w.t) || inAnchor(w) || onHeading(w)) return;
      var k = owner(w);
      if (k >= 0 && rightOfCode(w, anchors[k])) items[k].txt.push(w);
    });
    items.forEach(function (it) { it.toks.sort(byX); });
    var model = columnModel(items, W, H, hdr);
    meta.cols = model;
    items.forEach(function (it) {
      it.pick = model ? pickByModel(it, model) : pickRow(it.toks, order, hdr);
      it.status = '';
      if (!it.pick.gr) it.txt.forEach(function (w) { var s = T.statusOf(w.t); if (s && !it.status) it.status = s; });
    });
    meta.wants = model ? cellWants(items, model, H, opts.verify) : [];

    var rows = [];
    items.forEach(function (it) {
      var p = it.pick, status = it.status;
      var picks = [p.u, p.g].filter(Boolean).map(function (t) { return t.w; });
      // A digit that ends a title ("Fitness 3") is a number token too; keep it when it is not in the units or grade column.
      var extra = picks.length ? it.toks.filter(function (t) { return t !== p.u && t !== p.g; }).map(function (t) { return t.w; }) : [];
      var name = cleanTitle(it.txt.concat(extra), it.a.x1 - 0.3 * H, picks, H);
      if (it.a.wasWeak && !p.gr && !status) return;
      rows.push(makeRow(it.a.code, name, p.un, p.gr, status, lastBefore(heads, it.a.cy), it.a.weak ? ['code?'] : []));
    });
    var d = dedupeRows(rows);
    meta.duplicates = d.dropped;
    meta.weak = weak.length;
    meta.printed = printedTotals(lines);
    return { rows: d.rows, meta: meta };
  }

  return { parse: parse };
});
