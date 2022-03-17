import {Format, ComplexFormat, ParsedFormat, formatIterator, MergeFormats} from '../format'
import {gpu} from '../gpu'
import {copy} from './copy'
import {concat} from './concat'
import {merge, InferMultipleBufferFormats} from './merge'
import {rename} from './rename'
import {slice} from './slice'
import {split} from './split'
import {read} from './read'
import {write, writeSync} from './write'
import {BufferGeometry, FramebufferTexture} from 'three138'
import {
  createThreeBufferGeometry,
  updateThreeBufferGeometry,
  createThreeTexture,
  updateThreeTexture,
} from './three'

export type Attribute = {
  name: string | null
  format: Format
  offset: number
  repeat: number
  count: number
}

export const attributeIterator = (attrib: Attribute) => {
  let a = [] as number[]
  for (let i_data = 0; i_data < attrib.count; i_data++) {
    let i_chunk = Math.floor(i_data / 4)
    let i_interleave = i_data % 4
    let index = i_chunk * attrib.repeat + attrib.offset + i_interleave * attrib.format.components
    a.push(index)
  }
  function get(i_data: number): any {
    let i_chunk = Math.floor(i_data / 4)
    let i_interleave = i_data % 4
    let index = i_chunk * attrib.repeat + attrib.offset + i_interleave * attrib.format.components
    return index
  }

  return Object.assign(a, {get})
}

export class Buffer<F extends Format | ComplexFormat = Format | ComplexFormat> {
  js = null as null | ArrayBufferView
  gl = null as null | WebGLBuffer
  tex = null as null | WebGLTexture
  byteLength = 0
  attribs = [] as Attribute[]
  consumed = false
  constructor(public format: F) {
    let repeat = 0
    let offset = 0
    for (let {format} of formatIterator(this.format)) repeat += format.components * 4

    for (let {name, format} of formatIterator(this.format)) {
      this.attribs.push({name, format, offset, repeat, count: 0})
      offset += format.components * 4
    }
    gpu.buffers.add(this)
  }
  get length() {
    let counts = new Set(this.attribs.map((p) => p.count))
    if (counts.size === 0) return 0
    if (counts.size >= 2) return NaN
    return Array.from(counts)[0]
  }
  get texDimensions() {
    if (!this.byteLength) return [0, 0]
    let pixels = Math.ceil(this.byteLength / 16)
    let width = 2 ** Math.ceil(Math.log2(pixels ** 0.5))
    let height = pixels / width
    return [width, height] as [number, number]
  }
  free() {
    this.consumed = false
    gpu.buffers.delete(this)
    if (this.gl) gpu.pool.reclaim(this.gl)
    if (this.tex) gpu.pool.reclaim(this.tex)
    this.js = null
    this.gl = null
    this.tex = null
    this.byteLength = 0
    for (let a of this.attribs) a.count = 0
  }
  consume() {
    this.consumed = true
    return this
  }
  async acquire(key: 'js' | 'gl' | 'tex') {
    if (this[key]) return
    switch (key) {
      case 'js': {
        await this.acquire('gl')
        if (!this.gl) return
        let {gl, pool} = gpu
        let read = pool.getBuffer(this.byteLength, gl.DYNAMIC_READ)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.gl)
        gl.bindBuffer(gl.COPY_READ_BUFFER, read)
        gl.copyBufferSubData(gl.COPY_WRITE_BUFFER, gl.COPY_READ_BUFFER, 0, 0, this.byteLength)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
        gl.bindBuffer(gl.COPY_READ_BUFFER, null)
        await gpu.waitForIdle()
        this.js = new Uint32Array(this.byteLength / 4)
        gl.bindBuffer(gl.ARRAY_BUFFER, read)
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, this.js)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        pool.reclaim(read)
      }
      case 'gl': {
        if (!this.js && !this.tex) return
        let {gl, pool} = gpu
        this.gl = pool.getBuffer(this.byteLength)
        if (this.tex) {
          let [w, h] = this.texDimensions
          gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.fb)
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.gl!)
          gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0)
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        } else if (this.js) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.gl)
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.js)
          gl.bindBuffer(gl.ARRAY_BUFFER, null)
        }
      }
      case 'tex': {
        await this.acquire('gl')
        if (!this.gl) return
        let {gl, pool} = gpu
        let [w, h] = this.texDimensions
        this.tex = pool.getTexture(w * h)
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, this.gl)
        gl.bindTexture(gl.TEXTURE_2D, this.tex)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0)
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
        gl.bindTexture(gl.TEXTURE_2D, null)
      }
    }
  }
  async createThreeBufferGeometry() {
    return createThreeBufferGeometry(this)
  }
  async updateThreeBufferGeometry(geom: BufferGeometry) {
    return updateThreeBufferGeometry(this, geom)
  }
  async createThreeTexture(width: number, height: number) {
    return createThreeTexture(this, width, height)
  }
  async updateThreeTexture(texture: FramebufferTexture) {
    return updateThreeTexture(this, texture)
  }
  async copy(): Promise<Buffer<F>> {
    return copy(this)
  }
  async slice(start: number, end?: number): Promise<Buffer<F>> {
    return slice(this, start, end)
  }
  async concat(...buffers: Buffer<F>[]): Promise<Buffer<F>> {
    return concat(this, ...buffers)
  }
  async split(): Promise<F extends ComplexFormat ? {[K in keyof F]: Buffer<F[K]>} : unknown> {
    return split(this as any) as any
  }
  async merge<
    B extends ({[x: string]: Buffer<Format>} | Buffer<ComplexFormat>)[],
    G extends MergeFormats<InferMultipleBufferFormats<B>>,
    M extends {
      [K in keyof (F & G)]: K extends keyof G ? G[K] : K extends keyof F ? F[K] : unknown
    }
  >(...buffers: B): Promise<M extends ComplexFormat ? Buffer<M> : unknown> {
    return merge(this as any, ...buffers) as any
  }
  async rename<S extends string, G extends S extends keyof F ? F[S] : unknown>(dict: {
    [K in S]: '.'
  }): Promise<G extends Format ? Buffer<G> : unknown>
  async rename<S extends string>(dict: {
    '.': S
  }): Promise<F extends Format ? Buffer<{[K in S]: F}> : unknown>
  async rename<S extends keyof F & keyof D, D extends {readonly [x: string]: string}>(
    dict: D
  ): Promise<F extends ComplexFormat ? Buffer<{[K in S as D[K]]: F[K]}> : unknown>
  async rename(dict: {[x: string]: string}) {
    return rename(this as any, dict) as any
  }
  async read(): Promise<ParsedFormat<F>[]> {
    return read(this)
  }
  async write(data: ParsedFormat<F>[]): Promise<Buffer<F>> {
    return write(this, data)
  }
}

export const buffer = Object.assign(
  function buffer<F extends Format | ComplexFormat>(format: F, data?: ParsedFormat<F>[]) {
    let b = new Buffer(format)
    if (data) b = writeSync(b, data)
    return b
  },
  {read, write, concat, copy, merge, rename, slice, split}
)
