import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// faustcode served under /faustcode/ by the server of faustmodular, so that the two have the same origin: they
// share the files of the resources (OPFS), the locks and the channel (Documentation/SCENE-RESOURCES-SPEC.md).
// FAUSTCODE_DIR names a checkout of faustcode (its webapp/ folder is served), by default ../faustcode next to
// this repository, if it is there.
const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon', '.txt': 'text/plain', '.lib': 'text/plain', '.dsp': 'text/plain', '.data': 'application/octet-stream',
}

function faustcodeRoot() {
    const dir = process.env.FAUSTCODE_DIR ?? path.resolve(import.meta.dirname ?? '.', '../faustcode')
    const webapp = path.join(dir, 'webapp')
    return fs.existsSync(path.join(webapp, 'index.html')) ? webapp : null
}

function serveFaustcode() {
    return {
        name: 'serve-faustcode',
        configureServer(server) {
            const root = faustcodeRoot()
            if (!root) return
            server.middlewares.use('/faustcode', (req, res, next) => {
                const url = decodeURIComponent((req.url ?? '/').split('?')[0])
                let file = path.join(root, url.endsWith('/') ? url + 'index.html' : url)
                if (!file.startsWith(root)) return next()
                if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
                if (!fs.existsSync(file)) return next()
                res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream')
                fs.createReadStream(file).pipe(res)
            })
        },
    }
}

export default defineConfig({
    base: "./",
    build: {
        minify: false,
    },
    plugins: [serveFaustcode()],
})
