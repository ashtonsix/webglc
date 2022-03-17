import {Format, ComplexFormat, ParsedFormat, formatIterator} from '../format'
import {gpu} from '../gpu'
import {Buffer, attributeIterator} from './buffer'

export function writeSync<F extends Format | ComplexFormat>(
  buffer: Buffer<F>,
  data: ParsedFormat<F>[]
) {
  buffer.free()
  let {pool} = gpu

  let fit = formatIterator(buffer.format)
  let uint = new Uint32Array(pool.sizeBuffer(buffer.format, data.length) / 4)
  let int = new Int32Array(uint.buffer)
  let float = new Float32Array(uint.buffer)

  for (let p of buffer.attribs) p.count = data.length

  for (let attrib of buffer.attribs) {
    let ait = attributeIterator(attrib)
    let f = attrib.format
    for (let i = 0; i < ait.length; i++) {
      let j = ait[i]
      for (let c = 0; c < f.components; c++) {
        let tmp = fit.get(data[i], attrib.name)
        tmp = f.components === 1 ? tmp : (tmp as number[])[c]
        let value = typeof tmp === 'number' ? tmp || 0 : 0
        let buffer = {uint, int, float}[f.base]
        buffer[j + c] = value
      }
    }
  }

  buffer.js = uint
  buffer.byteLength = uint.byteLength

  return buffer
}

export function write<F extends Format | ComplexFormat>(
  buffer: Buffer<F>,
  data: ParsedFormat<F>[]
) {
  return Promise.resolve(writeSync(buffer, data))
}
