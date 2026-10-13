/* Starts the photo reader (Tesseract in a Web Worker) from files that sit next to the page, and opens picture files.
   Nothing here leaves the device: the reader, its WebAssembly core and its English data are all local files. */
(function (root, factory) {
  root.GwaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FILES = {
    worker: 'vendor/worker.min.js',
    coreSimd: 'vendor/core/tesseract-core-simd-lstm.wasm.js',
    core: 'vendor/core/tesseract-core-lstm.wasm.js',
    lang: 'vendor/lang/eng.gz.b64.txt'           // the gzip-compressed English data, written as base64 text
  };
  // The same tiny test module Tesseract uses to find out whether this browser has WebAssembly SIMD.
  var SIMD_TEST = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];

  var running = null;      // the started reader
  var starting = null;     // a start that is still in progress
  var notes = [];          // short lines about what happened, shown under "Details" when something fails

  function hasSimd() {
    try { return WebAssembly.validate(new Uint8Array(SIMD_TEST)); } catch (e) { return false; }
  }

  function urlOf(path) {
    var bases = [document.baseURI, location.href], i;
    for (i = 0; i < bases.length; i++) {
      try { return new URL(path, bases[i]).href; } catch (e) { /* try the next base */ }
    }
    return path;
  }

  function problem(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function asError(e) {
    return e instanceof Error ? e : new Error(typeof e === 'string' ? e : (e && e.message) || 'unknown error');
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    try { c.getContext('2d', { willReadFrequently: true }); } catch (e) { /* older browsers ignore the option */ }
    return c;
  }

  function b64ToBytes(text) {
    var bin = atob(text.replace(/\s+/g, '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Download a file and report how far along it is (when the server says how big it is).
  async function download(path, onBytes) {
    var res = await fetch(urlOf(path));
    notes.push(path + ' -> ' + res.status);
    if (!res.ok) throw problem('missing', 'A file the reader needs could not be loaded (' + path + ', status ' + res.status + ').');
    var total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader || !total) return res.text();
    var reader = res.body.getReader(), parts = [], got = 0, dec = new TextDecoder(), text = '';
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      got += chunk.value.length;
      text += dec.decode(chunk.value, { stream: true });
      if (onBytes) onBytes(Math.min(1, got / total));
    }
    return text + dec.decode();
  }

  // Only for the details text: does the server have these files?
  async function peek(path) {
    try { var r = await fetch(urlOf(path), { method: 'HEAD' }); notes.push(path + ' HEAD ' + r.status); } catch (e) { notes.push(path + ' HEAD failed: ' + asError(e).message); }
  }

  function startOnce(useBlob, lang, simd, report) {
    return new Promise(function (resolve, reject) {
      var done = false, timer;
      function finish(fn, v) { if (done) return; done = true; clearTimeout(timer); fn(v); }
      function wait(ms, why) { clearTimeout(timer); timer = setTimeout(function () { finish(reject, problem('timeout', why)); }, ms); }
      wait(25000, 'The reader did not start.');
      var options = {
        workerPath: urlOf(FILES.worker),
        corePath: urlOf(simd ? FILES.coreSimd : FILES.core),
        workerBlobURL: useBlob,
        cacheMethod: 'none',
        gzip: true,
        logger: function (m) {
          wait(150000, 'The reader stopped responding.');
          if (report) report(m);
        }
      };
      Tesseract.createWorker([{ code: 'eng', data: lang }], 1, options).then(
        function (w) { finish(resolve, w); },
        function (e) { finish(reject, asError(e)); }
      );
    });
  }

  var listeners = [];      // everyone waiting for the reader to start (the page may ask again while it is still loading)
  var lastNote = null;

  function broadcast(m) {
    lastNote = m;
    listeners.slice().forEach(function (fn) { try { fn(m); } catch (e) { /* a listener must never stop the start */ } });
  }

  async function begin() {
    notes = [];
    if (typeof WebAssembly !== 'object') throw problem('nowasm', 'This browser cannot run the photo reader (no WebAssembly).');
    if (typeof Worker !== 'function') throw problem('noworker', 'This browser cannot run the photo reader (no web workers).');
    if (typeof Tesseract !== 'object' || !Tesseract.createWorker) throw problem('nolib', 'The reading library did not load.');
    var simd = hasSimd();
    notes.push('simd ' + simd);
    var wait = 'Downloading the reader. This only takes long the first time.';
    broadcast({ text: wait, fraction: 0.02 });
    peek(FILES.worker); peek(simd ? FILES.coreSimd : FILES.core);
    var text = await download(FILES.lang, function (f) { broadcast({ text: wait, fraction: 0.02 + 0.28 * f }); });
    // gzip data written as base64 always starts with "H4sI". Anything else is a page the server sent instead of the file.
    if (text.slice(0, 4) !== 'H4sI') throw problem('badfile', 'The reading data did not load properly (the server sent something else).');
    var lang = b64ToBytes(text);
    var last = null, worker = null, tries = [false, true];
    for (var i = 0; i < tries.length && !worker; i++) {
      try {
        worker = await startOnce(tries[i], lang, simd, function (m) {
          var st = (m && m.status) || '', p = (m && m.progress) || 0;
          if (/core/.test(st)) broadcast({ text: 'Loading the reader…', fraction: 0.3 + 0.35 * p });
          else if (/language/.test(st)) broadcast({ text: 'Loading the reading data…', fraction: 0.65 + 0.25 * p });
          else broadcast({ text: 'Almost ready…', fraction: 0.9 + 0.1 * p });
        });
      } catch (e) {
        last = asError(e);
        notes.push('start ' + (i + 1) + ' (' + (tries[i] ? 'blob' : 'file') + '): ' + last.message);
      }
    }
    if (!worker) {
      var err = problem('start', 'The reader could not start.');
      err.detail = notes.join(' | ');
      throw err;
    }
    return { worker: worker, simd: simd };
  }

  // start(report) calls report({ text, fraction 0..1 }) while things load. Resolves with { worker }, or throws an Error with .detail.
  // Asking again while a start is running joins that start. Asking after it worked returns the same reader.
  function start(report) {
    if (running) return Promise.resolve(running);
    if (report) { listeners.push(report); if (lastNote) { try { report(lastNote); } catch (e) { /* ignore */ } } }
    if (!starting) {
      lastNote = null;
      starting = begin().then(function (r) {
        running = r; starting = null; listeners = [];
        return r;
      }, function (e) {
        starting = null; listeners = [];
        e = asError(e);
        if (!e.detail) e.detail = notes.join(' | ');
        throw e;
      });
    }
    return starting;
  }

  // Throw the reader away (after a crash, say) so that the next start() builds a fresh one.
  function reset() {
    if (running) { try { running.worker.terminate(); } catch (e) { /* already gone */ } }
    running = null;
  }

  // What the reader needs from the page.
  function deps(worker) {
    return { worker: worker, makeCanvas: makeCanvas, toInput: function (c) { return c; } };
  }

  // Open a picture file as a canvas. Very large photos are brought down to 3200 pixels on the long side.
  async function openPicture(file) {
    var url = URL.createObjectURL(file);
    try {
      var img = new Image();
      img.src = url;
      if (img.decode) await img.decode();
      else await new Promise(function (ok, bad) { img.onload = ok; img.onerror = bad; });
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw problem('empty', 'That picture is empty.');
      var s = Math.min(1, 3200 / Math.max(w, h));
      var c = makeCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } catch (e) {
      throw problem('open', 'That file could not be opened as a picture. Try a JPG or PNG.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return {
    start: start, reset: reset, deps: deps, openPicture: openPicture, makeCanvas: makeCanvas,
    details: function () { return notes.join(' | '); },
    ready: function () { return !!running; }
  };
});
