<script>
  import ToolMenu from "./ToolMenu.svelte";

  let { beforeMenu = "", afterMenu = "", currentPage = "" } = $props();
</script>

<header class="topbar">
  {@html beforeMenu}
  <ToolMenu {currentPage} />
  {@html afterMenu}
</header>
