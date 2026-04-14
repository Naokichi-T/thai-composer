<script>
  import { onMount } from "svelte";
  import { supabase } from "$lib/supabase.js";

  // --- 状態管理 ---
  let userWords = $state([]); // 登録済み単語の一覧
  let loading = $state(true); // 読み込み中フラグ
  let saving = $state(false); // 登録処理中フラグ
  let errorMessage = $state(""); // エラーメッセージ
  let successMessage = $state(""); // 登録完了メッセージ

  // --- 登録フォームの入力値 ---
  let inputThai = $state(""); // タイ語
  let inputReading = $state(""); // 読み
  let inputMeaning = $state(""); // 意味
  let inputUseForIpa = $state(true); // IPA変換に使うかどうか

  // ログイン中のユーザーIDを格納する変数
  let userId = $state(null);

  /**
   * thai_normalized を計算する関数
   * words テーブルと同じルールで正規化する
   * ① 声調記号を除去　② 同音字を統一
   */
  function normalizeThai(str) {
    // ① 声調記号のみ除去: ่ ้ ๊ ๋
    str = str.replace(/[่้๊๋]/g, "");

    // ② 同音字を統一
    const replacements = {
      ฎ: "ด",
      ฏ: "ต",
      ฐ: "ถ",
      ศ: "ส",
      ษ: "ส",
      ฆ: "ค",
      ฌ: "ช",
      ฑ: "ท",
      ฒ: "ท",
      ธ: "ท",
      ภ: "พ",
      ณ: "น",
      ญ: "ย",
      ฬ: "ล",
    };
    for (const [original, replacement] of Object.entries(replacements)) {
      str = str.replaceAll(original, replacement);
    }

    return str;
  }

  /**
   * reading_normalized を計算する関数
   * words テーブルと同じルールで正規化する
   */
  function normalizeReading(str) {
    // ① 母音の変音記号を基本文字に統一する
    str = str
      .replace(/[àâáǎ]/g, "a")
      .replace(/[ìîíǐ]/g, "i")
      .replace(/[ùûúǔ]/g, "u")
      .replace(/[èêéě]/g, "e")
      .replace(/[òôóǒ]/g, "o")
      .replace(/ə/g, "u") // ə → u（words テーブルの実データに合わせる）
      .replace(/ɛ/g, "e")
      .replace(/ɔ/g, "o")
      .replace(/ʉ/g, "u")
      .replace(/ŋ/g, "ng");

    // ② 残った声調記号を除去する（U+0300〜U+030C）
    str = str.replace(/[\u0300-\u030C]/g, "");

    return str;
  }

  /**
   * ページ表示時にユーザー確認と単語一覧の取得を行う関数
   */
  onMount(async () => {
    // ログイン確認
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = "/login";
      return;
    }
    userId = data.session.user.id;

    // 単語一覧を取得する
    await fetchUserWords();
  });

  /**
   * user_words テーブルから自分の登録単語を取得する関数
   * 登録日時の新しい順に並べる
   */
  async function fetchUserWords() {
    loading = true;
    const { data, error } = await supabase.from("user_words").select("*").order("created_at", { ascending: false });

    if (error) {
      errorMessage = "データの取得に失敗しました";
      loading = false;
      return;
    }

    userWords = data;
    loading = false;
  }

  /**
   * 登録ボタンを押したときの処理
   * thai_normalized・reading_normalized を自動計算してから保存する
   */
  async function handleAdd() {
    // タイ語が空のときは何もしない
    if (!inputThai.trim()) return;

    saving = true;
    errorMessage = "";

    // 正規化を自動計算する
    const thaiNormalized = normalizeThai(inputThai.trim());
    const readingNormalized = normalizeReading(inputReading.trim());

    const { error } = await supabase.from("user_words").insert({
      user_id: userId,
      thai: inputThai.trim(),
      thai_normalized: thaiNormalized,
      reading: inputReading.trim(),
      reading_normalized: readingNormalized,
      meaning: inputMeaning.trim(),
      use_for_ipa: inputUseForIpa,
    });

    if (error) {
      errorMessage = "登録に失敗しました";
      saving = false;
      return;
    }

    // 登録成功：フォームをリセットして一覧を再取得する
    inputThai = "";
    inputReading = "";
    inputMeaning = "";
    inputUseForIpa = true;

    successMessage = "✅ 登録しました";
    setTimeout(() => (successMessage = ""), 2000);

    await fetchUserWords();
    saving = false;
  }

  /**
   * 解除ボタンを押したときの処理
   * 指定した id の行を user_words テーブルから削除する
   */
  async function handleDelete(id) {
    const { error } = await supabase.from("user_words").delete().eq("id", id);

    if (error) {
      errorMessage = "削除に失敗しました";
      return;
    }

    // 削除成功：一覧から該当行を除く
    userWords = userWords.filter((w) => w.id !== id);
  }

  /**
   * ログアウトボタンを押したときの処理
   */
  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
</script>

<svelte:head>
  <title>単語登録</title>
</svelte:head>

