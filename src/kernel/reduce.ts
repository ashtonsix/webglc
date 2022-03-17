import {range} from '../range'
import {map} from './gl'
import {Program, Kernel} from './kernel'
import {generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import * as template from './template'

export function reduce(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  let struct = generateProgramModel(kernel, sourceFragments, src)
  struct.vertexIdMultiplier = 16

  kernel.programs.main = new Program(
    template.vs(struct),
    template.fs(),
    struct.outRegisters.map((r) => `glc_out_${r.name}`)
  )
  kernel.exec = async (r, read, scope) => {
    let n = r.end
    let first = true
    while (n >= 2) {
      n = Math.ceil(n / 4)
      let temp = await map(kernel.programs.main.gl!, range(n), {read, scope, write: kernel.write})
      if (!first) read!.free()
      read = temp
      first = false
    }
    return [read!]
  }
  return kernel
}
