import {Format, ComplexFormat, isComplexFormat} from '../format'
import {gpu} from '../gpu'
import {Buffer} from './buffer'

export async function copy<F extends Format | ComplexFormat>(buffer: Buffer<F>) {
  let result = new Buffer(isComplexFormat(buffer.format) ? {...buffer.format} : buffer.format)
  result.byteLength = buffer.byteLength
  result.attribs = JSON.parse(JSON.stringify(buffer.attribs))
  if (buffer.consumed) {
    result.js = buffer.js
    result.gl = buffer.gl
    result.tex = buffer.tex
    buffer.gl = null
    buffer.tex = null
    buffer.free()
  } else {
    let {gl, pool} = gpu
    result.gl = pool.getBuffer(buffer.byteLength)
    await buffer.acquire('gl')
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer.gl)
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, result.gl)
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, buffer.byteLength)
    gl.bindBuffer(gl.COPY_READ_BUFFER, null)
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
  }
  return result
}
