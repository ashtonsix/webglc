import {gpu} from '../gpu'
import {Range} from '../range'
import {buffer, Buffer} from '../buffer/buffer'
import {Format, ComplexFormat} from '../format'
import {Program, trimLeadingSpace} from './kernel'
import * as template from './template'

export function finishCompileParallel(programs: Program[]) {
  programs = programs.filter((p) => !p.gl)
  let {gl} = gpu
  let vsca = [] as WebGLShader[]
  let fsca = [] as WebGLShader[]
  for (let i in programs) {
    let p = programs[i]
    let vsc = gl.createShader(gl.VERTEX_SHADER)!
    vsca[i] = vsc
    gl.shaderSource(vsc, p.vs!)
    let fsc = gl.createShader(gl.FRAGMENT_SHADER)!
    fsca[i] = fsc
    gl.shaderSource(fsc, p.fs!)
  }
  for (let i in programs) {
    gl.compileShader(vsca[i]!)
    gl.compileShader(fsca[i]!)
  }
  for (let i in programs) {
    let p = programs[i]
    p.gl = gl.createProgram()!
    gl.attachShader(p.gl!, vsca[i]!)
    gl.attachShader(p.gl!, fsca[i]!)
    if (p.transformFeedback.length) {
      gl.transformFeedbackVaryings(p.gl!, p.transformFeedback, gl.INTERLEAVED_ATTRIBS)
    }
  }
  for (const p of programs) {
    gl.linkProgram(p.gl!)
  }
  for (const i in programs) {
    let p = programs[i]
    if (!gl.getProgramParameter(p.gl!, gl.LINK_STATUS)) {
      console.log(p.vs)
      console.error('Link failed: ' + gl.getProgramInfoLog(p.gl!))
      console.error('vs info-log: ' + gl.getShaderInfoLog(vsca[i]!))
      console.error('fs info-log: ' + gl.getShaderInfoLog(fsca[i]!))
    }
  }
}

type MapConfig = {
  read?: Buffer | null
  scope?: Buffer | null
  scope2?: Buffer | null
  write: Format | ComplexFormat
  outputByteLength?: number | null
  uniforms?: () => void
}
export async function map(program: WebGLProgram, range: Range, config = {} as MapConfig) {
  let length = range.end - range.start
  let {gl, pool} = gpu
  let output = buffer(config.write)
  output.byteLength = config.outputByteLength ?? pool.sizeBuffer(config.write, length)
  output.gl = pool.getBuffer(output.byteLength)
  for (let p of output.attribs) p.count = length
  gl.useProgram(program)
  let attribi = 0
  let inputKeys = ['read', 'scope', 'scope2'] as const
  for (let i in inputKeys) {
    let k = inputKeys[i]
    let input = config[k]
    if (!input) continue
    gl.activeTexture(gl.TEXTURE0 + +i)
    await input.acquire('tex')
    if (!input.tex) throw new Error(`Input buffer is empty`)
    gl.bindTexture(gl.TEXTURE_2D, input.tex)
    gl.uniform1i(gl.getUniformLocation(program, `glc_sampler${i}`), +i)
    for (let j in input.attribs) {
      let u = input.attribs[j]
      gl.uniform1i(gl.getUniformLocation(program, `glc_attribs[${attribi}].repeat`), u.repeat)
      gl.uniform1i(gl.getUniformLocation(program, `glc_attribs[${attribi}].offset`), u.offset)
      gl.uniform1i(gl.getUniformLocation(program, `glc_attribs[${attribi}].count`), u.count)
      attribi++
    }
  }
  // gl.uniform1i(gl.getUniformLocation(program, `groupSize`), range.groupSize)
  gl.uniform3i(
    gl.getUniformLocation(program, 'glc_urandomState'),
    Math.random() * 2 ** 32 + 128,
    Math.random() * 2 ** 32 + 128,
    Math.random() * 2 ** 32 + 128
  )
  if (config.uniforms) config.uniforms()
  let tf = gl.createTransformFeedback()
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf)
  gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output.gl, 0, output.byteLength)
  gl.enable(gl.RASTERIZER_DISCARD)
  gl.beginTransformFeedback(gl.POINTS)
  gl.drawArrays(gl.POINTS, 0, Math.ceil(length / 4))
  gl.endTransformFeedback()
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
  gl.deleteTransformFeedback(tf)
  gl.disable(gl.RASTERIZER_DISCARD)
  return output
}

let readRedIntegerProgram: WebGLProgram
export function readRedIntegerTex(
  tex: WebGLTexture,
  pixels: number,
  uint = false,
  buf?: WebGLBuffer
) {
  pixels = 2 ** Math.ceil(Math.log2(pixels))
  let {gl, pool} = gpu
  let width = 2 ** Math.ceil(Math.log2(pixels ** 0.5))
  let height = pixels / width
  if (!buf) buf = pool.getBuffer(pixels * 4)
  let fb = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  let attach = gl.COLOR_ATTACHMENT0
  gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, tex, 0)
  if (gpu.support.RED_INTEGER) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf!)
    gl.readPixels(0, 0, width, height, gl.RED_INTEGER, uint ? gl.UNSIGNED_INT : gl.INT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.deleteFramebuffer(fb)
    return
  }
  if (!readRedIntegerProgram) {
    let program = new Program(
      trimLeadingSpace(`
        #version 300 es
        in int i; flat out int o;
        void main() { o = i; }
      `).trim(),
      template.fs(),
      ['o']
    )
    finishCompileParallel([program])
    readRedIntegerProgram = program.gl!
  }

  gl.useProgram(readRedIntegerProgram)

  let tmp = pool.getBuffer(pixels * 16)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, tmp)
  gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, uint ? gl.UNSIGNED_INT : gl.INT, 0)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  gl.deleteFramebuffer(fb)

  gl.bindBuffer(gl.ARRAY_BUFFER, tmp)
  let va = gl.createVertexArray()
  let iloc = gl.getAttribLocation(readRedIntegerProgram, 'i')
  gl.bindVertexArray(va)
  gl.enableVertexAttribArray(iloc)
  gl.vertexAttribIPointer(iloc, 1, gl.INT, 16, 0) // important! stride = 16 bytes

  let tf = gl.createTransformFeedback()
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf)
  gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf, 0, pixels * 4)

  gl.enable(gl.RASTERIZER_DISCARD)
  gl.beginTransformFeedback(gl.POINTS)
  gl.drawArrays(gl.POINTS, 0, pixels)
  gl.endTransformFeedback()
  gl.disable(gl.RASTERIZER_DISCARD)

  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  gl.deleteTransformFeedback(tf)
  gl.deleteVertexArray(va)
}
