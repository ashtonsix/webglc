import {Format, ComplexFormat, isComplexFormat, isSimpleFormat} from '../format'
import {Buffer} from './buffer'
import {copy} from './copy'

export async function rename<F extends Format, S extends string>(
  buffer: Buffer<{[K in S]: F}>,
  dict: {[K in S]: '.'}
): Promise<Buffer<F>>
export async function rename<F extends Format, S extends string>(
  buffer: Buffer<F>,
  dict: {'.': S}
): Promise<Buffer<{[K in S]: F}>>
export async function rename<F extends ComplexFormat, D extends {readonly [K in keyof F]: string}>(
  buffer: Buffer<F>,
  dict: D
): Promise<Buffer<{[K in keyof F as D[K]]: F[K]}>>
export async function rename(buffer: Buffer, dict: {[x: string]: string}) {
  buffer = await copy(buffer)
  if ((Object.values(dict).includes('.') || dict['.']) && Object.values(dict).length > 1) {
    throw new Error(`If "." is given it must be the only key/value given`)
  }
  if (dict['.']) {
    if (isComplexFormat(buffer.format)) throw new Error(`Expected buffer with a simple format`)
    buffer.attribs[0].name = dict['.']
    buffer.format = {[dict['.']]: buffer.format as Format}
    return buffer
  }
  if (isSimpleFormat(buffer.format)) throw new Error(`Expected buffer with a complex format`)
  if (Object.values(dict).includes('.')) {
    let a = buffer.attribs.find((a) => dict[a.name!] === '.')!
    buffer.format = buffer.format[a.name!]
    a.name = null
    return buffer
  }

  let attribs = []
  let format = {} as ComplexFormat
  for (let a of buffer.attribs) {
    if (!dict[a.name!]) continue
    let n = dict[a.name!]
    a.name = n
    attribs.push(a)
    format[n] = a.format
  }
  buffer.attribs = attribs
  buffer.format = format
  return buffer
}
