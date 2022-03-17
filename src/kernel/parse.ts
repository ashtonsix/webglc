import {format, formatIterator, formatQuery} from '../format'
import {allowedEntrypoints, KernelStruct} from './kernel'

export interface SourceFragment {
  type: 'entrypoint' | 'identity' | 'read' | 'write'
  id: number
  start: number
  end: number
  key: string | null
  value: string[]
}

export interface SourceFragmentStruct {
  entrypoint: SourceFragment[]
  identity: SourceFragment[]
  read: SourceFragment[]
  write: SourceFragment[]
}

class SourceError extends Error {
  constructor(message: string, public fragment?: SourceFragment) {
    super(message)
  }
}

// naive parsing, fails for some edge cases but deemed acceptable
// TODO: identify if/where streaming read access is doable
export function extractSourceFragments(src: string) {
  let currentId = 0
  let srcWithoutComments = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  let srcWithoutIdentity: string
  let sourceFragments = {entrypoint: [], identity: [], read: [], write: []} as SourceFragmentStruct
  entrypoint: {
    // prettier-ignore
    let matches = Array.from(
      srcWithoutComments.matchAll(/(\w+)\s+(\w+)\s*\(([^\)]*)\)\s*{/g),
      (m) => ({index: m.index!, whole: m[0], returnType: m[1], key: m[2], value: m[3]})
    )
    matches = matches.filter((m) => allowedEntrypoints.includes(m.key as any))

    for (let m of matches) {
      sourceFragments.entrypoint.push({
        type: 'entrypoint',
        id: currentId++,
        start: m.index,
        end: m.index + m.whole.replace(/{$/, '').trimEnd().length,
        key: m.key,
        value: m.value.split(',').map((v) => v.trim()),
      })
      let fragment = sourceFragments.entrypoint.slice(-1)[0]
      if (m.returnType !== 'void') {
        throw new SourceError(`Expected return type to be "void"`, fragment)
      }
    }
  }
  identity: {
    let reg = /(^|;|})([\w\s]*)identity(_\w+)?\s*=([^;]+);/g
    srcWithoutIdentity = src.replace(reg, '$1')
    // prettier-ignore
    let matches = Array.from(
      srcWithoutComments.matchAll(reg),
      (m) => ({index: m.index!, whole: m[0], prefix: m[2], key: m[3], value: m[4]})
    )
    for (let m of matches) {
      sourceFragments.identity.push({
        type: 'identity',
        id: currentId++,
        start: m.index + (m.whole.match(/^(;|})?\s*/)?.[0]?.length ?? 0),
        end: m.index + m.whole.length,
        key: m.key?.replace(/^_/, '') ?? null,
        value: [m.value.trim()],
      })
      let qualifier = (m.prefix.match(/(\w+)\s+\b/)?.[1] ?? '').trim()
      if (qualifier !== 'const') {
        let expected = `Expected qualifier to be "const"`
        let found = `found ${qualifier ? `"${qualifier}"` : 'no qualifier'}`
        let fragment = sourceFragments.identity.slice(-1)[0]
        throw new SourceError(`${expected}, but ${found}`, fragment)
      }
    }
  }
  readwrite: {
    // prettier-ignore
    let matches = Array.from(
      srcWithoutComments.matchAll(/\b(read|write)(_\w+)?\s*\(/g),
      (m) => ({index: m.index!, whole: m[0], type: m[1] as 'read' | 'write', key: m[2]})
    )
    for (let m of matches) {
      sourceFragments[m.type].push({
        type: m.type,
        id: currentId++,
        start: m.index,
        end: m.index + m.whole.length,
        key: m.key?.replace(/^_/, '') ?? null,
        value: [],
      })
      let f = sourceFragments[m.type].slice(-1)[0]
      let parens = 1
      let arg = ''
      for (let c of srcWithoutComments.slice(f.end)) {
        f.end++
        if (c === '(') parens++
        if (c === ')') parens--
        if (parens === 0) break
        if (c === ',' && parens === 1) {
          f.value.push(arg.trim())
          arg = ''
        } else {
          arg += c
        }
      }
      arg = arg.trim()
      if (arg) f.value.push(arg)
    }
  }
  return [sourceFragments, srcWithoutIdentity] as const
}

