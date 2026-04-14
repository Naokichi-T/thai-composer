<script>
  import { onMount } from "svelte";
  import { supabase } from "$lib/supabase.js";

  // --- 状態管理 ---
  let excludedTokens = $state([]); // 除外トークンの一覧（{ id, token } の配列）
  let userId = $state(null); // ログイン中のユーザーID

  // --- ページ表示時に LocalStorage から読み込む ---
  onMount(async () => {
    // ログイン確認
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return;
    }
    userId = data.session.user.id;

    // ipa_excluded テーブルから除外トークンを取得する
    await fetchExcludedTokens();
  });

  /**
   * ipa_excluded テーブルから自分の除外トークンを取得する関数
   */
  async function fetchExcludedTokens() {
    const { data, error } = await supabase.from("ipa_excluded").select("id, token").order("created_at", { ascending: false });

    if (error) {
      console.error("除外リスト取得エラー:", error);
      return;
    }

    excludedTokens = data;
  }

  /**
   * 指定した id のトークンを ipa_excluded テーブルから削除する関数
   */
  async function removeToken(id) {
    const { error } = await supabase.from("ipa_excluded").delete().eq("id", id);

    if (error) {
      console.error("削除エラー:", error);
      return;
    }

    // 削除成功：一覧から該当行を除く
    excludedTokens = excludedTokens.filter((t) => t.id !== id);
  }
</script>

<svelte:head>
  <title>除外リスト管理</title>
</svelte:head>

<div class="container">
  <h1>除外リスト管理</h1>

  <!-- IPA変換ページに戻るリンク -->
  <a class="back-link" href="/ipa">← IPA変換に戻る</a>

  <!-- 除外リスト一覧 -->
  {#if excludedTokens.length === 0}
    <p class="empty">登録なし</p>
  {:else}
    <p class="count">{excludedTokens.length} 件登録中</p>
    <table class="token-table">
      <tbody>
        {#each excludedTokens as token}
          <tr>
            <td class="token-cell">{token.token}</td>
            <td class="action-cell">
              <button class="btn-remove" onclick={() => removeToken(token.id)}>解除</button>
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
