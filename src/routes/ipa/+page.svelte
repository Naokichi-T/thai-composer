<script>
  import { onMount } from "svelte";

  // --- 状態管理 ---
  let inputText = $state(""); // 入力されたタイ語
  let outputText = $state(""); // 変換結果
  let dictionary = $state({}); // 対応表（タイ語 → IPA）
  let isLoading = $state(true); // 読み込み中フラグ
  let loadError = $state(""); // エラーメッセージ
  let copied = $state(false); // コピー完了フラグ
  let showAdvanced = $state(false); // 「詳細設定」の開閉フラグ
  let useExcludedList = $state(true); // 除外リストを変換に反映するかどうか
  let selectedTokens = $state([]); // 選択範囲から抽出したトークン一覧
  let excludedTokens = $state([]); // 除外するトークンの一覧
  let excludeInput = $state(""); // 除外トークンの入力欄
  let registerMessage = $state(""); // 登録完了メッセージ

  /**
   * 変換結果をクリップボードにコピーする関数
   * コピー後は2秒間「✅ コピーしました」を表示する
   */
  async function copyOutput() {
    await navigator.clipboard.writeText(outputText);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  // --- 対応表を読み込む関数 ---
  async function loadDictionary() {
    try {
      // オリジナルデータを読み込む
      const res = await fetch("/thai2ipa.data");
      if (!res.ok) throw new Error("データの読み込みに失敗しました");
      const text = await res.text();

      // タブ区切りで辞書を作る
      const dict = {};
      for (const line of text.split("\n")) {
        const [thai, ipa] = line.split("\t");
        if (thai && ipa) {
          dict[thai.trim()] = ipa.trim();
        }
      }

      // カスタムデータを読み込む（オリジナルを上書きする形で追加）
      // ※ファイルがない場合はスキップする
      const customRes = await fetch("/thai2ipa_custom.data");
      if (customRes.ok) {
        const customText = await customRes.text();
        let customCount = 0;
        for (const line of customText.split("\n")) {
          const [thai, ipa] = line.split("\t");
          if (thai && ipa) {
            dict[thai.trim()] = ipa.trim();
            customCount++;
          }
        }
        console.log(`カスタム辞書: ${customCount} 語 読み込みました`);
      }

      dictionary = dict;
      isLoading = false;
    } catch (e) {
      loadError = e.message;
      isLoading = false;
    }
  }

  // --- タイ語の文字かどうかを判定する関数 ---
  // タイ文字のUnicode範囲：U+0E00〜U+0E7F
  function isThaiChar(char) {
    return char >= "\u0E00" && char <= "\u0E7F";
  }

  // --- 単独で区切るべきタイ文字かどうかを判定する関数 ---
  // ๆ（U+0E46）：直前の単語を繰り返す記号
  // ฯ（U+0E2F）：省略記号
  // これらは辞書に単独では載っていないため、かたまりから切り離して個別に処理する
  function isSeparatorChar(char) {
    return char === "\u0E46" || char === "\u0E2F";
  }

  // --- タイ文字のかたまりをバックトラッキングで分割する関数 ---
  // 「全部辞書で変換できる分割」を優先して探す
  // 例：ละครั้ง →「ละคร + ั้ง（変換不可）」より「ละ + ครั้ง（全部変換可）」を採用
  function tokenizeThai(text, pos) {
    // 末尾まで到達したら成功（空配列を返す）
    if (pos >= text.length) return [];

    // 最長→最短の順で候補を試す（最大20文字）
    const maxLen = Math.min(20, text.length - pos);
    for (let len = maxLen; len >= 1; len--) {
      const candidate = text.slice(pos, pos + len);

      // 除外リストに含まれているトークンは辞書にないものとして扱う
      // useExcludedList が OFF のときはこのチェックをスキップする
      if (useExcludedList && excludedTokens.includes(candidate)) {
        continue;
      }

      // 辞書にある単語だけを候補として採用する
      if (!dictionary[candidate]) continue;

      // この候補を採用して、残りを再帰的に処理する
      const rest = tokenizeThai(text, pos + len);

      // rest が null のときは残りの分割が失敗 → この候補は諦めて次の長さを試す
      if (rest === null) continue;

      // 成功！この候補 + 残りの結果を返す
      return [candidate, ...rest];
    }

    // 辞書にある単語が見つからなかった
    // → タイ文字の場合は null を返して呼び出し元にバックトラックさせる
    // → タイ文字以外（数字・記号など）はそのまま追加して続ける
    if (isThaiChar(text[pos])) {
      return null;
    }
    const rest = tokenizeThai(text, pos + 1);
    if (rest === null) return null;
    return [text[pos], ...rest];
  }

  // --- 最長一致＋バックトラッキングでタイ語をトークンに分割する関数 ---
  // タイ文字のかたまりは tokenizeThai() に渡し、
  // タイ文字以外（スペース・英数字など）はそのまままとめて追加する
  function tokenize(text) {
    const tokens = [];
    let i = 0;

    while (i < text.length) {
      // タイ文字でない場合（スペース・英数字など）は固まりごとまとめて追加
      // 例：「1,000」を「1」「,」「0」「0」「0」ではなく「1,000」として扱う
      if (!isThaiChar(text[i])) {
        let chunk = "";
        while (i < text.length && !isThaiChar(text[i])) {
          chunk += text[i];
          i++;
        }
        tokens.push(chunk);
        continue;
      }

      // タイ文字のかたまりをまとめて取り出す
      // ๆ と ฯ はかたまりから切り離して単独で処理する
      while (i < text.length && isThaiChar(text[i])) {
        // ๆ と ฯ は単独トークンとして追加して次へ進む
        if (isSeparatorChar(text[i])) {
          tokens.push(text[i]);
          i++;
          continue;
        }

        // 通常のタイ文字のかたまりを取り出す
        let thaiChunk = "";
        while (i < text.length && isThaiChar(text[i]) && !isSeparatorChar(text[i])) {
          thaiChunk += text[i];
          i++;
        }

        // バックトラッキングで分割してトークンに追加する
        // null のときは完全な分割ができなかった → 1文字ずつそのまま追加する
        const thaiTokens = tokenizeThai(thaiChunk, 0);
        if (thaiTokens === null) {
          for (const char of thaiChunk) {
            tokens.push(char);
          }
        } else {
          tokens.push(...thaiTokens);
        }
      }
    }

    return tokens;
  }

  // --- 1行分を変換する関数 ---
  function convertLine(line) {
    // 最長一致法でトークンに分割する
    const tokens = tokenize(line);

    let result = "";

    for (const token of tokens) {
      const ipa = dictionary[token];
      if (ipa) {
        // タイ語トークン：IPAに変換してスペースを後ろに追加する
        // ˑ（音節区切り記号）を除去して返す
        result += ipa.replaceAll("ˑ", "") + " ";
      } else if (isSeparatorChar(token)) {
        // ๆ と ฯ はそのまま出力してスペースを後ろに追加する
        result += token + " ";
      } else {
        // スペースだけのchunkはそのまま追加する（センテンス間のスペースを保持するため）
        // スペース以外を含むchunk（"1,000"など）は先頭のスペースを除去する
        // 例：" 1,000 " → "1,000 "（タイ語トークンの後ろのスペースと重複するため）
        if (token.trim() === "") {
          result += token;
        } else {
          result += token.trimStart();
        }
      }
    }

    // 末尾に余分なスペースが残る場合は除去する
    return result.trimEnd();
  }

  // --- タイ語をIPAに変換する関数 ---
  function convert() {
    // 入力が空の場合は何もしない
    if (!inputText.trim()) return;

    // 改行ごとに処理する（複数行に対応）
    const lines = inputText.split("\n");
    const convertedLines = lines.map((line) => convertLine(line));
    outputText = convertedLines.join("\n");
  }

  /**
   * テキストエリアでテキストが選択されたときにトークンを抽出する関数
   * mouseup イベントで呼ばれる
   */
  function handleTextSelect() {
    // 選択されているテキストを取得する
    const selection = window.getSelection();
    const selected = selection ? selection.toString() : "";

    // 選択が空のときはトークン一覧をクリアして終了
    if (!selected.trim()) {
      selectedTokens = [];
      return;
    }

    // tokenize() で分割して、タイ文字を含むトークンだけ抽出する
    const tokens = tokenize(selected);
    selectedTokens = tokens.filter((t) => [...t].some((c) => isThaiChar(c)));
  }

  /**
   * 除外リストに LocalStorage へ保存する関数
   * 登録・解除のたびに呼ぶ
   */
  function saveExcludedTokens() {
    localStorage.setItem("ipa_excluded_tokens", JSON.stringify(excludedTokens));
  }

  /**
   * 除外リストにトークンを登録する関数
   * 入力欄の内容を追加して LocalStorage に保存する
   */
  function registerToken() {
    const token = excludeInput.trim();

    // 空のときは何もしない
    if (!token) return;

    // すでに登録済みのときはメッセージを出して終了
    if (excludedTokens.includes(token)) {
      registerMessage = "⚠️ すでに登録されています";
      setTimeout(() => (registerMessage = ""), 2000);
      return;
    }

    // 除外リストに追加して保存する
    excludedTokens = [...excludedTokens, token];
    saveExcludedTokens();

    // 入力欄をクリアしてメッセージを表示する
    excludeInput = "";
    registerMessage = "✅ 登録しました";
    setTimeout(() => (registerMessage = ""), 2000);
  }

  /**
   * バッジをクリックしたときに除外入力欄にセットする関数
   * そのまま登録ボタンを押せる状態にする
   */
  function selectTokenForExclude(token) {
    excludeInput = token;
  }

  // --- ページ表示時にデータを読み込む ---
  onMount(() => {
    loadDictionary();

    // LocalStorage から除外リストを読み込む
    const saved = localStorage.getItem("ipa_excluded_tokens");
    if (saved) {
      excludedTokens = JSON.parse(saved);
    }

    // 別タブ（/ipa/excluded）で LocalStorage が更新されたら自動で反映する
    function handleStorage(e) {
      // ipa_excluded_tokens 以外のキーの変更は無視する
      if (e.key !== "ipa_excluded_tokens") return;

      // 新しい値を読み込む（null のときは空配列にする）
      excludedTokens = e.newValue ? JSON.parse(e.newValue) : [];
    }

    window.addEventListener("storage", handleStorage);

    // ページを離れるときにイベントリスナーを解除する（メモリリーク防止）
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  });
</script>

<svelte:head>
  <title>IPA変換</title>
</svelte:head>

<div class="container">
  <h1>IPA変換</h1>

  {#if isLoading}
    <p class="loading">読み込み中...</p>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else}
    <p class="loaded">✅ {Object.keys(dictionary).length.toLocaleString()} 語 読み込み完了</p>

    <!-- 詳細設定（アコーディオン）← テキストエリアの上に置く -->
    <div class="advanced-section">
      <button class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
        {showAdvanced ? "▼" : "▶"} 詳細設定
      </button>

      {#if showAdvanced}
        <div class="advanced-body">
          <!-- 除外リストの反映ON/OFF -->
          <div class="toggle-row">
            <button class="toggle-label" onclick={() => (useExcludedList = !useExcludedList)}>
              <div class="toggle-switch" class:on={useExcludedList}>
                <div class="toggle-knob"></div>
              </div>
              <span>除外リストを変換に反映する</span>
            </button>
          </div>
        </div>
        <!-- 選択範囲のトークン表示 -->
        <div class="token-section">
          {#if selectedTokens.length > 0}
            <p class="token-hint">選択したテキストのトークン：</p>
            <div class="token-list">
              {#each selectedTokens as token}
                <button class="token-badge" onclick={() => selectTokenForExclude(token)} title="クリックで除外入力欄にセット">{token}</button>
              {/each}
            </div>
          {:else}
            <p class="token-hint">入力欄のテキストを選択するとトークンが表示されます</p>
          {/if}
        </div>
        <!-- 除外トークンの登録フォーム -->
        <div class="exclude-form">
          <p class="token-hint">除外するトークンを登録：</p>
          <div class="exclude-input-row">
            <input
              type="text"
              placeholder="例：ว่าว"
              bind:value={excludeInput}
              onkeydown={(e) => {
                if (e.key === "Enter" && !e.isComposing) registerToken();
              }}
            />
            <button class="btn-register" onclick={registerToken}>登録</button>
          </div>
          {#if registerMessage}
            <p class="register-message">{registerMessage}</p>
          {/if}
          {#if excludedTokens.length > 0}
            <p class="excluded-count">
              除外中：{excludedTokens.length} 件
              <a class="excluded-link" href="/ipa/excluded" target="_blank">一覧を見る →</a>
            </p>
          {/if}
        </div>
      {/if}
    </div>

    <!-- 入力エリア：テキスト選択時にトークンを抽出する -->
    <textarea placeholder="タイ語を入力してください" bind:value={inputText} onmouseup={handleTextSelect}></textarea>

    <!-- ボタン群 -->
    <div class="actions">
      <button class="btn-convert" onclick={convert}>変換</button>
      <button
        class="btn-clear"
        onclick={() => {
          inputText = "";
          outputText = "";
        }}>クリア</button
      >
    </div>

    <!-- 変換結果 -->
    {#if outputText}
      <div class="output">
        <div class="output-header">
          <h2>変換結果</h2>
          <button class="btn-copy" class:copied onclick={copyOutput}>
            {copied ? "✅ コピーしました" : "コピー"}
          </button>
        </div>
        <p class="result">{outputText}</p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 18px;
    margin-bottom: 8px;
  }

  .loading {
    color: #888;
  }

  .error {
    color: red;
  }

  .loaded {
    color: green;
    margin-bottom: 16px;
  }

  textarea {
    width: 100%;
    height: 120px;
    font-size: 20px;
    padding: 12px;
    border: 1px solid #ccc;
    border-radius: 8px;
    font-family: "Sarabun", sans-serif;
    box-sizing: border-box;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .btn-convert {
    padding: 10px 24px;
    font-size: 16px;
    background: #2d2a4a;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }

  .btn-convert:hover {
    opacity: 0.8;
  }

  /* クリアボタン：グレー系 */
  .btn-clear {
    padding: 10px 24px;
    font-size: 16px;
    background: #eee;
    color: #333;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }

  .btn-clear:hover {
    background: #ddd;
  }

  /* 変換結果ヘッダー：タイトルとコピーボタンを横並びにする */
  .output-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .output-header h2 {
    margin: 0;
  }

  /* コピーボタン：小さめのボタン */
  .btn-copy {
    padding: 4px 12px;
    font-size: 14px;
    background: #fff;
    color: #2d2a4a;
    border: 1px solid #2d2a4a;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-copy:hover {
    background: #e8e7f0;
  }

  /* コピー完了時のスタイル */
  .btn-copy.copied {
    color: #2d2a4a;
    border-color: #2d2a4a;
  }

  .output {
    margin-top: 24px;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 8px;
  }

  .result {
    font-size: 20px;
    line-height: 1.8;
    white-space: pre-wrap;
    font-family: Arial, Helvetica, sans-serif;
  }

  /* 詳細設定セクション */
  .advanced-section {
    margin-top: 16px;
  }

  /* 詳細設定の開閉ボタン */
  .advanced-toggle {
    background: none;
    border: none;
    font-size: 15px;
    color: #2d2a4a;
    cursor: pointer;
    padding: 4px 0;
  }

  .advanced-toggle:hover {
    opacity: 0.7;
  }

  /* 詳細設定の中身エリア */
  .advanced-body {
    margin-top: 8px;
    padding: 16px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fafafa;
  }

  /* トグルスイッチの行 */
  .toggle-row {
    display: flex;
    align-items: center;
    margin-bottom: 0;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    background: none;
    border: none;
    padding: 0;
  }

  /* トグルスイッチ本体（OFFのとき） */
  .toggle-switch {
    width: 40px;
    height: 22px;
    background: #ccc;
    border-radius: 11px;
    position: relative;
    transition: background 0.2s;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* トグルスイッチ本体（ONのとき） */
  .toggle-switch.on {
    background: #2d2a4a;
  }

  /* トグルスイッチの丸いつまみ */
  .toggle-knob {
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: left 0.2s;
  }

  /* ONのときはつまみを右に移動 */
  .toggle-switch.on .toggle-knob {
    left: 20px;
  }

  /* トークン表示セクション */
  .token-section {
    margin-top: 12px;
  }

  .token-hint {
    font-size: 13px;
    color: #888;
    margin-bottom: 6px;
  }

  /* トークンのバッジ一覧 */
  .token-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* トークン1つ1つのバッジ */
  .token-badge {
    padding: 4px 10px;
    background: #e8e7f0;
    color: #2d2a4a;
    border-radius: 20px;
    font-size: 15px;
    font-family: "Sarabun", sans-serif;
  }

  /* トークンバッジをボタンにしたときのリセット */
  .token-badge {
    cursor: pointer;
    border: none;
  }

  .token-badge:hover {
    background: #d0ceea;
  }

  /* 除外登録フォーム */
  .exclude-form {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #eee;
  }

  /* 入力欄とボタンを横並びにする */
  .exclude-input-row {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
  }

  .exclude-input-row input {
    flex: 1;
    padding: 6px 10px;
    font-size: 15px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-family: "Sarabun", sans-serif;
  }

  /* 登録ボタン */
  .btn-register {
    padding: 6px 16px;
    font-size: 14px;
    background: #2d2a4a;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-register:hover {
    opacity: 0.8;
  }

  /* 登録完了・警告メッセージ */
  .register-message {
    font-size: 13px;
    color: #555;
    margin-bottom: 4px;
  }

  /* 除外中の件数表示 */
  .excluded-count {
    font-size: 13px;
    color: #888;
    margin-top: 4px;
  }

  /* 「一覧を見る →」リンク */
  .excluded-link {
    font-size: 13px;
    color: #2d2a4a;
    margin-left: 8px;
  }

  .excluded-link:hover {
    text-decoration: underline;
  }
</style>
