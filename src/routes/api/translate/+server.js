import { DEEPL_API_KEY } from "$env/static/private";

/**
 * タイ語を日本語に翻訳するAPIエンドポイント
 * POST /api/translate
 * body: { text: "翻訳したいテキスト" }
 */
export async function POST({ request }) {
  const { text } = await request.json();

  // テキストが空のときは400エラーを返す
  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: "テキストが空です" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // DeepL APIを呼び出す
  const response = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      source_lang: "TH", // タイ語
      target_lang: "JA", // 日本語
    }),
  });

  if (!response.ok) {
    return new Response(JSON.stringify({ error: "翻訳に失敗しました" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const translated = data.translations[0].text;

  return new Response(JSON.stringify({ translated }), {
    headers: { "Content-Type": "application/json" },
  });
}
