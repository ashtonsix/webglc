import {buffer, Buffer} from '../buffer/buffer'
import {format} from '../format'
import {gpu} from '../gpu'
import {Program, trimLeadingSpace, Kernel} from './kernel'
import {map, readRedIntegerTex} from './gl'
import {generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import * as template from './template'

export function filtro(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  let struct = generateProgramModel(kernel, sourceFragments, src)
  struct.main.after = trimLeadingSpace(
    `
      glc_out_0 = glc_out_0 == 0 ? 0 : 1;
      glc_out_1 = glc_out_1 == 0 ? 0 : 1;
      glc_out_2 = glc_out_2 == 0 ? 0 : 1;
      glc_out_3 = glc_out_3 == 0 ? 0 : 1;
    `,
    2
  )
  kernel.programs.main = new Program(
    template.vs(struct),
    template.fs(),
    struct.outRegisters.map((r) => `glc_out_${r.name}`)
  )
  let prefixSum = new Kernel(
    trimLeadingSpace(`
      const int identity = 0;

      void scan(int i) {
        ivec4 in0 = read(i, f_ivec4);
        ivec4 in1 = read(i + 4, f_ivec4);
        ivec4 r = ivec4(in0.xz, in1.xz) + ivec4(in0.yw, in1.yw);
        write(r.x, r.y, r.z, r.w);
      }`),
    format.int,
    format.int,
    null
  )
  kernel.programs.scatter = new Program(
    trimLeadingSpace(`
      #version 300 es
      uniform vec2 fdim;
      uniform ivec2 idim;

      in int i;
      flat out int j;

      void main() {
        if (i == 0) return;
        j = gl_VertexID;
        float x = ((float((i - 1) % idim.x) + .5) / fdim.x) * 2. - 1.;
        float y = ((float((i - 1) / idim.x) + .5) / fdim.y) * 2. - 1.;
        gl_Position = vec4(x, y, 0, 1);
        gl_PointSize = 1.;
      }
    `).trim(),
    trimLeadingSpace(`
      #version 300 es
      flat in int j; out int i;
      void main() { i = j; }
    `).trim(),
    []
  )
  kernel.exec = async (r, read, scope, flags) => {
    read = await map(kernel.programs.main.gl!, r, {read, scope, write: kernel.write})
    let [next] = await prefixSum.invoke(r, 'scan', read, null)
    read.free()
    read = next

    let {gl, pool} = gpu

    let blength = null as null | Buffer<typeof format.int>
    if (flags.includes('length')) {
      blength = buffer(format.int)
      blength.attribs[0].count = 1
      blength.byteLength = 16
      blength.gl = pool.getBuffer(blength.byteLength)

      gl.bindBuffer(gl.COPY_READ_BUFFER, read.gl)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, blength.gl)
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, r.length * 4 - 4, 0, 4)
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    gl.useProgram(kernel.programs.scatter.gl!)

    let dataTex = pool.getTexture(2 ** Math.ceil(Math.log2(read.length)), gl.R32I)
    let maskTex = pool.getTexture(2 ** Math.ceil(Math.log2(read.length)), gl.DEPTH24_STENCIL8)
    let {width: w, height: h} = pool.dimensions(dataTex)
    gl.uniform2f(gl.getUniformLocation(kernel.programs.scatter.gl!, 'fdim'), w, h)
    gl.uniform2i(gl.getUniformLocation(kernel.programs.scatter.gl!, 'idim'), w, h)
    let fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    let attach = gl.COLOR_ATTACHMENT0
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, dataTex, 0)
    attach = gl.DEPTH_STENCIL_ATTACHMENT
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, maskTex, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, read.gl!)
    let va = gl.createVertexArray()
    let iloc = gl.getAttribLocation(kernel.programs.scatter.gl!, 'i')
    gl.bindVertexArray(va)
    gl.enableVertexAttribArray(iloc)
    gl.vertexAttribIPointer(iloc, 1, gl.INT, 0, 0)

    gl.enable(gl.STENCIL_TEST)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR)
    gl.stencilFunc(gl.EQUAL, 0, 255)
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 0, 0)
    gl.clearBufferiv(gl.COLOR, 0, [-1, -1, -1, -1])
    gl.viewport(0, 0, w, h)
    gl.drawArrays(gl.POINTS, 0, r.length)
    gl.disable(gl.STENCIL_TEST)

    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.deleteFramebuffer(fb)
    gl.deleteVertexArray(va)

    readRedIntegerTex(dataTex, r.length, false, read.gl!)
    pool.freeTexture(dataTex)
    pool.freeTexture(maskTex)
    read.tex = null

    let result = [read]
    if (blength) result.push(blength)
    return result
  }
  return kernel
}
