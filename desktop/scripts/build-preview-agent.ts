import { $ } from 'bun'
await $`bun build ./src/preview-agent/index.ts --outfile=./src-tauri/resources/preview-agent.js --format=iife --minify`
console.log('preview-agent.js built')
