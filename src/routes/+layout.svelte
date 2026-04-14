<script>
  import { onMount } from "svelte";
  import { supabase } from "$lib/supabase.js";

  let { children } = $props();

  // ログインチェック完了前は画面を表示しない（チラつき防止）
  let checked = $state(false);

  // ログインが必要なページのパスリスト
  const PROTECTED_PATHS = ["/words", "/ipa/excluded"];

  /**
   * ページ表示時にログイン状態を確認する関数
   * ログインが必要なページに未ログインでアクセスした場合は /login にリダイレクトする
   */
  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;

    const currentPath = window.location.pathname;
    const isProtected = PROTECTED_PATHS.some((path) => currentPath.startsWith(path));

    if (isProtected && !session) {
      window.location.href = "/login";
      return;
    }

    checked = true;
  });
</script>

{#if checked}
  {@render children()}
{/if}
