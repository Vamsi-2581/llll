<script setup lang="ts">
/** The hero shows static screenshots first so the landing stays fast. The live
 * sandbox loads only when a visitor asks for it, in the same embed path the
 * shell already uses for /open?instance=…, so nothing new is contracted. */
const sandboxUrl = '/open?instance=https://sandbox.llll.gg'
const live = ref(false)
</script>

<template>
  <div>
    <div v-if="!live" class="overflow-hidden rounded-md border border-muted bg-elevated">
      <ProductPreview />
    </div>
    <div v-else class="overflow-hidden rounded-md border border-muted bg-elevated">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-muted px-3 py-2">
        <p class="text-xs text-dimmed">Live sandbox · sandbox.llll.gg</p>
        <div class="flex items-center gap-1">
          <UButton :to="sandboxUrl" target="_blank" label="Open full screen" icon="i-ph-arrow-square-out" color="neutral" variant="ghost" size="xs" />
          <UButton label="Close" icon="i-ph-x" color="neutral" variant="ghost" size="xs" @click="live = false" />
        </div>
      </div>
      <iframe
        :src="sandboxUrl"
        title="L4 live sandbox"
        class="aspect-video w-full border-0 bg-default"
        loading="lazy"
        allow="camera; microphone; display-capture; fullscreen; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        referrerpolicy="no-referrer"
      />
    </div>

    <div class="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
      <UButton v-if="!live" label="Load live demo" icon="i-ph-play-circle" color="neutral" variant="outline" @click="live = true" />
      <p class="text-xs text-dimmed">
        {{ live ? 'The sandbox instance is running in an embedded client.' : 'Screenshots above. Load the sandbox to click around the real interface.' }}
      </p>
    </div>
  </div>
</template>
