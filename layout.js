/* Geometry: turn loose OCR words into lines, find course codes (row anchors), column titles and semester headings. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tokens.js'));
  else root.GwaLayout = factory(root.GwaTokens);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Accepts { t|text, x0, y0, x1, y1, c } and adds centre and size.
  function prepare(words, pass) {
    var out = [];
    (words || []).forEach(function (w) {
      var t = String(w.t != null ? w.t : w.text != null ? w.text : '').trim();
      if (!t) return;
      var o = { t: t, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, c: w.c == null ? 0 : w.c, p: pass };
      o.cx = (o.x0 + o.x1) / 2; o.cy = (o.y0 + o.y1) / 2; o.w = o.x1 - o.x0; o.h = o.y1 - o.y0;
      out.push(o);
    });
    return out;
  }

  // A dark band, a shadow edge or a ruled line can come back as a "word" that is far bigger than any real word.
  // Painting over such a box would wipe out real numbers, so these are dropped before anything else uses them.
  function dropJunk(words) {
    var hs = words.map(function (w) { return w.y1 - w.y0; }).filter(function (h) { return h > 4; });
    var H = median(hs) || 20;
    return words.filter(function (w) {
      var h = w.y1 - w.y0, wd = w.x1 - w.x0, c = w.c == null ? 100 : w.c;
      if (h > 4 * H || wd > 40 * H) return false;
      if (c < 40 && (h > 2 * H || wd > 20 * H)) return false;
      return true;
    });
  }

  // How steeply the rows of text run downhill, in degrees (positive = lower on the right).
  // Step 1: words that share a row sit at the same height once the tilt is undone, so count such pairs for each angle.
  // Step 2: with the rows found, fit a straight line through each long row and take the middle slope.
  function tilt(words) {
    var pts = words.filter(function (w) { return (w.y1 - w.y0) > 4; }).map(function (w) {
      return { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 };
    });
    if (pts.length < 8) return 0;
    var H = median(words.map(function (w) { return w.y1 - w.y0; }).filter(function (h) { return h > 4; })) || 20;
    if (pts.length > 500) pts = pts.filter(function (p, i) { return i % Math.ceil(pts.length / 500) === 0; });
    var win = 0.3 * H;
    function untilted(deg) {
      var k = Math.tan(deg * Math.PI / 180);
      return pts.map(function (p) { return { x: p.x, y: p.y - k * p.x, y0: p.y }; }).sort(function (a, b) { return a.y - b.y; });
    }
    function score(deg) {
      var ys = untilted(deg), n = 0, j = 0, i;
      for (i = 0; i < ys.length; i++) {
        if (j < i) j = i;
        while (j + 1 < ys.length && ys[j + 1].y - ys[i].y <= win) j++;
        n += j - i;
      }
      return n;
    }
    var base = score(0), best = 0, bestS = base, d, s;
    for (d = -8; d <= 8; d += 0.25) { s = score(d); if (s > bestS) { bestS = s; best = d; } }
    if (Math.abs(best) < 0.4 || bestS < base * 1.04) return 0;
    // rows at the coarse angle -> one fitted slope per long row
    var ys = untilted(best), groups = [], cur = [ys[0]], i2;
    for (i2 = 1; i2 < ys.length; i2++) {
      if (ys[i2].y - ys[i2 - 1].y > 0.6 * H) { groups.push(cur); cur = []; }
      cur.push(ys[i2]);
    }
    groups.push(cur);
    var fits = [];
    groups.forEach(function (g) {
      if (g.length < 4) return;
      var xs = g.map(function (p) { return p.x; }), span = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      if (span < 8 * H) return;
      var mx = 0, my = 0, sxx = 0, sxy = 0;
      g.forEach(function (p) { mx += p.x; my += p.y0; });
      mx /= g.length; my /= g.length;
      g.forEach(function (p) { sxx += (p.x - mx) * (p.x - mx); sxy += (p.x - mx) * (p.y0 - my); });
      if (sxx > 0) fits.push({ deg: Math.atan(sxy / sxx) * 180 / Math.PI, w: span });
    });
    if (fits.length >= 2) {
      fits.sort(function (a, b) { return a.deg - b.deg; });
      var tot = fits.reduce(function (a, f) { return a + f.w; }, 0), acc = 0, f;
      for (var q = 0; q < fits.length; q++) { f = fits[q]; acc += f.w; if (acc * 2 >= tot) { best = f.deg; break; } }
    }
    if (Math.abs(best) < 0.4) return 0;
    return Math.round(best * 100) / 100;
  }

  function clusterLines(words, H) {
    var ws = words.slice().sort(function (a, b) { return a.cy - b.cy; }), lines = [];
    ws.forEach(function (w) {
      var L = lines[lines.length - 1];
      if (L && Math.abs(w.cy - L.cy) <= 0.55 * H) {
        L.words.push(w);
        L.cy = (L.cy * (L.words.length - 1) + w.cy) / L.words.length;
      } else lines.push({ cy: w.cy, words: [w] });
    });
    lines.forEach(function (L) {
      L.words.sort(function (a, b) { return a.x0 - b.x0; });
      L.text = L.words.map(function (w) { return w.t; }).join(' ');
    });
    return lines;
  }

  // The leftmost course code on each line.
  function findAnchors(lines, loose) {
    var out = [];
    lines.forEach(function (L) {
      var ws = L.words;
      for (var i = 0; i < ws.length; i++) {
        var hit = T.codeAt(ws, i, loose);
        if (!hit) continue;
        var last = ws[i + hit.span - 1];
        out.push({
          code: hit.text, x0: ws[i].x0, x1: last.x1, y0: Math.min(ws[i].y0, last.y0), y1: Math.max(ws[i].y1, last.y1),
          cy: (ws[i].cy + last.cy) / 2, line: L
        });
        break;
      }
    });
    return out;
  }

  // Real codes line up in one column. Keep the biggest group at the same left edge.
  function columnFilter(anchors, W) {
    if (anchors.length < 3) return anchors;
    var tol = Math.max(0.06 * W, 40), best = null, bestN = -1;
    anchors.forEach(function (a) {
      var n = anchors.filter(function (b) { return Math.abs(b.x0 - a.x0) <= tol; }).length;
      if (n > bestN || (n === bestN && a.x0 < best.x0)) { best = a; bestN = n; }
    });
    return anchors.filter(function (b) { return Math.abs(b.x0 - best.x0) <= tol; });
  }

  // Find the "Units" and "Grade" column titles just above the first row.
  function headerInfo(lines, firstCy, pitch) {
    var u = null, g = null;
    lines.forEach(function (L) {
      if (L.cy >= firstCy - 0.3 * pitch || L.cy < firstCy - 3.2 * pitch) return;
      L.words.forEach(function (w) {
        var t = w.t.replace(/[^A-Za-z]/g, '').toLowerCase();
        if (/^(units?|credits?)$/.test(t)) u = w;
        else if (/^(grades?|ratings?|finals?)$/.test(t)) g = w;
      });
    });
    var order = null;
    if (u && g) order = u.cx < g.cx ? 'ug' : 'gu';
    return { order: order, ux: u ? u.cx : null, gx: g ? g.cx : null };
  }

  var ORD = /\b(1st|first|2nd|second|3rd|third|4th|fourth)\b/i;
  var KIND = /\b(semester|sem|term|trimester)\b/i;
  var SPECIAL = /\b(summer|mid[\s-]?year)\b/i;
  var YEARS = /(20\d{2})\s*[-–—~]\s*(20\d{2}|\d{2})\b/;
  var ORD_MAP = { '1st': '1st', first: '1st', '2nd': '2nd', second: '2nd', '3rd': '3rd', third: '3rd', '4th': '4th', fourth: '4th' };

  // "1st Semester • A.Y. 2025–2026" -> "1st Semester 2025–2026". Empty when the line is not a heading.
  function termLabel(text) {
    var o = ORD.exec(text), k = KIND.exec(text), s = SPECIAL.exec(text);
    if (!((o && k) || s)) return '';
    var y = YEARS.exec(text), yr = '';
    if (y) yr = y[1] + '–' + (y[2].length === 2 ? y[1].slice(0, 2) + y[2] : y[2]);
    else { var y1 = /\b(20\d{2})\b/.exec(text); if (y1) yr = y1[1]; }
    var base = (s && !(o && k)) ? (/summer/i.test(s[0]) ? 'Summer' : 'Midyear') : ORD_MAP[o[1].toLowerCase()] + ' Semester';
    return (base + (yr ? ' ' + yr : '')).trim();
  }

  function termHeadings(lines, anchors) {
    var rowLines = anchors.map(function (a) { return a.line; }), out = [];
    lines.forEach(function (L) {
      if (rowLines.indexOf(L) >= 0) return;
      var label = termLabel(L.text);
      if (label) out.push({ cy: L.cy, label: label });
    });
    return out;
  }

  return {
    median: median, prepare: prepare, dropJunk: dropJunk, tilt: tilt, clusterLines: clusterLines, findAnchors: findAnchors,
    columnFilter: columnFilter, headerInfo: headerInfo, termLabel: termLabel, termHeadings: termHeadings
  };
});
