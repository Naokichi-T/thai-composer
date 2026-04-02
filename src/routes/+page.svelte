<script>
  // Supabaseクライアントを読み込む
  import { supabase } from "$lib/supabase.js";
  import { onMount } from "svelte";

  // 追加する1行
  let allWords = $state([]);

  // 検索入力欄の値
  let query = $state("");

  // 検索結果を格納する配列
  let results = $state([]);

  // 検索中かどうかのフラグ（ローディング表示に使う）
  let loading = $state(false);

  // エラーメッセージ
  let errorMessage = $state("");

  // 入力欄のDOM要素への参照
  let inputEl = $state(null);

  // 作成エリアに追加された単語を格納する配列
  let composedWords = $state([]);

  // LocalStorageのキー名（保存・読み込みで共通して使う）
  const STORAGE_KEY = "thai-composer-saved";

  // 保存済みの文章リストを格納する配列
  let savedList = $state([]);

  /**
   * Supabaseから全単語を1000件ずつ取得してallWordsに格納する関数
   * Supabaseは1回のリクエストで最大1000件しか取得できないため
   * ページネーションでループしながら全件取得する
   */
  async function fetchAllWords() {
    loading = true;
    errorMessage = "";

    const batchSize = 1000;
    let from = 0;
    let allData = [];

    while (true) {
      const { data, error } = await supabase
        .from("words")
        .select("thai, reading, meaning, frequency, formality")
        // from〜toの範囲で取得（ページネーション）
        .range(from, from + batchSize - 1);

      if (error) {
        errorMessage = "データの読み込みに失敗しました。";
        console.error(error);
        loading = false;
        return;
      }

      // 取得したデータを蓄積する
      allData = [...allData, ...data];

      // 取得件数がbatchSize未満なら最後のページなのでループ終了
      if (data.length < batchSize) break;

      // 次のページへ
      from += batchSize;
    }

    allWords = allData;
    loading = false;
  }

  /**
   * タイ語の声調記号を除去して正規化する関数
   * 声調記号：่ ้ ๊ ๋ （Unicodeの特定範囲の文字）
   * これを除去することで「เก่า」と「เกา」を同じとみなせる
   */
  function removeToneMarks(str) {
    // タイ語の声調記号のUnicode範囲: \u0E48-\u0E4B
    return str.replace(/[\u0E48-\u0E4B]/g, "");
  }

  /**
   * サブシーケンス検索：inputの文字がtargetに順番通りに含まれるか判定する関数
   * 例: input="ขบค" target="ขอบคุณ" → true
   * 例: input="ขบค" target="กินข้าว" → false
   */
  function isSubsequence(input, target) {
    // 声調記号を除去してから比較する
    const normalizedInput = removeToneMarks(input);
    const normalizedTarget = removeToneMarks(target);

    // inputの何文字目まで一致したかを追跡するインデックス
    let inputIndex = 0;

    for (let i = 0; i < normalizedTarget.length; i++) {
      // targetの文字とinputの現在の文字が一致したら次のinputの文字へ進む
      if (normalizedTarget[i] === normalizedInput[inputIndex]) {
        inputIndex++;
      }
      // inputの全文字が見つかったらtrue
      if (inputIndex === normalizedInput.length) return true;
    }

    // 最後まで見つからなかったらfalse
    return false;
  }

  /**
   * queryを使ってallWordsをサブシーケンス検索する関数
   * 最大30件に絞ってresultsに格納する
   */
  function searchWords(q) {
    // 入力が空のときは結果をリセットして終了
    if (!q.trim()) {
      results = [];
      return;
    }

    // allWordsの中からサブシーケンス一致するものだけ抽出して最大30件にする
    results = allWords.filter((word) => isSubsequence(q, word.thai)).slice(0, 30);
  }

  /**
   * 候補をクリックしたときに作成エリアに単語を追加する関数
   * 追加後は入力欄をリセットして次の入力に備える
   */
  function selectWord(word) {
    composedWords = [...composedWords, word.thai];
    query = "";
    // DOMの更新が終わってから入力欄にフォーカスを戻す
    setTimeout(() => {
      inputEl?.focus();
    }, 0);
  }

  /**
   * LocalStorageから保存済みリストを読み込む関数
   * ページ表示時に呼び出す
   */
  function loadSavedList() {
    const raw = localStorage.getItem(STORAGE_KEY);
    // データがあればJSONをパースして配列に変換、なければ空配列
    savedList = raw ? JSON.parse(raw) : [];
  }

  /**
   * 保存済みリストをLocalStorageに書き込む関数
   * 保存・削除のたびに呼び出す
   */
  function persistSavedList() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedList));
  }

  /**
   * 作成エリアの内容をLocalStorageに保存する関数
   * 保存後は作成エリアをリセットする
   */
  function saveComposed() {
    // 作成エリアが空のときは何もしない
    if (composedWords.length === 0) return;

    // 作成エリアの内容を文字列にして保存リストの先頭に追加する
    savedList = [composedWords.join(""), ...savedList];
    persistSavedList();

    // 作成エリアをリセットする
    composedWords = [];
  }

  /**
   * 作成エリアをリセットする関数
   */
  function clearComposed() {
    composedWords = [];
  }

  /**
   * 保存済みリストから指定したインデックスの項目を削除する関数
   */
  function deleteSaved(index) {
    savedList = savedList.filter((_, i) => i !== index);
    persistSavedList();
  }

  /**
   * queryの変化を監視して自動で検索を実行する
   * $effect：Svelte5で値の変化を検知する仕組み
   */
  $effect(() => {
    searchWords(query);
  });

  // ページ表示時に全件取得を実行する
  onMount(() => {
    fetchAllWords();
    loadSavedList();
  });