<div class="container">
  <!-- ヘッダー：タイトルとログアウトボタンを横並びにする -->
  <div class="header">
    <h1>単語登録</h1>
    <button class="btn-logout" onclick={handleLogout}>ログアウト</button>
  </div>

  <!-- 登録フォーム -->
  <div class="form">
    <!-- タイ語入力欄 -->
    <div class="field">
      <label for="thai">タイ語 *</label>
      <input id="thai" type="text" bind:value={inputThai} placeholder="例：มิสคอล" class="input-thai" />
    </div>

    <!-- 読み入力欄 -->
    <div class="field">
      <label for="reading">読み</label>
      <input id="reading" type="text" bind:value={inputReading} placeholder="例：mískhɔɔn" />
    </div>

    <!-- 意味入力欄 -->
    <div class="field">
      <label for="meaning">意味</label>
      <input id="meaning" type="text" bind:value={inputMeaning} placeholder="例：不在着信" />
    </div>

    <!-- IPA変換に使うかどうかのチェックボックス -->
    <div class="field-check">
      <input id="use-for-ipa" type="checkbox" bind:checked={inputUseForIpa} />
      <label for="use-for-ipa">IPA変換に使う</label>
    </div>

    <!-- エラー・完了メッセージ -->
    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    {#if successMessage}
      <p class="success">{successMessage}</p>
    {/if}

    <!-- 登録ボタン -->
    <button class="btn-add" onclick={handleAdd} disabled={saving || !inputThai.trim()}>
      {saving ? "登録中..." : "登録"}
    </button>
  </div>

  <!-- 登録済み一覧 -->
  <div class="list-section">
    <h2>登録済み（{userWords.length}件）</h2>

    {#if loading}
      <p class="loading">読み込み中...</p>
    {:else if userWords.length === 0}
      <p class="empty">登録なし</p>
    {:else}
      <table class="word-table">
        <thead>
          <tr>
            <th class="th-thai">タイ語</th>
            <th class="th-reading">読み</th>
            <th class="th-meaning">意味</th>
            <th class="th-ipa">IPA</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each userWords as word}
            <tr>
              <td class="td-thai">{word.thai}</td>
              <td class="td-reading">{word.reading ?? ""}</td>
              <td class="td-meaning">{word.meaning ?? ""}</td>
              <!-- IPA変換に使うかどうかを ✓ / - で表示する -->
              <td class="td-ipa">{word.use_for_ipa ? "✓" : "-"}</td>
              <td class="td-action">
                <button class="btn-delete" onclick={() => handleDelete(word.id)}> 削除 </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px;
  }

  /* ヘッダー：タイトルとログアウトボタンを横並びにする */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .header h1 {
    margin: 0;
    font-size: 24px;
  }

  /* ログアウトボタン */
  .btn-logout {
    padding: 4px 12px;
    font-size: 13px;
    background: #fff;
    color: #999;
    border: 1px solid #ccc;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-logout:hover {
    color: #c00;
    border-color: #c00;
  }

  /* 登録フォーム */
  .form {
    padding: 16px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fafafa;
    margin-bottom: 32px;
  }

  /* 入力フィールドの行 */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  label {
    font-size: 13px;
    color: #555;
  }

  input[type="text"] {
    padding: 8px 10px;
    font-size: 15px;
    border: 1px solid #ccc;
    border-radius: 6px;
  }

  /* タイ語入力欄はSarabunフォントを使う */
  .input-thai {
    font-family: "Sarabun", sans-serif;
    font-size: 18px;
  }

  /* チェックボックスの行 */
  .field-check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .field-check label {
    font-size: 14px;
    color: #333;
    cursor: pointer;
  }

  /* エラーメッセージ */
  .error {
    color: #c0392b;
    font-size: 13px;
    margin-bottom: 8px;
  }

  /* 完了メッセージ */
  .success {
    color: #27ae60;
    font-size: 13px;
    margin-bottom: 8px;
  }

  /* 登録ボタン */
  .btn-add {
    padding: 8px 24px;
    font-size: 15px;
    background: #2d2a4a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-add:hover {
    opacity: 0.8;
  }

  .btn-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 登録済み一覧のセクション */
  .list-section h2 {
    font-size: 16px;
    margin-bottom: 12px;
    color: #333;
  }

  .loading {
    color: #888;
  }

  .empty {
    color: #aaa;
    font-size: 15px;
  }

  /* 一覧テーブル */
  .word-table {
    width: 100%;
    border-collapse: collapse;
  }

  .word-table th {
    text-align: left;
    font-size: 13px;
    color: #888;
    padding: 6px 8px;
    border-bottom: 1px solid #ddd;
  }

  .word-table tr {
    border-bottom: 1px solid #eee;
  }

  /* タイ語のセル */
  .td-thai {
    padding: 10px 8px;
    font-size: 18px;
    font-family: "Sarabun", sans-serif;
    width: 25%;
  }

  /* 読みのセル */
  .td-reading {
    padding: 10px 8px;
    font-size: 14px;
    color: #555;
    width: 25%;
  }

  /* 意味のセル */
  .td-meaning {
    padding: 10px 8px;
    font-size: 14px;
    color: #333;
  }

  /* IPA使用フラグのセル */
  .td-ipa {
    padding: 10px 8px;
    font-size: 14px;
    color: #888;
    text-align: center;
    width: 60px;
  }

  /* 削除ボタンのセル */
  .td-action {
    padding: 10px 8px;
    text-align: right;
    white-space: nowrap;
  }

  /* 削除ボタン */
  .btn-delete {
    padding: 4px 12px;
    font-size: 13px;
    background: #fff;
    color: #c0392b;
    border: 1px solid #c0392b;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-delete:hover {
    background: #fdf0ef;
  }
</style>
