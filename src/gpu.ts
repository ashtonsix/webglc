import {BufferPool} from './buffer/buffer'
import {Kernel} from './kernel/kernel'

export class GPU {
  kernels: Kernel[]
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  _pool?: BufferPool
  support: ReturnType<GPU['getSupport']>
  idleCounter = 0
  constructor() {
    this.canvas = document.createElement('canvas')
    this.gl = this.canvas.getContext('webgl2')!
    this.kernels = []
    this.support = this.getSupport()
  }
  getSupport() {
    let {gl} = this
    let support = {RED_INTEGER: false}

    RED_INTEGER: {
      let tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, 1, 1)

      let fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

      support.RED_INTEGER = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) === gl.RED_INTEGER

      gl.deleteTexture(tex)
      gl.deleteFramebuffer(fb)
    }

    return support
  }
  // hack to make things place nice with the circular dependency "buffer -> gpu -> buffer"
  get pool() {
    if (!this._pool) this._pool = new BufferPool()
    return this._pool
  }
  setContext(canvas: HTMLCanvasElement, gl?: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl ?? this.canvas.getContext('webgl2')!
    this._pool = new BufferPool()
    this.kernels = []
  }
  freeAll() {
    let {gl, pool} = this

    let buffers = Array.from(pool.bufferPoolIndex.keys())
    let textures = Array.from(pool.texturePoolIndex.keys())
    for (let i in pool.bufferPool) buffers.push(...pool.bufferPool[i])
    for (let i in pool.texturePool) textures.push(...pool.texturePool[i])
    for (let b of buffers) gl.deleteBuffer(b)
    for (let t of textures) gl.deleteTexture(t)

    pool.bufferPool = {}
    pool.texturePool = {}
    pool.bufferPoolIndex = new Map()
    pool.texturePoolIndex = new Map()
  }
  async waitForIdle() {
    this.idleCounter = 0
    let {gl} = this
    let failed = false
    let sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
    gl.flush()
    await new Promise<void>((resolve, reject) => {
      function test(): void {
        switch (gl.clientWaitSync(sync, 0, 0)) {
          case gl.ALREADY_SIGNALED:
            return resolve()
          case gl.TIMEOUT_EXPIRED:
            setTimeout(test, 10)
            return
          case gl.CONDITION_SATISFIED:
            return resolve()
          case gl.WAIT_FAILED:
            if (failed) return reject()
            // firefox, even upon success, returns gl.WAIT_FAILED the first time it's queried,
            // and gl.ALREADY_SIGNALLED the second time (cypress-specific?)
            failed = true
            setTimeout(test, 10)
            return
          default:
            return reject()
        }
      }
      test()
    })
    gl.deleteSync(sync)
  }
}

export const gpu = new GPU()
