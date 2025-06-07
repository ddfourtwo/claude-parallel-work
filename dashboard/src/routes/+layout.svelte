<script lang="ts">
  import '../app.css';
</script>

<main class="h-screen overflow-hidden bg-gray-900 text-white">
  <slot />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
