# Auto-Version Workflow テストファイル

このファイルは `.github/workflows/auto-version.yml` の動作確認用です。

## 確認手順

このファイルをリポジトリにアップ（または何か変更してコミット）すると、
GitHub Actions の `Auto Update sw.js CACHE_NAME` ワークフローが起動します。

成功すると：
1. ワークフローが正常終了する
2. `sw.js` の `CACHE_NAME` が `daikome-{commitSHA}` の形に書き換わる
3. 新しいコミット `chore: auto-update CACHE_NAME to daikome-XXXXXXX [skip ci]` が自動追加される

確認後、このファイルは削除しても問題ありません。

---

作成日: 2026-04-29
目的: auto-version.yml ワークフロー動作確認
