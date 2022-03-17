import {formatQuery} from '../format'
import {ProgramModel} from './model'

let t_if = (p: boolean | (() => boolean)) => {
  return (str: TemplateStringsArray, ...interstices: (string | number)[]) => {
    if (!p) return ''
    let result = str[0]
    for (let i in interstices) {
      result += interstices[i]
      result += str[+i + 1]
    }
    return result.trim()
  }
}
let t_each = <T>(a: T[]) => {
  return (
    str: TemplateStringsArray,
    ...interstices: (string | number | ((v: T) => string | number))[]
  ) => {
    let lines = a.map((v) => {
      let result = str[0]
      for (let i in interstices) {
        let its = interstices[i]
        result += typeof its === 'function' ? its(v) : its
        result += str[+i + 1]
      }
      return result.replace(/^\n/, '').trimEnd()
    })
    return lines.join('\n').trim()
  }
}

let u = (s?: string | null) => (s ? `_${s}` : '')

export function fs() {
  return `#version 300 es
precision highp float;
void main() {}
`
}

export function vs(s: ProgramModel) {
  let sections = {
    prelude: null as unknown as string,
    read: null as unknown as string,
    write: null as unknown as string,
    entrypoint: null as unknown as string,
  }
  // random (hybrid taus): https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-37-efficient-random-number-generation-and-application
  sections.prelude = `#version 300 es

uniform ivec3 glc_urandomState;
ivec4 glc_randomState;
float random() {
  glc_randomState.x = ((glc_randomState.x & 4294967294) << 12) ^ (((glc_randomState.x << 13) ^ glc_randomState.x) >> 19);
  glc_randomState.y = ((glc_randomState.y & 4294967288) <<  4) ^ (((glc_randomState.y <<  2) ^ glc_randomState.y) >> 25);
  glc_randomState.z = ((glc_randomState.z & 4294967280) << 17) ^ (((glc_randomState.z <<  3) ^ glc_randomState.z) >> 11);
  glc_randomState.w = 1664525 * glc_randomState.w + 1013904223;

  return 2.3283064365387e-10 * float(glc_randomState.x ^ glc_randomState.y ^ glc_randomState.z ^ glc_randomState.w) + .5;
}
`

  sections.read = `

${t_if(!!s.readFunctions.length)`
struct glc_Attrib {
  int repeat;
  int offset;
  int count;
};

uniform glc_Attrib glc_attribs[${s.attribCount}];
${t_if(s.samplers.read)`uniform highp usampler2D glc_sampler0;`}
${t_if(s.samplers.scope)`uniform highp usampler2D glc_sampler1;`}
${t_if(s.samplers.scope2)`uniform highp usampler2D glc_sampler2;`}
int glc_samplerTexWidth[3];

uvec4 glc_read_1D(int s, int i) {
  int y = i / glc_samplerTexWidth[s];
  int x = i % glc_samplerTexWidth[s];
  
  switch (s) {
    ${t_if(s.samplers.read)`
    case 0: return texelFetch(glc_sampler0, ivec2(x, y), 0);`}
    ${t_if(s.samplers.scope)`
    case 1: return texelFetch(glc_sampler1, ivec2(x, y), 0);`}
    ${t_if(s.samplers.scope2)`
    case 2: return texelFetch(glc_sampler2, ivec2(x, y), 0);`}
  }
}`}

${t_if(s.readFunctions.some((r) => r.requestFormat.components === 1))`
uint glc_read(int s, int i, int j, uint f) {
  switch (j) {
    case 0: return glc_read_1D(s, i).x;
    case 1: return glc_read_1D(s, i).y;
    case 2: return glc_read_1D(s, i).z;
    case 3: return glc_read_1D(s, i).w;
  }
}`}
${t_if(s.readFunctions.some((r) => r.requestFormat.components === 2))`
uvec2 glc_read(int s, int i, int j, uvec2 f) {
  switch (j) {
    case 0: return glc_read_1D(s, i).xy;
    case 1: return glc_read_1D(s, i).zw;
    case 2: return glc_read_1D(s, i + 1).xy;
    case 3: return glc_read_1D(s, i + 1).zw;
  }
}`}
${t_if(s.readFunctions.some((r) => r.requestFormat.components === 3))`
uvec3 glc_read(int s, int i, int j, uvec3 f) {
  switch (j) {
    case 0: return glc_read_1D(s, i).xyz;
    case 1: return uvec3(glc_read_1D(s, i).w, glc_read_1D(s, i + 1).xy);
    case 2: return uvec3(glc_read_1D(s, i + 1).zw, glc_read_1D(s, i + 2).x);
    case 3: return glc_read_1D(s, i + 2).yzw;
  }
}`}
${t_if(s.readFunctions.some((r) => r.requestFormat.components === 4))`
uvec4 glc_read(int s, int i, int j, uvec4 f) {
  switch (j) {
    case 0: return glc_read_1D(s, i);
    case 1: return glc_read_1D(s, i + 1);
    case 2: return glc_read_1D(s, i + 2);
    case 3: return glc_read_1D(s, i + 3);
  }
}`}

${t_each(s.identities)`
const ${(i) => i.format.name} identity${(i) => u(i.attrib)} = ${(i) => i.value};
${(i) => {
  if (i.format.components > 2) return ''
  let up = formatQuery({base: i.format.base, components: i.format.components * 2})[0].name
  let id = `identity${u(i.attrib)}`
  return `const ${up} ${id}2 = ${up}(${id}, ${id});`
}}
${(i) => {
  if (i.format.components > 1) return ''
  let up = formatQuery({base: i.format.base, components: 4})[0].name
  let id = `identity${u(i.attrib)}`
  return `const ${up} ${id}4 = ${up}(${id}, ${id}, ${id}, ${id});`
}}`}

${t_each(s.formatRegisters)`
${(f) => f.name} f_${(f) => f.name};`}

${t_each(s.readFunctions)`
${(r) => r.requestFormat.name} read${(r) => u(r.attrib)}(int i, ${(r) => r.requestFormat.name} f) {
  glc_Attrib a = glc_attribs[${(r) => r.attribIndex}];
  ${/* TODO: partial for "under", groupSize */ ''}
  if (i >= a.count || i < 0) {
    return identity${(r) => u(r.attrib)}${(r) => (r.batchSize === 1 ? '' : r.batchSize)};
  }
  ${(r) => {
    if (r.batchSize === 1) return `int j = i % 4;`
    return `
  int batchSize = ${r.batchSize};
  int over = i + batchSize - a.count;
  int j = (i % 4) / batchSize;`.replace(/^\n\s+/, '')
  }}
  ivec3 tmp = ivec3(i, a.repeat, a.offset) / 4;
  i = tmp.x * tmp.y + tmp.z;
  ${(r) => {
    let convertMap = {float: 'uintBitsToFloat', int: r.requestFormat.name, uint: ''}
    let convert = convertMap[r.requestFormat.base]
    let format = formatQuery({base: 'uint', components: r.requestFormat.components})[0].name
    return `${r.requestFormat.name} partial = ${convert}(glc_read(${r.samplerIndex}, i, j, f_${format}));`
  }}
  ${(r) => {
    if (r.nativeFormat.components === 1 && r.requestFormat.components === 2) {
      return `if (over > 0) { partial.y = identity${u(r.attrib)}; }`
    }
    if (r.nativeFormat.components === 2 && r.requestFormat.components === 4) {
      return `if (over > 0) { partial.zw = identity${u(r.attrib)}; }`
    }
    if (r.nativeFormat.components === 1 && r.requestFormat.components === 4) {
      return `
  if (over > 0) {
    partial.w = identity${u(r.attrib)};
    if (over >= 2) partial.z = identity${u(r.attrib)};
    if (over >= 3) partial.y = identity${u(r.attrib)};
  }`.trim()
    }
    return ''
  }}
  return partial;
}

${(r) => {
  if (r.batchSize !== 1) return ''
  return `
${r.nativeFormat.name} read${u(r.attrib)}(int i) {
  return read${u(r.attrib)}(i, f_${r.nativeFormat.name});
}
${r.nativeFormat.name} read${u(r.attrib)}() {
  return read${u(r.attrib)}(0, f_${r.nativeFormat.name});
}`
}}`}
`

  sections.write = `
${s.outRegisters
  .map((r) => {
    let flat = r.format.base === 'float' ? '' : 'flat '
    return `${flat}out ${r.format.name} glc_out_${r.name};`
  })
  .join('\n')}
${s.writeFunctions
  .map((f) => {
    let r = ''
    if (s.writeBatchSize <= 2) r += `${f.format.name} glc_write${u(f.attrib)}_0;`
    if (s.writeBatchSize == 2) r += `${f.format.name} glc_write${u(f.attrib)}_1;`
    return r
  })
  .join('\n')}

${s.writeFunctions
  .map((r) => {
    let args = Array.from({length: s.writeBatchSize}, (_, i) => `${r.format.name} _${i}`)
    return `
void write${u(r.attrib)}(${args.join(', ')}) {
  ${t_each(Array.from({length: s.writeBatchSize}, (v, i) => i))`
  glc_${s.writeBatchSize <= 2 ? 'write' : 'out'}${u(r.attrib)}_${(i) => i} = _${(i) => i};`}
}`
  })
  .join('\n')}
`

  let copyToOut = (out: number, write: number) => {
    let lines = s.writeFunctions.map((f) => {
      return `glc_out${u(f.attrib)}_${out} = glc_write${u(f.attrib)}_${write};`
    })
    return lines.join('\n  ')
  }

  sections.entrypoint = `
${s.userCode}

void main() {
  glc_randomState = ivec4(glc_urandomState, gl_VertexID + 1);
  ${t_if(s.samplers.read)`
  glc_samplerTexWidth[0] = textureSize(glc_sampler0, 0).x;`}
  ${t_if(s.samplers.scope)`
  glc_samplerTexWidth[1] = textureSize(glc_sampler1, 0).x;`}
  ${t_if(s.samplers.scope2)`
  glc_samplerTexWidth[2] = textureSize(glc_sampler2, 0).x;`}
  int i = gl_VertexID * ${s.vertexIdMultiplier};

  ${s.main.before ?? ''}

  ${t_if(s.writeBatchSize === 1)`
  ${s.main.runUserCode(`i`)}
  ${copyToOut(0, 0)}
  ${s.main.runUserCode(`i + ${(1 * s.vertexIdMultiplier) / 4}`)}
  ${copyToOut(1, 0)}
  ${s.main.runUserCode(`i + ${(2 * s.vertexIdMultiplier) / 4}`)}
  ${copyToOut(2, 0)}
  ${s.main.runUserCode(`i + ${(3 * s.vertexIdMultiplier) / 4}`)}
  ${copyToOut(3, 0)}`}

  ${t_if(s.writeBatchSize === 2)`
  ${s.main.runUserCode(`i`)}
  ${copyToOut(0, 0)}
  ${copyToOut(1, 1)}
  ${s.main.runUserCode(`i + ${(2 * s.vertexIdMultiplier) / 4}`)}
  ${copyToOut(2, 0)}
  ${copyToOut(3, 1)}`}

  ${t_if(s.writeBatchSize === 4)`
  ${s.main.runUserCode(`i`)}`}

  ${s.main.after ?? ''}
}`

  let result = sections.prelude + sections.read + sections.write + sections.entrypoint

  result = result.replace(/(\n *)+\n/g, '\n\n')
  result = result.replace(/\s*\n}/g, '\n}')
  result = result.replace(/(\n};?)\s*/g, '$1\n\n').trim() + '\n'
  return result
}
