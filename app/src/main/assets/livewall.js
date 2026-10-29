/* ReaperOS live wallpaper: "Reaper night".
   A moonlit sky with twinkling stars, drifting fog, RAM-stick souls floating up,
   and the reaper standing on a distant hill. Drawn on a canvas at a capped
   resolution and frame rate so it stays light on the GPU.

   ReaperWall(canvas, { dim: 0..1, pauseOnBlur: bool, fps: number }) -> { stop(), pause(bool) } */
(function () {
  "use strict";

  var REAPER = {
    cloak: "M50,17 C34,17 26,31 26,47 C26,61 22,75 15,90 L85,90 C78,75 74,61 74,47 C74,31 66,17 50,17 Z",
    face: "M50,30 C41,30 36,38 36,48 C36,58 42,65 50,65 C58,65 64,58 64,48 C64,38 59,30 50,30 Z",
    handle: "M76.5,93 L80,92 L68.5,12 L65,12.8 Z",
    blade: "M67,12 C53,2 30,4 16,19 C31,13 48,13 63.5,21.5 Z"
  };

  function rng(seed) {            // small seeded random so hills and graves stay put between resizes
    return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }

  window.ReaperWall = function (canvas, opts) {
    opts = opts || {};
    var dim = opts.dim || 0, fps = opts.fps || 30, pauseOnBlur = opts.pauseOnBlur !== false;
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, S = 1;      // canvas size and scale factor (canvas px per CSS px)
    var sky, hills, vignette, glowSoul, glowEmber, fogBlob, moon, eyeGlow;
    var stars = [], souls = [], embers = [], fogs = [];
    var paths = {}; for (var k in REAPER) paths[k] = new Path2D(REAPER[k]);
    var running = true, paused = false, raf = 0, last = 0, t0 = performance.now();
    var nextBlink = 3, blinkUntil = 0, nextFlash = 18 + Math.random() * 20, flashAt = -10;

    function offscreen(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }

    function sprite(r, inner, outer) {
      var c = offscreen(r * 2, r * 2), g = c.getContext("2d");
      var grd = g.createRadialGradient(r, r, 0, r, r, r);
      grd.addColorStop(0, inner); grd.addColorStop(0.35, outer); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.fillRect(0, 0, r * 2, r * 2);
      return c;
    }

    function build() {
      var cssW = window.innerWidth, cssH = window.innerHeight;
      S = Math.min(1, 1280 / cssW);            // never draw more than ~1280 px wide; CSS scales it up
      W = Math.round(cssW * S); H = Math.round(cssH * S);
      canvas.width = W; canvas.height = H;

      // sky
      sky = offscreen(W, H); var g = sky.getContext("2d");
      var grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, "#0B0518"); grd.addColorStop(0.45, "#1C0B38"); grd.addColorStop(0.72, "#2B1452"); grd.addColorStop(1, "#0B0714");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);

      // moon (with soft halo)
      var mr = H * 0.11; moon = offscreen(mr * 7, mr * 7); var m = moon.getContext("2d"), c = mr * 3.5;
      var halo = m.createRadialGradient(c, c, mr * 0.8, c, c, mr * 3.5);
      halo.addColorStop(0, "rgba(220,205,255,.32)"); halo.addColorStop(0.4, "rgba(150,110,230,.10)"); halo.addColorStop(1, "rgba(0,0,0,0)");
      m.fillStyle = halo; m.fillRect(0, 0, mr * 7, mr * 7);
      var face = m.createRadialGradient(c - mr * 0.3, c - mr * 0.3, mr * 0.1, c, c, mr);
      face.addColorStop(0, "#F7F2FF"); face.addColorStop(1, "#C9BCEB");
      m.fillStyle = face; m.beginPath(); m.arc(c, c, mr, 0, Math.PI * 2); m.fill();
      m.fillStyle = "rgba(120,100,170,.22)";
      [[-.35, -.2, .22], [.3, .25, .16], [.05, .45, .1], [.4, -.35, .09], [-.15, .2, .08]].forEach(function (cr) {
        m.beginPath(); m.arc(c + cr[0] * mr, c + cr[1] * mr, cr[2] * mr, 0, Math.PI * 2); m.fill();
      });

      // hills and graves
      hills = offscreen(W, H); var hg = hills.getContext("2d"), r = rng(7);
      function ridge(base, amp, freq, phase, color) {
        hg.fillStyle = color; hg.beginPath(); hg.moveTo(0, H);
        for (var x = 0; x <= W; x += 4) {
          var y = H * base - amp * H * (Math.sin(x / W * freq + phase) * 0.6 + Math.sin(x / W * freq * 2.3 + phase * 1.7) * 0.4);
          hg.lineTo(x, y);
        }
        hg.lineTo(W, H); hg.closePath(); hg.fill();
      }
      ridge(0.78, 0.05, 5, 1.2, "#1B0F33");
      ridge(0.86, 0.035, 7, 4.1, "#110A22");
      ridge(0.93, 0.02, 11, 2.0, "#08050F");
      hg.fillStyle = "#08050F";
      for (var i = 0; i < 14; i++) {        // crosses and headstones on the front hill
        var gx = r() * W, gy = H * (0.9 + r() * 0.03), s = H * (0.012 + r() * 0.012);
        if (gx > W * 0.7 && gx < W * 0.92) continue;
        if (r() < 0.5) { hg.fillRect(gx - s * 0.12, gy - s * 2, s * 0.24, s * 2); hg.fillRect(gx - s * 0.55, gy - s * 1.55, s * 1.1, s * 0.22); }
        else { hg.beginPath(); hg.moveTo(gx - s * 0.6, gy); hg.lineTo(gx - s * 0.6, gy - s * 1.1); hg.arc(gx, gy - s * 1.1, s * 0.6, Math.PI, 0); hg.lineTo(gx + s * 0.6, gy); hg.fill(); }
      }
      // a bare tree on the left
      hg.strokeStyle = "#08050F"; hg.lineCap = "round";
      (function branch(x, y, len, ang, w, depth) {
        if (depth > 6 || len < 2) return;
        var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        hg.lineWidth = w; hg.beginPath(); hg.moveTo(x, y); hg.lineTo(x2, y2); hg.stroke();
        branch(x2, y2, len * 0.72, ang - 0.45 - r() * 0.2, w * 0.66, depth + 1);
        branch(x2, y2, len * 0.68, ang + 0.4 + r() * 0.25, w * 0.66, depth + 1);
      })(W * 0.09, H * 0.93, H * 0.11, -Math.PI / 2, Math.max(2, H * 0.012), 0);

      // vignette (plus extra dimming behind the ReaperOS interface)
      vignette = offscreen(W, H); var v = vignette.getContext("2d");
      var vg = v.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      vg.addColorStop(0, "rgba(5,3,10,0)"); vg.addColorStop(1, "rgba(5,3,10,.75)");
      v.fillStyle = vg; v.fillRect(0, 0, W, H);
      if (dim) { v.fillStyle = "rgba(11,7,20," + dim + ")"; v.fillRect(0, 0, W, H); }

      glowSoul = sprite(Math.round(H * 0.03), "rgba(120,255,170,.55)", "rgba(56,196,106,.18)");
      eyeGlow = sprite(14, "rgba(255,90,40,.95)", "rgba(255,30,10,.35)");
      glowEmber = sprite(Math.round(H * 0.008) + 2, "rgba(170,245,255,.9)", "rgba(34,227,255,.3)");
      fogBlob = sprite(Math.round(H * 0.32), "rgba(150,120,210,.10)", "rgba(110,80,180,.05)");

      var sr = rng(42);
      stars = []; for (i = 0; i < 160; i++) stars.push({ x: sr() * W, y: sr() * H * 0.7, s: sr() < 0.85 ? 1 : 2, p: sr() * 6.28, f: 0.5 + sr() * 2 });
      fogs = []; for (i = 0; i < 7; i++) fogs.push({ x: sr() * W * 1.4 - W * 0.2, y: H * (0.55 + sr() * 0.35), v: (6 + sr() * 14) * (sr() < 0.5 ? 1 : -1), sc: 0.8 + sr() * 1.2 });
      souls = []; for (i = 0; i < 16; i++) souls.push(newSoul(true));
      embers = []; for (i = 0; i < 26; i++) embers.push(newEmber(true));
    }

    function newSoul(anywhere) {
      return { x: Math.random() * W, y: anywhere ? H * (0.3 + Math.random() * 0.7) : H + 20, v: H * (0.018 + Math.random() * 0.03),
        w: Math.random() * 6.28, ws: 0.4 + Math.random() * 0.8, rot: (Math.random() - 0.5) * 0.6, rs: (Math.random() - 0.5) * 0.4,
        size: H * (0.012 + Math.random() * 0.012), reap: Math.random() < 0.45 };
    }
    function newEmber(anywhere) {
      return { x: Math.random() * W, y: anywhere ? Math.random() * H : H + 5, v: H * (0.01 + Math.random() * 0.025), p: Math.random() * 6.28 };
    }

    function drawSoul(s, t) {
      var x = s.x + Math.sin(t * s.ws + s.w) * H * 0.02, y = s.y;
      var life = Math.min(1, (H - y) / (H * 0.15)) * Math.min(1, y / (H * 0.35));
      if (life <= 0) return;
      ctx.globalAlpha = life * 0.9;
      ctx.drawImage(glowSoul, x - glowSoul.width / 2, y - glowSoul.height / 2);
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot + Math.sin(t * 0.5 + s.w) * 0.15);
      var w = s.size * 3, h = s.size * 0.75;
      ctx.fillStyle = "#1E8C47"; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#141414"; for (var i = 0; i < 3; i++) ctx.fillRect(-w / 2 + w * (0.1 + i * 0.29), -h * 0.32, w * 0.22, h * 0.42);
      ctx.fillStyle = "#E8C24A"; ctx.fillRect(-w / 2 + w * 0.05, h * 0.3, w * 0.9, h * 0.18);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ---- the reaper: tall, gaunt and hooded, silhouetted against the moon
    var REAPER_H = 0.56;                       // share of the screen height
    function reaperBox() {
      var sc = H * REAPER_H / 430;
      return { x: W * 0.8, y: H * 0.875, sc: sc, hx: W * 0.8 - 122 * sc, hy: H * 0.875 - 205 * sc };
    }
    function robePath(t) {
      var p = new Path2D(), n = 14, i;
      p.moveTo(-6, -394);
      p.bezierCurveTo(20, -398, 46, -372, 52, -334);       // hood, right
      p.bezierCurveTo(60, -312, 78, -298, 88, -286);       // shoulder
      p.bezierCurveTo(98, -230, 100, -150, 104, -80);
      p.bezierCurveTo(108, -40, 114, -14, 118, 4);
      for (i = n; i >= 0; i--) {                           // tattered hem, ragged and moving in the wind
        var hx = -112 + 230 * i / n, sway = Math.sin(t * 1.7 + i * 1.3) * 7 + Math.sin(t * 0.9 + i) * 4;
        p.lineTo(hx + sway * 0.6, i % 2 ? HEM[i] + Math.abs(sway) : -10 - HEM[i] * 0.4);
      }
      p.bezierCurveTo(-108, -30, -104, -90, -100, -150);
      p.bezierCurveTo(-104, -210, -96, -262, -84, -288);   // left shoulder
      p.bezierCurveTo(-70, -300, -58, -318, -52, -340);
      p.bezierCurveTo(-46, -374, -26, -392, -6, -394);     // hood, left
      p.closePath();
      return p;
    }
    var HEM = [22, 9, 34, 14, 18, 6, 40, 12, 26, 8, 30, 16, 20, 10, 28];
    var hoodVoid = new Path2D("M -30,-298 C -38,-344 -22,-374 0,-375 C 22,-374 38,-344 30,-298 C 18,-284 -18,-284 -30,-298 Z");
    var sleeve = new Path2D("M -82,-290 C -104,-262 -124,-236 -138,-214 C -128,-198 -112,-190 -98,-192 C -94,-214 -88,-240 -78,-262 Z");
    var smokeSprite = null;

    function drawReaper(t, flash) {
      var b = reaperBox(), sway = Math.sin(t * 0.55) * 0.02;
      if (!smokeSprite) smokeSprite = sprite(Math.round(H * 0.07), "rgba(10,6,16,.55)", "rgba(10,6,16,.25)");
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(b.sc, b.sc);

      // scythe staff (behind the figure), crooked wood
      ctx.save(); ctx.transform(1, 0, sway * 0.6, 1, 0, 0);
      ctx.lineCap = "round";
      ctx.strokeStyle = "#1E140D"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(-150, 16); ctx.quadraticCurveTo(-112, -210, -118, -440); ctx.stroke();
      ctx.strokeStyle = "rgba(150,120,90,.25)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-147, 10); ctx.quadraticCurveTo(-110, -210, -115, -436); ctx.stroke();
      // the blade: a long steel crescent sweeping over the hood
      var blade = new Path2D("M -122,-442 C -50,-492 80,-488 158,-404 C 172,-388 178,-366 174,-344 C 160,-380 130,-414 92,-432 C 30,-458 -40,-450 -112,-418 Z");
      var steel = ctx.createLinearGradient(-120, -500, 170, -400);
      steel.addColorStop(0, "#1E1D27"); steel.addColorStop(0.55, "#46445A"); steel.addColorStop(1, "#7E7A96");
      ctx.fillStyle = steel; ctx.fill(blade);
      // moonlight gliding along the cutting edge
      var g = (t * 0.12) % 1.6 - 0.3;
      var gleam = ctx.createLinearGradient(-120, -440, 170, -410);
      gleam.addColorStop(Math.max(0, Math.min(1, g - 0.08)), "rgba(255,255,255,0)");
      gleam.addColorStop(Math.max(0, Math.min(1, g)), "rgba(240,236,255," + (0.95 + flash) + ")");
      gleam.addColorStop(Math.max(0, Math.min(1, g + 0.08)), "rgba(255,255,255,0)");
      ctx.strokeStyle = gleam; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-112, -418); ctx.bezierCurveTo(-40, -450, 30, -458, 92, -432); ctx.bezierCurveTo(130, -414, 160, -380, 174, -344); ctx.stroke();
      ctx.restore();

      // robe
      ctx.save(); ctx.transform(1, 0, sway, 1, 0, 0);
      var robe = robePath(t);
      var cloth = ctx.createLinearGradient(-130, -400, 140, 0);
      cloth.addColorStop(0, "#0C0814"); cloth.addColorStop(0.6, "#07040C"); cloth.addColorStop(1, "#030206");
      ctx.fillStyle = cloth; ctx.fill(robe);
      // folds
      ctx.strokeStyle = "rgba(70,55,105,.22)"; ctx.lineWidth = 3;
      [[-60, -280, -80, 0], [-18, -284, -30, 4], [26, -282, 40, 2], [64, -286, 92, -6]].forEach(function (f, i) {
        var w = Math.sin(t * 1.2 + i) * 6;
        ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.quadraticCurveTo((f[0] + f[2]) / 2 + w, (f[1] + f[3]) / 2, f[2] + w, f[3]); ctx.stroke();
      });
      // rim light from the moon behind; lightning makes it blaze
      ctx.strokeStyle = "rgba(205,190,255," + (0.28 + flash * 2.5) + ")"; ctx.lineWidth = 2.2; ctx.stroke(robe);

      // the hood's opening and the skull inside it
      ctx.fillStyle = "#000"; ctx.fill(hoodVoid);
      ctx.save(); ctx.clip(hoodVoid);
      var bone = "rgba(165,155,175," + (0.16 + flash * 1.5) + ")";
      ctx.fillStyle = bone;
      ctx.beginPath(); ctx.ellipse(0, -342, 19, 22, 0, 0, 6.283); ctx.fill();               // cranium
      ctx.beginPath(); ctx.ellipse(0, -314, 12, 9, 0, 0, 6.283); ctx.fill();                // jaw
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(-8.5, -335, 6.2, 5.2, 0.25, 0, 6.283); ctx.ellipse(8.5, -335, 6.2, 5.2, -0.25, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -327); ctx.lineTo(-3, -320); ctx.lineTo(3, -320); ctx.closePath(); ctx.fill();   // nose
      ctx.fillStyle = "rgba(0,0,0,.85)";
      for (var k = -3; k <= 3; k++) ctx.fillRect(k * 3.2 - 1.1, -315, 2.2, 5);               // teeth
      ctx.restore();
      // burning eyes
      var blink = t < blinkUntil, burn = 0.75 + Math.sin(t * 2.3) * 0.15 + Math.sin(t * 7.1) * 0.1;
      if (!blink) {
        ctx.globalAlpha = Math.min(1, burn);
        ctx.drawImage(eyeGlow, -8.5 - 14, -335 - 14, 28, 28); ctx.drawImage(eyeGlow, 8.5 - 14, -335 - 14, 28, 28);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#FF3A1C";
        ctx.beginPath(); ctx.arc(-8.5, -334.5, 2.1, 0, 6.283); ctx.arc(8.5, -334.5, 2.1, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#FFD0A0";
        ctx.beginPath(); ctx.arc(-8.2, -335, 0.8, 0, 6.283); ctx.arc(8.8, -335, 0.8, 0, 6.283); ctx.fill();
      }

      // sleeve and the skeletal hand gripping the staff
      ctx.fillStyle = "#06030B"; ctx.fill(sleeve);
      ctx.strokeStyle = "rgba(205,190,255," + (0.2 + flash * 2) + ")"; ctx.lineWidth = 1.6; ctx.stroke(sleeve);
      ctx.restore();
      ctx.strokeStyle = "rgba(185,175,195,.75)"; ctx.lineCap = "round";
      for (var f = 0; f < 4; f++) {
        var fy = -214 + f * 7;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-136, fy - 2); ctx.lineTo(-128, fy - 4); ctx.lineTo(-121, fy + 1); ctx.lineTo(-124, fy + 4); ctx.stroke();
      }
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-134, -218); ctx.lineTo(-124, -224); ctx.lineTo(-116, -220); ctx.stroke();   // thumb

      ctx.restore();

      // dark smoke curling around the feet
      for (var sm = 0; sm < 6; sm++) {
        var ph = t * 0.35 + sm * 1.1, life = (ph % 1);
        var sx = b.x + Math.sin(sm * 2.1 + t * 0.4) * 120 * b.sc, sy = b.y - life * 90 * b.sc;
        ctx.globalAlpha = (1 - life) * 0.8;
        var ssz = smokeSprite.width * (0.8 + life * 1.4);
        ctx.drawImage(smokeSprite, sx - ssz / 2, sy - ssz / 2, ssz, ssz);
      }
      ctx.globalAlpha = 1;
    }

    // crows circling the moon
    var crows = [0, 1, 2].map(function (i) { return { a: i * 2.1, r: 0.12 + i * 0.05, sp: 0.12 + i * 0.03, fl: Math.random() * 6 }; });
    function drawCrows(t) {
      ctx.strokeStyle = "#07040C"; ctx.lineCap = "round";
      crows.forEach(function (c) {
        var a = c.a + t * c.sp, cx = W * 0.8 + Math.cos(a) * W * c.r, cy = H * 0.24 + Math.sin(a) * H * c.r * 0.45;
        var s = H * 0.012, flap = Math.sin(t * 7 + c.fl) * s * 0.9;
        ctx.lineWidth = Math.max(1.5, s * 0.28);
        ctx.beginPath(); ctx.moveTo(cx - s * 1.6, cy - flap); ctx.quadraticCurveTo(cx - s * 0.6, cy - s * 0.5 - flap * 0.3, cx, cy);
        ctx.quadraticCurveTo(cx + s * 0.6, cy - s * 0.5 - flap * 0.3, cx + s * 1.6, cy - flap); ctx.stroke();
      });
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (paused || now - last < 1000 / fps - 2) return;
      var dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      var t = (now - t0) / 1000;

      ctx.drawImage(sky, 0, 0);
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i], a = 0.35 + 0.65 * Math.abs(Math.sin(t * st.f * 0.5 + st.p));
        ctx.fillStyle = "rgba(235,228,255," + a.toFixed(2) + ")"; ctx.fillRect(st.x, st.y, st.s, st.s);
      }
      ctx.globalAlpha = 0.92 + Math.sin(t * 0.4) * 0.08;
      ctx.drawImage(moon, W * 0.8 - moon.width / 2, H * 0.3 - moon.height / 2);
      ctx.globalAlpha = 1;

      // lightning, every 20-40 seconds: a double flicker across the sky
      if (t > nextFlash) { flashAt = t; nextFlash = t + 20 + Math.random() * 20; }
      var ft = t - flashAt, fa = 0;
      if (ft < 0.45) {
        fa = ft < 0.08 ? 0.22 : ft < 0.14 ? 0.04 : ft < 0.24 ? 0.16 * (1 - (ft - 0.14) / 0.1) : 0;
        if (fa > 0) { ctx.fillStyle = "rgba(200,190,255," + fa + ")"; ctx.fillRect(0, 0, W, H * 0.8); }
      }
      drawCrows(t);

      for (i = 0; i < fogs.length; i++) {
        var f = fogs[i]; f.x += f.v * dt * S * 2;
        if (f.x > W * 1.3) f.x = -W * 0.3; if (f.x < -W * 0.3) f.x = W * 1.3;
        var fw = fogBlob.width * f.sc * 1.8, fh = fogBlob.height * f.sc * 0.55;
        ctx.drawImage(fogBlob, f.x - fw / 2, f.y - fh / 2, fw, fh);
      }

      ctx.drawImage(hills, 0, 0);
      drawReaper(t, fa);
      if (t > nextBlink) { blinkUntil = t + 0.12; nextBlink = t + 4 + Math.random() * 6; }

      for (i = 0; i < souls.length; i++) {
        var s = souls[i]; s.y -= s.v * dt; s.rot += s.rs * dt;
        if (s.reap) {                                   // some souls are drawn to the reaper's hand
          var rb = reaperBox(), dx = rb.hx - s.x, dy = rb.hy - s.y, d = Math.sqrt(dx * dx + dy * dy);
          if (s.y < H * 0.75) { s.x += dx / d * H * 0.05 * dt; s.y += dy / d * H * 0.03 * dt; }
          if (d < H * 0.03) souls[i] = s = newSoul(false);
        }
        if (s.y < -30) souls[i] = s = newSoul(false);
        drawSoul(s, t);
      }
      for (i = 0; i < embers.length; i++) {
        var e = embers[i]; e.y -= e.v * dt; e.x += Math.sin(t + e.p) * 0.3;
        if (e.y < -10) embers[i] = e = newEmber(false);
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + e.p));
        ctx.drawImage(glowEmber, e.x - glowEmber.width / 2, e.y - glowEmber.height / 2);
      }
      ctx.globalAlpha = 1;
      // low fog in front of the hills
      for (i = 0; i < 3; i++) {
        var lf = fogs[i], lw = fogBlob.width * 2.4, lh = fogBlob.height * 0.35;
        ctx.drawImage(fogBlob, W - lf.x - lw / 2, H * 0.92 - lh / 2, lw, lh);
      }
      ctx.drawImage(vignette, 0, 0);
    }

    var onResize = function () { build(); };
    var onVis = function () { paused = document.hidden; };
    var onBlur = function () { if (pauseOnBlur) paused = true; };
    var onFocus = function () { paused = document.hidden; };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    build();
    raf = requestAnimationFrame(frame);

    return {
      pause: function (p) { paused = !!p; },
      stop: function () {
        running = false; cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("focus", onFocus);
        ctx.clearRect(0, 0, W, H);
      }
    };
  };
})();
