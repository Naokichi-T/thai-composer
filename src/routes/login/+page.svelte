<script>
  // Supabaseクライアントを読み込む
  import { supabase } from "$lib/supabase.js";

  // メールアドレスとパスワードの入力値
  let email = $state("");
  let password = $state("");

  // エラーメッセージ
  let errorMessage = $state("");

  // ログイン処理中フラグ
  let loading = $state(false);

  /**
   * ログインボタンを押したときの処理
   * Supabaseのメール＋パスワード認証を使う
   */
  async function handleLogin() {
    loading = true;
    errorMessage = "";

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // ログイン失敗：エラーメッセージを表示する
      errorMessage = "メールアドレスまたはパスワードが正しくありません";
      loading = false;
      return;
    }

    // ログイン成功：トップページに遷移する
    window.location.href = "/";
  }
</script>

<svelte:head>
  <title>ログイン</title>
</svelte:head>

<div class="container">
  <h1>ログイン</h1>

  <!-- メールアドレス入力欄 -->
  <div class="field">
    <label for="email">メールアドレス</label>
    <input id="email" type="email" bind:value={email} placeholder="example@email.com" />
  </div>

  <!-- パスワード入力欄 -->
  <div class="field">
    <label for="password">パスワード</label>
    <input id="password" type="password" bind:value={password} placeholder="パスワード" />
  </div>

  <!-- エラーメッセージ -->
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- ログインボタン -->
  <button class="btn-login" onclick={handleLogin} disabled={loading}>
    {loading ? "ログイン中..." : "ログイン"}
  </button>
</div>

<style>
  .container {
    max-width: 400px;
    margin: 80px auto;
    padding: 24px;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 24px;
  }

  /* 入力フィールドの行 */
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  label {
    font-size: 14px;
    color: #555;
  }

  input {
    padding: 10px 12px;
    font-size: 16px;
    border: 1px solid #ccc;
    border-radius: 8px;
  }

  /* エラーメッセージ */
  .error {
    color: #c0392b;
    font-size: 14px;
    margin-bottom: 12px;
  }

  /* ログインボタン */
  .btn-login {
    width: 100%;
    padding: 12px;
    font-size: 16px;
    background: #2d2a4a;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }

  .btn-login:hover {
    opacity: 0.8;
  }

  .btn-login:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
