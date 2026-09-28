/* Kodhane: Açık Ofis — procedural placeholder art (own work, CC0).
 * Runs inside a browser page (tools/atlas/build.mjs). Everything is drawn at 2x source scale:
 * one floor tile = 128x64 px (in game 64x32). Frame names: tur_ad_eylem_NN (ASCII).
 * Each frame: { w, h, pivot:[x,y] (2x px), draw(ctx) }. */
(function () {
  'use strict';
  var F = {};
  var TW = 128, TH = 64, HW = 64, HH = 32;

  // ---------- helpers
  function shade(hex, f) { // f<1 darker, f>1 lighter
    var r, g, b;
    if (hex[0] === '#') { var n = parseInt(hex.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else { var m = hex.match(/\d+/g); r = +m[0]; g = +m[1]; b = +m[2]; }
    function c(v) { v = f < 1 ? v * f : v + (255 - v) * (f - 1); return Math.max(0, Math.min(255, Math.round(v))); }
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }
  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function rrect(ctx, x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function circle(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function ellipse(ctx, x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  // iso projector with base tile (0,0) center at (ox,oy); u,v in tile units, z in px (up)
  function P(ox, oy) { return function (u, v, z) { return [ox + (u - v) * HW, oy + (u + v) * HH - (z || 0)]; }; }
  // box between u0..u1, v0..v1, z0..z1: draws visible faces (top, front-left(v=v1), front-right(u=u1))
  function box(ctx, p, u0, u1, v0, v1, z0, z1, col, opt) {
    opt = opt || {};
    var ol = opt.outline || 'rgba(40,25,20,0.55)';
    poly(ctx, [p(u0, v1, z0), p(u1, v1, z0), p(u1, v1, z1), p(u0, v1, z1)], shade(col, 0.78), ol, 1.5);
    poly(ctx, [p(u1, v1, z0), p(u1, v0, z0), p(u1, v0, z1), p(u1, v1, z1)], shade(col, 0.62), ol, 1.5);
    poly(ctx, [p(u0, v0, z1), p(u1, v0, z1), p(u1, v1, z1), p(u0, v1, z1)], opt.top || col, ol, 1.5);
  }
  function shadow(ctx, p, u0, u1, v0, v1) {
    poly(ctx, [p(u0 - 0.04, v0 - 0.04, 0), p(u1 + 0.08, v0 - 0.04, 0), p(u1 + 0.08, v1 + 0.08, 0), p(u0 - 0.04, v1 + 0.08, 0)], 'rgba(30,20,10,0.18)');
  }
  function diamond(ctx, cx, cy, w, h, fill, stroke, lw) {
    poly(ctx, [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]], fill, stroke, lw);
  }
  function def(name, w, h, pivot, draw) { F[name] = { w: w, h: h, pivot: pivot, draw: draw }; }

  // ---------- floor tiles (128x64, pivot = center)
  function floorTile(name, base, kind) {
    def(name, TW, TH, [HW, HH], function (ctx) {
      ctx.save();
      poly(ctx, [[HW, 0], [TW, HH], [HW, TH], [0, HH]], base);
      ctx.clip();
      if (kind === 'parke') {
        ctx.strokeStyle = shade(base, 0.82); ctx.lineWidth = 1.5;
        for (var i = -6; i <= 6; i++) { // planks parallel to the u axis (slope 1/2)
          var c0 = i * 16; ctx.beginPath(); ctx.moveTo(0, c0); ctx.lineTo(TW, c0 + 64); ctx.stroke();
        }
        ctx.strokeStyle = shade(base, 0.88); ctx.lineWidth = 1;
        for (var j = 0; j < 6; j++) { var x = 12 + j * 21, y = 8 + (j * 37) % 48; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y - 4); ctx.stroke(); }
      } else if (kind === 'beton') {
        for (var k = 0; k < 40; k++) { var sx = (k * 53) % 128, sy = (k * 29) % 64; ctx.fillStyle = k % 2 ? shade(base, 0.9) : shade(base, 1.06); ctx.fillRect(sx, sy, 2, 2); }
        ctx.strokeStyle = shade(base, 0.85); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HW, 0); ctx.lineTo(HW, TH); ctx.stroke();
      } else if (kind === 'hali') {
        diamond(ctx, HW, HH, TW - 18, TH - 9, shade(base, 1.0), '#f3d9a4', 3);
        diamond(ctx, HW, HH, TW - 50, TH - 25, '#e8b04a', '#7a2e22', 2);
        diamond(ctx, HW, HH, 26, 13, '#7a2e22');
      }
      ctx.restore();
      poly(ctx, [[HW, 0.5], [TW - 0.5, HH], [HW, TH - 0.5], [0.5, HH]], null, 'rgba(60,40,25,0.22)', 1);
    });
  }
  floorTile('zemin_parke_01', '#d9a76a', 'parke');
  floorTile('zemin_parke_02', '#d29f62', 'parke');
  floorTile('zemin_beton_01', '#c9c6c0', 'beton');
  floorTile('zemin_beton_02', '#c2bfb9', 'beton');
  floorTile('zemin_hali_01', '#b8432f', 'hali');

  // ---------- walls. duvar_sag: along the top-right edge of a tile (gy=-0.5); duvar_sol: top-left edge (gx=-0.5)
  var WALLH = 184; // 2x px (game 92)
  function wall(name, side, look, deco) {
    var w = HW, h = WALLH + HH;
    // sag: left end high (y=WALLH), right end low (y=h). pivot = tile center -> (0,h) ; sol mirrored -> (w,h)
    def(name, w, h, side === 'sag' ? [0, h] : [w, h], function (ctx) {
      if (side === 'sol') { ctx.translate(w, 0); ctx.scale(-1, 1); }
      var q = [[0, WALLH], [w, h], [w, HH], [0, 0]];
      var base = look === 'ev' ? '#f1dfbf' : '#ece8e1';
      ctx.save(); poly(ctx, q, side === 'sol' ? shade(base, 0.93) : base); ctx.clip();
      if (look === 'ev') { // wallpaper: small tulip dots
        for (var yy = 0; yy < h; yy += 22) for (var xx = 6; xx < w; xx += 22) {
          var y2 = yy + xx / 2 + ((yy / 22) % 2) * 6; circle(ctx, xx, y2, 2.2, 'rgba(190,110,80,0.35)');
        }
      } else { // studio: brick lower band
        for (var by = 0; by < 5; by++) for (var bx = -1; bx < 4; bx++) {
          var ox = bx * 22 + (by % 2) * 11, oy = WALLH - 70 + by * 14 + ox / 2;
          poly(ctx, [[ox, oy], [ox + 20, oy + 10], [ox + 20, oy + 22], [ox, oy + 12]], by % 2 ? '#b8664a' : '#c47456', 'rgba(90,40,30,0.4)', 1);
        }
      }
      // baseboard
      poly(ctx, [[0, WALLH - 10], [w, h - 10], [w, h], [0, WALLH]], look === 'ev' ? '#9b6b43' : '#6d6a66');
      ctx.restore();
      poly(ctx, [[0, 0], [w, HH], [w, HH + 6], [0, 6]], look === 'ev' ? '#c9a57b' : '#9d9a95'); // top cap
      poly(ctx, q, null, 'rgba(60,40,25,0.35)', 1.5);
      function onWall(x, y) { return [x, y + x / 2]; } // local wall coords -> frame (x along wall, y down)
      if (deco === 'pencere') {
        var a = onWall(10, 46), b = onWall(54, 46), c = onWall(54, 124), d = onWall(10, 124);
        poly(ctx, [a, b, c, d], '#a8d8f0', look === 'ev' ? '#fff' : '#3b3b3b', 5);
        poly(ctx, [onWall(32, 46), onWall(34, 46), onWall(34, 124), onWall(32, 124)], look === 'ev' ? '#fff' : '#3b3b3b');
        poly(ctx, [onWall(14, 60), onWall(24, 60), onWall(18, 100), onWall(14, 100)], 'rgba(255,255,255,0.5)');
        if (look === 'ev') { // curtain + flower pot
          poly(ctx, [onWall(4, 40), onWall(14, 40), onWall(12, 130), onWall(2, 130)], '#d9534f');
          poly(ctx, [onWall(50, 40), onWall(60, 40), onWall(62, 130), onWall(52, 130)], '#d9534f');
        }
      } else if (deco === 'kapi') {
        poly(ctx, [onWall(14, 58), onWall(52, 58), onWall(52, WALLH), onWall(14, WALLH)], look === 'ev' ? '#8a5a3b' : '#4f5d6b', 'rgba(30,20,10,0.6)', 2);
        circle(ctx, onWall(46, 124)[0], onWall(46, 124)[1], 3, '#f0c040');
      } else if (deco === 'poster') {
        poly(ctx, [onWall(14, 50), onWall(50, 50), onWall(50, 100), onWall(14, 100)], '#fff7e0', '#6b4a2f', 2);
        poly(ctx, [onWall(20, 62), onWall(44, 62), onWall(44, 70), onWall(20, 70)], '#e07a3f');
        poly(ctx, [onWall(20, 76), onWall(38, 76), onWall(38, 80), onWall(20, 80)], '#6b4a2f');
        poly(ctx, [onWall(20, 84), onWall(42, 84), onWall(42, 88), onWall(20, 88)], '#6b4a2f');
      } else if (deco === 'logo') { // tiny Teserix plaque (own drawing, just a "T")
        poly(ctx, [onWall(22, 66), onWall(42, 66), onWall(42, 90), onWall(22, 90)], '#1f2a36', '#f2f2f2', 1.5);
        // "T" mark drawn as shapes (no text baked into images)
        poly(ctx, [onWall(26, 71), onWall(38, 71), onWall(38, 74), onWall(26, 74)], '#ffffff');
        poly(ctx, [onWall(30.5, 74), onWall(33.5, 74), onWall(33.5, 85), onWall(30.5, 85)], '#ffffff');
      } else if (deco === 'raf') {
        poly(ctx, [onWall(6, 90), onWall(58, 90), onWall(58, 96), onWall(6, 96)], '#7a5234');
        [['#3f7fbf', 10], ['#d9534f', 18], ['#5cb85c', 26], ['#f0ad4e', 34]].forEach(function (bk) {
          poly(ctx, [onWall(bk[1], 66), onWall(bk[1] + 6, 66), onWall(bk[1] + 6, 90), onWall(bk[1], 90)], bk[0]);
        });
        circle(ctx, onWall(48, 82)[0], onWall(48, 82)[1], 7, '#3c8d4f');
      }
    });
  }
  ['ev', 'studyo'].forEach(function (look) {
    ['sag', 'sol'].forEach(function (side) {
      wall('duvar_' + side + '_' + look + '_01', side, look, null);
      wall('duvar_' + side + '_' + look + '_pencere_01', side, look, 'pencere');
      wall('duvar_' + side + '_' + look + '_raf_01', side, look, 'raf');
    });
    wall('duvar_sol_' + look + '_kapi_01', 'sol', look, 'kapi');
  });
  wall('duvar_sag_ev_poster_01', 'sag', 'ev', 'poster');
  wall('duvar_sag_studyo_logo_01', 'sag', 'studyo', 'logo');

  // ---------- furniture. meta collected for mobilya.json
  var META = {};
  // furniture frame: footprint bx x by tiles, extra headroom (px above ground at the back corner)
  function furn(name, bx, by, head, draw, extra) {
    var left = HW + (by - 1) * HW, right = HW + (bx - 1) * HW;
    var ox = left, top = HH + head, oy = top;
    var w = left + right, h = top + (bx + by - 1) * HH + HH / 1 + 4;
    def(name, Math.ceil(w), Math.ceil(h), [ox, oy], function (ctx) { draw(ctx, P(ox, oy)); });
    META[name] = Object.assign({ boyut: [bx, by], pivotKaro: [0, 0], pivotPx: [ox, oy] }, extra || {});
  }
  var WOOD = '#b07a4a', WOOD2 = '#8e5d36';
  function desk(ctx, p, col) {
    shadow(ctx, p, -0.42, 1.42, -0.4, 0.4);
    box(ctx, p, -0.40, -0.30, -0.36, 0.36, 0, 34, shade(col, 0.8));
    box(ctx, p, 1.30, 1.40, -0.36, 0.36, 0, 34, shade(col, 0.8));
    box(ctx, p, -0.42, 1.42, -0.4, 0.4, 34, 42, col);
  }
  function laptop(ctx, p, u, v) { // screen faces the seat (behind the desk); viewer sees the lid's back
    box(ctx, p, u - 0.28, u + 0.28, v - 0.42, v - 0.14, 42, 45, '#9aa3ad');
    poly(ctx, [p(u - 0.28, v - 0.14, 45), p(u + 0.28, v - 0.14, 45), p(u + 0.28, v - 0.08, 80), p(u - 0.28, v - 0.08, 80)], '#b9c1ca', 'rgba(30,30,40,0.6)', 1.5);
    var c = p(u, v - 0.11, 63); circle(ctx, c[0], c[1], 5, '#e25b45'); // sticker
  }
  function monitor(ctx, p, u, v) {
    box(ctx, p, u - 0.22, u + 0.22, v - 0.46, v - 0.28, 42, 45, '#dfe3e8'); // keyboard (seat side)
    box(ctx, p, u - 0.08, u + 0.08, v - 0.06, v + 0.06, 42, 58, '#4a4f57');
    poly(ctx, [p(u - 0.42, v + 0.02, 56), p(u + 0.42, v + 0.02, 56), p(u + 0.42, v + 0.06, 100), p(u - 0.42, v + 0.06, 100)], '#2f343b', 'rgba(10,10,20,0.8)', 1.5);
  }
  function cay(ctx, p, u, v) {
    var b = p(u, v, 42);
    ellipse(ctx, b[0], b[1], 11, 5, '#f4f4f4');
    ctx.beginPath(); ctx.moveTo(b[0] - 5, b[1] - 2); ctx.quadraticCurveTo(b[0] - 8, b[1] - 12, b[0] - 5, b[1] - 20);
    ctx.lineTo(b[0] + 5, b[1] - 20); ctx.quadraticCurveTo(b[0] + 8, b[1] - 12, b[0] + 5, b[1] - 2); ctx.closePath();
    ctx.fillStyle = '#a2331c'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // desks: occupy 2x1 (u), seat is behind at tile (0,-1); tile (1,-1) is kept free as well
  var deskExtra = { koltuk: [0, -1], ayrilmis: [[0, -1], [1, -1]], oturmaPx: [HW, -6] };
  furn('masa_tekli_laptop_01', 2, 1, 96, function (ctx, p) { desk(ctx, p, WOOD); laptop(ctx, p, 0.5, 0); }, deskExtra);
  furn('masa_tekli_monitor_01', 2, 1, 110, function (ctx, p) { desk(ctx, p, '#e9e4dc'); monitor(ctx, p, 0.5, -0.08); }, deskExtra);
  furn('masa_kurucu_01', 2, 1, 96, function (ctx, p) { desk(ctx, p, WOOD2); laptop(ctx, p, 0.45, 0); cay(ctx, p, 1.15, 0.1); }, deskExtra);
  furn('masa_mutfak_01', 2, 1, 96, function (ctx, p) { desk(ctx, p, '#d9c7a3'); laptop(ctx, p, 0.5, 0); }, deskExtra);
  // decor
  furn('esya_cayocagi_01', 1, 1, 110, function (ctx, p) {
    shadow(ctx, p, -0.4, 0.4, -0.4, 0.4);
    box(ctx, p, -0.4, 0.4, -0.4, 0.4, 0, 52, '#e6e0d4', { top: '#8a8f96' });
    var b = p(0, 0, 52); // double teapot (çaydanlık)
    ellipse(ctx, b[0], b[1] - 12, 18, 14, '#c9cdd2'); ellipse(ctx, b[0], b[1] - 12, 18, 5, '#e6e9ec');
    ellipse(ctx, b[0], b[1] - 34, 12, 10, '#d8dbe0'); ellipse(ctx, b[0], b[1] - 42, 5, 3, '#555');
    ctx.strokeStyle = '#555'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b[0] + 16, b[1] - 18); ctx.lineTo(b[0] + 28, b[1] - 30); ctx.stroke();
  }, {});
  furn('esya_kanepe_01', 2, 1, 70, function (ctx, p) {
    shadow(ctx, p, -0.45, 1.45, -0.42, 0.42);
    box(ctx, p, -0.45, 1.45, -0.4, 0.4, 0, 26, '#4f7fa8');
    box(ctx, p, -0.45, 1.45, -0.4, -0.18, 26, 58, '#5a8cb6');
    box(ctx, p, -0.45, -0.25, -0.18, 0.4, 26, 40, '#5a8cb6');
    box(ctx, p, 1.25, 1.45, -0.18, 0.4, 26, 40, '#5a8cb6');
    box(ctx, p, 0.3, 0.6, -0.1, 0.1, 26, 40, '#f0c14b'); // cushion
  }, {});
  furn('esya_bitki_01', 1, 1, 96, function (ctx, p) {
    shadow(ctx, p, -0.25, 0.25, -0.25, 0.25);
    box(ctx, p, -0.2, 0.2, -0.2, 0.2, 0, 30, '#c66b3d');
    var b = p(0, 0, 30);
    [[-14, -30, 16], [12, -34, 15], [0, -52, 17], [-6, -18, 13], [10, -16, 12]].forEach(function (l, i) {
      circle(ctx, b[0] + l[0], b[1] + l[1], l[2], i % 2 ? '#3f8f4f' : '#4fa65c');
    });
  }, {});
  furn('esya_kitaplik_01', 1, 1, 150, function (ctx, p) {
    shadow(ctx, p, -0.4, 0.4, -0.25, 0.25);
    box(ctx, p, -0.4, 0.4, -0.25, 0.25, 0, 130, WOOD2);
    for (var s = 0; s < 4; s++) {
      var z = 12 + s * 30;
      for (var bk = 0; bk < 5; bk++) {
        var cols = ['#d9534f', '#3f7fbf', '#f0ad4e', '#5cb85c', '#8e6bbf'];
        var u = -0.34 + bk * 0.14;
        poly(ctx, [p(u, 0.25, z), p(u + 0.11, 0.25, z), p(u + 0.11, 0.25, z + 22 - (bk % 3) * 3), p(u, 0.25, z + 22 - (bk % 3) * 3)], cols[(bk + s) % 5], 'rgba(0,0,0,0.3)', 1);
      }
    }
  }, {});
  furn('esya_sebil_01', 1, 1, 150, function (ctx, p) {
    shadow(ctx, p, -0.25, 0.25, -0.25, 0.25);
    box(ctx, p, -0.22, 0.22, -0.22, 0.22, 0, 80, '#eef1f4');
    var b = p(0, 0, 80);
    ellipse(ctx, b[0], b[1] - 22, 17, 24, 'rgba(110,180,230,0.85)'); ellipse(ctx, b[0], b[1] - 44, 8, 4, '#3a7bd5');
  }, {});
  furn('esya_tahta_01', 2, 1, 150, function (ctx, p) {
    box(ctx, p, -0.1, 0.0, 0.2, 0.3, 0, 60, '#777'); box(ctx, p, 1.0, 1.1, 0.2, 0.3, 0, 60, '#777');
    poly(ctx, [p(-0.35, 0.3, 50), p(1.35, 0.3, 50), p(1.35, 0.3, 130), p(-0.35, 0.3, 130)], '#fbfbfb', '#8a8f96', 3);
    ctx.strokeStyle = '#3a7bd5'; ctx.lineWidth = 2.5; ctx.beginPath();
    var a = p(-0.1, 0.3, 110), b2 = p(0.5, 0.3, 90), c = p(1.1, 0.3, 115); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    ctx.strokeStyle = '#d9534f'; ctx.beginPath(); var d = p(0.1, 0.3, 75), e = p(0.9, 0.3, 75); ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }, {});
  furn('esya_puf_01', 1, 1, 60, function (ctx, p) {
    shadow(ctx, p, -0.3, 0.3, -0.3, 0.3);
    var b = p(0, 0, 0); ellipse(ctx, b[0], b[1] - 16, 34, 22, '#e07a3f'); ellipse(ctx, b[0] - 6, b[1] - 24, 16, 8, 'rgba(255,255,255,0.25)');
  }, {});

  // ---------- characters (pivot = feet bottom-center)
  var CW = 72, CH = 128;
  var TYPES = {
    kurucu:    { shirt: '#e07a3f', pants: '#34495e', hair: '#3b2a20', skin: '#f1c7a1' },
    stajyer:   { shirt: '#f2c94c', pants: '#3d5a80', hair: '#6b3e26', skin: '#f6d2b0', cap: '#e74c3c' },
    junior:    { shirt: '#4a90d9', pants: '#2d3e50', hair: '#1f1a17', skin: '#e0ac85', hood: true },
    kidemli:   { shirt: '#7f8c8d', pants: '#2c2c2c', hair: '#9aa0a6', skin: '#eab893', beard: true, glasses: true },
    tasarimci: { shirt: '#9b59b6', pants: '#222', hair: '#c0392b', skin: '#f3c9a8', beret: '#2c3e50' },
    yzajan:    { robot: true }
  };
  function person(ctx, t, pose, fr) {
    var cx = CW / 2, g = CH - 7;
    ellipse(ctx, cx, g, 20, 6, 'rgba(30,20,10,0.22)');
    if (t.robot) {
      var bob = fr === 2 ? -3 : 0;
      rrect(ctx, cx - 16, g - 56 + bob, 32, 44, 8, '#1abc9c', '#0e6655', 2);
      rrect(ctx, cx - 10, g - 14, 8, 12, 3, '#16a085'); rrect(ctx, cx + 2, g - 14, 8, 12, 3, '#16a085');
      rrect(ctx, cx - 22, g - 98 + bob, 44, 38, 10, '#48c9b0', '#0e6655', 2.5);
      rrect(ctx, cx - 16, g - 92 + bob, 32, 24, 6, '#123');
      circle(ctx, cx - 7, g - 80 + bob, 4, pose === 'calis' ? '#7fffd4' : '#58d68d'); circle(ctx, cx + 7, g - 80 + bob, 4, pose === 'calis' ? '#7fffd4' : '#58d68d');
      ctx.strokeStyle = '#0e6655'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, g - 98 + bob); ctx.lineTo(cx, g - 110 + bob); ctx.stroke();
      circle(ctx, cx, g - 112 + bob, 5, fr === 2 ? '#f1c40f' : '#e74c3c');
      var ay = pose === 'calis' ? (fr === 2 ? -44 : -36) : -30;
      rrect(ctx, cx - 26, g + ay + bob, 9, 22, 4, '#48c9b0'); rrect(ctx, cx + 17, g + ay + bob - (fr === 2 ? 6 : 0), 9, 22, 4, '#48c9b0');
      return;
    }
    // legs
    var lo = pose === 'yuru' ? (fr === 1 ? 5 : -5) : 0;
    rrect(ctx, cx - 11, g - 26, 9, 24 + (lo > 0 ? 0 : 2), 3, t.pants); rrect(ctx, cx + 2, g - 26, 9, 24 + (lo > 0 ? 2 : 0), 3, t.pants);
    ellipse(ctx, cx - 7 - (lo > 0 ? 2 : 0), g - 2, 7, 4, '#2b2b2b'); ellipse(ctx, cx + 7 + (lo < 0 ? 2 : 0), g - 2, 7, 4, '#2b2b2b');
    // body
    rrect(ctx, cx - 17, g - 62, 34, 40, 10, t.shirt, 'rgba(0,0,0,0.25)', 1.5);
    if (t.hood) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 4, g - 58); ctx.lineTo(cx - 5, g - 44); ctx.moveTo(cx + 4, g - 58); ctx.lineTo(cx + 5, g - 44); ctx.stroke(); }
    // arms
    var armCol = t.shirt;
    if (pose === 'calis') {
      var up = fr === 2;
      rrect(ctx, cx - 24, g - 58, 10, 26, 5, armCol); rrect(ctx, cx + 14, g - 58 - (up ? 6 : 0), 10, 26, 5, armCol);
      circle(ctx, cx - 16, g - 32, 5, t.skin); circle(ctx, cx + 16, g - 32 - (up ? 8 : 0), 5, t.skin);
    } else {
      var sw = pose === 'yuru' ? (fr === 1 ? 3 : -3) : 0;
      rrect(ctx, cx - 25, g - 58 + sw, 9, 30, 5, armCol); rrect(ctx, cx + 16, g - 58 - sw, 9, 30, 5, armCol);
      circle(ctx, cx - 21, g - 27 + sw, 5, t.skin); circle(ctx, cx + 21, g - 27 - sw, 5, t.skin);
    }
    // head
    var hy = g - 84;
    circle(ctx, cx, hy, 22, t.skin, 'rgba(0,0,0,0.25)', 1.5);
    // hair
    ctx.fillStyle = t.hair; ctx.beginPath(); ctx.arc(cx, hy - 2, 23, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
    if (t.hood) { ctx.strokeStyle = shade(t.shirt, 0.8); ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, hy, 25, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke(); }
    if (t.cap) { ctx.fillStyle = t.cap; ctx.beginPath(); ctx.arc(cx, hy - 6, 22, Math.PI, 0); ctx.fill(); rrect(ctx, cx - 4, hy - 10, 30, 6, 3, t.cap); }
    if (t.beret) { ellipse(ctx, cx + 3, hy - 20, 22, 9, t.beret); circle(ctx, cx + 3, hy - 29, 3, t.beret); }
    // face
    var blink = pose === 'bekle' && fr === 2;
    if (blink) { ctx.fillStyle = '#2b2b2b'; ctx.fillRect(cx - 10, hy + 2, 7, 2); ctx.fillRect(cx + 4, hy + 2, 7, 2); }
    else { circle(ctx, cx - 7, hy + 2, 3, '#2b2b2b'); circle(ctx, cx + 7, hy + 2, 3, '#2b2b2b'); }
    if (t.glasses) { circle(ctx, cx - 7, hy + 2, 7, null, '#333', 2); circle(ctx, cx + 7, hy + 2, 7, null, '#333', 2); }
    if (t.beard) { ctx.fillStyle = t.hair; ctx.beginPath(); ctx.arc(cx, hy + 8, 15, 0.1 * Math.PI, 0.9 * Math.PI); ctx.fill(); }
    ctx.strokeStyle = '#8a4b3a'; ctx.lineWidth = 2; ctx.beginPath();
    if (pose === 'calis') { ctx.moveTo(cx - 4, hy + 12); ctx.lineTo(cx + 4, hy + 12); } else ctx.arc(cx, hy + 9, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    circle(ctx, cx - 13, hy + 9, 3.5, 'rgba(230,110,110,0.35)'); circle(ctx, cx + 13, hy + 9, 3.5, 'rgba(230,110,110,0.35)');
  }
  Object.keys(TYPES).forEach(function (k) {
    [['bekle', 1], ['bekle', 2], ['calis', 1], ['calis', 2], ['yuru', 1], ['yuru', 2]].forEach(function (pf) {
      def('calisan_' + k + '_' + pf[0] + '_0' + pf[1], CW, CH, [CW / 2, CH], function (ctx) { person(ctx, TYPES[k], pf[0], pf[1]); });
    });
  });

  // ---------- office cat (orange tabby)
  function cat(ctx, pose, fr) {
    var o = '#e8913a', d = '#b5651d', cx = 40, g = 52;
    ellipse(ctx, cx, g - 2, 22, 5, 'rgba(30,20,10,0.2)');
    if (pose === 'yat') { // loaf
      ellipse(ctx, cx, g - 12, 24, 12, o);
      for (var s = 0; s < 3; s++) { ctx.strokeStyle = d; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - 8 + s * 8, g - 23); ctx.lineTo(cx - 10 + s * 8, g - 14); ctx.stroke(); }
      circle(ctx, cx - 20, g - 20, 11, o);
      poly(ctx, [[cx - 29, g - 26], [cx - 27, g - 38], [cx - 20, g - 29]], o); poly(ctx, [[cx - 19, g - 30], [cx - 13, g - 38], [cx - 12, g - 26]], o);
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(cx - 27, g - 20); ctx.lineTo(cx - 23, g - 19); ctx.moveTo(cx - 18, g - 19); ctx.lineTo(cx - 14, g - 20); ctx.stroke();
      ctx.strokeStyle = o; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx + 20, g - 10);
      if (fr === 1) ctx.quadraticCurveTo(cx + 36, g - 8, cx + 34, g - 22); else ctx.quadraticCurveTo(cx + 36, g - 4, cx + 38, g - 10);
      ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    if (pose === 'otur') {
      ellipse(ctx, cx + 4, g - 16, 15, 16, o);
      circle(ctx, cx, g - 36, 12, o);
      poly(ctx, [[cx - 10, g - 42], [cx - 9, g - 55], [cx - 2, g - 46]], o); poly(ctx, [[cx + 2, g - 46], [cx + 9, g - 55], [cx + 10, g - 42]], o);
      circle(ctx, cx - 4, g - 37, 2, '#2b2b2b'); circle(ctx, cx + 4, g - 37, 2, '#2b2b2b');
      ctx.strokeStyle = o; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx + 16, g - 6); ctx.quadraticCurveTo(cx + 30, g - 6, cx + 28, g - 24); ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    // walk
    var l = fr === 1 ? 4 : -4;
    ellipse(ctx, cx + 2, g - 16, 20, 10, o);
    [cx - 12 + l, cx - 6 - l, cx + 8 + l, cx + 14 - l].forEach(function (x) { rrect(ctx, x, g - 12, 5, 11, 2, d); });
    circle(ctx, cx - 18, g - 24, 10, o);
    poly(ctx, [[cx - 26, g - 29], [cx - 25, g - 40], [cx - 19, g - 32]], o); poly(ctx, [[cx - 17, g - 33], [cx - 11, g - 40], [cx - 10, g - 28]], o);
    circle(ctx, cx - 21, g - 25, 1.8, '#2b2b2b'); circle(ctx, cx - 14, g - 25, 1.8, '#2b2b2b');
    ctx.strokeStyle = o; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx + 20, g - 18); ctx.quadraticCurveTo(cx + 34, g - 24, cx + 30, g - 38 + l); ctx.stroke(); ctx.lineCap = 'butt';
  }
  [['otur', 1], ['yat', 1], ['yat', 2], ['yuru', 1], ['yuru', 2]].forEach(function (pf) {
    def('kedi_ofis_' + pf[0] + '_0' + pf[1], 80, 56, [40, 56], function (ctx) { cat(ctx, pf[0], pf[1]); });
  });

  // ---------- fx / ui in world
  def('fx_para_01', 28, 28, [14, 14], function (ctx) { circle(ctx, 14, 14, 12, '#f5c542', '#b8860b', 2.5); circle(ctx, 14, 14, 6.5, null, '#d9a520', 2); circle(ctx, 11, 10, 2.5, 'rgba(255,255,255,0.7)'); });
  def('fx_kalp_01', 28, 26, [14, 13], function (ctx) {
    ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.moveTo(14, 24); ctx.bezierCurveTo(-4, 12, 4, -2, 14, 7); ctx.bezierCurveTo(24, -2, 32, 12, 14, 24); ctx.fill();
  });
  def('fx_buhar_01', 24, 40, [12, 40], function (ctx) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(10, 38); ctx.bezierCurveTo(2, 28, 18, 20, 10, 10); ctx.moveTo(16, 34); ctx.bezierCurveTo(22, 26, 12, 18, 18, 6); ctx.stroke();
  });
  def('fx_yildiz_01', 24, 24, [12, 12], function (ctx) {
    var pts = []; for (var i = 0; i < 10; i++) { var r = i % 2 ? 5 : 11, a = -Math.PI / 2 + i * Math.PI / 5; pts.push([12 + Math.cos(a) * r, 12 + Math.sin(a) * r]); }
    poly(ctx, pts, '#fff3a0', '#e6b800', 1.5);
  });
  def('ui_ok_01', 40, 44, [20, 44], function (ctx) { poly(ctx, [[12, 2], [28, 2], [28, 20], [38, 20], [20, 42], [2, 20], [12, 20]], '#ffcf33', '#8a5a00', 3); });
  function sel(name, fill, stroke) { def(name, TW, TH, [HW, HH], function (ctx) { diamond(ctx, HW, HH, TW - 6, TH - 3, fill, stroke, 3); }); }
  sel('sec_karo_ok_01', 'rgba(80,200,120,0.35)', 'rgba(40,150,80,0.9)');
  sel('sec_karo_yok_01', 'rgba(230,80,70,0.35)', 'rgba(180,40,30,0.9)');
  sel('sec_karo_bos_01', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.35)');
  def('ui_nokta_01', 8, 8, [4, 4], function (ctx) { circle(ctx, 4, 4, 4, '#ffffff'); }); // 1-colour quad for bars (tinted)

  window.ART = { frames: F, meta: META, TYPES: Object.keys(TYPES) };
})();
