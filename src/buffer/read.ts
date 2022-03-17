import {Format, ComplexFormat, isComplexFormat, ParsedFormat} from '../format'
import {Buffer, attributeIterator} from './buffer'

export async function read<F extends Format | ComplexFormat>(
  buffer: Buffer<F>
): Promise<ParsedFormat<F>[]> {
  await buffer.acquire('js')
  if (!buffer.js) return []

  let uint = new Uint32Array(buffer.js.buffer)
  let int = new Int32Array(buffer.js.buffer)
  let float = new Float32Array(buffer.js.buffer)

  let results = [] as any[]
  let attribs = {} as {[x: string]: any[]}
  for (let attrib of buffer.attribs) {
    if (attrib.name) attribs[attrib.name] = []
    let ait = attributeIterator(attrib)
    let f = attrib.format
    for (let i of ait) {
      let buffer = {uint, int, float}[f.base]
      let tmp = buffer.slice(i, i + f.components)
      let value = f.components === 1 ? tmp[0] : Array.from(tmp)
      if (attrib.name) attribs[attrib.name].push(value)
      else results.push(value)
    }
  }

  if (!isComplexFormat(buffer.format)) return results
  for (let i = 0; ; i++) {
    let value = {} as {[x: string]: any}
    for (let attrib of buffer.attribs) {
      if (attribs[attrib.name!][i] != null) value[attrib.name!] = attribs[attrib.name!][i]
    }
    if (Object.keys(value).length === 0) break
    results.push(value)
  }

  return results
}
