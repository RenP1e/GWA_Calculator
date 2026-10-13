/* Photo clean-up before reading: resize, grayscale, flip dark mode, even out lighting, straighten, hide text.
   Works with any canvas that has the 2D API (browser canvas, or @napi-rs/canvas in Node tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GwaImage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SIDE = 2400, MIN_SIDE = 1500;

  function scaleTo(src, deps) {
    var long = Math.max(src.width, src.height), s = 1;
    if (long > MAX_SIDE) s = MAX_SIDE / long;
    else if (long < MIN_SIDE) s = Math.min(MIN_SIDE / long, 3);
    var w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
    var c = deps.makeCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    return c;
  }

  function grayOf(canvas) {
    var w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }

  function paintGray(canvas, g) {
    var ctx = canvas.getContext('2d'), id = ctx.createImageData(canvas.width, canvas.height), d = id.data;
    for (var i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = g[i]; d[j + 3] = 255; }
    ctx.putImageData(id, 0, 0);
  }

  // Most common gray level, and how much of the picture sits near it.
  function histInfo(g) {
    var hist = new Uint32Array(256), n = 0, i;
    for (i = 0; i < g.length; i += 3) { hist[g[i]]++; n++; }
    var best = 0, bestSum = -1;
    for (i = 0; i < 256; i++) {
      var s = 0;
      for (var k = Math.max(0, i - 3); k <= Math.min(255, i + 3); k++) s += hist[k];
      if (s > bestSum) { bestSum = s; best = i; }
    }
    return { hist: hist, mode: best, share: bestSum / Math.max(n, 1), n: n };
  }

  // Light text on a dark page (dark mode) reads badly. Compare small blocks with the average around them:
  // text makes blocks darker than their surroundings on a normal page and lighter on a dark-mode page.
  function wantsInvert(g, w, h) {
    var f = 4, sw = Math.ceil(w / f), sh = Math.ceil(h / f), sum = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh), x, y, i;
    for (y = 0; y < h; y++) {
      var sr = ((y / f) | 0) * sw, r = y * w;
      for (x = 0; x < w; x++) { i = sr + ((x / f) | 0); sum[i] += g[r + x]; cnt[i]++; }
    }
    for (i = 0; i < sum.length; i++) sum[i] /= cnt[i] || 1;
    var mean = boxBlur(sum, sw, sh, 10), dark = 0, light = 0, dsum = 0, lsum = 0;
    for (i = 0; i < sum.length; i++) {
      var d = sum[i] - mean[i];
      if (d < -25) { dark++; dsum -= d; } else if (d > 25) { light++; lsum += d; }
    }
    // Light cards on a grey page also give many "light" blocks, but weak ones. Real light text is strong.
    return light > dark * 1.25 && light > sum.length * 0.003 && lsum * dark > dsum * light;
  }

  function maxFilter(a, w, h, r) {
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, k, m;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      m = 0; for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (a[y * w + k] > m) m = a[y * w + k];
      t[y * w + x] = m;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      m = 0; for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (t[k * w + x] > m) m = t[k * w + x];
      o[y * w + x] = m;
    }
    return o;
  }

  function boxBlur(a, w, h, r) {
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, k, s, c;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0; for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; c++; }
      t[y * w + x] = s / c;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      s = 0; c = 0; for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += t[k * w + x]; c++; }
      o[y * w + x] = s / c;
    }
    return o;
  }

  // Paper brightness varies across a photo. Estimate it on a small copy, then divide it out.
  function flatten(g, w, h) {
    var f = 8, sw = Math.ceil(w / f), sh = Math.ceil(h / f), sum = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh), x, y, i;
    for (y = 0; y < h; y++) {
      var sr = ((y / f) | 0) * sw, r = y * w;
      for (x = 0; x < w; x++) { i = sr + ((x / f) | 0); sum[i] += g[r + x]; cnt[i]++; }
    }
    for (i = 0; i < sum.length; i++) sum[i] /= cnt[i] || 1;
    var bg = boxBlur(maxFilter(sum, sw, sh, 3), sw, sh, 5);
    for (y = 0; y < h; y++) {
      var br = ((y / f) | 0) * sw, rr = y * w;
      for (x = 0; x < w; x++) {
        var b = bg[br + ((x / f) | 0)];
        var v = (255 * g[rr + x]) / (b < 40 ? 40 : b);
        g[rr + x] = v > 255 ? 255 : v;
      }
    }
  }

  // Low-contrast photos: stretch the middle 98% of gray levels to the full range.
  function stretch(g) {
    var info = histInfo(g), acc = 0, lo = 0, hi = 255, i;
    for (i = 0; i < 256; i++) { acc += info.hist[i]; if (acc >= info.n * 0.01) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += info.hist[i]; if (acc >= info.n * 0.01) { hi = i; break; } }
    if (hi - lo >= 200 || hi - lo < 20) return;
    var k = 255 / (hi - lo);
    for (i = 0; i < g.length; i++) { var v = (g[i] - lo) * k; g[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
  }

  // Text rows should line up. Try small tilts and keep the one that makes the row profile sharpest.
  // Returns degrees to turn the picture clockwise (0 when it already looks straight).
  function estimateSkew(g, w, h) {
    var k = Math.max(1, Math.round(w / 640)), sw = Math.floor(w / k), sh = Math.floor(h / k), pts = [], x, y, a, b;
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      var s = 0;
      for (a = 0; a < k; a++) for (b = 0; b < k; b++) s += g[(y * k + a) * w + x * k + b];
      if (s / (k * k) < 140) pts.push(x, y);
    }
    if (pts.length < 400) return 0;
    function score(deg) {
      var r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), off = Math.abs(sn) * sw + 2;
      var bins = new Float32Array(Math.ceil(sh * Math.abs(cs) + 2 * off + 4)), i;
      for (i = 0; i < pts.length; i += 2) bins[(pts[i + 1] * cs - pts[i] * sn + off) | 0]++;
      var sc = 0;
      for (i = 1; i < bins.length; i++) { var d = bins[i] - bins[i - 1]; sc += d * d; }
      return sc;
    }
    var base = score(0), best = 0, bestS = base, d;
    for (d = -10; d <= 10; d += 0.5) { var sc = score(d); if (sc > bestS) { bestS = sc; best = d; } }
    var c0 = best;
    for (d = c0 - 0.5; d <= c0 + 0.5; d += 0.1) { var s2 = score(d); if (s2 > bestS) { bestS = s2; best = d; } }
    if (Math.abs(best) < 0.3 || bestS < base * 1.03) return 0;
    return -best;
  }

  function rotate(canvas, deg, deps) {
    var a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    var w = canvas.width, h = canvas.height, nw = Math.ceil(w * c + h * s), nh = Math.ceil(w * s + h * c);
    var out = deps.makeCanvas(nw, nh), g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, nw, nh);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.translate(nw / 2, nh / 2); g.rotate(a); g.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }

  // Exact quarter turns (k = 1: 90 degrees clockwise, 2: upside down, 3: 90 degrees counter-clockwise). No blur.
  function quarter(canvas, k, deps) {
    k = ((k % 4) + 4) % 4;
    if (!k) return canvas;
    var w = canvas.width, h = canvas.height, src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var nw = k === 2 ? w : h, nh = k === 2 ? h : w;
    var out = deps.makeCanvas(nw, nh), ctx = out.getContext('2d'), id = ctx.createImageData(nw, nh), dst = id.data;
    var x, y, i, j;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (k === 1) j = x * nw + (h - 1 - y);
        else if (k === 2) j = (h - 1 - y) * nw + (w - 1 - x);
        else j = (w - 1 - x) * nw + y;
        i = (y * w + x) * 4; j *= 4;
        dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = src[i + 3];
      }
    }
    ctx.putImageData(id, 0, 0);
    return out;
  }

  // Turn the picture and the word boxes found on it by the same angle (degrees clockwise).
  function turn(canvas, words, deg, deps) {
    var out = rotate(canvas, deg, deps), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var ox = canvas.width / 2, oy = canvas.height / 2, nx = out.width / 2, ny = out.height / 2;
    var moved = words.map(function (w) {
      var dx = (w.x0 + w.x1) / 2 - ox, dy = (w.y0 + w.y1) / 2 - oy, hw = (w.x1 - w.x0) / 2, hh = (w.y1 - w.y0) / 2;
      var rx = nx + dx * c - dy * s, ry = ny + dx * s + dy * c, o = {}, k;
      for (k in w) o[k] = w[k];
      o.x0 = rx - hw; o.x1 = rx + hw; o.y0 = ry - hh; o.y1 = ry + hh;
      return o;
    });
    return { canvas: out, words: moved };
  }

  // Table borders touch the digits and get read as brackets or bars. Erase long, thin horizontal and vertical lines.
  function removeRules(g, w, h, bg) {
    var thr = Math.max(60, bg - 30), minH = Math.max(60, (w * 0.05) | 0), minV = Math.max(60, (h * 0.03) | 0);
    var x, y, k, x0, y0, len, a, b, n, lo, hi, dd;
    for (y = 5; y < h - 5; y++) {
      x = 0;
      while (x < w) {
        if (g[y * w + x] >= thr) { x++; continue; }
        x0 = x;
        while (x < w && g[y * w + x] < thr) x++;
        len = x - x0;
        if (len < minH) continue;
        a = 0; b = 0; n = 0; lo = x0 + (len >> 2); hi = x - (len >> 2);
        for (k = lo; k < hi; k += 3) { n++; if (g[(y - 4) * w + k] < thr) a++; if (g[(y + 4) * w + k] < thr) b++; }
        if (a < n * 0.3 && b < n * 0.3) for (k = x0; k < x; k++) for (dd = -2; dd <= 2; dd++) g[(y + dd) * w + k] = 255;
      }
    }
    for (x = 5; x < w - 5; x++) {
      y = 0;
      while (y < h) {
        if (g[y * w + x] >= thr) { y++; continue; }
        y0 = y;
        while (y < h && g[y * w + x] < thr) y++;
        len = y - y0;
        if (len < minV) continue;
        a = 0; b = 0; n = 0; lo = y0 + (len >> 2); hi = y - (len >> 2);
        for (k = lo; k < hi; k += 3) { n++; if (g[k * w + x - 4] < thr) a++; if (g[k * w + x + 4] < thr) b++; }
        if (a < n * 0.3 && b < n * 0.3) for (k = y0; k < y; k++) for (dd = -2; dd <= 2; dd++) g[k * w + x + dd] = 255;
      }
    }
  }

  // Turn the picture so text rows run level. Returns { canvas, deg }.
  function straighten(canvas, deps) {
    var deg = estimateSkew(grayOf(canvas), canvas.width, canvas.height);
    return deg ? { canvas: rotate(canvas, deg, deps), deg: Math.round(deg * 10) / 10 } : { canvas: canvas, deg: 0 };
  }

  // Smaller copy for quick looks (turning the page, for example).
  function shrink(canvas, longSide, deps) {
    var s = Math.min(1, longSide / Math.max(canvas.width, canvas.height));
    var out = deps.makeCanvas(Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
    var g = out.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  // Everything above, in order. Returns { canvas, info }.
  function prepare(src, deps) {
    var c = scaleTo(src, deps), w = c.width, h = c.height, g = grayOf(c), i;
    var info = { w: w, h: h, scale: c.width / src.width, inverted: false, flattened: false, skew: 0 };
    if (wantsInvert(g, w, h)) { for (i = 0; i < g.length; i++) g[i] = 255 - g[i]; info.inverted = true; }
    var hi = histInfo(g);
    if (hi.share < 0.30) { flatten(g, w, h); info.flattened = true; }
    stretch(g);
    var skew = estimateSkew(g, w, h);
    paintGray(c, g);
    if (skew) { c = rotate(c, skew, deps); g = grayOf(c); info.skew = Math.round(skew * 10) / 10; info.w = c.width; info.h = c.height; }
    removeRules(g, c.width, c.height, histInfo(g).mode);
    paintGray(c, g);
    return { canvas: c, info: info };
  }

  // The most common-ish gray level on the frame just outside a box (its median). Used to paint a box so it blends in.
  function frameGray(px, w, h, x0, y0, x1, y1) {
    var hist = new Uint32Array(256), n = 0, x, y, v;
    function add(xx, yy) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
      hist[px[(yy * w + xx) * 4]]++; n++;
    }
    for (x = x0; x < x1; x++) { add(x, y0 - 2); add(x, y1 + 1); }
    for (y = y0; y < y1; y++) { add(x0 - 2, y); add(x1 + 1, y); }
    if (!n) return 255;
    var acc = 0;
    for (v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= n) return v; }
    return 255;
  }

  // Copy of the picture with every real word painted over, so only numbers are left for the second read.
  // Each box gets the shade of the paper around it. Pure white would leave bright patches on shaded rows,
  // and the reader sometimes invents a bracket next to a digit there.
  function eraseWords(canvas, words, deps) {
    var w = canvas.width, h = canvas.height, out = deps.makeCanvas(w, h), g = out.getContext('2d');
    g.drawImage(canvas, 0, 0);
    var px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    words.forEach(function (wd) {
      if (!/[A-Za-z]{2,}/.test(wd.t)) return;
      var pad = 3, x0 = Math.max(0, Math.round(wd.x0 - pad)), y0 = Math.max(0, Math.round(wd.y0 - pad));
      var x1 = Math.min(w, Math.round(wd.x1 + pad)), y1 = Math.min(h, Math.round(wd.y1 + pad));
      if (x1 <= x0 || y1 <= y0) return;
      var v = frameGray(px, w, h, x0, y0, x1, y1);
      g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    });
    return out;
  }

  return { prepare: prepare, removeRules: removeRules, rotate: rotate, quarter: quarter, turn: turn, straighten: straighten, shrink: shrink, eraseWords: eraseWords, estimateSkew: estimateSkew, scaleTo: scaleTo };
});
