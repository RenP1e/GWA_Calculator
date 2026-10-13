/* A short burst of small confetti on a canvas that covers the page. No libraries, nothing is sent anywhere.
   GwaCelebrate.confetti() starts it, GwaCelebrate.stop() ends it early. It clears itself after about 4 seconds. */
(function (root) {
  'use strict';

  var COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#facc15', '#06b6d4'];
  var DURATION = 4200;      // ms until everything has faded out
  var current = null;       // the burst that is running, if any

  function prefersLessMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function piece(x, y, vx, vy, delay) {
    return {
      x: x, y: y, vx: vx, vy: vy, delay: delay,
      w: rand(5, 10), h: rand(3, 6),                 // small pieces
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.25,
      angle: rand(0, Math.PI * 2), spin: rand(-8, 8),
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(4, 10)
    };
  }

  // Two "cannons" in the bottom corners shooting up and inwards, plus pieces drifting down from the top.
  function makePieces(W, H) {
    var list = [], i, speed = Math.max(520, H * 0.95), spread = 0.55;
    for (i = 0; i < 70; i++) {
      list.push(piece(0, H, 0, 0, rand(0, 0.15)));
      list.push(piece(W, H, 0, 0, rand(0, 0.15)));
      var left = list[list.length - 2], right = list[list.length - 1];
      var a1 = -Math.PI / 2 + 0.35 + rand(-spread, spread) * 0.6, a2 = -Math.PI / 2 - 0.35 + rand(-spread, spread) * 0.6, s = rand(0.55, 1) * speed;
      left.vx = Math.cos(a1) * s; left.vy = Math.sin(a1) * s;
      right.vx = Math.cos(a2) * s; right.vy = Math.sin(a2) * s;
    }
    for (i = 0; i < 90; i++) list.push(piece(rand(0, W), rand(-H * 0.2, -10), rand(-40, 40), rand(40, 160), rand(0.1, 1.6)));
    return list;
  }

  function stop() {
    if (!current) return;
    if (current.raf) root.cancelAnimationFrame(current.raf);
    root.removeEventListener('resize', current.onResize);
    if (current.canvas.parentNode) current.canvas.parentNode.removeChild(current.canvas);
    current = null;
  }

  function confetti() {
    if (prefersLessMotion() || !root.requestAnimationFrame) return;
    stop();
    var doc = root.document, canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:60';
    doc.body.appendChild(canvas);

    var dpr = Math.min(2, root.devicePixelRatio || 1), W = 0, H = 0;
    function size() {
      W = root.innerWidth; H = root.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    size();
    var pieces = makePieces(W, H), start = 0, last = 0;
    var run = { canvas: canvas, raf: 0, onResize: size };
    current = run;
    root.addEventListener('resize', run.onResize);

    function frame(now) {
      if (current !== run) return;
      if (!start) { start = now; last = now; }
      var t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now - start > DURATION) { stop(); return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var fade = Math.max(0, Math.min(1, (DURATION / 1000 - t) / 0.9));       // everything fades over the last 0.9 s
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        if (t < p.delay) continue;
        p.vx *= Math.pow(0.35, dt);              // air drag
        p.vy = p.vy * Math.pow(0.5, dt) + 620 * dt;   // gravity pulls the pieces down, drag stops them speeding up forever
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.angle += p.spin * dt; p.wobble += p.wobbleSpeed * dt;
        if (p.y > H + 20) continue;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(1, Math.cos(p.wobble));        // tumbling: the piece turns edge-on and back
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      run.raf = root.requestAnimationFrame(frame);
    }
    run.raf = root.requestAnimationFrame(frame);
  }

  root.GwaCelebrate = { confetti: confetti, stop: stop };
})(typeof self !== 'undefined' ? self : this);
