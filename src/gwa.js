/* GWA math and honors tiers. No DOM, no OCR. Runs in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GwaMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lower is better. A GWA is rounded to 2 decimals before it is matched to a tier.
  var TIERS = [
    { id: 'us', max: 1.5,  short: 'US', name: 'University Scholar', range: '1.00 – 1.50' },
    { id: 'cs', max: 1.75, short: 'CS', name: 'College Scholar',    range: '1.51 – 1.75' },
    { id: 'dl', max: 2.0,  short: 'DL', name: "Dean's Lister",      range: '1.76 – 2.00' }
  ];

  function round2(x) { return Math.round(x * 100 + 1e-7) / 100; }

  // Marks go 1.00 to 5.00 in steps of 0.25.
  function isValidGrade(g) {
    return typeof g === 'number' && g >= 1 && g <= 5 && Math.abs(g * 4 - Math.round(g * 4)) < 1e-6;
  }

  function blank(v) { return v === '' || v === null || v === undefined; }

  // Weighted average over the rows that are ticked and have both a number of units and a mark.
  function compute(rows) {
    var units = 0, points = 0, count = 0, unreadable = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.include) continue;
      var u = Number(r.units), g = Number(r.grade);
      if (blank(r.units) || blank(r.grade) || !(u > 0) || !(g >= 1 && g <= 5)) { unreadable++; continue; }
      units += u; points += u * g; count++;
    }
    var raw = units > 0 ? points / units : null;
    return { raw: raw, gwa: raw === null ? null : round2(raw), units: units, count: count, unreadable: unreadable };
  }

  function tierFor(gwa) {
    if (gwa === null || gwa === undefined) return null;
    for (var i = 0; i < TIERS.length; i++) if (gwa <= TIERS[i].max + 1e-9) return TIERS[i];
    return null;
  }

  // How far the GWA is from the next tier up (or from Dean's Lister when there is no tier yet).
  function gapToNext(gwa) {
    if (gwa === null || gwa === undefined) return null;
    var t = tierFor(gwa);
    var idx = t ? TIERS.indexOf(t) : TIERS.length;
    if (idx === 0) return null;
    var target = TIERS[idx - 1];
    return { tier: target, diff: round2(gwa - target.max) };
  }

  // When rounding is what puts someone in a tier, say so. Some schools do not round.
  function roundingNote(raw) {
    if (raw === null || raw === undefined) return null;
    var used = tierFor(round2(raw)), exact = tierFor(raw);
    if (used === exact) return null;
    return { exact: raw, used: used, exactTier: exact };
  }

  // One result per semester heading found in the photo. Rows with no heading share one group.
  function groups(rows) {
    var order = [], map = {};
    rows.forEach(function (r) {
      var k = r.term || '';
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(r);
    });
    return order.map(function (k) { return { key: k, label: k, rows: map[k], result: compute(map[k]) }; });
  }

  // Things that usually matter for honors but are not part of the GWA itself.
  function notes(rows) {
    var out = { fail: 0, inc: 0, dropped: 0, nonCredit: 0 };
    rows.forEach(function (r) {
      if (r.status === 'INC') out.inc++;
      else if (/^(DRP|W|UW|AW|NG|UD)$/.test(r.status || '')) out.dropped++;
      if (r.include && Number(r.grade) >= 5) out.fail++;
      if (r.nonCredit && !r.include) out.nonCredit++;
    });
    return out;
  }

  function fmt2(n) { return n === null || n === undefined || isNaN(n) ? '–' : Number(n).toFixed(2); }

  return {
    TIERS: TIERS, round2: round2, isValidGrade: isValidGrade, compute: compute, tierFor: tierFor,
    gapToNext: gapToNext, roundingNote: roundingNote, groups: groups, notes: notes, fmt2: fmt2
  };
});
