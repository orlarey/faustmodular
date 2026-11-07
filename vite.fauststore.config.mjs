// The library of the stores (src/store/fauststore.ts) as one ES module without dependency, for faustcode:
// npm run build:fauststore → lib/fauststore.js
import { defineConfig } from 'vite'

export default defineConfig({
    publicDir: false,
    build: {
        outDir: 'lib',
        emptyOutDir: true,
        minify: false,
        lib: {
            entry: 'src/store/fauststore.ts',
            formats: ['es'],
            fileName: () => 'fauststore.js',
        },
    },
})
