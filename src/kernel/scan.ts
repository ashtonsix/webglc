import {attributeIterator, buffer, Buffer} from '../buffer/buffer'
import {range} from '../range'
import {ComplexFormat, formatIterator, formatQuery, isSimpleFormat} from '../format'
import {gpu} from '../gpu'
import {Program, trimLeadingSpace, Kernel} from './kernel'
import {map} from './gl'
import {dedupeProgramModel, generateProgramModel} from './model'
import {extractSourceFragments} from './parse'
import * as template from './template'

const u = (s: string | null) => (s ? '_' + s : '')

// https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda
export function scan(kernel: Kernel) {
  let [sourceFragments, src] = extractSourceFragments(kernel.src)

  let fit = {read: formatIterator(kernel.read, kernel.scope), write: formatIterator(kernel.write)}

  kernel.method = sourceFragments.entrypoint[0].key as typeof kernel['method']

  let includeSwap = sourceFragments.entrypoint[0].value.length >= 2
  up: {
    let struct = generateProgramModel(kernel, sourceFragments, src)
    struct.main.runUserCode = (i) => `scan(${i}${includeSwap ? `, 0` : ``});`
    struct.vertexIdMultiplier = 8
    kernel.programs.up = new Program(template.vs(struct), template.fs(), Program.tf(struct))
  }
  insert: {
    let src = trimLeadingSpace(`
      void scan(int i) {
        ${fit.write
          .map((f) => {
            let id = `identity${u(f.name)}`
            return `write${u(f.name)}(read${u(f.name)}(), ${id}, ${id}, ${id});`
          })
          .join('\n')}
      }`)
    let [frag] = extractSourceFragments(src)
    let struct = generateProgramModel(kernel, frag, src)
    kernel.programs.insert = new Program(template.vs(struct), template.fs(), Program.tf(struct))
  }
  down: {
    let fit = {read: formatIterator(kernel.read, kernel.scope), write: formatIterator(kernel.write)}
    let after = ''
    for (let f of fit.write) {
      let r0 = 'read' + u(f.name)
      let r1 = 'read_s_scope2' + u(f.name)
      let wc = 'glc_out_s_copy' + u(f.name)
      let wl = 'glc_out_s_keepl' + u(f.name)
      let wr = 'glc_out_s_keepr' + u(f.name)
      switch (f.format.components) {
        case 1: {
          let fn = formatQuery({base: f.format.base, components: 4})[0].name
          after += trimLeadingSpace(
            `
              ${fn} q${u(f.name)} = ${r0}(i + 0, f_${fn});
              ${fn} r${u(f.name)} = ${r0}(i + 4, f_${fn});
              ${fn} s${u(f.name)} = ${r1}(i * 2 + 0, f_${fn});
              ${fn} t${u(f.name)} = ${r1}(i * 2 + 4, f_${fn});
              ${fn} u${u(f.name)} = ${r1}(i * 2 + 8, f_${fn});
              ${fn} v${u(f.name)} = ${r1}(i * 2 + 12, f_${fn});

              ${wl}_0 = s${u(f.name)}.x;
              ${wl}_1 = t${u(f.name)}.x;
              ${wl}_2 = u${u(f.name)}.x;
              ${wl}_3 = v${u(f.name)}.x;
              ${wc}_0 = q${u(f.name)}.y;
              ${wc}_1 = q${u(f.name)}.w;
              ${wc}_2 = r${u(f.name)}.y;
              ${wc}_3 = r${u(f.name)}.w;
              ${wr}_0 = s${u(f.name)}.z;
              ${wr}_1 = t${u(f.name)}.z;
              ${wr}_2 = u${u(f.name)}.z;
              ${wr}_3 = v${u(f.name)}.z;
            `,
            2
          )
          break
        }
        case 2:
        case 3:
        case 4: {
          after += trimLeadingSpace(
            `
              ${wl}_0 = ${r1}(i * 2 + 0);
              ${wl}_1 = ${r1}(i * 2 + 4);
              ${wl}_2 = ${r1}(i * 2 + 8);
              ${wl}_3 = ${r1}(i * 2 + 12);
              ${wc}_0 = ${r0}(i * 2 + 1);
              ${wc}_1 = ${r0}(i * 2 + 3);
              ${wc}_2 = ${r0}(i * 2 + 5);
              ${wc}_3 = ${r0}(i * 2 + 7);
              ${wr}_0 = ${r1}(i * 2 + 2);
              ${wr}_1 = ${r1}(i * 2 + 6);
              ${wr}_2 = ${r1}(i * 2 + 10);
              ${wr}_3 = ${r1}(i * 2 + 14);
            `,
            2
          )
          break
        }
      }
    }

    let [frag, src] = extractSourceFragments(kernel.src)
    let [frag2] = extractSourceFragments(after)
    let struct = generateProgramModel(kernel, frag, src)

    frag2.identity = frag.identity
    let kern2 = {...kernel, scope2: {} as ComplexFormat, write2: {} as ComplexFormat}
    for (let f of fit.read) kern2.scope2['s_scope2' + u(f.name)] = f.format
    let struct2 = generateProgramModel(kern2, frag2, after)

    struct.readFunctions.push(...struct2.readFunctions)
    struct.attribCount += struct2.attribCount
    struct.samplers.scope2 = true
    struct.formatRegisters.push(...struct2.formatRegisters)
    struct.identities.push(...struct2.identities)
    struct = dedupeProgramModel(struct)
    let includeSwap = sourceFragments.entrypoint[0].value.length >= 2
    struct.main.runUserCode = (i) => `scan(${i}${includeSwap ? `, 1` : ``});`
    struct.main.after = after
    struct.vertexIdMultiplier = 8

    struct.outRegisters = []
    for (let i = 0; i < 4; i++) {
      for (let {format, name} of fit.write) {
        let n = name ? name + '_' : ''
        struct.outRegisters.push({format, attrib: name, name: 's_keepl_' + n + i})
        struct.outRegisters.push({format, attrib: name, name: 's_copy_' + n + i})
        struct.outRegisters.push({format, attrib: name, name: 's_keepr_' + n + i})
        struct.outRegisters.push({format, attrib: name, name: n + i})
      }
    }
    kernel.programs.down = new Program(template.vs(struct), template.fs(), Program.tf(struct))
  }
  final: {
    let fit = {read: formatIterator(kernel.read, kernel.scope), write: formatIterator(kernel.write)}

    let after = ''
    for (let f of fit.write) {
      let r = 'read' + u(f.name)
      let t = 'tmp' + u(f.name)
      let w = 'glc_out_s_copy' + u(f.name)
      switch (f.format.components) {
        case 1: {
          let fn = formatQuery({base: f.format.base, components: 4})[0].name
          after += trimLeadingSpace(
            `
              ${w}_0 = ${r}(i + 3);
              ${fn} ${t} = ${r}(i + 4, f_${fn});
              ${w}_1 = ${t}.y;
              ${w}_2 = ${t}.w;
              ${w}_3 = ${r}(i + 9);
            `,
            2
          )
        }
        case 2:
        case 3:
        case 4: {
          after += trimLeadingSpace(
            `
              ${w}_0 = ${r}(i + 3);
              ${w}_1 = ${r}(i + 5);
              ${w}_2 = ${r}(i + 7);
              ${w}_3 = ${r}(i + 9);
            `,
            2
          )
        }
      }
    }

    let [frag, src] = extractSourceFragments(kernel.src)
    let [frag2] = extractSourceFragments(after)
    let struct = generateProgramModel(kernel, frag, src)

    frag2.identity = frag.identity
    let kern2 = {...kernel, scope2: {} as ComplexFormat, write2: {} as ComplexFormat}
    for (let f of fit.read) kern2.scope2['s_scope2' + u(f.name)] = f.format
    let struct2 = generateProgramModel(kern2, frag2, after)

    struct.readFunctions.push(...struct2.readFunctions)
    struct.attribCount += struct2.attribCount
    struct.samplers.scope2 = true
    struct.formatRegisters.push(...struct2.formatRegisters)
    struct.identities.push(...struct2.identities)
    struct = dedupeProgramModel(struct)
    let includeSwap = sourceFragments.entrypoint[0].value.length >= 2
    struct.main.runUserCode = (i) => `scan(${i}${includeSwap ? `, 1` : ``});`
    struct.main.after = after
    struct.vertexIdMultiplier = 8

    struct.outRegisters = []
    for (let i = 0; i < 2; i++) {
      for (let {format, name} of fit.write) {
        for (let j = 0; j < 2; j++) {
          let n = name ? name + '_' : ''
          let k = i * 2 + j
          struct.outRegisters.push({format, attrib: name, name: n + k})
          struct.outRegisters.push({format, attrib: name, name: 's_copy_' + n + k})
        }
      }
    }
    kernel.programs.final = new Program(template.vs(struct), template.fs(), Program.tf(struct))
  }
  kernel.exec = async (r, read, scope) => {
    let {gl, pool} = gpu
    let n = r.end
    if (n <= 1) return [await read!.copy()]
    if (n === 2) {
      let v2 = await map(kernel.programs.up, range(1), {read, scope, write: kernel.write})
      let v1 = await read!.slice(0, 1)
      return [await buffer.concat(v1, v2)]
    }
    let layers = [read] as Buffer[]
    while (n >= 2) {
      n = Math.ceil(n / 2)
      layers.push(
        await map(kernel.programs.up, range(n), {
          read: layers[layers.length - 1],
          scope,
          write: kernel.write,
        })
      )
    }
    let i = layers.length - 2
    let next = await map(kernel.programs.insert, range(2), {
      read: layers[i],
      outputByteLength: layers[i].byteLength,
      write: kernel.write,
    })
    layers[i].free()
    layers[i] = next
    for (; i > 0; i--) {
      let l0 = layers[i]
      let l1 = layers[i - 1]
      let next = await map(kernel.programs.down, range(Math.ceil(l1.length / 4)), {
        read: l0,
        scope,
        scope2: l1,
        outputByteLength: pool.sizeBuffer(kernel.write, l1.length + 12), // what is "+ 12" for?
        write: kernel.write,
      })
      for (let p of next.attribs) p.count *= 4
      layers[i - 1] = next
      l0.free()
      l1.free()
    }
    let init = layers[0]
    let last = layers[layers.length - 1]
    init = await map(kernel.programs.final, range(r.end), {
      read: init,
      scope,
      outputByteLength: pool.sizeBuffer(kernel.write, r.end * 2),
      write: kernel.write,
    })
    layers[0].free()

    for (let attrib of init.attribs) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, last.gl)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, init.gl)
      gl.copyBufferSubData(
        gl.COPY_READ_BUFFER,
        gl.COPY_WRITE_BUFFER,
        attributeIterator(attrib).get(0) * 4,
        attributeIterator(attrib).get(attrib.count - 1) * 4,
        attrib.format.components * 4
      )
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    return [init]
  }
}

// async function debugScanLayers(layers: Buffer[], key?: string) {
//   let data = (await Promise.all(layers.map((l) => l.read()))) as number[][]
//   if (key) data = data.map((d) => d.map((d) => (d as any)[key]))
//   data.reverse()
//   let colWidth = Math.ceil(Math.log10(Math.max(...data.flat(2)))) + 1
//   let maxLen = Math.max(...layers.map((l) => l.length))
//   let strings = data.map((d) => {
//     let fullColWidth = Math.floor((colWidth * maxLen) / d.length)
//     return d.map((d) => (d + '').padStart(fullColWidth)).join('')
//   })
//   console.log(strings.join('\n'))
// }
