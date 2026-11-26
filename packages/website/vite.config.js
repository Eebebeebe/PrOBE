import { defineConfig, lazyPlugins } from 'vite-plus'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const fullReloadAlways = {
    name: 'full-reload',
    handleHotUpdate({ server }) {
        server.ws.send({ type: 'full-reload' })
        return []
    },
}

export default defineConfig(async ({ command, mode }) => {
    const visualizerPlugin = process.env.VISUALIZE
        ? (await import('rollup-plugin-visualizer')).visualizer({
              open: true,
              gzipSize: true,
              brotliSize: true,
              filename: 'dist/stats.html',
              title: 'FBE Bundle Analysis',
          })
        : null
    const proxy = {
        // TODO: replace with a local implementation. This forwards `?source=`
        // fetches (bpString.ts) to the previous project's production site, and
        // nothing serves /corsproxy in a production build since its Cloudflare
        // function was removed.
        '/corsproxy': {
            target: 'https://fbe.factorygamefan.com',
            changeOrigin: true,
        },
    }
    if (mode !== 'production') {
        proxy['/data'] = {
            target: 'http://127.0.0.1:8081',
            rewrite: path => path.replace(/^\/data/, ''),
        }
    }
    return {
        build: { sourcemap: true },
        optimizeDeps: {
            include: [
                'pixi.js',
                'pixi.js/app',
                'pixi.js/events',
                'pixi.js/filters',
                'pixi.js/sprite-tiling',
                'pixi.js/text',
                'pixi.js/graphics',
                'pixi.js/basis',
            ],
        },
        /*
            Listen on 127.0.0.1, not Vite's default "localhost". Vite binds only
            the first address the OS returns for localhost, which on many Linux
            setups (and on macOS) is ::1 alone - then a browser that reaches
            localhost over IPv4 gets "connection refused". Every client that
            resolves localhost tries 127.0.0.1, so binding it serves them all.
        */
        preview: { host: '127.0.0.1', port: 8080 },
        server: {
            host: '127.0.0.1',
            port: 8080,
            proxy,
        },
        plugins: lazyPlugins(() => [
            command === 'build'
                ? viteStaticCopy({
                      targets: [
                          {
                              src: '../exporter/data/output/**/*',
                              dest: 'data',
                              // v4 preserves the full source path (exporter/data/output/...);
                              // strip those 3 segments so files land at dist/data/<name>.
                              rename: { stripBase: 3 },
                          },
                      ],
                  })
                : fullReloadAlways,
            ...(visualizerPlugin ? [visualizerPlugin] : []),
        ]),
    }
})
