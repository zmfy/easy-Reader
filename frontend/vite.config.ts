import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import fs from 'fs'
import path from 'path'

// pdf.js 运行时按目录加载的资源（中文字体映射 cmaps、标准字体、图片解码 wasm、CMYK 颜色配置 iccs），
// 开发时直接从 node_modules 提供，构建时原样复制到 dist/pdfjs/ 下（地址见 src/utils/pdf.ts）
function pdfjsAssets(): Plugin {
  const root = path.resolve(__dirname, 'node_modules/pdfjs-dist')
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '')
        const file = path.resolve(root, rel)
        if (!dirs.some(d => file.startsWith(path.join(root, d) + path.sep)) || !fs.existsSync(file)) return next()
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        fs.createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const name of fs.readdirSync(path.join(root, dir))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(root, dir, name)) })
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    pdfjsAssets(),
    // Element Plus 组件按需引入（样式仍在 main.ts 全量引入，避免漏样式）
    Components({
      resolvers: [ElementPlusResolver({ importStyle: false })],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
