import format, {Format, formatIterator, formatQuery} from '../format'
import {KernelStruct} from './kernel'
import {SourceFragmentStruct} from './parse'

export type ProgramModel = {
  attribCount: number
  samplers: {
    read: boolean
    scope: boolean
    scope2: boolean
  }
  formatRegisters: Format[]
  identities: {attrib: string | null; value: string; format: Format}[]
  readFunctions: {
    attrib: string | null
    attribIndex: number
    samplerIndex: number
    nativeFormat: Format
    requestFormat: Format
    batchSize: number
  }[]
  outRegisters: {format: Format; attrib: string | null; name: string}[]
  writeFunctions: {format: Format; attrib: string | null}[]
  writeBatchSize: number
  userCode: string
  main: {runUserCode: (s: string) => string; before?: string; after?: string}
  vertexIdMultiplier: number
}

export function dedupeProgramModel(model: ProgramModel) {
  for (let k in model) {
    let m = model as unknown as {[x: string]: any[]}
    if (!(m[k] instanceof Array)) continue
    let h = {} as {[x: string]: any}
    for (let v of m[k]) h[JSON.stringify(v)] = v
    m[k] = Object.values(h)
  }
  return model
}

export function generateProgramModel(
  kernel: KernelStruct,
  sourceFragments: SourceFragmentStruct,
  src: string
) {
  let fit = {
    read: formatIterator(kernel.read, kernel.scope, kernel.scope2!),
    write: formatIterator(kernel.write, kernel.write2!),
  }

  let struct: ProgramModel = {
    attribCount: fit.read.length,
    samplers: {
      read: !!kernel.read && kernel.read !== format.null,
      scope: !!kernel.scope && kernel.scope !== format.null,
      scope2: !!kernel.scope2,
    },
    formatRegisters: [] as Format[],
    identities: [] as {format: Format; attrib: string | null; value: string}[],
    readFunctions: [] as {
      attrib: string | null
      attribIndex: number
      samplerIndex: number
      nativeFormat: Format
      requestFormat: Format
      batchSize: number
    }[],
    outRegisters: [] as {format: Format; attrib: string | null; name: string}[],
    writeFunctions: [] as {format: Format; attrib: string}[],
    writeBatchSize: sourceFragments.write[0]?.value?.length || 0,
    userCode: src,
    main: {runUserCode: (i) => `${sourceFragments.entrypoint[0].key}(${i});`},
    vertexIdMultiplier: 4,
  }

  read: {
    let fits = [kernel.read, kernel.scope, kernel.scope2!].map((f) => formatIterator(f))
    for (let r of sourceFragments.read) {
      let native = fit.read.get(r.key)!
      let request = formatQuery({name: r.value[1] ?? native.name})[0]
      struct.readFunctions.push({
        attrib: r.key,
        attribIndex: fit.read.findIndex((f) => f.name === r.key),
        samplerIndex: fits.findIndex((fit) => fit.get(r.key)),
        nativeFormat: native,
        requestFormat: request,
        batchSize: request.components / native.components,
      })
      let idfrag = sourceFragments.identity.find((id) => id.key === r.key)
      let idDefault: string
      id_default: {
        let a = new Array(native.components).fill(native.base === 'float' ? '0.' : '0')
        if (native.name === 'float' || native.name === 'int') idDefault = a[0]
        else idDefault = `${native.name}(${a.join(', ')})`
      }
      struct.identities.push({
        format: native,
        attrib: r.key,
        value: idfrag?.value?.[0] ?? idDefault,
      })
      struct.formatRegisters.push(native)
      struct.formatRegisters.push(request)
      struct.formatRegisters.push(formatQuery({base: 'uint', components: request.components})[0])
    }
  }

  write: {
    struct.writeFunctions = fit.write.map(({format, name}) => ({format, attrib: name}))
    for (let {format, name} of fit.write) {
      let n = name ? name + '_' : ''
      struct.outRegisters.push({format, attrib: name, name: n + '0'})
      struct.outRegisters.push({format, attrib: name, name: n + '1'})
      struct.outRegisters.push({format, attrib: name, name: n + '2'})
      struct.outRegisters.push({format, attrib: name, name: n + '3'})
    }
  }

  return dedupeProgramModel(struct)
}
