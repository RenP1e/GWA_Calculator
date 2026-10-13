/* Runs the two reading passes with a Tesseract worker and hands the words to the parser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./image.js'), require('./parse.js'), require('./layout.js'));
  else root.GwaReader = factory(root.GwaImage, root.GwaParse, root.GwaLayout);
})(typeof self !== 'undefined' ? self : this, function (Img, Parse, Lay) {
  'use strict';

  function wordsOf(data) {
    var out = [];
    ((data && data.blocks) || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) {
            var t = (w.text || '').trim();
            if (t && w.bbox) out.push({ t: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: w.confidence });
          });
        });
      });
    });
    return out;
  }

  async function recognize(worker, input, psm, keepSettings) {
    if (!keepSettings) await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    var res = await worker.recognize(input, {}, { blocks: true });
    return Lay.dropJunk(wordsOf(res.data));
  }

  var MAX_CELLS = 60;
  var ORDER = { missing: 0, bracket: 1, dot: 2, unsure: 3, check: 4 };

  // Read single cells again, each in its own tight crop and enlarged, as one line of text. This is far more reliable
  // than the whole-page reads for a lone digit. Returns words in picture coordinates.
  async function readCells(worker, canvas, wants, deps) {
    var toInput = deps.toInput || function (c) { return c; };
    var list = wants.slice().sort(function (a, b) { return ORDER[a.reason] - ORDER[b.reason]; }).slice(0, MAX_CELLS);
    var out = [], W = canvas.width, H = canvas.height, pad = 12;
    if (!list.length) return out;
    await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      var sx0 = Math.max(0, Math.floor(w.x0)), sy0 = Math.max(0, Math.floor(w.y0));
      var sx1 = Math.min(W, Math.ceil(w.x1)), sy1 = Math.min(H, Math.ceil(w.y1));
      if (sx1 - sx0 < 4 || sy1 - sy0 < 4) continue;
      var k = Math.max(2, Math.min(4, Math.round(84 / (w.y1 - w.y0))));
      var ox = sx0 - pad, oy = sy0 - pad;                       // picture position of the crop's top-left corner
      var cw = Math.round((sx1 - sx0 + 2 * pad) * k), ch = Math.round((sy1 - sy0 + 2 * pad) * k);
      var c = deps.makeCanvas(cw, ch), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, pad * k, pad * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
      var got = await recognize(worker, toInput(c), '7', true);
      got.forEach(function (t) {
        out.push({ t: t.t, c: t.c, x0: ox + t.x0 / k, x1: ox + t.x1 / k, y0: oy + t.y0 / k, y1: oy + t.y1 / k });
      });
    }
    return out;
  }

  // How much a set of words looks like a grade sheet: readable words, and above all course codes.
  function sheetScore(words) {
    var good = 0, p = Lay.prepare(words, 1);
    words.forEach(function (w) { if ((w.c || 0) >= 60 && /^[A-Za-z]{3,}$/.test(w.t)) good++; });
    var H = Lay.median(p.filter(function (w) { return w.h > 4; }).map(function (w) { return w.h; })) || 20;
    var codes = Lay.findAnchors(Lay.clusterLines(p, H), false).length;
    return { score: good + 8 * codes, codes: codes };
  }

  // Nothing readable? The picture may be on its side. Try the quarter turns on a small copy and report the best one.
  async function findTurn(prep, deps, baseline) {
    var toInput = deps.toInput || function (c) { return c; };
    var small = Img.shrink(prep.canvas, 1300, deps), best = null, tries = [1, 3, 2];
    for (var i = 0; i < tries.length; i++) {
      if (i === 2 && best && best.codes >= 2) break;                 // upside down is checked last, and only if needed
      var words = await recognize(deps.worker, toInput(Img.quarter(small, tries[i], deps)), '11');
      var sc = sheetScore(words);
      if (!best || sc.score > best.score) best = { k: tries[i], score: sc.score, codes: sc.codes };
    }
    if (best && (best.codes >= 2 || best.score >= 2 * baseline.score + 10) && best.score > baseline.score) return best;
    return null;
  }

  // One full read of a cleaned-up picture: text pass, lean fix, numbers pass, then the doubtful cells again.
  async function readPrepared(prep, deps, say, allowTurn) {
    var toInput = deps.toInput || function (c) { return c; };
    var t1 = Date.now();
    say('text');
    var words1 = await recognize(deps.worker, toInput(prep.canvas), '11'), t2 = Date.now();
    var first = sheetScore(words1);
    if (allowTurn && first.codes === 0) {
      say('turn');
      var turn = await findTurn(prep, deps, first);
      if (turn) {
        var info = {};
        for (var key in prep.info) info[key] = prep.info[key];
        var c2 = Img.quarter(prep.canvas, turn.k, deps);
        info.turned = turn.k * 90; info.w = c2.width; info.h = c2.height;
        return readPrepared({ canvas: c2, info: info }, deps, say, false);
      }
    }
    // Rows can still lean a little after the first straightening (a phone photo with some perspective, for example).
    // The words show the lean much better than the pixels do, so turn the picture and the word boxes once more.
    var lean = Lay.tilt(words1);
    if (lean) {
      var tilted = Img.turn(prep.canvas, words1, -lean, deps);
      prep.canvas = tilted.canvas; words1 = tilted.words;
      prep.info.lean = lean; prep.info.w = prep.canvas.width; prep.info.h = prep.canvas.height;
    }
    say('numbers');
    var words2 = await recognize(deps.worker, toInput(Img.eraseWords(prep.canvas, words1, deps)), '6'), t3 = Date.now();
    var opts = { width: prep.canvas.width, verify: deps.verify };
    // Parse, then read again the cells that were missing or doubtful, then parse once more with those reads.
    async function parseAndCheck(w1) {
      opts.recovered = [];
      var r = Parse.parse(w1, words2, opts), asked = 0;
      var wants = r.meta.wants || [];
      if (wants.length) {
        say('cells');
        opts.recovered = await readCells(deps.worker, prep.canvas, wants, deps);
        asked = Math.min(wants.length, MAX_CELLS);
        if (opts.recovered.length) r = Parse.parse(w1, words2, opts);
      }
      r.meta.cellReads = asked;
      return r;
    }
    var res = await parseAndCheck(words1), retried = false;
    if (!res.rows.length) {
      // Sparse reading can drop words. Try the block mode once before giving up.
      say('retry');
      var alt = await recognize(deps.worker, toInput(prep.canvas), '6');
      var res2 = await parseAndCheck(alt);
      if (res2.rows.length) { res = res2; retried = true; }
    }
    res.info = prep.info;
    res.info.ms = { text: t2 - t1, numbers: t3 - t2, cells: Date.now() - t3 };
    res.info.words = [words1.length, words2.length];
    res.info.retried = retried;
    res.canvas = prep.canvas;            // the straightened picture the rows were read from
    return res;
  }

  // deps = { worker, makeCanvas(w, h), toInput(canvas)? }. onStage('prepare' | 'text' | 'turn' | 'numbers' | 'cells' | 'retry').
  async function readImage(src, deps, onStage) {
    var say = onStage || function () {};
    var t0 = Date.now();
    say('prepare');
    var prep = Img.prepare(src, deps), t1 = Date.now();
    var res = await readPrepared(prep, deps, say, true);
    res.info.ms.prepare = t1 - t0;
    res.info.ms.total = Date.now() - t0;
    return res;
  }

  return { readImage: readImage, readCells: readCells, recognize: recognize, wordsOf: wordsOf };
});
