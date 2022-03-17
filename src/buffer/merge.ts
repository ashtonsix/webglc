import {Format, ComplexFormat, MergeFormats} from '../format'
import {gpu} from '../gpu'
import {Buffer, Attribute} from './buffer'

type InferBufferFormat<B extends {[x: string]: Buffer<Format>} | Buffer<ComplexFormat>> =
  B extends {[x: string]: Buffer<Format>}
    ? {[K in keyof B]: B[K] extends Buffer<infer F> ? F : never}
    : B extends Buffer<infer F>
    ? F
    : never

export type InferMultipleBufferFormats<A extends any[]> = {
  [I in keyof A]: A[I] extends {[x: string]: Buffer<Format>} | Buffer<ComplexFormat>
    ? InferBufferFormat<A[I]>
    : never
}

export async function merge<
  B extends ({[x: string]: Buffer<Format>} | Buffer<ComplexFormat>)[],
  M extends MergeFormats<InferMultipleBufferFormats<B>>
>(...input: B): Promise<M extends ComplexFormat ? Buffer<M> : never> {
  let buffers = [] as Buffer<ComplexFormat>[]
  for (let b of input) {
    if (b instanceof Buffer) buffers.push(b)
    else {
      for (let k in b) {
        let bk = new Buffer(b[k].format) as any as Buffer<ComplexFormat>
        bk.js = b[k].js
        bk.gl = b[k].gl
        bk.tex = b[k].tex
        bk.byteLength = b[k].byteLength
        bk.format = {[k]: b[k].format}
        bk.attribs = [{...b[k].attribs[0], name: k}]
        bk.consumed = b[k].consumed
        bk.free = b[k].free.bind(b[k])
        buffers.push(bk)
      }
    }
  }

  let byteLength = 0
  let attribs = [] as Attribute[]
  let format = {} as ComplexFormat
  for (let b of buffers) {
    Object.assign(format, b.format)
    for (let a of b.attribs) {
      a = {...a, offset: a.offset + Math.ceil(byteLength / 4)}
      let i = attribs.findIndex((aa) => aa.name === a.name)
      if (i === -1) attribs.push(a)
      else attribs[i] = a
    }
    byteLength += b.byteLength
  }
  byteLength = 2 ** Math.ceil(Math.log2(byteLength))

  let {gl, pool} = gpu
  let result = new Buffer(format)
  result.byteLength = byteLength
  result.attribs = attribs
  result.gl = pool.getBuffer(byteLength)
  gl.bindBuffer(gl.COPY_WRITE_BUFFER, result.gl)

  let cursor = 0
  for (let b of buffers) {
    await b.acquire('gl')
    if (!b.gl) continue
    gl.bindBuffer(gl.COPY_READ_BUFFER, b.gl)
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, cursor, b.byteLength)
    cursor += b.byteLength
    if (b.consumed) b.free()
  }
  gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
  gl.bindBuffer(gl.COPY_READ_BUFFER, null)

  return result as any
}
