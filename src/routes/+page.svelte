<script>
  // Supabaseクライアントを読み込む
  import { supabase } from "$lib/supabase.js";
  import { onMount } from "svelte";
  import Fuse from "fuse.js";

  // 追加する1行
  let allWords = $state([]);

  // 検索入力欄の値
  let query = $state("");

  // 検索結果を格納する配列
  let results = $state([]);

  // キーボードで選択中の候補のインデックス（-1は未選択）
  let selectedIndex = $state(-1);

  // 検索中かどうかのフラグ（ローディング表示に使う）
  let loading = $state(false);

  // エラーメッセージ
  let errorMessage = $state("");

  // 入力欄のDOM要素への参照
  let inputEl = $state(null);

  // 作成エリア（textarea）のDOM要素への参照
  let composerEl = $state(null);

  // textareaのカーソル位置を記憶する変数（フォーカスが外れたときに保存する）
  let savedCursorPos = $state(null);

  // 作成エリアのテキスト（直接編集可能な文字列）
  let composedText = $state("");

  // LocalStorageのキー名（保存・読み込みで共通して使う）
  const STORAGE_KEY = "thai-composer-saved";

  // 保存済みの文章リストを格納する配列
  let savedList = $state([]);

  // 翻訳結果を格納する変数
  let translatedText = $state("");

  // 翻訳中かどうかのフラグ
  let translating = $state(false);

  // コピー完了メッセージを表示するボタンのkey（nullは非表示）
  let copiedKey = $state(null);

  // 現在選択中の検索モード
  // "thaiA"=タイ語A / "thaiB"=タイ語B（未実装）/ "reading"=読み方 / "japanese"=日本語
  let searchMode = $state("thaiA");

  // Fuse.jsのインスタンスを格納する変数（読み方検索に使う）
  let fuseReading = $state(null);

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
        .select("thai, reading, meaning, frequency, formality, thai_normalized, reading_normalized, no")
        .order("no", { ascending: true })
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

    // Fuse.jsのインスタンスを初期化する（読み方検索用）
    // reading_normalizedカラムを対象にファジー検索する
    fuseReading = new Fuse(allData, {
      // 検索対象のキー
      keys: ["reading_normalized"],
      // しきい値：0に近いほど厳密、1に近いほど曖昧（0.4くらいがちょうどいい）
      threshold: 0.4,
      // 検索結果にスコアを含める
      includeScore: true,
      // 文字列のどこにでもマッチする（前方一致でなくてもOK）
      ignoreLocation: true,
    });

    loading = false;
  }

  /**
   * 入力文字列をthai_normalizedと同じルールで正規化する関数
   * 声調記号の除去 ＋ 同音字の統一をする（母音記号は残す）
   */
  function normalizeInput(str) {
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
   * サブシーケンス検索：inputの正規化済み文字がtargetのthai_normalizedに
   * 順番通りに含まれるか判定する関数
   * 例: input="ครบ" target.thai_normalized="ครบ" → true
   */
  function isSubsequence(input, target) {
    // 入力側も同じルールで正規化する
    const normalizedInput = normalizeInput(input);
    const normalizedTarget = target.thai_normalized ?? "";

    let inputIndex = 0;

    for (let i = 0; i < normalizedTarget.length; i++) {
      if (normalizedTarget[i] === normalizedInput[inputIndex]) {
        inputIndex++;
      }
      if (inputIndex === normalizedInput.length) return true;
    }

    return false;
  }

  /**
   * queryを使ってallWordsをサブシーケンス検索する関数
   * 完全一致・前方一致・その他の順にスコアリングして並び替える
   * 最大30件に絞ってresultsに格納する
   */
  function searchWords(q) {
    if (!q.trim()) {
      results = [];
      selectedIndex = -1;
      return;
    }

    // 読み方モードの場合はFuse.jsでファジー検索する
    if (searchMode === "reading") {
      if (!fuseReading) return;
      // Fuse.jsで検索する（結果は { item, score } の配列）
      const fuseResults = fuseReading.search(q);
      // スコアの良い順に30件に絞る（Fuse.jsはデフォルトでスコア順）
      results = fuseResults.slice(0, 30).map((r) => r.item);
      selectedIndex = -1;
      return;
    }

    // 日本語モードの場合はmeaningカラムで部分一致検索する
    if (searchMode === "japanese") {
      results = allWords
        // meaningに入力文字列が含まれるものだけ抽出する
        .filter((word) => word.meaning?.includes(q))
        // 最大30件にする
        .slice(0, 30);
      selectedIndex = -1;
      return;
    }

    // 声調記号を除去した入力値（比較用）
    const normalizedQ = normalizeInput(q);

    /**
     * 単語のスコアを計算する関数
     */
    function getScore(word) {
      const normalizedThai = word.thai_normalized ?? "";
      // 声調記号ありで完全一致
      if (word.thai === q) return 4;
      // 正規化後に完全一致
      if (normalizedThai === normalizedQ) return 3;
      // 正規化後に前方一致
      if (normalizedThai.startsWith(normalizedQ)) return 2;
      // その他のサブシーケンス一致
      return 1;
    }

    // ▼ タイ語B：スコア優先＋文字数の近さ順で並べる（方法A）
    if (searchMode === "thaiB") {
      results = allWords
        .filter((word) => {
          const normalizedVariants = (word.thai_normalized ?? "").split(",");
          return normalizedVariants.some((variant) => isSubsequence(q, { ...word, thai_normalized: variant.trim() }));
        })
        .sort((a, b) => {
          // スコアの高い順に並べる
          const scoreDiff = getScore(b) - getScore(a);
          if (scoreDiff !== 0) return scoreDiff;
          // スコアが同じなら入力文字数との差が小さい順
          const aDiff = Math.abs(a.thai.length - q.length);
          const bDiff = Math.abs(b.thai.length - q.length);
          return aDiff - bDiff;
        })
        .slice(0, 30);
      selectedIndex = -1;
      return;
    }

    results = allWords

      // ▼ 変更後（カンマ区切りで複数の正規化形に対応）
      // thai_normalizedをカンマで分割して、どれか1つでもヒットすればOK
      // 例: "กุยแจ,กุนแจ" → どちらかにマッチすれば検索結果に出る
      .filter((word) => {
        // カンマで分割して複数の正規化形を配列にする（1つだけの場合も配列になる）
        const normalizedVariants = (word.thai_normalized ?? "").split(",");
        // いずれか1つにサブシーケンス一致すればtrueを返す
        return normalizedVariants.some((variant) => isSubsequence(q, { ...word, thai_normalized: variant.trim() }));
      })

      // ▼ 方法B：文字数の近さのみで並べる（スコアなし）
      .sort((a, b) => {
        const aDiff = Math.abs(a.thai.length - q.length);
        const bDiff = Math.abs(b.thai.length - q.length);
        if (aDiff !== bDiff) return aDiff - bDiff;
        return a.thai.length - b.thai.length;
      })
      // 最大30件にする
      .slice(0, 30);
  }

  /**
   * 候補をクリックしたときに作成エリアに単語を追加する関数
   * 追加後は入力欄をリセットして次の入力に備える
   */
  function selectWord(word) {
    // 記憶したカーソル位置、なければ末尾を挿入位置にする
    const pos = savedCursorPos ?? composedText.length;
    // カーソル位置に単語を挿入する
    composedText = composedText.slice(0, pos) + word.thai + composedText.slice(pos);
    // 次の挿入位置を挿入した単語の末尾に更新する
    savedCursorPos = pos + word.thai.length;
    query = "";
    selectedIndex = -1;
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
    if (!composedText.trim()) return;
    savedList = [composedText, ...savedList];
    persistSavedList();
    composedText = "";
  }

  /**
   * 作成エリアをリセットする関数
   */
  function clearComposed() {
    composedText = "";
    translatedText = "";
  }

  /**
   * 保存済みリストから指定したインデックスの項目を削除する関数
   */
  function deleteSaved(index) {
    savedList = savedList.filter((_, i) => i !== index);
    persistSavedList();
  }

  /**
   * 作成エリアのタイ語を日本語に翻訳する関数
   * /api/translate エンドポイントを経由してDeepL APIを呼び出す
   */
  async function translateComposed() {
    // 作成エリアが空のときは何もしない
    if (!composedText.trim()) return;
    translating = true;
    translatedText = "";
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: composedText }),
    });
    const data = await response.json();
    translating = false;
    if (data.error) {
      translatedText = "翻訳に失敗しました";
      return;
    }
    translatedText = data.translated;
  }

  /**
   * 指定したテキストをクリップボードにコピーする関数
   * コピー後は指定したkeyのボタンに「コピーしました」を2秒間表示する
   */
  async function copyText(text, key) {
    await navigator.clipboard.writeText(text);
    // コピー完了メッセージを表示する
    copiedKey = key;
    // 2秒後にメッセージを消す
    setTimeout(() => {
      copiedKey = null;
    }, 2000);
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
    // ページ表示時に入力欄にフォーカスを当てる
    inputEl?.focus();
  });
