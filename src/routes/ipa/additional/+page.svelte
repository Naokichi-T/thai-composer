<script>
  import { onMount } from "svelte";

  // --- 状態管理 ---
  let additionalTokens = $state([]); // 追加登録トークンの一覧（{ thai, ipa } の配列）
  let importMessage = $state(""); // インポート完了メッセージ

  // --- ページ表示時に LocalStorage から読み込む ---
  onMount(() => {
    const saved = localStorage.getItem("ipa_additional_tokens");
    if (saved) {
      additionalTokens = JSON.parse(saved);
    }
  });

  /**
   * 追加登録リストを LocalStorage に保存する関数
   * 解除・インポートのたびに呼ぶ
   */
  function saveAdditionalTokens() {
    localStorage.setItem("ipa_additional_tokens", JSON.stringify(additionalTokens));
  }

  /**
   * 指定したトークンを追加登録リストから解除する関数
   */
  function removeToken(thai) {
    // thai が一致するものを除いた新しい配列を作る
    additionalTokens = additionalTokens.filter((t) => t.thai !== thai);
    saveAdditionalTokens();
  }

  /**
   * 追加登録リストを CSV ファイルとしてダウンロードする関数
   * 1行1エントリ、タブ区切り（タイ語\tIPA）の形式で出力する
   */
  function exportCSV() {
    // タブ区切りで1行1エントリの CSV 文字列を作る
    const csvContent = additionalTokens.map((t) => `${t.thai}\t${t.ipa}`).join("\n");

    // ダウンロード用の a タグを一時的に作ってクリックする
    const blob = new Blob([csvContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ipa_additional.csv";
    a.click();

    // 使い終わった URL を解放する
    URL.revokeObjectURL(url);
  }

  /**
   * CSV ファイルを読み込んで追加登録リストに追加する関数
   * タブ区切り（タイ語\tIPA）の形式を想定する
   * すでに同じタイ語が登録済みの場合は重複して追加しない
   */
  function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // 1行1エントリとして読み込む（空行は除外する）
      const lines = e.target.result
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // タブで分割して { thai, ipa } のオブジェクトに変換する
      const entries = lines
        .map((l) => {
          const [thai, ipa] = l.split("\t");
          return thai && ipa ? { thai: thai.trim(), ipa: ipa.trim() } : null;
        })
        .filter((e) => e !== null); // 不正な行は除外する

      // すでに同じタイ語が登録済みのものは重複して追加しない
      const existingThais = new Set(additionalTokens.map((t) => t.thai));
      const newEntries = entries.filter((e) => !existingThais.has(e.thai));
      additionalTokens = [...additionalTokens, ...newEntries];
      saveAdditionalTokens();

      // インポート結果をメッセージで表示する
      importMessage = `✅ ${newEntries.length} 件追加しました（重複 ${entries.length - newEntries.length} 件スキップ）`;
      setTimeout(() => (importMessage = ""), 3000);

      // input をリセットして同じファイルを再度インポートできるようにする
      event.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  }
</script>

<svelte:head>
  <title>追加登録リスト管理</title>
</svelte:head>

<div class="container">
  <h1>追加登録リスト管理</h1>

  <!-- IPA変換ページに戻るリンク -->
  <a class="back-link" href="/ipa">← IPA変換に戻る</a>

  <!-- CSV操作ボタン -->
  <div class="csv-actions">
    <button class="btn-export" onclick={exportCSV}>CSV出力</button>

    <!-- CSVインポート：input[type=file] を hidden にしてボタンからクリックする -->
    <button class="btn-import" onclick={() => document.getElementById("csv-import").click()}>CSVインポート</button>
    <input id="csv-import" type="file" accept=".csv,.txt" style="display:none" onchange={importCSV} />
  </div>

  <!-- インポート結果メッセージ -->
  {#if importMessage}
    <p class="import-message">{importMessage}</p>
  {/if}

  <!-- 追加登録リスト一覧 -->
  {#if additionalTokens.length === 0}
    <p class="empty">登録なし</p>
  {:else}
    <p class="count">{additionalTokens.length} 件登録中</p>
    <table class="token-table">
      <thead>
        <tr>
          <th class="th-thai">タイ語</th>
          <th class="th-ipa">読み（IPA）</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each additionalTokens as token}
          <tr>
            <td class="token-cell-thai">{token.thai}</td>
            <td class="token-cell-ipa">{token.ipa}</td>
            <td class="action-cell">
              <button class="btn-remove" onclick={() => removeToken(token.thai)}>解除</button>
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

  .token-table th {
    text-align: left;
    font-size: 13px;
    color: #888;
    padding: 6px 8px;
    border-bottom: 1px solid #ddd;
  }

  .token-table tr {
    border-bottom: 1px solid #eee;
  }

  /* タイ語のセル */
  .token-cell-thai {
    padding: 10px 8px;
    font-size: 18px;
    font-family: "Sarabun", sans-serif;
    width: 40%;
  }

  /* IPAのセル */
  .token-cell-ipa {
    padding: 10px 8px;
    font-size: 16px;
    font-family: Arial, Helvetica, sans-serif;
    color: #555;
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
