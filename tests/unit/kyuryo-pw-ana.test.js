// ★本人の パスワード・初回コードの 照らし方（空＝必ず 違う）を repo の 字で 縛る★ 2026-10-19
//   前は `pw_hash <> crypt(p_pw, …)`・`init_code <> p_init` で、null を 送ると 素通りした（パスワード 無しで 開いた・
//   初回コード 無しで 決められた）。4桁の 件で 3本を 書き直す 時に 一番 落ちやすい 守り（対立役 本番前 N2）。
//   わざと壊す：apply-kyuryo-honnin-kansuu.sql の 3か所の どれかを 古い 比べに 戻す ⇒ 赤
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { kiridasu, kazoeru } from '../../scripts/apply-kyuryo-saihakkou.mjs';
import { KANSUU, honbunMd5 } from '../../scripts/apply-kyuryo-pw-ana.mjs';

const ROOT = path.join(__dirname, '..', '..');

describe('★本人の パスワード・初回コードの 照らし方★', () => {
  KANSUU.forEach((k) => {
    it(k.na + '：空は 必ず 違う・古い 比べが 無い・md5 が 決めた 版', () => {
      const block = kiridasu(fs.readFileSync(path.join(ROOT, k.file), 'utf8'), k);
      const kz = kazoeru(block, k);
      expect(kz.aru.filter((x) => !x.ok).map((x) => x.x)).toEqual([]);
      expect(kz.nai.filter((x) => !x.ok).map((x) => x.x)).toEqual([]);
      expect(honbunMd5(block)).toBe(k.ato);
    });
  });
});