</script>

<main>
  <h1>🔍 タイ語検索</h1>

  <!-- 作成エリア：選んだ単語が積み上がっていく場所 -->
  <div class="composer">
    <p class="composed-text">
      {#if composedWords.length === 0}
        <span class="placeholder">単語を選ぶとここに追加されます</span>
      {:else}
        {composedWords.join("")}
      {/if}
    </p>
    <!-- 保存・クリアボタン -->
    <div class="composer-actions">
      <button class="btn-save" onclick={saveComposed}>保存</button>
      <button class="btn-clear" onclick={clearComposed}>クリア</button>
    </div>
  </div>

  <!-- 検索入力欄 -->
  <div class="search-box">
    <input type="text" placeholder="タイ語を入力..." bind:value={query} bind:this={inputEl} />
  </div>

  <!-- ローディング表示 -->
  {#if loading}
    <p class="loading">検索中...</p>
  {/if}

  <!-- エラー表示 -->
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- 検索結果 -->
  <ul class="results">
    {#each results as word}
      <button class="result-item" onclick={() => selectWord(word)}>
        <span class="thai">{word.thai}</span>
        <span class="reading">{word.reading}</span>
        <span class="meaning">{word.meaning}</span>
      </button>
    {/each}
  </ul>

  <!-- 保存済み一覧 -->
  {#if savedList.length > 0}
    <div class="saved-list">
      <h2>保存済み</h2>
      {#each savedList as item, index}
        <div class="saved-item">
          <span class="saved-text">{item}</span>
          <button class="btn-delete" onclick={() => deleteSaved(index)}>削除</button>
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 600px;
    margin: 0 auto;
    padding: 24px 16px;
    font-family: sans-serif;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 16px;
  }

  .search-box input {
    width: 100%;
    padding: 10px 14px;
    font-size: 18px;
    border: 2px solid #ccc;
    border-radius: 8px;
    box-sizing: border-box;
  }

  .loading {
    color: #888;
    margin-top: 12px;
  }

  .error {
    color: red;
    margin-top: 12px;
  }

  .results {
    list-style: none;
    padding: 0;
    margin-top: 16px;
  }

  .result-item {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid #eee;
    padding: 12px;
    gap: 4px;
    text-align: left;
  }

  .thai {
    font-size: 22px;
    color: #2d2a4a;
  }

  .reading {
    font-size: 14px;
    color: #888;
  }

  .meaning {
    font-size: 16px;
    color: #333;
  }

  .composer {
    margin-bottom: 16px;
    padding: 12px;
    border: 2px solid #2d2a4a;
    border-radius: 8px;
    min-height: 60px;
  }

  .composed-text {
    font-size: 22px;
    color: #2d2a4a;
    margin: 0;
    word-break: break-all;
  }

  .placeholder {
    font-size: 14px;
    color: #aaa;
  }

  .composer-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .btn-save {
    padding: 6px 16px;
    background-color: #2d2a4a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-save:hover {
    background-color: #3d3a6a;
  }

  .btn-clear {
    padding: 6px 16px;
    background-color: #eee;
    color: #333;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-clear:hover {
    background-color: #ddd;
  }

  .saved-list {
    margin-top: 32px;
  }

  .saved-list h2 {
    font-size: 18px;
    margin-bottom: 12px;
    color: #333;
  }

  .saved-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid #eee;
    gap: 8px;
  }

  .saved-text {
    font-size: 20px;
    color: #2d2a4a;
    word-break: break-all;
  }

  .btn-delete {
    padding: 4px 12px;
    background-color: #fff;
    color: #999;
    border: 1px solid #ccc;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
  }

  .btn-delete:hover {
    background-color: #fee;
    color: #c00;
    border-color: #c00;
  }
</style>
