/** PNG helpers. Canvas is used in the browser; a tiny uncompressed PNG writer works everywhere. */

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type, data) {
  const t = new TextEncoder().encode(type);
  const body = concat([t, data]);
  const crc = u32(crc32(body));
  return concat([u32(data.length), body, crc]);
}

function deflateStore(data) {
  const chunks = [];
  const max = 65535;
  for (let i = 0; i < data.length; i += max) {
    const slice = data.subarray(i, Math.min(i + max, data.length));
    const last = i + max >= data.length ? 1 : 0;
    const len = slice.length;
    const nlen = (~len) & 0xffff;
    chunks.push(new Uint8Array([last, len & 255, (len >> 8) & 255, nlen & 255, (nlen >> 8) & 255]), slice);
  }
  const raw = concat(chunks);
  const zlib = concat([new Uint8Array([0x78, 0x01]), raw, u32(adler32(data))]);
  return zlib;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Write an RGBA PNG. pixels is Uint8Array length width*height*4
 */
export function encodePngRGBA(width, height, pixels) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const ihdr = concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])]);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateStore(raw)), chunk("IEND", new Uint8Array(0))]);
}

export function solidPng(width, height, hex, alpha = 255) {
  const [r, g, b] = hexToRgb(hex);
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = alpha;
  }
  return encodePngRGBA(width, height, pixels);
}

/** Simple block-letter initials so Node tests and browsers without canvas still get a real PNG. */
export function rasterInitialsPng(width, height, initials, bg, fg, { transparent = false } = {}) {
  const [br, bgc, bb] = hexToRgb(bg);
  const [fr, fg_ , fb] = hexToRgb(fg);
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = br;
    pixels[i * 4 + 1] = bgc;
    pixels[i * 4 + 2] = bb;
    pixels[i * 4 + 3] = transparent ? 0 : 255;
  }
  if (transparent) {
    // Draw a rounded-ish outline square so the 32x32 icon isn't empty.
    const inset = Math.max(2, Math.round(width * 0.12));
    for (let y = inset; y < height - inset; y++) {
      for (let x = inset; x < width - inset; x++) {
        const edge = x === inset || x === width - inset - 1 || y === inset || y === height - inset - 1;
        if (edge) {
          const i = (y * width + x) * 4;
          pixels[i] = fr;
          pixels[i + 1] = fg_;
          pixels[i + 2] = fb;
          pixels[i + 3] = 255;
        }
      }
    }
  }
  const glyphs = glyphSet();
  const text = String(initials || "AS").slice(0, 2).toUpperCase();
  const gw = 5;
  const gh = 7;
  const scale = Math.max(2, Math.floor(Math.min(width, height) / 18));
  const gap = scale;
  const totalW = text.length * gw * scale + (text.length - 1) * gap;
  const totalH = gh * scale;
  let x0 = Math.floor((width - totalW) / 2);
  const y0 = Math.floor((height - totalH) / 2);
  for (const ch of text) {
    const g = glyphs[ch] || glyphs["?"];
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (!g[gy][gx]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = x0 + gx * scale + sx;
            const y = y0 + gy * scale + sy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = (y * width + x) * 4;
            pixels[i] = fr;
            pixels[i + 1] = fg_;
            pixels[i + 2] = fb;
            pixels[i + 3] = 255;
          }
        }
      }
    }
    x0 += gw * scale + gap;
  }
  return encodePngRGBA(width, height, pixels);
}

function glyphSet() {
  const bit = (rows) => rows.map((r) => r.split("").map((c) => (c === "#" ? 1 : 0)));
  return {
    A: bit([".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
    B: bit(["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."]),
    C: bit([".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."]),
    D: bit(["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."]),
    E: bit(["#####", "#....", "#....", "####.", "#....", "#....", "#####"]),
    F: bit(["#####", "#....", "#....", "####.", "#....", "#....", "#...."]),
    G: bit([".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."]),
    H: bit(["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
    I: bit([".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."]),
    J: bit(["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."]),
    K: bit(["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"]),
    L: bit(["#....", "#....", "#....", "#....", "#....", "#....", "#####"]),
    M: bit(["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"]),
    N: bit(["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"]),
    O: bit([".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    P: bit(["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."]),
    Q: bit([".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"]),
    R: bit(["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"]),
    S: bit([".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."]),
    T: bit(["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."]),
    U: bit(["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    V: bit(["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."]),
    W: bit(["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"]),
    X: bit(["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"]),
    Y: bit(["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."]),
    Z: bit(["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"]),
    "?": bit([".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."]),
    "0": bit([".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."]),
    "1": bit(["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."]),
    "2": bit([".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
    "3": bit([".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."]),
    "4": bit(["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
    "5": bit(["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
    "6": bit([".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."]),
    "7": bit(["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."]),
    "8": bit([".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]),
    "9": bit([".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."]),
  };
}

export function generateIcons(project) {
  const initials = (project.icons?.initials || "AS").slice(0, 2).toUpperCase();
  const bg = project.icons?.colorBg || project.app?.accentColor || "#1F4E79";
  const fg = project.icons?.colorFg || "#FFFFFF";
  const color = rasterInitialsPng(192, 192, initials, bg, fg, { transparent: false });
  const outline = rasterInitialsPng(32, 32, initials, "#000000", fg, { transparent: true });
  return { color, outline, initials, bg, fg };
}

export function generateIconsViaCanvas(project) {
  if (typeof document === "undefined") return generateIcons(project);
  const initials = (project.icons?.initials || "AS").slice(0, 2).toUpperCase();
  const bg = project.icons?.colorBg || project.app?.accentColor || "#1F4E79";
  const fg = project.icons?.colorFg || "#FFFFFF";
  const color = canvasIcon(192, initials, bg, fg, false);
  const outline = canvasIcon(32, initials, "transparent", fg, true);
  return { color, outline, initials, bg, fg };
}

function canvasIcon(size, initials, bg, fg, outlineOnly) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (outlineOnly) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(2, size * 0.08);
    const r = size * 0.18;
    roundRect(ctx, size * 0.08, size * 0.08, size * 0.84, size * 0.84, r);
    ctx.stroke();
  } else {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, size, size, size * 0.18);
    ctx.fill();
  }
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(size * 0.42)}px "Segoe UI", "Helvetica Neue", system-ui, sans-serif`;
  ctx.fillText(initials, size / 2, size / 2 + size * 0.03);
  return dataUrlToBytes(canvas.toDataURL("image/png"));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes, mime = "image/png") {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return `data:${mime};base64,${base64}`;
}
