import {Format, ComplexFormat, formatIterator, Null} from '../format'
import {gpu} from '../gpu'

export class GLPool {
  bufferPool = {} as {[key: string]: WebGLBuffer[]}
  texturePool = {} as {[key: string]: WebGLTexture[]}
  bufferPoolMap = new WeakMap<WebGLBuffer, string>()
  texturePoolMap = new WeakMap<WebGLTexture, string>()
  _poolsize = 0
  get poolsize() {
    return this._poolsize
  }
  set poolsize(poolsize: number) {
    this._poolsize = poolsize
    let pools = Object.values({...this.bufferPool, ...this.texturePool})
    for (let r of pools.flatMap((pool) => pool.slice(poolsize))) this.forget(r)
  }
  sizeBuffer(format: Format | ComplexFormat | Null, count: number) {
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
      this.bufferPoolMap.set(buffer, key)
    }

    return buffer
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
      this.texturePoolMap.set(texture, key)
    }

    return texture
  }
  clear() {
    let {gl} = gpu
    for (let b of Object.values(this.bufferPool).flat()) gl.deleteBuffer(b)
    for (let t of Object.values(this.texturePool).flat()) gl.deleteTexture(t)
    this.bufferPool = {}
    this.texturePool = {}
    this.bufferPoolMap = new WeakMap()
    this.texturePoolMap = new WeakMap()
  }
  reclaim(buffer?: WebGLBuffer | null): void
  reclaim(texture?: WebGLTexture | null): void
  reclaim(resource?: WebGLBuffer | WebGLTexture | null) {
    if (!resource) return
    let key = this.bufferPoolMap.get(resource) || this.texturePoolMap.get(resource)
    if (!key) return
    let pool = this.bufferPool[key] || this.texturePool[key]
    if (!pool) return
    if (pool.length >= this.poolsize) {
      this.delete(resource)
    } else {
      pool.push(resource)
    }
  }
  forget(buffer?: WebGLBuffer | null): void
  forget(texture?: WebGLTexture | null): void
  forget(resource?: WebGLBuffer | WebGLTexture | null) {
    if (!resource) return
    let key = this.bufferPoolMap.get(resource) || this.texturePoolMap.get(resource)
    if (!key) return
    this.bufferPoolMap.delete(resource)
    this.texturePoolMap.delete(resource)
    let pool = this.bufferPool[key] || this.texturePool[key]
    if (!pool) return
    let i = pool.findIndex((r) => r === resource)
    if (i === -1) return
    pool.splice(i, 1)
  }
  delete(buffer?: WebGLBuffer | null): void
  delete(texture?: WebGLTexture | null): void
  delete(resource?: WebGLBuffer | WebGLTexture | null) {
    let {gl} = gpu
    if (!resource) return
    this.forget(resource)
    if (resource instanceof WebGLBuffer) gl.deleteBuffer(resource)
    if (resource instanceof WebGLTexture) gl.deleteTexture(resource)
  }
}
