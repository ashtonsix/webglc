import {Buffer} from './buffer/buffer'
import {Kernel} from './kernel/kernel'
import {
  WebGLRenderer,
  WebGLRendererParameters,
  BufferGeometry,
  GLBufferAttribute,
  FramebufferTexture,
  Vector2,
  Vector3,
  PixelFormat,
  Sphere,
  Box3,
} from 'three138'
import {GLPool} from './buffer/pool'

interface THREE {
  WebGLRenderer: new (parameters?: WebGLRendererParameters) => WebGLRenderer
  BufferGeometry: new () => BufferGeometry
  Vector2: new (x?: number, y?: number) => Vector2
  Vector3: new (x?: number, y?: number, z?: number) => Vector3
  Sphere: new (center?: Vector3, radius?: number) => Sphere
  Box3: new (min?: Vector3, max?: Vector3) => Box3
  GLBufferAttribute: new (
    buffer: WebGLBuffer,
    type: number,
    itemSize: number,
    elementSize: 1 | 2 | 4,
    count: number
  ) => GLBufferAttribute
  FramebufferTexture: new (width: number, height: number, format: PixelFormat) => FramebufferTexture
  RGBAFormat: PixelFormat
  RGBAIntegerFormat: PixelFormat
}

export class GPU {
  kernels = [] as Kernel[]
  buffers = new Set<Buffer>()
  canvas!: HTMLCanvasElement
  dom!: HTMLDivElement
  backgroundContext!: CanvasRenderingContext2D
  gl!: WebGL2RenderingContext
  fb!: WebGLFramebuffer
  info!: ReturnType<GPU['getInfo']>
  idleCounter = 0
  threeRenderer?: WebGLRenderer
  THREE?: THREE
  constructor() {
    this.setContext(document.createElement('canvas'))
    this.info = this.getInfo()
  }
  setContext(canvas: HTMLCanvasElement, gl?: WebGL2RenderingContext) {
    for (let b of this.buffers) b.free()
    this.canvas = canvas
    this.gl = gl ?? this.canvas.getContext('webgl2')!
    this.fb = this.gl.createFramebuffer()!
    if (this._pool) this.pool.clear()
    this.kernels = []

    this.dom = document.createElement('div')
    let background = document.createElement('canvas')
    this.dom.appendChild(this.canvas)
    this.dom.appendChild(background)
    this.dom.style.display = 'inline-block'
    this.dom.style.position = 'relative'
    this.canvas.style.display = 'block'
    background.style.display = 'block'
    background.style.position = 'absolute'
    background.style.top = '0px'
    background.style.left = '0px'
    background.style.zIndex = '-1'
    let canvasDimensions = {width: this.canvas.width, height: this.canvas.height}
    for (let key of ['width', 'height'] as const) {
      Object.defineProperty(this.canvas, key, {
        get: () => canvasDimensions[key],
        set: (next) => {
          canvasDimensions[key] = next
          this.canvas.setAttribute(key, next)
          background.setAttribute(key, next)
        },
      })
    }
    this.backgroundContext = background.getContext('2d')!

    return this
  }
  blitToBackgroundCanvas() {
    this.backgroundContext.drawImage(this.canvas, 0, 0)
  }
  createThreeRenderer(THREE: THREE, params?: WebGLRendererParameters) {
    params = {...params, canvas: this.canvas, context: this.gl}
    this.threeRenderer = new THREE.WebGLRenderer(params)
    this.THREE = THREE
    let render = this.threeRenderer.render.bind(this.threeRenderer)
    this.threeRenderer.render = (...args) => {
      this.threeRenderer!.resetState()
      let result = render(...args)
      this.threeRenderer!.resetState()
      if (this.info.hasFlickerBug) this.blitToBackgroundCanvas()
      return result
    }
    return this.threeRenderer
  }
  getInfo() {
    let {gl} = this
    let info = {supportsRedInteger: false, supportsImmediateSync: false, hasFlickerBug: false}

    supportsRedInteger: {
      let tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32I, 1, 1)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

      let crf = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)
      info.supportsRedInteger = crf === gl.RED_INTEGER

      gl.deleteTexture(tex)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    firefox: {
      info.hasFlickerBug = navigator.userAgent.includes('Firefox')
      info.supportsImmediateSync = !navigator.userAgent.includes('Firefox')
    }

    return info
  }
  // hack around the circular dependency "buffer -> gpu -> buffer"
  _pool?: GLPool
  get pool() {
    if (!this._pool) this._pool = new GLPool()
    return this._pool
  }
  set pool(pool: GLPool) {
    this._pool = pool
  }
  async waitForIdle() {
    this.idleCounter = 0
    let {gl} = this
    let failed = false
    let sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
    gl.flush()
    await new Promise<void>((resolve, reject) => {
      let i = 0
      function test(): void {
        let delay = 2 ** (i - 1)
        i++
        switch (gl.clientWaitSync(sync, 0, 0)) {
          case gl.ALREADY_SIGNALED:
            return resolve()
          case gl.TIMEOUT_EXPIRED:
            // here Firefox may warn "ClientWaitSync must return TIMEOUT_EXPIRED until control has returned to the user agent's main loop"
            // as far as i can tell webglc's waitForIdle implementation is 100% correct and this warning shows up unavoidably anyway
            // https://searchfox.org/mozilla-central/source/dom/canvas/ClientWebGLContext.cpp#5207
            setTimeout(test, delay)
            return
          case gl.CONDITION_SATISFIED:
            return resolve()
          case gl.WAIT_FAILED:
            if (failed) return reject()
            // Firefox, even upon success, can return gl.WAIT_FAILED the first time it's queried, and gl.ALREADY_SIGNALLED the next time
            failed = true
            setTimeout(test, delay)
            return
          default:
            return reject()
        }
      }
      test()
    })
    gl.deleteSync(sync)
  }
  // async waitForIdle() {
  //   this.idleCounter = 0
  //   let {gl} = this
  //   let failed = false
  //   let sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
  //   gl.flush()
  //   await new Promise<void>((resolve, reject) => {
  //     let timeout = this.info.supportsImmediateSync ? 0 : 1
  //     function test(): void {
  //       timeout = Math.max(timeout * 2, 1)
  //       switch (gl.clientWaitSync(sync, 0, 0)) {
  //         case gl.ALREADY_SIGNALED:
  //           return resolve()
  //         case gl.CONDITION_SATISFIED:
  //           return resolve()
  //         case gl.TIMEOUT_EXPIRED:
  //           setTimeout(test, timeout)
  //           return
  //         case gl.WAIT_FAILED:
  //           // firefox, even upon success, may return gl.WAIT_FAILED the first time it's queried,
  //           // and gl.ALREADY_SIGNALLED the second time
  //           if (failed) return reject()
  //           failed = true
  //           setTimeout(test, timeout)
  //           return
  //         default:
  //           return reject()
  //       }
  //     }
  //     setTimeout(test, timeout)
  //   })
  //   gl.deleteSync(sync)
  // }
}

export const gpu = new GPU()
