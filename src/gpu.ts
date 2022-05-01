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
  canvas!: HTMLCanvasElement
  dom!: HTMLDivElement
  gl!: WebGL2RenderingContext
  info!: ReturnType<GPU['getInfo']>
  // @internal
  kernels = [] as Kernel[]
  // @internal
  buffers = new Set<Buffer>()
  // @internal
  backgroundContext!: CanvasRenderingContext2D
  // @internal
  fb!: WebGLFramebuffer
  // @internal
  idleCounter = 0
  // @internal
  threeRenderer?: WebGLRenderer
  // @internal
  THREE?: THREE
  constructor() {
    this.setContext(document.createElement('canvas'))
    this.info = this.getInfo()
  }
  // @internal
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
  // @internal
  getInfo() {
    let {gl} = this
    let info = {hasFlickerBug: false, maxTransformComponents: 0}

    info.hasFlickerBug = navigator.userAgent.includes('Firefox')
    info.maxTransformComponents = gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)

    return info
  }
  // hack around the circular dependency "buffer -> gpu -> buffer"
  // @internal
  _pool?: GLPool
  // @internal
  get pool() {
    if (!this._pool) this._pool = new GLPool()
    return this._pool
  }
  // @internal
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
      function test(): void {
        switch (gl.clientWaitSync(sync, 0, 0)) {
          case gl.ALREADY_SIGNALED:
            return resolve()
          case gl.TIMEOUT_EXPIRED:
            // here Firefox may warn "ClientWaitSync must return TIMEOUT_EXPIRED until control has returned to the user agent's main loop"
            // as far as i can tell webglc's waitForIdle implementation is 100% correct and this warning shows up unavoidably anyway
            // https://searchfox.org/mozilla-central/source/dom/canvas/ClientWebGLContext.cpp#5207
            setTimeout(test, 4)
            return
          case gl.CONDITION_SATISFIED:
            return resolve()
          case gl.WAIT_FAILED:
            if (failed) return reject()
            // Firefox, even upon success, can return gl.WAIT_FAILED the first time it's queried, and gl.ALREADY_SIGNALLED the next time
            failed = true
            setTimeout(test, 4)
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
