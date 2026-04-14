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

  // 検索結果の表示モード（onMountで復元する、初期値は"list"）
  let resultViewMode = $state("list");

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

  // リアルタイム翻訳（Google翻訳）の結果を格納する変数
  let realtimeTranslation = $state("");

  // デバウンス用のタイマーIDを格納する変数
  // clearTimeout()で前のタイマーをリセットするために使う
  let realtimeTimer = null;

  // コピー完了メッセージを表示するボタンのkey（nullは非表示）
  let copiedKey = $state(null);

  // 現在選択中の検索モード（onMountで復元する、初期値は"thai"）
  // "thai"=タイ語 / "reading"=読み方 / "japanese"=日本語
  let searchMode = $state("thai");

  // Fuse.jsのインスタンスを格納する変数（読み方検索に使う）
  let fuseReading = $state(null);

  // onMount完了後かどうかのフラグ（初期化前の$effectの誤保存を防ぐ）
  let mounted = $state(false);

  // autoDetectMode用：1つ前のqueryの値を記憶する変数
  let prevQuery = $state("");

  // スマホ（タッチ対応デバイス）かどうかのフラグ
  // onMount後に設定するため、初期値はfalse
  let isMobile = $state(false);

  // 作成エリアの操作履歴を格納する配列（Ctrl+Zで戻るために使う）
  // 末尾が最新の状態。Ctrl+Zを押すたびに末尾から取り出す
  let undoStack = $state([]);

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
        // .select("thai, reading, meaning, frequency, formality, reading_normalized, phonemic_normalized, no, url_no")
        .select("thai, reading, meaning, frequency, formality, thai_normalized, reading_normalized, phonemic_normalized, no, url_no")
        .order("frequency", { ascending: false }) // 頻出度の降順
        .order("url_no", { ascending: true }) // 同じ頻出度の中はurl_noの昇順
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

    // ログイン済みの場合は user_words も取得して先頭に追加する
    const { data: session } = await supabase.auth.getSession();
    if (session.session) {
      const { data: userWordsData, error: userWordsError } = await supabase
        .from("user_words")
        .select("thai, reading, meaning, thai_normalized, reading_normalized, phonemic_normalized")
        .order("created_at", { ascending: false });
      if (userWordsData && userWordsData.length > 0) {
        // user_words を allWords の先頭に追加する
        // no と url_no は user_words にないので null にする
        allData = [...userWordsData, ...allData];
      }
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
  // function isSubsequence(input, target) {
  //   // 入力側も同じルールで正規化する
  //   const normalizedInput = normalizeInput(input);
  //   const normalizedTarget = target.thai_normalized ?? "";

  //   let inputIndex = 0;

  //   for (let i = 0; i < normalizedTarget.length; i++) {
  //     if (normalizedTarget[i] === normalizedInput[inputIndex]) {
  //       inputIndex++;
  //     }
  //     if (inputIndex === normalizedInput.length) return true;
  //   }

  //   return false;
  // }

  function isSubsequence(input, target) {
    let inputIndex = 0;
    for (let i = 0; i < target.length; i++) {
      if (target[i] === input[inputIndex]) inputIndex++;
      if (inputIndex === input.length) return true;
    }
    return false;
  }

  /**
   * 入力文字の種類を判定して検索モードを自動で切り替える関数
   * queryが空→1文字になった瞬間だけ動く（2文字目以降は判定しない）
   * タイ文字 → "thai" / アルファベット → "reading" / 日本語 → "japanese"
   */
  function autoDetectMode(q, prevQ) {
    // 空→1文字になった瞬間だけ判定する（それ以外は何もしない）
    if (prevQ.length !== 0 || q.length !== 1) return;
    // タイ文字のUnicode範囲（\u0E00〜\u0E7F）に含まれるか
    if (/[\u0E00-\u0E7F]/.test(q)) {
      searchMode = "thai";
      // 日本語（ひらがな・カタカナ・漢字）に含まれるか
    } else if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(q)) {
      searchMode = "japanese";
      // アルファベットに含まれるか
    } else if (/[a-zA-Z]/.test(q)) {
      searchMode = "reading";
    }
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

      /**
       * 読み方検索用のスコアを計算する関数
       * 完全一致・前方一致を優先してFuse.jsのスコアを上書きする
       */
      function getReadingScore(normalized) {
        // 完全一致
        if (normalized === q) return 4;
        // 前方一致
        if (normalized.startsWith(q)) return 3;
        // 部分一致（qがnormalizedに含まれる）
        if (normalized.includes(q)) return 2;
        // その他（Fuse.jsのファジーマッチ）
        return 1;
      }

      results = fuseResults
        .map((r) => ({
          item: r.item,
          // Fuse.jsのスコア（0が完全一致、1が最悪）を反転して加算する
          score: getReadingScore(r.item.reading_normalized ?? "") + (1 - (r.score ?? 1)),
        }))
        // スコアの高い順に並び替える
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map((r) => r.item);

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

    results = allWords

      // .filter((word) => {
      //   const thaiHit = isSubsequence(q, word.thai ?? "");
      //   const phonemicHit = isSubsequence(q, word.phonemic_normalized ?? "");
      //   return thaiHit || phonemicHit;
      // })

      .filter((word) => {
        const thaiHit = isSubsequence(q, word.thai ?? "");
        const phonemicHit = isSubsequence(q, word.phonemic_normalized ?? "");
        const thaiNormalizedHit = isSubsequence(q, word.thai_normalized ?? "");
        return thaiHit || phonemicHit || thaiNormalizedHit;
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
    // 単語を選択する前に現在の状態を履歴に積む
    undoStack = [...undoStack, composedText];

    const pos = savedCursorPos ?? composedText.length;
    composedText = composedText.slice(0, pos) + word.thai + composedText.slice(pos);
    savedCursorPos = composedText.length;
    query = "";
    selectedIndex = -1;
    setTimeout(() => {
      inputEl?.focus();
      // 単語を挿入したあとに作成エリアを末尾までスクロールする
      if (composerEl) composerEl.scrollTop = composerEl.scrollHeight;
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
    undoStack = [composedText];
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
   * Google翻訳の非公式APIを使ってリアルタイム翻訳する関数
   * DeepLより品質は落ちるが無料で使える
   * composedTextが変わるたびに自動で呼び出される
   */
  async function translateRealtime(text) {
    // Google翻訳の非公式API URL
    // sl=th（タイ語）、tl=ja（日本語）、q=翻訳するテキスト
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=ja&dt=t&q=${encodeURIComponent(text)}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      // レスポンスの構造：data[0] が翻訳結果の配列
      // data[0][0][0] が翻訳されたテキスト
      realtimeTranslation = data[0].map((item) => item[0]).join("");
    } catch (e) {
      // エラーが起きても何も表示しない（参考訳なので）
      realtimeTranslation = "";
    }
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
    // 入力文字の種類に応じて検索モードを自動切り替えする
    autoDetectMode(query, prevQuery);
    // 今のqueryを次回のために記憶しておく
    prevQuery = query;
    searchWords(query);
  });

  // composedTextが変わったらDeepL訳をリセットして、0.5秒後にGoogle翻訳する
  $effect(() => {
    const text = composedText;

    // DeepL訳はリセットする
    translatedText = "";

    // 前のタイマーをリセットする（連続入力時に翻訳が何度も走らないようにする）
    clearTimeout(realtimeTimer);

    // テキストが空なら参考訳もリセットして終了する
    if (!text.trim()) {
      realtimeTranslation = "";
      return;
    }

    // 0.5秒後にGoogle翻訳を実行する
    realtimeTimer = setTimeout(() => {
      translateRealtime(text);
    }, 500);
  });

  // searchModeが変わったらLocalStorageに保存する（mount後のみ）
  $effect(() => {
    if (!mounted) return;
    localStorage.setItem("searchMode", searchMode);
  });

  // resultViewModeが変わったらLocalStorageに保存する（mount後のみ）
  $effect(() => {
    if (!mounted) return;
    localStorage.setItem("resultViewMode", resultViewMode);
  });

  // ページ表示時に全件取得を実行する
  onMount(() => {
    fetchAllWords();
    loadSavedList();

    // 別タブから戻ってきたときに user_words を再取得する
    async function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        await fetchAllWords();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // LocalStorageから設定を復元する
    searchMode = localStorage.getItem("searchMode") ?? "thai";
    resultViewMode = localStorage.getItem("resultViewMode") ?? "list";
    // ページ表示時に入力欄にフォーカスを当てる
    inputEl?.focus();
    // 初期化完了フラグを立てる
    mounted = true;

    // ★ 追加：Ctrl+Z（またはMacのCmd+Z）でアンドゥする
    // document全体にイベントを登録することで、どこにフォーカスがあっても動く
    function handleUndo(e) {
      // Ctrl+Z（Windows）またはCmd+Z（Mac）のとき
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        // 履歴がなければ何もしない
        if (undoStack.length === 0) return;

        // ★ ブラウザのデフォルトのCtrl+Z動作を止める
        e.preventDefault();

        // 末尾（最新の履歴）を取り出してcomposedTextに戻す
        const prev = undoStack[undoStack.length - 1];
        // 末尾を除いた配列を新しいスタックにする
        undoStack = undoStack.slice(0, -1);
        composedText = prev;
      }
    }

    document.addEventListener("keydown", handleUndo);

    // スマホ判定してフラグを立てる
    // 'ontouchstart' in window：タッチ操作に対応しているデバイスかどうか
    isMobile = "ontouchstart" in window;

    if (isMobile) {
      window.addEventListener(
        "scroll",
        () => {
          document.activeElement?.blur();
        },
        { passive: true },
      );
    }

    // ページを離れるときにイベントリスナーを解除する（メモリリーク防止）
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });
</script>

<svelte:head>
  <title>コンポーザー</title>
</svelte:head>
<main>
  <div class="header">
    <h1>タイ語コンポーザー</h1>
    <div class="header-links">
      <a class="ipa-link" href="/ipa" target="_blank" rel="noreferrer">IPA変換</a>
      <a class="ipa-link" href="/words" target="_blank" rel="noreferrer">単語登録</a>
    </div>
  </div>

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
      <!-- 末尾30文字だけ表示する。30文字より長い場合は先頭に...をつける -->
      <p class="cursor-hint">
        {#if composedText.slice(0, savedCursorPos).length > 30}
          挿入位置: ...{composedText.slice(savedCursorPos - 30, savedCursorPos)}|
        {:else}
          挿入位置: {composedText.slice(0, savedCursorPos)}|
        {/if}
      </p>
    {/if}
    <div class="composer-actions">
      <button class="btn-save" tabindex="-1" onclick={saveComposed}>保存</button>
      <button class="btn-clear" tabindex="-1" onclick={clearComposed}>クリア</button>
      <button class="btn-translate" tabindex="-1" onclick={translateComposed}>翻訳</button>
      <button class="btn-copy" tabindex="-1" class:copied={copiedKey === "composer"} onclick={() => copyText(composedText, "composer")}>
        {copiedKey === "composer" ? "✅ コピーしました" : "コピー"}
      </button>
    </div>

    <!-- 翻訳結果 -->
    {#if translating}
      <!-- DeepL翻訳中 -->
      <p class="translated">翻訳中...</p>
    {:else if translatedText}
      <!-- DeepL訳：「翻訳」ボタンを押したときだけ表示 -->
      <p class="translated">{translatedText}</p>
    {:else if realtimeTranslation}
      <!-- 参考訳：Google翻訳によるリアルタイム翻訳 -->
      <p class="translated realtime">{realtimeTranslation}</p>
    {/if}
  </div>

  <!-- 検索入力欄 -->
  <div class="search-box">
    <input
      type="text"
      placeholder={searchMode === "thai" ? "タイ語を入力..." : searchMode === "reading" ? "読み方を入力..." : "日本語を入力..."}
      bind:value={query}
      bind:this={inputEl}
      onkeydown={(e) => {
        // IME変換中（日本語入力の確定前）はすべてのキー操作を無視する
        if (e.isComposing) return;
        if (e.key === "ArrowLeft") {
          // ←キー：前のモードに戻る（最初なら最後に戻る）
          e.preventDefault();
          const modes = ["thai", "reading", "japanese"];
          const currentIndex = modes.indexOf(searchMode);
          searchMode = modes[(currentIndex - 1 + modes.length) % modes.length];
          selectedIndex = -1;
        } else if (e.key === "ArrowRight") {
          // →キー：次のモードに進む（最後なら最初に戻る）
          e.preventDefault();
          const modes = ["thai", "reading", "japanese"];
          const currentIndex = modes.indexOf(searchMode);
          searchMode = modes[(currentIndex + 1) % modes.length];
          selectedIndex = -1;
        } else if (((e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown") && results.length > 0) {
          // Tab または ↓キー：次の候補に移動（最後の候補を超えたら止まる）
          e.preventDefault(); // ページのフォーカス移動 / スクロールを止める
          selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
        } else if (((e.key === "Tab" && e.shiftKey) || e.key === "ArrowUp") && results.length > 0) {
          // Shift+Tab または ↑キー：前の候補に移動（-1で未選択に戻る）
          e.preventDefault(); // ページのフォーカス移動 / スクロールを止める
          selectedIndex = Math.max(selectedIndex - 1, -1);
        } else if (e.key === "Enter") {
          if (selectedIndex >= 0 && results[selectedIndex]) {
            selectWord(results[selectedIndex]);
          } else if (query.length > 0) {
            // ★Enterで直接追加する前に履歴を積む
            undoStack = [...undoStack, composedText];
            const pos = savedCursorPos ?? composedText.length;
            composedText = composedText.slice(0, pos) + query + composedText.slice(pos);
            savedCursorPos = pos + query.length;
            query = "";
            // ✅ 追加：Enterキーで直接追加したあとも末尾までスクロールする
            setTimeout(() => {
              if (composerEl) composerEl.scrollTop = composerEl.scrollHeight;
            }, 0);
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
      class:active={searchMode === "thai"}
      onclick={() => {
        searchMode = "thai";
      }}>タイ語</button
    >
    <button
      class="tab"
      class:active={searchMode === "reading"}
      onclick={() => {
        searchMode = "reading";
      }}>読み方</button
    >
    <button
      class="tab"
      class:active={searchMode === "japanese"}
      onclick={() => {
        searchMode = "japanese";
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
  <!-- 検索結果 -->
  <div class="results-header">
    <span class="results-count">{results.length > 0 ? `${results.length}件` : ""}</span>
    {#if results.length > 0}
      <button
        class="btn-view-toggle"
        onclick={() => {
          resultViewMode = resultViewMode === "list" ? "compact" : "list";
        }}>{resultViewMode === "list" ? "コンパクト" : "一覧"}</button
      >
    {/if}
  </div>

  {#if resultViewMode === "list"}
    <!-- 縦一覧表示 -->
    <ul class="results">
      {#each results as word, i}
        <button class="result-item" class:selected={i === selectedIndex} class:exact={word.thai === query} onclick={() => selectWord(word)}>
          <span class="thai">{word.thai}</span>
          <span class="reading">{word.reading}</span>
          <span class="meaning">{word.meaning}</span>
        </button>
      {/each}
    </ul>
  {:else}
    <!-- 横並びコンパクト表示 -->
    <ul class="results-compact">
      {#each results as word, i}
        <button class="result-item-compact" class:selected={i === selectedIndex} class:exact={word.thai === query} onclick={() => selectWord(word)}>
          <span class="thai">{word.thai}</span>
          <span class="reading">{word.reading}</span>
          <span class="meaning">{word.meaning}</span>
        </button>
      {/each}
    </ul>
  {/if}

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

  <!-- スマホ用：右下固定ボタン（最上部に戻る＋キーボードを開く） -->
  {#if isMobile}
    <button
      class="btn-scroll-top"
      onclick={() => {
        // behavior: 'instant' = アニメーションなしで即座に最上部へ移動する
        window.scrollTo({ top: 0, behavior: "instant" });
        // スクロールが終わるのを待ってからinputにフォーカスする
        // （すぐfocusするとキーボードが出なかったり消えたりする）
        setTimeout(() => {
          inputEl?.focus();
        }, 400);
      }}>↑</button
    >
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
    font-size: 18px;
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

  /* 検索結果ヘッダー：件数とトグルボタンを横並びに */
  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
  }

  .results-count {
    font-size: 12px;
    color: #aaa;
  }

  /* 表示切り替えボタン */
  .btn-view-toggle {
    background: none;
    border: none;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    padding: 2px 6px;
    text-decoration: underline;
  }

  /* コンパクト表示：横並びにする */
  .results-compact {
    list-style: none;
    padding: 0;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result-item-compact {
    cursor: pointer;
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid #eee;
    padding: 8px;
    text-align: left;
  }

  .result-item-compact.selected {
    background-color: #e8e7f0;
  }

  .result-item-compact .thai {
    font-size: 18px;
    color: #2d2a4a;
    white-space: nowrap;
  }

  .result-item-compact .reading {
    font-size: 12px;
    color: #888;
    white-space: nowrap;
  }

  .result-item-compact .meaning {
    font-size: 13px;
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .result-item.exact .thai,
  .result-item-compact.exact .thai {
    color: #c0392b;
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
    height: 80px; /* 約3行分の高さに固定する */
    border: none;
    resize: none;
    outline: none;
    box-sizing: border-box;
    font-family: sans-serif;
    word-break: normal; /* ★ 単語の区切りでだけ改行する */
    background: transparent;
    overflow-y: auto; /* 縦方向にはみ出たらスクロールできるようにする */
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

  /* 参考訳：Google翻訳の結果をグレーで表示する */
  .translated.realtime {
    color: #aaa;
    font-size: 14px;
  }

  .saved-list {
    margin-top: 32px;
  }

  .saved-list h2 {
    font-size: 14px;
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

  /* スマホ用：右下固定ボタン */
  .btn-scroll-top {
    /* 画面に固定して常に表示する */
    position: fixed;
    /* 右下に配置 */
    bottom: 24px;
    right: 24px;
    /* 見た目 */
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background-color: #2d2a4a;
    color: white;
    font-size: 20px;
    border: none;
    cursor: pointer;
    /* 他の要素より手前に表示する */
    z-index: 100;
    /* 影をつけて浮いているように見せる */
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* ヘッダー：タイトルとリンクを横並びにする */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .header h1 {
    margin: 0;
  }

  /* IPA変換リンク */
  .ipa-link {
    font-size: 14px;
    color: #2d2a4a;
    text-decoration: none;
    border: 1px solid #2d2a4a;
    border-radius: 6px;
    padding: 4px 12px;
  }

  .ipa-link:hover {
    background-color: #e8e7f0;
  }

  /* ヘッダーのリンクを横並びにする */
  .header-links {
    display: flex;
    gap: 8px;
  }
</style>
