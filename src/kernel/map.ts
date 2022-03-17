import {Program, Kernel} from './kernel'
import {generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import {map as mapGL} from './gl'
import * as template from './template'

export function map(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  let struct = generateProgramModel(kernel, sourceFragments, src)

  kernel.programs.main = new Program(
    template.vs(struct),
    template.fs(),
    struct.outRegisters.map((r) => `glc_out_${r.name}`)
  )
  kernel.exec = async (range, read, scope) => {
    return [await mapGL(kernel.programs.main.gl!, range, {read, scope, write: kernel.write})]
  }
  return kernel
}
