import typescript from 'rollup-plugin-typescript2'
import {nodeResolve} from '@rollup/plugin-node-resolve'
import nodePolyfills from 'rollup-plugin-polyfill-node'
import commonJS from '@rollup/plugin-commonjs'

export default {
  input: './src/index.ts',
  output: [
    {format: 'cjs', file: './dist/index.cjs'},
    {format: 'es', file: './dist/index.js'},
  ],
  plugins: [
    nodePolyfills(),
    nodeResolve(),
    commonJS(),
    typescript({check: false, tsconfig: './tsconfig-build.json'}),
  ],
}
