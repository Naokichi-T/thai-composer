<script>
  import { onMount } from "svelte";

  // --- 状態管理 ---
  let inputText = $state(""); // 入力されたタイ語
  let outputText = $state(""); // 変換結果
  let dictionary = $state({}); // 対応表（タイ語 → IPA）
  let isLoading = $state(true); // 読み込み中フラグ
  let loadError = $state(""); // エラーメッセージ
  let copied = $state(false); // コピー完了フラグ

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

  // --- 最長一致法でタイ語をトークンに分割する関数 ---
  // 例：「สวัสดีครับ」→ ["สวัสดี", "ครับ"]
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

      // タイ文字の場合：できるだけ長い単語を辞書から探す（最長一致）
      let matched = false;
      // 最大20文字まで試す（タイ語の単語はほぼ20文字以内）
      for (let len = 20; len >= 1; len--) {
        const candidate = text.slice(i, i + len);
        if (dictionary[candidate]) {
          // 辞書に見つかった！このトークンを追加する
          tokens.push(candidate);
          i += len;
          matched = true;
          break;
        }
      }

      // 辞書に見つからなかった場合は1文字そのまま追加
      if (!matched) {
        tokens.push(text[i]);
        i++;
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

  // --- ページ表示時にデータを読み込む ---
  onMount(() => {
    loadDictionary();
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

    <!-- 入力エリア -->
    <textarea placeholder="タイ語を入力してください" bind:value={inputText}></textarea>

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
</style>
