import {Buffer} from './buffer/buffer'
import {Kernel} from './kernel/kernel'
import format, {ComplexFormat, Format, Null} from './format'

export class Range {
  length: number
  constructor(public start: number, public end: number, public groupSize: number | null) {
    this.length = end - start
  }
  async map<
    R extends Format | ComplexFormat | Null,
    W extends Format | ComplexFormat,
    S extends ComplexFormat | Null
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>]
        : [read: Buffer<R>]
      : S extends ComplexFormat
      ? [scope: Buffer<S>]
      : []
  ): Promise<Buffer<W>> {
    let r = await kernel.invoke(this, 'map', input[0] ?? null, input[1] ?? null, [])
    return r[0] as Buffer<W>
  }
  filtro<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>]
        : [read: Buffer<R>]
      : S extends ComplexFormat
      ? [scope: Buffer<S>]
      : []
  ): Promise<Buffer<W>>
  filtro<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null,
    F extends 'length'
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>, flag: F]
        : [read: Buffer<R>, flag: F]
      : S extends ComplexFormat
      ? [scope: Buffer<S>, flag: F]
      : [flag: F]
  ): Promise<[Buffer<W>, Buffer<typeof format.int>]>
  async filtro(kernel: Kernel, ...buffersAndFlags: any[]) {
    let buffers = [] as Buffer[]
    let flags = [] as string[]
    for (let bf of buffersAndFlags) (typeof bf === 'string' ? flags : buffers).push(bf)
    let buf = await kernel.invoke(this, 'filtro', buffers[0] ?? null, buffers[1] ?? null, flags)
    if (!flags.length) return buf[0]
    return buf
  }
  filter(): never {
    throw new Error(`Did you mean to call ".filtro()"?`)
  }
  group<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>]
        : [read: Buffer<R>]
      : S extends ComplexFormat
      ? [scope: Buffer<S>]
      : []
  ): Promise<Buffer<W>>
  group<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null,
    F0 extends 'start' | 'length' | 'overflow'
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>, flag_0: F0]
        : [read: Buffer<R>, flag_0: F0]
      : S extends ComplexFormat
      ? [scope: Buffer<S>, flag_0: F0]
      : [flag_0: F0]
  ): Promise<[Buffer<W>, Buffer<typeof format.int>]>
  group<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null,
    F0 extends 'start' | 'length' | 'overflow',
    F1 extends 'start' | 'length' | 'overflow'
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>, flag_0: F0, flag_1: F1]
        : [read: Buffer<R>, flag_0: F0, flag_1: F1]
      : S extends ComplexFormat
      ? [scope: Buffer<S>, flag_0: F0, flag_1: F1]
      : [flag_0: F0, flag_1: F1]
  ): Promise<[Buffer<W>, Buffer<typeof format.int>, Buffer<typeof format.int>]>
  group<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null,
    F0 extends 'start' | 'length' | 'overflow',
    F1 extends 'start' | 'length' | 'overflow',
    F2 extends 'start' | 'length' | 'overflow'
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>, flag_0: F0, flag_1: F1, flag_2: F2]
        : [read: Buffer<R>, flag_0: F0, flag_1: F1, flag_2: F2]
      : S extends ComplexFormat
      ? [scope: Buffer<S>, flag_0: F0, flag_1: F1, flag_2: F2]
      : [flag_0: F0, flag_1: F1, flag_2: F2]
  ): Promise<
    [Buffer<W>, Buffer<typeof format.int>, Buffer<typeof format.int>, Buffer<typeof format.int>]
  >
  async group(kernel: Kernel, ...buffersAndFlags: any[]) {
    let buffers = [] as Buffer[]
    let flags = [] as string[]
    for (let bf of buffersAndFlags) (typeof bf === 'string' ? flags : buffers).push(bf)
    let buf = await kernel.invoke(this, 'group', buffers[0] ?? null, buffers[1] ?? null, flags)
    if (!flags.length) return buf[0]
    return buf
  }
  async sort<
    R extends Format | ComplexFormat | Null,
    W extends typeof format.int,
    S extends ComplexFormat | Null
  >(
    kernel: Kernel<R, W, S>,
    ...input: R extends Format | ComplexFormat
      ? S extends ComplexFormat
        ? [read: Buffer<R>, scope: Buffer<S>]
        : [read: Buffer<R>]
      : S extends ComplexFormat
      ? [scope: Buffer<S>]
      : []
  ): Promise<Buffer<W>> {
    let r = await kernel.invoke(this, 'sort', input[0] ?? null, input[1] ?? null, [])
    return r[0] as Buffer<W>
  }
  async reduce<R extends Format | ComplexFormat, W extends R, S extends ComplexFormat | Null>(
    kernel: Kernel<R, W, S>,
    ...input: S extends ComplexFormat ? [read: Buffer<R>, scope: Buffer<S>] : [read: Buffer<R>]
  ): Promise<Buffer<W>> {
    let r = await kernel.invoke(this, 'reduce', input[0] ?? null, input[1] ?? null, [])
    return r[0] as Buffer<W>
  }
  async scan<R extends Format | ComplexFormat, W extends R, S extends ComplexFormat | Null>(
    kernel: Kernel<R, W, S>,
    ...input: S extends ComplexFormat ? [read: Buffer<R>, scope: Buffer<S>] : [read: Buffer<R>]
  ): Promise<Buffer<W>> {
    let r = await kernel.invoke(this, 'scan', input[0] ?? null, input[1] ?? null, [])
    return r[0] as Buffer<W>
  }
}

export function range(end: number): Range
export function range(start: number, end: number): Range
export function range(start: number, end: number, groupSize: number): Range
export function range(start: number, end?: number, groupSize?: number) {
  if (isNaN(start) || isNaN(end ?? 0)) throw new Error(`Cannot create a range of length "NaN"`)
  if (typeof end !== 'number') {
    end = start
    start = 0
  }
  if (start !== 0) {
    // TODO: support this
    throw new Error("Support for ranges where start != 0 hasn't been implemented yet")
  }
  return new Range(start, end, groupSize ?? null)
}
