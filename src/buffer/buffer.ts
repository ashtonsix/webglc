import {range} from '../range'
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

export class BufferPool {
  bufferPool = {} as {[sizeAndUsage: string]: WebGLBuffer[]}
  bufferPoolIndex = new Map<WebGLBuffer, string>()
  texturePool = {} as {[sizeAndFormat: string]: WebGLTexture[]}
  texturePoolIndex = new Map<WebGLTexture, {key: string; width: number; height: number}>()
  sizeBuffer(format: Format | ComplexFormat | null, count: number) {
    let components = 0
    for (let f of formatIterator(format)) components += f.format.components
    count = Math.ceil(count / 4) * 4
    let full = 2 ** Math.ceil(Math.log2(count * components)) * 4
    return full
  }
  getBuffer(size: number, usage = gpu.gl.DYNAMIC_DRAW) {
    let {gl} = gpu
    if (size !== 2 ** Math.ceil(Math.log2(size))) {
      throw new Error(`Size must be a power of 2, got ${size}`)
    }

    let key = size + '.' + usage
    if (!this.bufferPool[key]) this.bufferPool[key] = []
    let buffer = this.bufferPool[key].pop()
    if (!buffer) {
      buffer = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, size, usage)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      this.bufferPoolIndex.set(buffer, key)
    }

    return buffer
  }
  freeBuffer(buffer: WebGLBuffer, destroy?: boolean) {
    let {gl} = gpu
    let key = this.bufferPoolIndex.get(buffer)!
    let pool = this.bufferPool[key]
    if (pool.length > 8) destroy = true
    if (destroy) {
      this.bufferPoolIndex.delete(buffer)
      gl.deleteBuffer(buffer)
    } else {
      pool.push(buffer)
    }
  }
  getTexture(pixels: number, format = gpu.gl.RGBA32UI) {
    let {gl} = gpu
    if (pixels !== 2 ** Math.ceil(Math.log2(pixels))) {
      throw new Error(`pixels must be a power of 2, got ${pixels}`)
    }

    let key = pixels + '.' + format
    if (!this.texturePool[key]) this.texturePool[key] = []
    let texture = this.texturePool[key].pop()

    if (!texture) {
      let width = 2 ** Math.ceil(Math.log2(pixels ** 0.5))
      let height = pixels / width

      texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.texturePoolIndex.set(texture, {key, width, height})
    }

    return texture
  }
  dimensions(texture: WebGLTexture) {
    let {width, height} = this.texturePoolIndex.get(texture)!
    return {width, height}
  }
  freeTexture(texture: WebGLTexture, destroy?: boolean) {
    let {gl} = gpu
    let {key} = this.texturePoolIndex.get(texture)!
    let pool = this.texturePool[key]
    if (pool.length > 8) destroy = true
    if (destroy) {
      this.texturePoolIndex.delete(texture)
      gl.deleteTexture(texture)
    } else {
      pool.push(texture)
    }
  }
}

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
  components = 0
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
  }
  get length() {
    let counts = new Set(this.attribs.map((p) => p.count))
    if (counts.size === 0) return 0
    if (counts.size >= 2) return NaN
    return Array.from(counts)[0]
  }
  get byteLength() {
    return this.components * 4
  }
  set byteLength(v: number) {
    this.components = v / 4
  }
  get texDimensions() {
    if (!this.byteLength) return [0, 0]
    let pixels = Math.ceil(this.byteLength / 16)
    let width = 2 ** Math.ceil(Math.log2(pixels ** 0.5))
    let height = pixels / width
    return [width, height]
  }
  free(destroy?: boolean) {
    let {pool} = gpu
    // TODO: free tex
    if (this.gl) pool.freeBuffer(this.gl, destroy)
    // if (this.tex) pool.freeTexture(this.tex, destroy)
    this.consumed = false
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
        pool.freeBuffer(read)
      }
      case 'gl': {
        if (!this.js && !this.tex) return
        let {gl, pool} = gpu
        this.gl = pool.getBuffer(this.byteLength)
        if (this.tex) {
          let fb = gl.createFramebuffer()!
          let [w, h] = this.texDimensions
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.gl!)
          gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0)
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
          gl.deleteFramebuffer(fb)
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

type LifetimeInput =
  | []
  | [any]
  | [any, any]
  | [any, any, any]
  | [any, any, any, any]
  | [any, any, any, any, any]
  | [any, any, any, any, any, any]
  | [any, any, any, any, any, any, any]
  | [any, any, any, any, any, any, any, any]
  | any[]

class Lifetime {
  buffers = new Set<Buffer>()
  free(except: Set<Buffer>) {
    let buffers = Array.from(this.buffers)
    buffers = buffers.filter((b) => !except.has(b))
    for (let b of buffers) b.free()
  }
}

type LifetimeRange = typeof range
type LifetimeBuffer = typeof buffer
export function lifetime<I extends LifetimeInput, O extends any>(
  fn: (lib: {range: LifetimeRange; buffer: LifetimeBuffer}, ...input: I) => O
): (...input: I) => O extends Promise<any> ? O : Promise<O> {
  let f = async (...input: I) => {
    const lt = new Lifetime()
    for (let i of input) {
      if (i instanceof Buffer && i.consumed) {
        i.consumed = false
        lt.buffers.add(i)
      }
    }
    function decorate<F extends Function>(f: F) {
      return ((...args: any[]) => {
        let result = f(...args)
        if (result instanceof Array) for (let b of result) lt.buffers.add(b)
        else lt.buffers.add(result)
        return result
      }) as unknown as F
    }
    let result = await fn({range: decorate(range), buffer: decorate(buffer)}, ...input)
    let seen = new Set<any>()
    let stack = [result] as any[]
    let except = new Set<Buffer>()
    while (stack.length) {
      let current = stack.pop()!
      if (current instanceof Buffer) except.add(current)
      if (current instanceof Buffer || seen.has(current)) continue
      seen.add(current)
      stack.push(...Object.values(current))
    }
    lt.free(except)
    return result
  }
  return f as any
}
