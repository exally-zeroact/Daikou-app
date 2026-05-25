/**
 * dem-lookup.js
 *
 * 国土地理院 標高タイル PNG を読み込み、任意の lat/lng の標高を
 * bilinear 補間で返すライブラリ。
 *
 * PNG 1px → 標高式 (https://maps.gsi.go.jp/development/demtile.html):
 *   x = R * 65536 + G * 256 + B
 *   x <  2^23 → h =  x          * 0.01 m
 *   x === 2^23 → NaN (NA)
 *   x >  2^23 → h = (x - 2^24) * 0.01 m
 *
 * 5mDEM 優先、無ければ 10mDEM、両方無ければ NaN。
 *
 * 使い方:
 *   const dem = require('./dem-lookup.js')({ zoom: 14 });
 *   const h = dem.elev(33.84, 132.77); // → 250.34 (m) or NaN
 *   dem.stats(); // → { hits, misses, tilesLoaded, ... }
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function requireGlobal(name) {
  try {
    return require(name);
  } catch {}
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, name));
}
const { PNG } = requireGlobal('pngjs');

const PROJECT_ROOT = path.join(__dirname, '..');
const TILES_DIR = path.join(PROJECT_ROOT, 'tmp', 'tiles');
const TILE_SIZE = 256;

// ─── XYZ math ─────────────────────────────────────────────────────
function lng2tileXFloat(lng, z) {
  return ((lng + 180) / 360) * Math.pow(2, z);
}
function lat2tileYFloat(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

// ─── PNG → 標高グリッド (Float32Array, length 256x256) ────────────
function decodeTile(pngBuf) {
  const png = PNG.sync.read(pngBuf);
  const w = png.width,
    h = png.height;
  if (w !== TILE_SIZE || h !== TILE_SIZE) {
    throw new Error(`unexpected tile size ${w}x${h}`);
  }
  const elev = new Float32Array(w * h);
  const data = png.data; // RGBA
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const x = (r << 16) | (g << 8) | b;
    if (x === 0x800000) {
      elev[j] = NaN;
      continue;
    }
    elev[j] = (x < 0x800000 ? x : x - 0x1000000) * 0.01;
  }
  return elev;
}

// ─── DEM Lookup factory ───────────────────────────────────────────
function createDem(opts) {
  opts = opts || {};
  const zoom = opts.zoom || 14;
  const cache = new Map(); // "x_y" → Float32Array | null (no-tile)
  const stats = { hits: 0, misses: 0, naSamples: 0, tiles5m: 0, tiles10m: 0, tilesMissing: 0 };

  function loadTile(x, y) {
    const key = `${x}_${y}`;
    if (cache.has(key)) return cache.get(key);
    // 5mDEM 優先
    const p5 = path.join(TILES_DIR, 'dem5a_png', String(zoom), String(x), `${y}.png`);
    if (fs.existsSync(p5)) {
      try {
        const grid = decodeTile(fs.readFileSync(p5));
        cache.set(key, grid);
        stats.tiles5m++;
        return grid;
      } catch (err) {
        /* ignore, fall through */
      }
    }
    const p10 = path.join(TILES_DIR, 'dem_png', String(zoom), String(x), `${y}.png`);
    if (fs.existsSync(p10)) {
      try {
        const grid = decodeTile(fs.readFileSync(p10));
        cache.set(key, grid);
        stats.tiles10m++;
        return grid;
      } catch (err) {
        /* ignore */
      }
    }
    cache.set(key, null);
    stats.tilesMissing++;
    return null;
  }

  // 4 ピクセル bilinear 補間で標高を返す。NaN なら見つからずを意味する
  function elev(lat, lng) {
    const tx = lng2tileXFloat(lng, zoom);
    const ty = lat2tileYFloat(lat, zoom);
    // タイル内画素座標 (浮動小数)
    const pxF = (tx - Math.floor(tx)) * TILE_SIZE;
    const pyF = (ty - Math.floor(ty)) * TILE_SIZE;
    const x0 = Math.floor(pxF),
      y0 = Math.floor(pyF);
    const x1 = x0 + 1,
      y1 = y0 + 1;
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);

    // 4 隅のサンプル (タイル境界をまたぐ場合は隣接タイルを取る)
    function sample(px, py) {
      let tX = tileX,
        tY = tileY;
      let lx = px,
        ly = py;
      if (lx >= TILE_SIZE) {
        tX += Math.floor(lx / TILE_SIZE);
        lx %= TILE_SIZE;
      }
      if (lx < 0) {
        tX -= 1;
        lx += TILE_SIZE;
      }
      if (ly >= TILE_SIZE) {
        tY += Math.floor(ly / TILE_SIZE);
        ly %= TILE_SIZE;
      }
      if (ly < 0) {
        tY -= 1;
        ly += TILE_SIZE;
      }
      const grid = loadTile(tX, tY);
      if (!grid) return NaN;
      return grid[ly * TILE_SIZE + lx];
    }
    const h00 = sample(x0, y0);
    const h10 = sample(x1, y0);
    const h01 = sample(x0, y1);
    const h11 = sample(x1, y1);

    // 全 NaN なら ミス
    const has = [h00, h10, h01, h11].some((h) => !isNaN(h));
    if (!has) {
      stats.misses++;
      return NaN;
    }
    stats.hits++;

    // bilinear (NaN は隣接サンプルで補完)
    const fx = pxF - x0;
    const fy = pyF - y0;
    function blend(a, b, t) {
      if (isNaN(a)) return b;
      if (isNaN(b)) return a;
      return a * (1 - t) + b * t;
    }
    const top = blend(h00, h10, fx);
    const bot = blend(h01, h11, fx);
    const result = blend(top, bot, fy);
    if (isNaN(result)) {
      stats.naSamples++;
      return NaN;
    }
    return result;
  }

  return {
    elev,
    stats: () => Object.assign({}, stats, { cacheTiles: cache.size }),
    clearCache: () => cache.clear(),
  };
}

module.exports = createDem;

// CLI セルフテスト: node scripts/dem-lookup.js <lat> <lng>
if (require.main === module) {
  const [, , lat, lng] = process.argv;
  if (!lat || !lng) {
    console.error('Usage: dem-lookup.js <lat> <lng>');
    process.exit(1);
  }
  const dem = createDem({ zoom: 14 });
  const h = dem.elev(parseFloat(lat), parseFloat(lng));
  console.log(`elev(${lat}, ${lng}) = ${h.toFixed(2)} m`);
  console.log('stats:', dem.stats());
}
