import {range} from '../range'
import format, {Format, ComplexFormat, formatQuery} from '../format'
import {Kernel, kernel} from '../kernel/kernel'
import {Buffer} from './buffer'

let splitKernels: {[x: string]: Kernel}

export async function split<F extends ComplexFormat>(
  buffer: Buffer<F>
): Promise<{[K in keyof F]: Buffer<F[K]>}> {
  if (splitKernels == null) {
    splitKernels = {
      split1: kernel(format.uint, format.uint)`
        void map(int i) {
          uvec4 v = read(i, f_uvec4);
          write(v.x, v.y, v.z, v.w);
        }`,
      split2: kernel(format.uvec2, format.uvec2)`
        void map(int i) {
          uvec4 v = read(i, f_uvec4);
          write(v.xy, v.zw);
        }`,
      split3: kernel(format.uvec3, format.uvec3)`void map(int i) { write(read(i)); }`,
      split4: kernel(format.uvec4, format.uvec4)`void map(int i) { write(read(i)); }`,
    }
  }
  let result = {} as {[x: string]: Buffer<Format>}
  for (let a of buffer.attribs) {
    let f = buffer.format[a.name!]
    let buf = new Buffer(formatQuery({base: 'uint', components: f.components})[0])
    buf.js = buffer.js
    buf.gl = buffer.gl
    buf.tex = buffer.tex
    buf.byteLength = buffer.byteLength
    buf.attribs = [{...a, name: null}]
    let kern = splitKernels[('split' + f.components) as keyof typeof splitKernels]
    // TODO: don't create new texture for each draw call
    // NOTE: the planned vertex array optimisation supercedes this TODO
    buf = await range(buf.length).map(kern as any, buf as any)
    buf.format = f
    buf.attribs[0].format = f
    result[a.name!] = buf
  }
  if (buffer.consumed) buffer.free()
  return result as any
}