</script>

<main>
  <h1>タイ語コンポーザー</h1>

  <!-- 作成エリア：選んだ単語が積み上がっていく場所 -->
  <div class="composer">
    <!-- 作成エリア：直接編集可能なtextarea -->
    <textarea
      class="composed-text"
      placeholder="単語を選ぶとここに追加されます"
      bind:value={composedText}
      bind:this={composerEl}
      onblur={() => {
        // フォーカスが外れた瞬間にカーソル位置を記憶する
        savedCursorPos = composerEl?.selectionStart ?? null;
      }}
    ></textarea>
    <!-- 挿入位置の表示：savedCursorPosがあるときだけ表示 -->
    {#if savedCursorPos !== null}
      <p class="cursor-hint">挿入位置: {composedText.slice(0, savedCursorPos)}|</p>
    {/if}
    <div class="composer-actions">
      <button class="btn-save" onclick={saveComposed}>保存</button>
      <button class="btn-clear" onclick={clearComposed}>クリア</button>
      <button class="btn-translate" onclick={translateComposed}>翻訳</button>
      <button class="btn-copy" class:copied={copiedKey === "composer"} onclick={() => copyText(composedText, "composer")}>
        {copiedKey === "composer" ? "✅ コピーしました" : "コピー"}
      </button>
    </div>

    <!-- 翻訳結果 -->
    {#if translating}
      <p class="translated">翻訳中...</p>
    {:else if translatedText}
      <p class="translated">{translatedText}</p>
    {/if}
  </div>

  <!-- 検索入力欄 -->
  <div class="search-box">
    <input
      type="text"
      placeholder={searchMode === "thaiA" ? "タイ語を入力..." : searchMode === "thaiB" ? "タイ語を入力（B）..." : searchMode === "reading" ? "読み方を入力（例: sawasdii）..." : "日本語を入力..."}
      bind:value={query}
      bind:this={inputEl}
      onkeydown={(e) => {
        if (e.key === "Tab") {
          // Tabキー：ブラウザ本来のフォーカス移動をさせない
          e.preventDefault();
          // タブの順番リスト
          const modes = ["thaiA", "thaiB", "reading", "japanese"];
          const currentIndex = modes.indexOf(searchMode);
          if (e.shiftKey) {
            // Shift+Tab：前のモードに戻る（最初なら最後に戻る）
            searchMode = modes[(currentIndex - 1 + modes.length) % modes.length];
          } else {
            // Tab：次のモードに進む（最後なら最初に戻る）
            searchMode = modes[(currentIndex + 1) % modes.length];
          }
          // モード切り替え時に選択中の候補だけリセットする
          selectedIndex = -1;
        } else if (e.key === "ArrowDown") {
          // ↓キー：次の候補に移動（最後の候補を超えたら止まる）
          e.preventDefault();
          selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
        } else if (e.key === "ArrowUp") {
          // ↑キー：前の候補に移動（-1で未選択に戻る）
          e.preventDefault();
          selectedIndex = Math.max(selectedIndex - 1, -1);
        } else if (e.key === "Enter") {
          if (selectedIndex >= 0 && results[selectedIndex]) {
            // 候補が選択中ならその候補を確定する
            selectWord(results[selectedIndex]);
          } else if (query.length > 0) {
            // 未選択ならそのまま追加する
            composedWords = [...composedWords, query];
            query = "";
          }
        }
      }}
    />
    {#if query.length > 0}
      <button
        class="btn-clear-input"
        onclick={() => {
          // 入力欄をクリアしてフォーカスを戻す
          query = "";
          results = [];
          selectedIndex = -1;
          inputEl?.focus();
        }}>✕</button
      >
    {/if}
  </div>

  <!-- 検索モード切り替えタブ -->
  <div class="search-tabs">
    <button
      class="tab"
      class:active={searchMode === "thaiA"}
      onclick={() => {
        searchMode = "thaiA";
        query = "";
        results = [];
      }}>タイ語A</button
    >
    <button
      class="tab"
      class:active={searchMode === "thaiB"}
      onclick={() => {
        searchMode = "thaiB";
        query = "";
        results = [];
      }}>タイ語B</button
    >
    <button
      class="tab"
      class:active={searchMode === "reading"}
      onclick={() => {
        searchMode = "reading";
        query = "";
        results = [];
      }}>読み方</button
    >
    <button
      class="tab"
      class:active={searchMode === "japanese"}
      onclick={() => {
        searchMode = "japanese";
        query = "";
        results = [];
      }}>日本語</button
    >
  </div>

  <!-- 検索入力欄 -->

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
    {#each results as word, i}
      <button class="result-item" class:selected={i === selectedIndex} onclick={() => selectWord(word)}>
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
          <div class="saved-actions">
            <button class="btn-copy" class:copied={copiedKey === index} onclick={() => copyText(item, index)}>
              {copiedKey === index ? "✅ コピーしました" : "コピー"}
            </button>
            <button class="btn-delete" onclick={() => deleteSaved(index)}>削除</button>
          </div>
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

  /* 検索モード切り替えタブ */
  .search-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }

  .tab {
    flex: 1;
    padding: 6px 0;
    font-size: 13px;
    background: none;
    border: 1px solid #ccc;
    border-radius: 6px;
    cursor: pointer;
    color: #888;
  }

  /* アクティブなタブのスタイル */
  .tab.active {
    background-color: #2d2a4a;
    color: white;
    border-color: #2d2a4a;
  }
  /* 検索欄全体：inputと✕ボタンを横並びにする */
  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .search-box input {
    flex: 1; /* 残りの横幅をすべてinputに使う */
    padding: 10px 14px;
    font-size: 18px;
    border: 2px solid #ccc;
    border-radius: 8px;
    box-sizing: border-box;
  }

  /* ✕ボタン：目立たなくシンプルに */
  .btn-clear-input {
    background: none;
    border: none;
    color: #bbb;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    line-height: 1;
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

  .result-item.selected {
    background-color: #e8e7f0;
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

  /* 挿入位置のヒント表示 */
  .cursor-hint {
    font-size: 16px;
    color: #aaa;
    margin: 2px 0 0 0;
    word-break: break-all;
  }

  .composed-text {
    font-size: 22px;
    color: #2d2a4a;
    width: 100%;
    min-height: 60px;
    border: none;
    resize: none;
    outline: none;
    box-sizing: border-box;
    font-family: sans-serif;
    word-break: break-all;
    background: transparent;
  }

  /* textareaのplaceholderの色 */
  .composed-text::placeholder {
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

  .btn-translate {
    padding: 6px 16px;
    background-color: #fff;
    color: #2d2a4a;
    border: 1px solid #2d2a4a;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-translate:hover {
    background-color: #e8e7f0;
  }

  .btn-copy {
    padding: 6px 16px;
    background-color: #fff;
    color: #555;
    border: 1px solid #ccc;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-copy:hover {
    background-color: #f5f5f5;
  }

  /* コピー完了メッセージのフェードアウトアニメーション */
  @keyframes fadeOut {
    0% {
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .btn-copy.copied {
    animation: fadeOut 2s ease forwards;
    color: #2d2a4a;
    border-color: #2d2a4a;
  }

  .saved-actions {
    display: flex;
    gap: 8px;
  }

  .translated {
    margin-top: 8px;
    font-size: 16px;
    color: #555;
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
