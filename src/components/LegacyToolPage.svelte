<script>
  import { onMount } from "svelte";
  import ToolHeader from "./ToolHeader.svelte";

  let {
    beforeMenu = "",
    afterMenu = "",
    content = "",
    currentPage = "",
    initialize,
  } = $props();

  onMount(async () => {
    await initialize();
  });
</script>

<div id="app">
  <ToolHeader {beforeMenu} {afterMenu} {currentPage} />
  {@html content}
</div>
