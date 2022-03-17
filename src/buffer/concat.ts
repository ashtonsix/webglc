import {Format, ComplexFormat, isComplexFormat} from '../format'
import {gpu} from '../gpu'
import {Buffer, attributeIterator} from './buffer'
import {merge} from './merge'

export async function concat<F extends Format | ComplexFormat>(
  ...buffers: Buffer<F>[]
): Promise<Buffer<F>> {
  for (let i in buffers) {
    let b = buffers[i]
    if (isNaN(b.length)) {
      let issue = `Sub-buffer "${i}" has attributes of unequal length`
      let found = b.attribs.map((a) => `${a.name}=${a.count}`).join(', ')
      throw new Error(`${issue}. Found ${found}`)
    }
  }
  if (isComplexFormat(buffers[0].format)) {
    type S = {[x: string]: Buffer<Format>}[]
    let splits = (await Promise.all(buffers.map((b) => b.split()))) as S
    let split = splits[0]
    for (let k in split) split[k] = await concat(...splits.map((b) => b[k].consume()))
    return (await merge(split)) as any
  }

  let {gl, pool} = gpu
  let result = new Buffer(buffers[0].format)
  result.byteLength = 2 ** Math.ceil(Math.log2(buffers.reduce((pv, b) => pv + b.byteLength, 0)))
  result.gl = pool.getBuffer(result.byteLength)
  result.attribs[0].count = buffers.reduce((pv, b) => pv + b.attribs[0].count, 0)

  gl.bindBuffer(gl.COPY_WRITE_BUFFER, result.gl)

  let cursor = 0
  for (let b of buffers) {
    await b.acquire('gl')
    if (!b.gl) continue
    let byteLength = attributeIterator(b.attribs[0]).get(b.attribs[0].count) * 4
    gl.bindBuffer(gl.COPY_READ_BUFFER, b.gl)
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, cursor, byteLength)
    cursor += byteLength
    if (b.consumed) b.free()
  }
  gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
  gl.bindBuffer(gl.COPY_READ_BUFFER, null)

  return result
}
