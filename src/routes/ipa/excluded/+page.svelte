<script>
  import { onMount } from "svelte";

  // --- 状態管理 ---
  let excludedTokens = $state([]); // 除外トークンの一覧
  let importMessage = $state(""); // インポート完了メッセージ

  // --- ページ表示時に LocalStorage から読み込む ---
  onMount(() => {
    const saved = localStorage.getItem("ipa_excluded_tokens");
    if (saved) {
      excludedTokens = JSON.parse(saved);
    }
  });

  /**
   * 除外リストを LocalStorage に保存する関数
   * 解除・インポートのたびに呼ぶ
   */
  function saveExcludedTokens() {
    localStorage.setItem("ipa_excluded_tokens", JSON.stringify(excludedTokens));
  }

  /**
   * 指定したトークンを除外リストから解除する関数
   */
  function removeToken(token) {
    excludedTokens = excludedTokens.filter((t) => t !== token);
    saveExcludedTokens();
  }

  /**
   * 除外リストを CSV ファイルとしてダウンロードする関数
   * 1行1トークンの形式で出力する
   */
  function exportCSV() {
    // 1行1トークンの CSV 文字列を作る
    const csvContent = excludedTokens.join("\n");

    // ダウンロード用の a タグを一時的に作ってクリックする
    const blob = new Blob([csvContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ipa_excluded.csv";
    a.click();

    // 使い終わった URL を解放する
    URL.revokeObjectURL(url);
  }

  /**
   * CSV ファイルを読み込んで除外リストに追加する関数
   * すでに登録済みのトークンは重複して追加しない
   */
  function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // 1行1トークンとして読み込む（空行は除外する）
      const lines = e.target.result
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // すでに登録済みのトークンは重複して追加しない
      const newTokens = lines.filter((l) => !excludedTokens.includes(l));
      excludedTokens = [...excludedTokens, ...newTokens];
      saveExcludedTokens();

      // インポート結果をメッセージで表示する
      importMessage = `✅ ${newTokens.length} 件追加しました（重複 ${lines.length - newTokens.length} 件スキップ）`;
      setTimeout(() => (importMessage = ""), 3000);

      // input をリセットして同じファイルを再度インポートできるようにする
      event.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  }
</script>

<svelte:head>
  <title>除外リスト管理</title>
</svelte:head>

<div class="container">
  <h1>除外リスト管理</h1>

  <!-- IPA変換ページに戻るリンク -->
  <a class="back-link" href="/ipa">← IPA変換に戻る</a>

  <!-- CSV操作ボタン -->
  <div class="csv-actions">
    <button class="btn-export" onclick={exportCSV}>CSV出力</button>

    <!-- CSVインポート：input[type=file] を hidden にしてボタンからクリックする -->
    <button class="btn-import" onclick={() => document.getElementById("csv-import").click()}> CSVインポート </button>
    <input id="csv-import" type="file" accept=".csv,.txt" style="display:none" onchange={importCSV} />
  </div>

  <!-- インポート結果メッセージ -->
  {#if importMessage}
    <p class="import-message">{importMessage}</p>
  {/if}

  <!-- 除外リスト一覧 -->
  {#if excludedTokens.length === 0}
    <p class="empty">登録なし</p>
  {:else}
    <p class="count">{excludedTokens.length} 件登録中</p>
    <table class="token-table">
      <tbody>
        {#each excludedTokens as token}
          <tr>
            <td class="token-cell">{token}</td>
            <td class="action-cell">
              <button class="btn-remove" onclick={() => removeToken(token)}>解除</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 24px;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 12px;
  }

  /* 戻るリンク */
  .back-link {
    display: inline-block;
    font-size: 14px;
    color: #2d2a4a;
    text-decoration: none;
    margin-bottom: 20px;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  /* CSV操作ボタンの並び */
  .csv-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  /* CSV出力ボタン */
  .btn-export {
    padding: 8px 18px;
    font-size: 14px;
    background: #2d2a4a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-export:hover {
    opacity: 0.8;
  }

  /* CSVインポートボタン */
  .btn-import {
    padding: 8px 18px;
    font-size: 14px;
    background: #fff;
    color: #2d2a4a;
    border: 1px solid #2d2a4a;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-import:hover {
    background: #e8e7f0;
  }

  /* インポート結果メッセージ */
  .import-message {
    font-size: 13px;
    color: #555;
    margin-bottom: 12px;
  }

  /* 0件のときのメッセージ */
  .empty {
    color: #aaa;
    font-size: 15px;
    margin-top: 24px;
  }

  /* 件数表示 */
  .count {
    font-size: 14px;
    color: #888;
    margin-bottom: 8px;
  }

  /* 一覧テーブル */
  .token-table {
    width: 100%;
    border-collapse: collapse;
  }

  .token-table tr {
    border-bottom: 1px solid #eee;
  }

  /* トークン名のセル */
  .token-cell {
    padding: 10px 8px;
    font-size: 18px;
    font-family: "Sarabun", sans-serif;
  }

  /* 解除ボタンのセル */
  .action-cell {
    padding: 10px 8px;
    text-align: right;
  }

  /* 解除ボタン */
  .btn-remove {
    padding: 4px 12px;
    font-size: 13px;
    background: #fff;
    color: #c0392b;
    border: 1px solid #c0392b;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-remove:hover {
    background: #fdf0ef;
  }
</style>
