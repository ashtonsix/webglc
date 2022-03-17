import {Buffer} from '../buffer/buffer'
import {Range} from '../range'
import format, {ComplexFormat, Format, formatIterator, formatsMatch, Null} from '../format'
import {gpu} from '../gpu'
import {finishCompileParallel} from './gl'
import {extractSourceFragments, validateSourceFragments} from './parse'
import {map} from './map'
import {filtro} from './filtro'
import {reduce} from './reduce'
import {scan} from './scan'
import {sort} from './sort'

function compile(kernel: Kernel) {
  let [sourceFragments] = extractSourceFragments(kernel.src)
  validateSourceFragments(kernel, sourceFragments)
  kernel.method = sourceFragments.entrypoint[0].key as typeof kernel['method']

  switch (kernel.method) {
    case 'map': {
      return map(kernel)
    }
    case 'filtro': {
      return filtro(kernel)
    }
    case 'reduce': {
      return reduce(kernel)
    }
    case 'scan': {
      return scan(kernel)
    }
    case 'sort': {
      return sort(kernel)
    }
  }
}

export class Kernel<
  R extends Format | ComplexFormat | Null = Format | ComplexFormat | Null,
  W extends Format | ComplexFormat = Format | ComplexFormat,
  S extends ComplexFormat | Null = ComplexFormat | Null
> {
  method = 'map' as typeof allowedEntrypoints[number]
  programs = {} as {[x: string]: Program}
  exec = null as unknown as (
    range: Range,
    read: Buffer | null,
    scope: Buffer | null,
    flags: string[]
  ) => Promise<Buffer[]>
  constructor(public src: string, public read: R, public write: W, public scope: S) {
    compile(this)
    gpu.kernels.push(this)
  }
  async invoke(
    range: Range,
    method: string,
    read: Buffer | null,
    scope: Buffer | null,
    flags = [] as string[]
  ): Promise<Buffer[]> {
    try {
      if (!formatsMatch(read?.format, this.read)) console.error(`Read format doesn't match`)
      if (!formatsMatch(scope?.format, this.scope)) console.error(`Scope format doesn't match`)
      finishCompileParallel(gpu.kernels.flatMap((k) => Object.values(k.programs)))
      // waitForIdle protects against draw queue overflow (causes context loss)
      gpu.idleCounter++
      if (gpu.idleCounter >= 64) await gpu.waitForIdle()
      if (method !== this.method) {
        let expected = `Expected kernel to be invoked via "${this.method}"`
        throw new Error(`${expected}, but it was invoked via "${method}"`)
      }
      if (read && isNaN(read.length)) {
        let issue = `Read buffer attributes incomplete, all sub-buffers must be of the the same length`
        let found = read.attribs.map((a) => `${a.name}=${a.count}`).join(', ')
        let note = `You can mix sub-buffer lengths inside scope buffers`
        throw new Error(`${issue}. Found ${found}. ${note}.`)
      }
      let result = await this.exec(range, read, scope, flags)
      return result
    } finally {
      if (read?.consumed) read.free()
      if (scope?.consumed) scope.free()
    }
  }
}

class KernelStub {
  constructor(public header: string) {}
}
class KernelInclude {
  constructor(public src: string, public header: string) {}
}

export const kernel = Object.assign(
  <
    R extends Format | ComplexFormat | Null = Format | ComplexFormat | Null,
    W extends Format | ComplexFormat = Format | ComplexFormat,
    S extends ComplexFormat | Null = Null
  >(
    read: R,
    write: W,
    scope = format.null as S
  ) => {
    let components = formatIterator(write).reduce((pv, f) => pv + f.format.components, 0)
    if (components > 16) {
      throw new Error(`Too many components in write format`)
    }
    return (str: TemplateStringsArray, ...interstices: KernelInclude[]) => {
      let src = str[0]
      for (let i in interstices) {
        src += interstices[i].src
        src += str[+i + 1]
      }
      src = trimLeadingSpace(src)
      let kernel = new Kernel(src, read, write, scope) as Kernel<R, W, S>
      gpu.kernels.push(kernel)
      return kernel
    }
  },
  {
    include(src: TemplateStringsArray, ...interstices: KernelInclude[]) {
      let include = src[0]
      for (let i in interstices) {
        include += interstices[i].src
        include += src[+i + 1]
      }
      include = trimLeadingSpace(include)
      return new KernelInclude(include, include)
    },
    dynamic(src: string, stub: KernelStub = new KernelStub('')) {
      src = trimLeadingSpace(src)
      return new KernelInclude(src, stub.header)
    },
    stub(src: TemplateStringsArray, ...interstices: string[]) {
      let stub = src[0]
      for (let i in interstices) {
        stub += interstices[i]
        stub += src[+i + 1]
      }
      stub = trimLeadingSpace(stub)
      return new KernelStub(stub)
    },
  }
)

export const allowedEntrypoints = ['map', 'filtro', 'reduce', 'scan', 'group', 'sort'] as const

export function trimLeadingSpace(str: string, toRemain = 0) {
  let space = str.match(/(^|\n)( *)\b/)?.[2] ?? ''
  return str.replace(new RegExp(`(^|\n)${space}`, 'g'), '$1' + ' '.repeat(toRemain))
}

export type KernelStruct = {
  src: string
  read: Kernel['read']
  write: Kernel['write']
  scope: Kernel['scope']
  write2?: ComplexFormat
  scope2?: ComplexFormat
}

export class Program {
  gl?: WebGLProgram
  constructor(public vs: string, public fs: string, public transformFeedback: string[]) {}
}
