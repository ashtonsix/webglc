type Float = {readonly name: 'float'; readonly base: 'float'; readonly components: 1}
type Vec2 = {readonly name: 'vec2'; readonly base: 'float'; readonly components: 2}
type Vec3 = {readonly name: 'vec3'; readonly base: 'float'; readonly components: 3}
type Vec4 = {readonly name: 'vec4'; readonly base: 'float'; readonly components: 4}
type Int = {readonly name: 'int'; readonly base: 'int'; readonly components: 1}
type Ivec2 = {readonly name: 'ivec2'; readonly base: 'int'; readonly components: 2}
type Ivec3 = {readonly name: 'ivec3'; readonly base: 'int'; readonly components: 3}
type Ivec4 = {readonly name: 'ivec4'; readonly base: 'int'; readonly components: 4}
type Uint = {readonly name: 'uint'; readonly base: 'uint'; readonly components: 1}
type Uvec2 = {readonly name: 'uvec2'; readonly base: 'uint'; readonly components: 2}
type Uvec3 = {readonly name: 'uvec3'; readonly base: 'uint'; readonly components: 3}
type Uvec4 = {readonly name: 'uvec4'; readonly base: 'uint'; readonly components: 4}

export type Null = {readonly null: true}

// prettier-ignore
export type Format =
  | Float | Vec2  | Vec3  | Vec4
  | Int   | Ivec2 | Ivec3 | Ivec4
  | Uint  | Uvec2 | Uvec3 | Uvec4

export type ComplexFormat = {[x: string]: Format}

type ParseMap = {
  1: number
  2: [number, number]
  3: [number, number, number]
  4: [number, number, number, number]
}

export type ParsedFormat<F extends Format | ComplexFormat | Null> = F extends Null
  ? null
  : F extends ComplexFormat
  ? {[K in keyof F]: ParseMap[F[K]['components']]}
  : F extends Format
  ? ParseMap[F['components']]
  : never

export type MergeTwoFormats<A, B> = {
  [K in keyof (A & B)]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown
}

// prettier-ignore
// https://stackoverflow.com/questions/71404693/how-to-make-typescript-display-this-type-properly-recursive-type-with-generics/71409925#71409925
export type MergeFormats<Q extends readonly ComplexFormat[]> =
  Q extends [] ? {} :
  Q extends [infer A] ? A :
  Q extends [infer A, infer B] ? {[K in keyof (A & B)]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown} :
  Q extends [infer A, infer B, infer C] ? {[K in keyof (A & B & C)]: K extends keyof C ? C[K] : K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown} :
  Q extends [infer A, infer B, infer C, infer D] ? {[K in keyof (A & B & C & D)]: K extends keyof D ? D[K] : K extends keyof C ? C[K] : K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown} :
  Q extends [infer A, infer B, infer C, infer D, infer E] ? {[K in keyof (A & B & C & D & E)]: K extends keyof E ? E[K] : K extends keyof D ? D[K] : K extends keyof C ? C[K] : K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown} :
  Q extends [infer A, infer B, infer C, infer D, infer E, infer F] ? {[K in keyof (A & B & C & D & E & F)]: K extends keyof F ? F[K] : K extends keyof E ? E[K] : K extends keyof D ? D[K] : K extends keyof C ? C[K] : K extends keyof B ? B[K] : K extends keyof A ? A[K] : unknown} :
  Q extends [infer L, ...infer R] ? R extends ComplexFormat[] ? MergeTwoFormats<L, MergeFormats<R>> : unknown :
  unknown

export const format = {
  null: {null: true} as Null,
  float: {name: 'float', base: 'float', components: 1} as Float,
  vec2: {name: 'vec2', base: 'float', components: 2} as Vec2,
  vec3: {name: 'vec3', base: 'float', components: 3} as Vec3,
  vec4: {name: 'vec4', base: 'float', components: 4} as Vec4,
  int: {name: 'int', base: 'int', components: 1} as Int,
  ivec2: {name: 'ivec2', base: 'int', components: 2} as Ivec2,
  ivec3: {name: 'ivec3', base: 'int', components: 3} as Ivec3,
  ivec4: {name: 'ivec4', base: 'int', components: 4} as Ivec4,
  uint: {name: 'uint', base: 'uint', components: 1} as Uint,
  uvec2: {name: 'uvec2', base: 'uint', components: 2} as Uvec2,
  uvec3: {name: 'uvec3', base: 'uint', components: 3} as Uvec3,
  uvec4: {name: 'uvec4', base: 'uint', components: 4} as Uvec4,
}

export const formatQuery = (query: {name?: string; base?: Format['base']; components?: number}) => {
  let name = query.name?.replace(/^f_/, '')
  return Object.values(format).filter((f) => {
    if ('null' in f) return false
    if (name && name !== f.name) return false
    if (query.base && query.base !== f.base) return false
    if (query.components && query.components !== f.components) return false
    return true
  }) as Format[]
}

export default format

export function isSimpleFormat(f: Format | ComplexFormat | Null): f is Format {
  if (!f || 'null' in f) return false
  return typeof f.components === 'number'
}

export function isComplexFormat(f: Format | ComplexFormat | Null): f is ComplexFormat {
  if (!f || 'null' in f) return false
  return typeof f.components !== 'number'
}

// created so Format and ComplexFormat may be worked with as if they were the same
export const formatIterator = (...fs: (Format | ComplexFormat | Null)[]) => {
  let a = [] as {name: string | null; format: Format}[]
  let o = {} as ComplexFormat
  let n: Format
  for (let f of fs) {
    if (isSimpleFormat(f)) {
      a.push({name: null, format: f})
      n = f
    }
    if (isComplexFormat(f)) {
      for (let k of Object.keys(f).sort()) {
        a.push({name: k, format: f[k]})
        o[k] = f[k]
      }
    }
  }
  function get(data: any, key: string | null): ParsedFormat<Format> | undefined
  function get(key: string | null): Format | undefined
  function get(...args: any[]): any {
    if (args.length === 1) {
      let key = args[0]
      return key ? o[key] : n
    }
    if (args.length === 2) {
      let [data, key] = args
      return key ? data[key] : data
    }
  }

  return Object.assign(a, {get})
}

export const formatsMatch = (
  a?: Format | ComplexFormat | Null,
  b?: Format | ComplexFormat | Null
) => {
  // prettier-ignore
  if ((a === format.null || a == null)) return b === format.null || b == null
  if (isSimpleFormat(a)) return b === a
  if (isComplexFormat(a)) {
    if (!isComplexFormat(b!)) return false
    if (Object.keys(a).length !== Object.keys(b).length) return false
    for (let k of Object.keys(a)) if (a[k] !== b[k]) return false
  }

  return true
}
