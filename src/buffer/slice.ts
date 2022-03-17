import {Format, ComplexFormat, isComplexFormat, isSimpleFormat} from '../format'
import {gpu} from '../gpu'
import {Buffer} from './buffer'
import {merge} from './merge'

export async function slice<F extends Format | ComplexFormat>(
  buffer: Buffer<F>,
  start: number,
  end?: number
): Promise<Buffer<F>> {
  if (isComplexFormat(buffer.format)) {
    let split = (await buffer.split()) as {[x: string]: Buffer<Format>}
    for (let k in split) split[k] = await split[k].consume().slice(start, end)
    return (await merge(split)) as any
  }

  buffer = await buffer.copy()
  if (end != null) {
    if (end < 0) {
      end = Math.max(...buffer.attribs.map((a) => a.count)) + end
    }
    for (let a of buffer.attribs) {
      a.count = Math.min(a.count, end)
    }
  }

  let {gl} = gpu
  if (start % 4 === 0) {
    for (let a of buffer.attribs) {
      a.offset += start
      a.count -= start
    }
  } else if (isSimpleFormat(buffer.format)) {
    for (let a of buffer.attribs) {
      a.count -= start
    }
    let copy = await buffer.copy()
    gl.bindBuffer(gl.COPY_READ_BUFFER, copy.gl)
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer.gl)
    gl.copyBufferSubData(
      gl.COPY_READ_BUFFER,
      gl.COPY_WRITE_BUFFER,
      start * 4,
      0,
      buffer.byteLength - start * 4
    )
    gl.bindBuffer(gl.COPY_READ_BUFFER, null)
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    copy.free()
  }

  return buffer
}
