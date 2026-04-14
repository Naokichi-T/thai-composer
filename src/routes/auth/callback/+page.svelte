<script>
  import { onMount } from "svelte";
  import { supabase } from "$lib/supabase.js";

  /**
   * ページ表示時にセッションを確認してトップページに遷移する
   * Supabaseのメール認証後のリダイレクト先として使う
   */
  onMount(async () => {
    // セッションが確立されるのを待つ
    await supabase.auth.getSession();
    // トップページに遷移する
    window.location.href = "/";
  });
</script>

<p>ログイン処理中...</p>
