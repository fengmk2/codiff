import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: { copy: [], deps: { resolveDepSubpath: true }, dts: false },
});
