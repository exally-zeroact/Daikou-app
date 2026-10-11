/* pre-push-kinshi.mjs — ★押す commit ごとに、変わった 物の 中身（git が 持つ 字）に 実在の 字が 無いかを 見る★（2026-10-11）
 *
 *   公開 repo では、字が 外に 出る 瞬間は push（CI は push の 後に 走る・main 以外の 枝では CI が 走らない）。
 *   ＝押す 前の 最後の 門を ここに 置く。見張りの 本体（tests/kinshi-ji.test.mjs の scan）を そのまま 使い、
 *     読む 物だけを「手元の 字」から「押す commit の 中身（blob）」に 替える。
 *
 *   見る 物：まだ 遠くに 無い commit の 1本ずつで、親（1番目）から 変わった・増えた 物（消した 物は 見ない）。
 *     途中の commit で 入れて 後で 消した 字も、その commit の 所で 赤に なる（履歴に 残って 押されるので）。
 *     白名簿は その commit の tests/kinshi-ji-shiro.txt・印は その commit の blob の id。
 *   一覧：KINSHI_JI か ~/.tsukurimono/kinshi-ji.txt。★指紋を .githooks/kinshi-finger と 照らす★（縮んだ・差し替えた 一覧で 緑に しない）。
 *     一覧が 無い・指紋が 違う・指紋の 紙が 無い は 赤。
 *   ★見張りの 本体は 押す 頭の 木の 物を 一時の 所へ 取り出して 走らせる★（手元の 字の 本体は 読まない）。
 *     手元で 本体を 弱めた・add し忘れた push が 緑で 通った（10-11 taiketsu T11・5a45b10 の 入れ忘れ）。
 *     門（この 紙）も 押す 頭の 物と 手元が 違えば 赤（走っている 門＝押す 門 に する）。押す 頭に 本体・門が 無ければ 赤。
 *   見張りの 本体が 押す 範囲で 変わった 時は、自己確認も 回す（取り出した 押す 版で）。
 *   ★字は 出さない★（commit の SHA・道・行・一覧の 何番目か だけ）。
 *
 *   門の 外：--no-verify・core.hooksPath を 置いていない clone・GitHub の 画面での 編集・
 *     commit 文／作者名／注釈タグの 文・門の 古い 版を 取り出した 作業木からの push（門 自体が 走らない）・
 *     .githooks/pre-push と メールの 門の 手元の 書き換え。
 *   新しい 枝の 範囲は ★押す 先の 遠く（$1）に 今 在る 頭★ から（ls-remote）。遠くの 名が 無い・読めない は 赤。
 *     最後の 門は CI（main と PR）。
 *
 *   使い方（git が 呼ぶ）: 標準入力に「<手元の ref> <手元の sha> <遠くの ref> <遠くの sha>」
 *   自分で 確かめる:       node .githooks/pre-push-kinshi.mjs --self-test
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ZERO = /^0+$/;
/* 手元の 本体は 自己確認と 既定の 読み口 だけ（押す 時は 押す 頭の 本体で 走る）＝手元に 無くても 門は 走る */
let K = null;
try {
  K = await import(
    pathToFileURL(path.join(path.dirname(SELF), "..", "tests", "kinshi-ji.test.mjs")).href
  );
} catch {
  K = null;
}

const gitText = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
const gitBuf = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { maxBuffer: 1 << 28 });

/* ★押す 先の 遠く（hook の $1）に 今 在る 頭（ls-remote）の うち、手元に 在る 物★＝新しい 枝の 範囲の 下限。
   前の 形（--not --remotes）は 他の remote の 追跡枝・消された 枝の 古い 控えも「遠くに 在る」と 見て、
   新しい 枝の 字が 素通りした（10-11 アマかせ taiketsu 実測・remote 2 つの clone で「0 本」）。
   遠くの 名が 無い・読めない は throw（止める 側）。
   ★読む 先は hook の $2（実際に 押す 道）★：$1 の 名で 読むと fetch 側の 道を 読む＝pushurl・道 2 本の remote で
     押す 先と 取り違えて 偽の 緑（10-11 taiketsu 実測）。
   ★枝と タグだけ 読み、手元に 取っていない 頭が 在れば「fetch してから」で 止める★（全履歴を 赤に して
     作り直しへ 誘わない・10-11 taiketsu 実測＝古い 控えの clone で 128 件の 偽の 赤）。 */