export function validateSourceFragments(
  kernel: KernelStruct,
  sourceFragments: SourceFragmentStruct
) {
  let fit = {
    read: formatIterator(kernel.read, kernel.scope),
    write: formatIterator(kernel.write),
  }
  let errors = [] as SourceError[]
  one_entrypoint: {
    if (sourceFragments.entrypoint.length !== 1) {
      let expected = `Expected to find exactly 1 of ${allowedEntrypoints.join(', ')}.`
      let found = ` Found ${sourceFragments.entrypoint.map((m) => m.key).join(', ') || 'none'}.`
      errors.push(new SourceError(`${expected}${found}`))
    }
  }
  arguments: {
    let validArguments = (() => {
      switch (sourceFragments.entrypoint[0].key) {
        case 'map':
        case 'filtro':
        case 'reduce':
        case 'group':
          return ['int i']
        case 'scan':
          return ['int i', 'int i, int swapped']
        case 'sort':
          return ['int i, int j']
        default:
          return []
      }
    })()
    let pValidArguments = false
    for (let ea of validArguments) {
      let e = ea.split(',')
      let f = sourceFragments.entrypoint[0].value
      if (e.length !== f.length) continue
      for (let i in e) {
        let etype = e[i].split(' ')[0].trim()
        let ftype = f[i].split(' ')[0].trim()
        if (etype !== ftype) break
      }
      pValidArguments = true
    }
    if (!pValidArguments) {
      let va = validArguments.map((a) => `"${a}"`).join(' or ')
      let expected = `Expected arguments to be in format ${va}`
      let found = `Found "${sourceFragments.entrypoint[0].value.join(', ')}"`
      errors.push(new SourceError(`${expected}. ${found}`, sourceFragments.entrypoint[0]))
    }
  }
  format: {
    switch (sourceFragments.entrypoint[0].key) {
      case 'filtro':
      case 'group':
      case 'sort':
        if (kernel.write !== format.int) {
          errors.push(
            new SourceError(
              `Write format for "${sourceFragments.entrypoint[0].key}" must be f.int`,
              sourceFragments.entrypoint[0]
            )
          )
        }
      case 'reduce':
      case 'scan':
        if (JSON.stringify(kernel.read) !== JSON.stringify(kernel.write)) {
          console.log(kernel)
          errors.push(
            new SourceError(
              `Read and write format must match for "${sourceFragments.entrypoint[0].key}"`,
              sourceFragments.entrypoint[0]
            )
          )
        }
    }
  }
  format_keys_unique: {
    let seen = new Set()
    for (let {name} of fit.read) {
      if (seen.has(name)) {
        errors.push(new SourceError(`Key conflict between read and scope format on "${name}"`))
      }
      seen.add(name)
    }
  }
  format_available: {
    for (let type of ['read', 'write'] as const) {
      for (let f of sourceFragments[type]) {
        if (!fit[type].get(f.key)) {
          // prettier-ignore
          let reason = f.key
            ? `"${f.key}" is missing from the ${type} format`
            : fit[type].length ? `Format is complex, key is required` : `Format was not provided`
          errors.push(new SourceError(`Cannot ${type}. ${reason}`, f))
        }
      }
    }
  }
  read_typecast: {
    for (let read of sourceFragments.read) {
      let native = fit.read.get(read.key)!
      let request = formatQuery({name: read.value[1] ?? native.name})[0]
      let batchsize = request.components / native.components
      if (native.base !== request.base || ![1, 2, 4].includes(batchsize)) {
        errors.push(
          new SourceError(
            `Cannot read ${native.name} as ${request.name}, the formats are incompatiable`,
            read
          )
        )
      }
    }
  }
  write_batchsize: {
    let batchsize = sourceFragments.write[0].value.length
    if (sourceFragments.entrypoint[0].key === 'reduce' && batchsize > 1) {
      errors.push(
        new SourceError(`Write batch size must be "1" for reduce.`, sourceFragments.write[0])
      )
    }
    if (![1, 2, 4].includes(batchsize)) {
      errors.push(
        new SourceError(
          `Expected write batch size to be 1, 2 or 4. Got ${batchsize}.`,
          sourceFragments.write[0]
        )
      )
    }
    for (let w of sourceFragments.write) {
      if (batchsize !== w.value.length) {
        let found = `Found "${batchsize}" and "${w.value.length}"`
        errors.push(new SourceError(`Write batch size must be consistent. ${found}`, w))
      }
    }
  }
  write_comprehensive: {
    if (!sourceFragments.write.length) {
      errors.push(new SourceError(`Must write something`))
    }
    let remaining = new Set(fit.write.map((w) => w.name))
    for (let f of sourceFragments.write) remaining.delete(f.key)
    let re = Array.from(remaining)
    if (re.length) {
      let e = `Must write something to all keys in write format`
      errors.push(new SourceError(`${e}. ${re.map((r) => JSON.stringify(r))} missing`))
    }
  }
  if (errors.length) throw errors
}
