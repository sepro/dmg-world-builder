<script>
  import { toolGroups } from "../config/tools.js";

  let { currentPage = "" } = $props();
</script>

<nav class="tool-menu" aria-label="Tool suite">
  {#each toolGroups as group}
    <span class="tool-group">
      <span class="tool-group-label">{group.label}</span>
      {#each group.tools as tool}
        <a
          class:active={tool.href === currentPage}
          class="nav-link"
          href={tool.href}
          aria-current={tool.href === currentPage ? "page" : undefined}
        >{tool.name}</a>
      {/each}
    </span>
  {/each}
</nav>