export function remoteKnown(cwd, remote) {
  if (!remote) throw new Error("押す 先の 遠くの 名が 無い（hook の $1）");
  let out;
  try {
    out = gitText(cwd, "ls-remote", "--heads", "--tags", remote);
  } catch {
    throw new Error("押す 先の 遠くの 頭を 読めない（ls-remote）");
  }
  const shas = [
    ...new Set(
      out
        .split("\n")
        .map((l) => l.split("\t")[0])
        .filter((x) => /^[0-9a-f]{40,64}$/.test(x))
    ),
  ];
  if (!shas.length) return [];
  const have = execFileSync("git", ["-C", cwd, "cat-file", "--batch-check"], {
    input: shas.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const missing = have.split("\n").filter((l) => / missing$/.test(l)).length;
  if (missing)
    throw new Error(
      "押す 先の 遠くに、手元に 取っていない 頭が " +
        missing +
        " 本 在る＝git fetch してから 押す（commit は 作り直さない）"
    );
  return have
    .split("\n")
    .filter((l) => / (commit|tag) /.test(l))
    .map((l) => l.split(" ")[0]);
}
/* 自己確認用：別の repo で 作った commit を 遠くの 枝に 置く（手元に 無い 頭） */
function foreignHead(tmp, bare, ref) {
  const x = fs.mkdtempSync(path.join(tmp, "x-"));
  const gx = (...a) => execFileSync("git", ["-C", x, ...a], { stdio: "pipe" });
  gx("init", "-q");
  fs.writeFileSync(path.join(x, "f.txt"), "よそ\n");
  gx("add", "-A");
  gx(
    "-c",
    "user.name=x",
    "-c",
    "user.email=1+x@users.noreply.github.com",
    "commit",
    "-q",
    "-m",
    "f"
  );
  gx("push", "-q", bare, "HEAD:" + ref);
  return () => gx("push", "-q", bare, ":" + ref);
}

/* 押す 行ごとに、まだ 遠くに 無い commit（古い 順） */
export function pushedCommits(cwd, lines, remote) {
  const out = [];
  let known = null;
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue;
    let range;
    if (remoteSha && !ZERO.test(remoteSha)) range = [localSha, "^" + remoteSha];
    else range = [localSha, ...(known ??= remoteKnown(cwd, remote)).map((x) => "^" + x)];
    const list = execFileSync("git", ["-C", cwd, "rev-list", "--reverse", "--stdin"], {
      input: range.join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 1 << 28,
    }).trim();
    for (const c of list ? list.split("\n") : []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/* 1本の commit の「親から 変わった・増えた 物」を、見張りの 読み口に して 返す */
export function commitSource(cwd, commit, KB = K) {
  const parents = gitText(cwd, "rev-list", "--parents", "-n", "1", commit)
    .trim()
    .split(" ")
    .slice(1);
  const meta = new Map();
  if (parents.length) {
    const raw = gitText(
      cwd,
      "diff-tree",
      "-r",
      "-z",
      "--no-renames",
      "--diff-filter=ACMT",
      parents[0],
      commit
    );
    const parts = raw.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const head = parts[i].replace(/^:/, "").split(" ");
      if (head.length < 5) continue;
      meta.set(parts[i + 1], { mode: head[1], sha: head[3] });
    }
  } else {
    for (const row of gitText(cwd, "ls-tree", "-r", "-z", commit).split("\0").filter(Boolean)) {
      const [info, p] = row.split("\t");
      const [mode, , sha] = info.split(" ");
      meta.set(p, { mode, sha });
    }
  }
  let shiro;
  try {
    shiro = gitText(cwd, "show", commit + ":" + KB.SHIRO_PATH);
  } catch {
    shiro = null;
  }
  return {
    files: [...meta.keys()],
    src: {
      kind: (rel) => {
        const m = meta.get(rel);
        return !m ? "none" : /^100(644|755)$/.test(m.mode) ? "file" : "other";
      },
      read: (rel) => gitBuf(cwd, "cat-file", "blob", meta.get(rel).sha),
      id: (rel) => (meta.get(rel) ? meta.get(rel).sha.slice(0, 16) : ""),
      shiroText: () => shiro,
      partial: true,
    },
  };
}

/* ★押す 頭の 木の 見張りの 本体を 一時の 所へ 取り出す★（手元の 字の 本体・門で 走らせない）
   返す：{ heads, bodyFile, dir } か { err } */
export const BODY = "tests/kinshi-ji.test.mjs";
export const GATE = ".githooks/pre-push-kinshi.mjs";
export const FINGER = ".githooks/kinshi-finger";
/* hook の 中の 自己確認の 床＝★ci.yml の 床と 揃える★（自己確認を 0/0 に した 本体が 枝へ 緑で 出た＝10-11 taiketsu 実測） */
export const FLOOR = {
  [BODY]: { groups: 29, checks: 239 },
  [GATE]: { groups: 13, checks: 34 },
};
export function selfOk(stdout, floor) {
  const m = /^自己確認: (\d+)\/(\d+)$/m.exec(stdout || "");
  const c = /^確かめた 回数: (\d+)$/m.exec(stdout || "");
  return !!m && m[1] === m[2] && +m[1] >= floor.groups && !!c && +c[1] >= floor.checks;
}
export function bodyForPush(cwd, lines, gateFile = SELF) {
  const heads = [];
  for (const line of lines) {
    const [, localSha] = line.trim().split(/\s+/);
    if (localSha && !ZERO.test(localSha) && !heads.includes(localSha)) heads.push(localSha);
  }
  if (!heads.length) return { heads };
  const blob = (h, rel) => {
    try {
      return gitText(cwd, "rev-parse", "--verify", "-q", h + ":" + rel).trim();
    } catch {
      return "";
    }
  };
  const bodies = new Set();
  const gates = new Set();
  const fingers = new Set();
  for (const h of heads) {
    const b = blob(h, BODY);
    const g = blob(h, GATE);
    const f = blob(h, FINGER);
    if (!b) return { err: "押す 頭 " + h.slice(0, 7) + " に 見張りの 本体（" + BODY + "）が 無い" };
    if (!g) return { err: "押す 頭 " + h.slice(0, 7) + " に 門（" + GATE + "）が 無い" };
    if (!f) return { err: "押す 頭 " + h.slice(0, 7) + " に 指紋の 紙（" + FINGER + "）が 無い" };
    bodies.add(b);
    gates.add(g);
    fingers.add(f);
  }
  if (bodies.size > 1 || gates.size > 1 || fingers.size > 1)
    return { err: "押す 頭ごとに 見張りの 本体・門の 版が 違う（1 回の push は 1 つの 版で）" };
  const here = gitText(cwd, "hash-object", "--path=" + GATE, gateFile).trim();
  if (here !== [...gates][0])
    return {
      err:
        "手元の 門（" +
        GATE +
        "）が 押す 頭の 物と 違う＝走る 門が 押す 門で ない。commit してから 押す",
    };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppk-body-"));
  const bodyFile = path.join(dir, BODY);
  fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
  fs.writeFileSync(bodyFile, gitBuf(cwd, "cat-file", "blob", [...bodies][0]));
  /* 指紋の 紙も 押す 頭の 物（手元の 紙を 書き換えて 違う 一覧で 押した 字が 緑で 出た＝10-11 taiketsu 実測） */
  const fingerFile = path.join(dir, FINGER);
  fs.mkdirSync(path.dirname(fingerFile), { recursive: true });
  fs.writeFileSync(fingerFile, gitBuf(cwd, "cat-file", "blob", [...fingers][0]));
  return { heads, bodyFile, fingerFile, dir };
}

/* 門の 本体：赤なら 1 */
export function check({ cwd, lines, env = process.env, file, fingerFile, K: KB = K, remote }) {
  const out = [];
  const { words, finger } = KB.loadWords({
    env,
    file: file ?? env.KINSHI_JI_FILE ?? path.join(os.homedir(), ".tsukurimono", "kinshi-ji.txt"),
  });
  if (!words.length)
    return { code: 1, out: ["✗ 押すのを 止めた：禁止の 字の 一覧が 無い（未測定）"] };
  let want = "";
  try {
    want = fs.readFileSync(fingerFile, "utf8").trim();
  } catch {
    return { code: 1, out: ["✗ 押すのを 止めた：指紋の 紙（.githooks/kinshi-finger）が 無い"] };
  }
  if (want !== finger)
    return {
      code: 1,
      out: ["✗ 押すのを 止めた：一覧の 指紋が 違う（期待 " + want + "・今 " + finger + "）"],
    };
  let commits;
  try {
    commits = pushedCommits(cwd, lines, remote);
  } catch (e) {
    return { code: 1, out: ["✗ 押すのを 止めた：" + e.message] };
  }
  let files = 0;
  let red = 0;
  let selfNeeded = false;
  let gateNeeded = false;
  for (const c of commits) {
    const { files: fl, src } = commitSource(cwd, c, KB);
    if (fl.includes(BODY)) selfNeeded = true;
    if (fl.includes(GATE)) gateNeeded = true;
    files += fl.length;
    if (!fl.length) continue;
    const r = KB.scan({ root: cwd, files: fl, words, src });
    const all = [...r.hits, ...r.reds, ...r.notes.map((n) => n + "（未測定＝赤）")];
    for (const x of all) out.push("  " + c.slice(0, 7) + ": " + x);
    red += all.length;
  }
  if (red) {
    out.unshift(
      "✗ 押すのを 止めた：実在の 字・未測定 " +
        red +
        " 件（commit " +
        commits.length +
        " 本・変わった 物 " +
        files +
        " 本・字は 出さない）"
    );
    return { code: 1, out, selfNeeded, gateNeeded };
  }
  out.push(
    "✓ 押す commit " +
      commits.length +
      " 本の 変わった 物 " +
      files +
      " 本に 実在の 字 0 件（一覧 " +
      words.length +
      " 語・指紋 " +
      finger +
      "）"
  );
  return { code: 0, out, selfNeeded, gateNeeded };
}

function selfTest() {
  /* 呼ぶ 側（hook・worktree）が 渡す GIT_* を 外す＝一時 repo の git が 親を 書き換えない */
  for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];
  let pass = 0;
  let fail = 0;
  let checks = 0;
  const T = (n, fn) => {
    try {
      fn();
      pass++;
      console.log("  ✓ " + n);
    } catch (e) {
      fail++;
      console.log("  ✗ " + n + " … " + e.message);
    }
  };
  const must = (v, m) => {
    checks++;
    if (!v) throw new Error(m);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ppk-"));
  const repo = path.join(tmp, "r");
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "pipe" });
  g("init", "-q");
  const WORD = ["見本台", "ぷっしゅ語"].join("");
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, WORD + "\n");
  const { finger } = K.loadWords({ env: {}, file: list });
  const ff = path.join(tmp, "finger");
  fs.writeFileSync(ff, finger + "\n");
  const commit = (files, msg) => {
    for (const [p, body] of Object.entries(files)) {
      const abs = path.join(repo, p);
      if (body === null) fs.rmSync(abs, { force: true });
      else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
      }
    }
    g("add", "-A");
    g(
      "-c",
      "user.name=x",
      "-c",
      "user.email=1+x@users.noreply.github.com",
      "commit",
      "-q",
      "-m",
      msg
    );
    return gitText(repo, "rev-parse", "HEAD").trim();
  };
  const run = (from, to, extra = {}) =>
    check({
      cwd: repo,
      lines: ["refs/heads/main " + to + " refs/heads/main " + from],
      env: {},
      file: list,
      fingerFile: ff,
      ...extra,
    });
  const c1 = commit({ "a.txt": "ふつう\n" }, "c1");
  const c2 = commit({ "b.txt": "x\n" + WORD + "\n" }, "c2");
  const c3 = commit({ "b.txt": null }, "c3");
  const c4 = commit({ "c.txt": "ふつう\n" }, "c4");
  T("途中で 入れて 後で 消した 字も、その commit で 赤・字は 出さない", () => {
    const r = run(c1, c3);
    must(r.code === 1 && r.out.some((l) => l.includes(c2.slice(0, 7))), "入れて 消した 字が 緑");
    must(
      !r.out.join("\n").includes(WORD) && !r.out.join("\n").includes("ぷっしゅ"),
      "出しに 字が 出た"
    );
  });
  T("きれいな 範囲は 緑・分母が 出る", () => {
    const r = run(c3, c4);
    must(
      r.code === 0 &&
        r.out.some((l) => l.includes("commit 1 本") && l.includes("変わった 物 1 本")),
      "きれいで 赤 か 分母が 違う: " + r.out.join(" / ")
    );
  });
  T("一覧が 無い・指紋が 違う・指紋の 紙が 無い は 赤", () => {
    must(run(c3, c4, { file: path.join(tmp, "nai.txt") }).code === 1, "一覧なしで 緑");
    fs.writeFileSync(path.join(tmp, "bad"), "00000000\n");
    must(run(c3, c4, { fingerFile: path.join(tmp, "bad") }).code === 1, "指紋違いで 緑");
    must(run(c3, c4, { fingerFile: path.join(tmp, "nai") }).code === 1, "指紋の 紙なしで 緑");
  });
  T("初めての 枝（遠くの sha が 無い）は 押す 先の 遠くに 無い commit を 全部 見る", () => {
    /* 遠く 2 つ：O（押す 先・c1 だけ）と T（字の 入った c2〜c4 が 在る・追跡枝も 取ってある） */
    const O = path.join(tmp, "O.git");
    const TT = path.join(tmp, "T.git");
    execFileSync("git", ["init", "-q", "--bare", O], { stdio: "pipe" });
    execFileSync("git", ["init", "-q", "--bare", TT], { stdio: "pipe" });
    g("remote", "add", "O", O);
    g("remote", "add", "T", TT);
    g("push", "-q", "O", c1 + ":refs/heads/main");
    g("push", "-q", "T", c4 + ":refs/heads/side");
    g("fetch", "-q", "--all");
    const nb = (sha, remote) =>
      check({
        cwd: repo,
        lines: ["refs/heads/x " + sha + " refs/heads/x " + "0".repeat(40)],
        env: {},
        file: list,
        fingerFile: ff,
        remote,
      });
    const r = nb(c4, "O");
    must(
      r.code === 1 && r.out.some((l) => l.includes(c2.slice(0, 7))),
      "他の remote の 追跡枝に 在る 字の commit を 見ていない: " + r.out.join(" / ")
    );
    must(/commit 3 本/.test(r.out[0]), "押す 先に 無い 3 本を 見ていない: " + r.out[0]);
    const ok = nb(c1, "O");
    must(
      ok.code === 0 && ok.out.some((l) => l.includes("commit 0 本")),
      "押す 先に 在る commit の 新しい 枝で 赤"
    );
    must(nb(c4, undefined).code === 1, "押す 先の 名が 無いのに 緑");
    must(nb(c4, path.join(tmp, "無い.git")).code === 1, "読めない 遠くで 緑");
    /* 押す 先で 消された 枝の 古い 控え（追跡枝）が 在っても、今の 遠くの 頭で 見る */
    g("push", "-q", "O", c4 + ":refs/heads/old");
    g("fetch", "-q", "O");
    g("push", "-q", "O", ":refs/heads/old");
    must(nb(c4, "O").code === 1, "消された 枝の 古い 控えで 緑");
    /* 遠くに 手元に 無い 頭が 在る＝全履歴を 見ず「fetch してから」で 止める */
    const undo = foreignHead(tmp, O, "refs/heads/yoso");
    const rf = nb(c1, "O");
    undo();
    must(
      rf.code === 1 &&
        rf.out.join(" ").includes("fetch してから") &&
        !rf.out.some((l) => l.includes(c2.slice(0, 7))),
      "取っていない 頭で fetch の 止めに ならない: " + rf.out.join(" / ")
    );
  });
  T("白名簿は その commit の 物と blob の id で 通す", () => {
    const pic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81, 0x00]);
    const c5 = commit({ "w.jpg": pic }, "c5");
    must(run(c4, c5).code === 1, "絵の 未測定が 緑");
    const id = gitText(repo, "rev-parse", c5 + ":w.jpg")
      .trim()
      .slice(0, 16);
    const c6 = commit(
      { "w.jpg": pic, "tests/kinshi-ji-shiro.txt": "w.jpg\t未測定1\t" + id + "\t絵\n" },
      "c6"
    );
    fs.writeFileSync(
      path.join(repo, "w.jpg"),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81, 0x01])
    );
    g("add", "-A");
    g(
      "-c",
      "user.name=x",
      "-c",
      "user.email=1+x@users.noreply.github.com",
      "commit",
      "-q",
      "-m",
      "c7"
    );
    const c7 = gitText(repo, "rev-parse", "HEAD").trim();
    must(run(c5, c6).code === 0, "白名簿で 名指しした 絵が 赤: " + run(c5, c6).out.join(" / "));
    must(run(c6, c7).code === 1, "中身を 替えた 絵が 緑");
  });
  T("消す push は 見ない", () => {
    must(
      check({
        cwd: repo,
        lines: ["(delete) " + "0".repeat(40) + " refs/heads/x " + c4],
        env: {},
        file: list,
        fingerFile: ff,
      }).code === 0,
      "消す push で 赤"
    );
  });
  /* ★本物の 門を 作り物 repo の hook と 同じ 形で 走らせる★（押す 頭の 本体で 走るか） */
  const r2 = path.join(tmp, "r2");
  fs.mkdirSync(r2);
  const g2 = (...a) => execFileSync("git", ["-C", r2, ...a], { stdio: "pipe" });
  g2("init", "-q");
  const realBody = fs.readFileSync(path.join(path.dirname(SELF), "..", BODY));
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(r2, rel)), { recursive: true });
    fs.writeFileSync(path.join(r2, rel), body);
  };
  const commit2 = (msg) => {
    g2("add", "-A");
    g2(
      "-c",
      "user.name=x",
      "-c",
      "user.email=1+x@users.noreply.github.com",
      "commit",
      "-q",
      "-m",
      msg
    );
    return gitText(r2, "rev-parse", "HEAD").trim();
  };
  put(GATE, fs.readFileSync(SELF));
  put(BODY, realBody);
  put(".githooks/kinshi-finger", finger + "\n");
  put("a.txt", "ふつう\n");
  const b0 = commit2("b0");
  put("w.txt", "x\n" + WORD + "\n");
  const w1 = commit2("w1");
  const env2 = { ...process.env, KINSHI_JI_FILE: list };
  delete env2.KINSHI_JI;
  const gate = (from, to) =>
    spawnSync(process.execPath, [path.join(r2, GATE)], {
      cwd: r2,
      env: env2,
      encoding: "utf8",
      input: "refs/heads/main " + to + " refs/heads/main " + from + "\n",
    });
  const said = (s) => (s.stdout || "") + (s.stderr || "");
  T("本物の 門：押す 中身の 字で 止まる（作り物 repo・hook と 同じ 呼び方）", () => {
    const s = gate(b0, w1);
    must(
      s.status === 1 && said(s).includes(w1.slice(0, 7)),
      "字の 入った push が 通った: " + said(s)
    );
  });
  T("手元で 本体を 弱めても（commit せず）押す 頭の 本体で 止まる", () => {
    const weak =
      realBody.toString("utf8").replace("export function scan(", "function scanReal(") +
      "\nexport function scan() { return { hits: [], notes: [], reds: [], c: 0, passed: 0 }; }\n";
    must(weak.includes("function scanReal("), "弱める 置き換えが 当たらない（試しが 壊れている）");
    put(BODY, weak);
    const s = gate(b0, w1);
    put(BODY, realBody);
    must(s.status === 1 && said(s).includes(w1.slice(0, 7)), "手元の 弱い 本体で 緑: " + said(s));
  });
  T("手元の 門が 押す 頭の 物と 違えば 止まる・押す 頭に 本体が 無ければ 止まる", () => {
    const orig = fs.readFileSync(path.join(r2, GATE));
    put(GATE, Buffer.concat([orig, Buffer.from("// 手元だけ\n")]));
    const s = gate(b0, w1);
    put(GATE, orig);
    must(
      s.status === 1 && said(s).includes("手元の 門"),
      "手元の 門が 違うのに 通った: " + said(s)
    );
    g2("rm", "-q", BODY);
    const w2 = commit2("w2");
    const s2 = gate(w1, w2);
    must(s2.status === 1 && said(s2).includes("本体"), "本体の 無い 頭が 通った: " + said(s2));
    g2("reset", "-q", "--hard", w1);
    must(gate(b0, b0).status === 0, "何も 押さない（同じ sha）で 赤");
  });
  T("手元の 指紋の 紙を 違う 一覧に 合わせても、押す 頭の 紙で 止まる", () => {
    const list2 = path.join(tmp, "list2.txt");
    fs.writeFileSync(list2, ["別の", "ことば"].join("") + "\n");
    const f2 = K.loadWords({ env: {}, file: list2 }).finger;
    put(FINGER, f2 + "\n");
    const s = spawnSync(process.execPath, [path.join(r2, GATE)], {
      cwd: r2,
      env: { ...env2, KINSHI_JI_FILE: list2 },
      encoding: "utf8",
      input: "refs/heads/main " + w1 + " refs/heads/main " + b0 + "\n",
    });
    put(FINGER, finger + "\n");
    must(
      s.status === 1 && said(s).includes("指紋"),
      "手元の 指紋の 紙で 違う 一覧が 通った: " + said(s)
    );
  });
  T("自己確認を 床 未満に した 本体（字を 見ない）を 押すと 止まる", () => {
    const weak =
      "export * from " +
      JSON.stringify(pathToFileURL(path.join(path.dirname(SELF), "..", BODY)).href) +
      ";\n" +
      "export function scan() { return { hits: [], notes: [], reds: [], c: 0, passed: 0 }; }\n" +
      'if (process.argv.includes("--self-test")) { console.log("自己確認: 1/1"); console.log("確かめた 回数: 1"); }\n';
    put(BODY, weak);
    put("w9.txt", WORD + "\n");
    const wv = commit2("wv");
    const s = gate(w1, wv);
    must(s.status === 1 && said(s).includes("床"), "床 未満の 自己確認で 通った: " + said(s));
    /* 床の 境（数は FLOOR から 作る＝床を 上げても 試しが 古い 数に 残らない） */
    const F = FLOOR[BODY];
    const say = (g, n, c) => "自己確認: " + g + "/" + n + "\n確かめた 回数: " + c + "\n";
    must(selfOk(say(F.groups, F.groups, F.checks), F), "床 ちょうどが 赤");
    must(!selfOk(say(F.groups, F.groups, F.checks - 1), F), "回数 1 足りないのが 緑");
    must(!selfOk(say(F.groups - 1, F.groups, F.checks + 66), F), "1 組 落ちたのが 緑");
    must(
      !selfOk(say(F.groups - 1, F.groups - 1, F.checks + 66), F),
      "組の 数 だけ 床 未満（全部 通った）が 緑"
    );
    g2("reset", "-q", "--hard", w1);
  });
  T("門が 変わった push は 門の 自己確認を 床で 見る・一時 dir を 残さない", () => {
    const real = fs.readFileSync(path.join(r2, GATE), "utf8");
    /* 字を 2 つに 割る＝この 行 自身に 当たらない */
    const hook = 'if (process.argv.includes("--self-test")) process.exit(' + "selfTest());";
    must(real.split(hook).length === 2, "門の 自己確認の 口が 当たらない（試しが 壊れている）");
    /* 門の 自己確認を 床 未満（1/1）に 弱めた 門を commit して 押す＝自己確認を 回して 床で 赤（門の中で 門の 自己確認を 呼ぶと 入れ子が 終わらないので 弱めた 門で 見る） */
    put(
      GATE,
      real.replace(
        hook,
        'if (process.argv.includes("--self-test")) { console.log("自己確認: 1/1"); console.log("確かめた 回数: 1"); process.exit(0); }'
      )
    );
    const wg = commit2("wg");
    const s = gate(w1, wg);
    must(
      s.status === 1 && said(s).includes("門の 自己確認") && said(s).includes("床"),
      "弱めた 門の 自己確認で 通った: " + said(s)
    );
    g2("reset", "-q", "--hard", w1);
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ppk-body-")).length;
    put(BODY, "export const = ;\n");
    const wb = commit2("wb");
    const s2 = gate(w1, wb);
    must(s2.status !== 0, "構文エラーの 本体で 緑");
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("ppk-body-")).length;
    must(after <= before, "一時 dir が 残った（" + before + "→" + after + "）");
    g2("reset", "-q", "--hard", w1);
  });
  T("本物の 門：新しい 枝は hook の $2（実際に 押す 道）を 読む（pushurl で 取り違えない）", () => {
    const A = path.join(tmp, "A.git");
    const B = path.join(tmp, "B.git");
    execFileSync("git", ["init", "-q", "--bare", A], { stdio: "pipe" });
    execFileSync("git", ["init", "-q", "--bare", B], { stdio: "pipe" });
    g2("push", "-q", A, w1 + ":refs/heads/main");
    g2("remote", "add", "r", A);
    g2("remote", "set-url", "--push", "r", B);
    const s = spawnSync(process.execPath, [path.join(r2, GATE), "r", B], {
      cwd: r2,
      env: env2,
      encoding: "utf8",
      input: "refs/heads/x " + w1 + " refs/heads/x " + "0".repeat(40) + "\n",
    });
    must(
      s.status === 1 && said(s).includes(w1.slice(0, 7)),
      "押す 先（B）で なく fetch 側（A）を 読んで 緑: " + said(s)
    );
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("自己確認: " + pass + "/" + (pass + fail));
  console.log("確かめた 回数: " + checks);
  return fail ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (isMain) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const root = gitText(process.cwd(), "rev-parse", "--show-toplevel").trim();
  const lines = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  const b = bodyForPush(root, lines);
  if (b.err) {
    console.error("✗ 押すのを 止めた：" + b.err);
    process.exit(1);
  }
  /* 一時 dir は 赤・throw（取り出した 本体の 構文エラー 等）でも 消す（残った＝10-11 taiketsu 実測） */
  let code = 1;
  try {
    if (!b.bodyFile) code = 0; /* 消すだけの push＝見る commit が 無い */
    else {
      const KB = await import(pathToFileURL(b.bodyFile).href);
      const r = check({
        cwd: root,
        lines,
        fingerFile: b.fingerFile,
        K: KB,
        remote: process.argv[3] || process.argv[2],
      });
      for (const l of r.out) (r.code ? console.error : console.log)(l);
      code = r.code;
      const runs = [
        [r.selfNeeded, b.bodyFile, BODY, "見張りの 本体"],
        [r.gateNeeded, SELF, GATE, "門"],
      ];
      for (const [need, file, rel, name] of runs) {
        if (code || !need) continue;
        const s = spawnSync(process.execPath, [file, "--self-test"], { encoding: "utf8" });
        const ok = s.status === 0 && selfOk(s.stdout, FLOOR[rel]);
        const f = FLOOR[rel];
        console.log(
          ok
            ? "✓ " +
                name +
                "が 変わったので 自己確認も 回した（通った・床 " +
                f.groups +
                " 組・" +
                f.checks +
                " 回）"
            : "✗ " +
                name +
                "の 自己確認が 通らないか 床（" +
                f.groups +
                " 組・" +
                f.checks +
                " 回）未満"
        );
        if (!ok) code = 1;
      }
    }
  } finally {
    if (b.dir) fs.rmSync(b.dir, { recursive: true, force: true });
  }
  process.exit(code);
}
