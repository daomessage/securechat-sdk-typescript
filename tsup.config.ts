// tsup.config.ts — T-105 SDK NPM 构建配置
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/calls/e2ee-worker.ts'],
  format: ['esm', 'cjs'],
  dts: true,                // 生成 .d.ts 类型声明文件
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: false,            // 保持可读性（SDK 不混淆）
  treeshake: true,
  target: 'es2022',
  esbuildOptions(options) {
    // WebCrypto 全局 API（浏览器/Node.js 18+）
    options.define = {
      'globalThis.crypto': 'crypto',
    }
  },
  external: [
    // 纯 ESM 加密库不打包进去（减小体积）
    '@noble/curves',
    '@noble/hashes',
    '@scure/bip39',
    '@scure/bip32',
    'idb',
  ],
})
