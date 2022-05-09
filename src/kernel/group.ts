import {buffer, Buffer} from '../buffer/buffer'
import {Format, format, ComplexFormat} from '../format'
import {gpu} from '../gpu'
import {Program, trimLeadingSpace, Kernel} from './kernel'
import {map} from './gl'
import {generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import * as template from './template'
import {Range} from '../range'

let primeBiggest = 1048576
let primeSieve = new Uint8Array(primeBiggest)
let primes = [1, 2 /* ... */]
function getPrime(gte: number) {
  let lo = 0
  let hi = primes.length
  let guess = Math.floor((lo + hi) / 2)
  while (lo !== guess) {
    if (primes[guess] >= gte && primes[guess - 1] < gte) break
    if (primes[guess] > gte) hi = guess
    else lo = guess
    guess = Math.min(Math.floor((lo + hi) / 2), primes.length - 1)
  }
  if (primes[guess] >= gte) return primes[guess]
  for (let i = primes[guess]; i < primeBiggest; i++) {
    if (primeSieve[i]) continue
    primes.push(i)
    for (let j = i; j < primeBiggest; j += i) primeSieve[j] = 1
    if (i >= gte) return i
  }
  return primes[primes.length - 1]
}

// selecting a bucket (4 integers per bucket):
// prime * groupId + (random() % prime);

export function group(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  let struct = generateProgramModel(kernel, sourceFragments, src)
  kernel.programs.main = new Program(template.vs(struct), template.fs(), Program.tf(struct))
  kernel.programs.scatter = new Program(
    trimLeadingSpace(`
      #version 300 es
      uniform vec2 fdim;
      uniform ivec2 idim;
      uniform int glc_bucketSize;

      in int i;
      flat out int j;

      void main() {
        j = gl_VertexID;
        int xy = i * glc_bucketSize + ((1664525 * (j + 1) + 1013904223) % glc_bucketSize);
        float x = ((float(xy % idim.x) + .5) / fdim.x) * 2. - 1.;
        float y = ((float(xy / idim.x) + .5) / fdim.y) * 2. - 1.;
        gl_Position = vec4(x, y, float(gl_VertexID) * 2.38418579e-7, 1);
        gl_PointSize = 1.;
      }
    `).trim(),
    trimLeadingSpace(`
      #version 300 es
      flat in int j; out uvec4 i;
      void main() { i = uvec4(j, j, j, j); }
    `).trim(),
    [{attribs: [], registers: []}]
  )
  function insert4(r: Range, read: Buffer<Format | ComplexFormat>) {
    let {gl, pool} = gpu

    gl.useProgram(kernel.programs.scatter.gl[0])
    let bucketSize = getPrime(r.groupSize! / 4)
    let pixels = 2 ** Math.ceil(Math.log2(bucketSize * r.groupCount!))
    let width = 2 ** Math.ceil(Math.log2(pixels ** 0.5))
    let height = pixels / width
    let dataTex = pool.getTexture(pixels, gl.RGBA32UI)
    let maskTex = pool.getTexture(pixels, gl.DEPTH24_STENCIL8)

    gl.uniform2f(gl.getUniformLocation(kernel.programs.scatter.gl[0], 'fdim'), width, height)
    gl.uniform2i(gl.getUniformLocation(kernel.programs.scatter.gl[0], 'idim'), width, height)
    gl.uniform1i(gl.getUniformLocation(kernel.programs.scatter.gl[0], 'glc_bucketSize'), bucketSize)
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dataTex, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, maskTex, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, read.gl!)
    let va = gl.createVertexArray()
    let iloc = gl.getAttribLocation(kernel.programs.scatter.gl[0], 'i')
    gl.bindVertexArray(va)
    gl.enableVertexAttribArray(iloc)
    gl.vertexAttribIPointer(iloc, 1, gl.INT, 0, 0)

    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.STENCIL_TEST)
    gl.clearBufferuiv(gl.COLOR, 0, [-1, -1, -1, -1])
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0)
    gl.viewport(0, 0, width, height)

    gl.colorMask(true, false, false, false)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    gl.depthFunc(gl.LESS)
    gl.drawArrays(gl.POINTS, 0, r.length)

    gl.colorMask(false, true, false, false)
    gl.depthFunc(gl.GREATER)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR)
    gl.stencilFunc(gl.GREATER, 1, 255)
    gl.drawArrays(gl.POINTS, 0, r.length)

    gl.colorMask(false, false, true, false)
    gl.stencilFunc(gl.GREATER, 2, 255)
    gl.drawArrays(gl.POINTS, 0, r.length)

    gl.colorMask(false, false, false, true)
    gl.stencilFunc(gl.GREATER, 3, 255)
    gl.drawArrays(gl.POINTS, 0, r.length)

    gl.colorMask(true, true, true, true)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteVertexArray(va)

    pool.reclaim(maskTex)

    return dataTex
  }
  kernel.exec = async (r, read, scope, flags) => {
    read = read as Buffer<Format | ComplexFormat>
    read = await map(kernel.programs.main, r, {read, scope, write: kernel.write})
    let {gl, pool} = gpu

    let dataTex = insert4(r, read)

    let result = buffer(format.int)
    result.attribs[0].count = r.groupSize! * r.groupCount!
    result.byteLength = pool.sizeBuffer(format.int, result.attribs[0].count)
    result.tex = dataTex
    read.free()

    return [result]
  }
  return kernel
}
