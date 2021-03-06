import {gpu} from '../gpu'
import {Range} from '../range'
import {buffer, Buffer} from '../buffer/buffer'
import {Format, ComplexFormat} from '../format'
import {Program, trimLeadingSpace} from './kernel'
import * as template from './template'
import {logSourceError} from './parse'

export function finishCompileParallel(programs: Program[]) {
  programs = programs.filter((p) => !p.gl.length)
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
    for (let {registers} of p.transformFeedback) {
      let glp = gl.createProgram()!
      p.gl.push(glp)
      gl.attachShader(glp, vsca[i]!)
      gl.attachShader(glp, fsca[i]!)
      if (p.transformFeedback.length) {
        gl.transformFeedbackVaryings(glp, registers, gl.INTERLEAVED_ATTRIBS)
      }
    }
  }
  for (const p of programs) {
    for (const glp of p.gl) {
      gl.linkProgram(glp)
    }
  }
  let matches = new Set<string>()
  for (const i in programs) {
    let p = programs[i]
    for (const glp of p.gl) {
      if (!gl.getProgramParameter(glp!, gl.LINK_STATUS)) {
        let ve = gl.getShaderInfoLog(vsca[i]!)!.matchAll(/ERROR: \d+:(\d+):(.+)/g)
        let fe = gl.getShaderInfoLog(fsca[i]!)!.matchAll(/ERROR: \d+:(\d+):(.+)/g)
        let vg = {} as {[x: string]: string[]}
        let fg = {} as {[x: string]: string[]}
        for (let [match, line, message] of ve) {
          if (matches.has(match)) continue
          if (!vg[line]) vg[line] = []
          vg[line].push(message.trim())
          matches.add(match)
        }
        for (let [match, line, message] of fe) {
          if (matches.has(match)) continue
          if (!fg[line]) fg[line] = []
          fg[line].push(message.trim())
          matches.add(match)
        }
        for (let line in vg) logSourceError(vg[line].join('\n'), p.vs, +line - 1)
        for (let line in fg) logSourceError(fg[line].join('\n'), p.fs, +line - 1)
      }
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
export async function map(program: Program, range: Range, config = {} as MapConfig) {
  if (program.gl.length === 1) {
    return mapOne(program.gl[0], range, config)
  }
  config.write = config.write as ComplexFormat
  let parts = [] as Buffer<ComplexFormat>[]
  for (let i = 0; i < program.gl.length; i++) {
    let attribs = program.transformFeedback[i].attribs
    let write = {} as any
    for (let k in config.write) if (attribs.includes(k)) write[k] = config.write[k]
    let part = await mapOne(program.gl[i], range, {...config, write})
    parts.push(part as Buffer<ComplexFormat>)
  }
  return await buffer.merge(...parts)
}

export async function mapOne(program: WebGLProgram, range: Range, config = {} as MapConfig) {
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
    (Math.random() * 2 ** 32 + 128) % 2 ** 32,
    (Math.random() * 2 ** 32 + 128) % 2 ** 32,
    (Math.random() * 2 ** 32 + 128) % 2 ** 32
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.fb)
  let attach = gl.COLOR_ATTACHMENT0
  gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, tex, 0)
  if (!readRedIntegerProgram) {
    let program = new Program(
      trimLeadingSpace(`
        #version 300 es
        in int i; flat out int o;
        void main() { o = i; }
      `).trim(),
      template.fs(),
      [{attribs: [], registers: ['o']}]
    )
    finishCompileParallel([program])
    readRedIntegerProgram = program.gl[0]!
  }

  gl.useProgram(readRedIntegerProgram)

  let tmp = pool.getBuffer(pixels * 16)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, tmp)
  gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, uint ? gl.UNSIGNED_INT : gl.INT, 0)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  gl.bindBuffer(gl.ARRAY_BUFFER, tmp)
  let va = gl.createVertexArray()
  let iloc = gl.getAttribLocation(readRedIntegerProgram, 'i')
  gl.bindVertexArray(va)
  gl.enableVertexAttribArray(iloc)
  gl.vertexAttribIPointer(iloc, 1, gl.INT, 16, 0) // stride = 16 bytes (every 4th integer)

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
