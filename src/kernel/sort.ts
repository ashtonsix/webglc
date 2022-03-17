import format from '../format'
import {gpu} from '../gpu'
import {map} from './gl'
import {Range} from '../range'
import {Kernel, Program, trimLeadingSpace} from './kernel'
import {dedupeProgramModel, generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import * as template from './template'

// https://en.wikipedia.org/wiki/Bitonic_sorter
export function sort(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  kernel.method = sourceFragments.entrypoint[0].key as typeof kernel['method']

  let init = new Kernel(
    trimLeadingSpace(`
      void map(int i) {
        write(i, i + 1, i + 2, i + 3);
      }`),
    null,
    format.int,
    null
  )
  let before = `ivec4 sorted = read_s_scope2(i, f_ivec4); read_s_scope2(i);`
  let [fragB] = extractSourceFragments(before)
  let structB = generateProgramModel({...kernel, scope2: {s_scope2: format.int}}, fragB, before)
  before = before.replace(' read_s_scope2(i);', '')

  let struct = generateProgramModel(kernel, sourceFragments, src)
  struct.readFunctions.push(...structB.readFunctions)
  struct.attribCount += structB.attribCount
  struct.samplers.scope2 = true
  struct.formatRegisters.push(...structB.formatRegisters)
  struct.identities.push(...structB.identities)
  struct = dedupeProgramModel(struct)
  struct.userCode += trimLeadingSpace(`
    uniform ivec2 glc_part;
    uniform int glc_sort_vertex_count;

    void glc_sortwrap(int i, int j) {
      if (max(i, j) >= glc_sort_vertex_count) {
        glc_write_0 = i - j;
      } else {
        sort(i, j);
      }
    }

    void map(int i, int p) {
      int j = i ^ glc_part.y;
      int q = read_s_scope2(j);

      if (j > i) {
        if ((i & glc_part.x) == 0) glc_sortwrap(p, q);
        else glc_sortwrap(q, p);
        switch (clamp(glc_write_0, -1, 1)) {
          case 0: { glc_write_0 = p; return; }
          case -1: { glc_write_0 = p; return; }
          case 1: { glc_write_0 = q; return; }
        }
      } else {
        if ((i & glc_part.x) != 0) glc_sortwrap(p, q);
        else glc_sortwrap(q, p);
        switch (clamp(glc_write_0, -1, 1)) {
          case 0: { glc_write_0 = q; return; }
          case -1: { glc_write_0 = p; return; }
          case 1: { glc_write_0 = q; return; }
        }
      }
    }
  `)
  struct.main.before = before
  struct.main.runUserCode = (i) => {
    let args = i
      .replace(/i$/, 'i, sorted.x')
      .replace(/1$/, '1, sorted.y')
      .replace(/2$/, '2, sorted.z')
      .replace(/3$/, '3, sorted.w')
    return `map(${args});`
  }
  kernel.programs.main = new Program(
    template.vs(struct),
    template.fs(),
    struct.outRegisters.map((r) => `glc_out_${r.name}`)
  )

  kernel.exec = async (range, read, scope) => {
    let length = range.length
    range = new Range(range.start, 2 ** Math.ceil(Math.log2(range.end)), range.groupSize)
    let [sorted] = await init.invoke(range, 'map', null, null)
    let {gl} = gpu

    // for n = 16, partition goes [2,1; 4,2; 4,1; 8,4; 8,2, 8,1; 16,8; 16,4; 16,2; 16,1]
    // each i is compared with i ^ py and possibly swapped
    // if partition.y == 8, then i ^ py adds or subtracts 8 from i (bit flip)
    for (let px = 2; px <= range.length; px *= 2) {
      for (let py = px / 2; py > 0; py = Math.floor(py / 2)) {
        let next = await map(kernel.programs.main.gl!, range, {
          read,
          scope,
          scope2: sorted,
          write: kernel.write,
          uniforms: () => {
            let p = kernel.programs.main.gl!
            gl.uniform2i(gl.getUniformLocation(p, 'glc_part'), px, py)
            gl.uniform1i(gl.getUniformLocation(p, 'glc_sort_vertex_count'), length)
          },
        })
        sorted.free()
        sorted = next
      }
    }
    for (let a of sorted.attribs) a.count = length
    return [sorted]
  }
  return kernel
}
