import {range, Range} from '../range'
import {buffer, Buffer} from './buffer'

type LifetimeInput =
  | []
  | [any]
  | [any, any]
  | [any, any, any]
  | [any, any, any, any]
  | [any, any, any, any, any]
  | [any, any, any, any, any, any]
  | [any, any, any, any, any, any, any]
  | [any, any, any, any, any, any, any, any]
  | any[]

class Lifetime {
  buffers = new Set<Buffer>()
  free(except: Set<Buffer>) {
    let buffers = Array.from(this.buffers)
    buffers = buffers.filter((b) => !except.has(b))
    for (let b of buffers) b.free()
  }
}

type LifetimeRange = typeof range
type LifetimeBuffer = typeof buffer
export function lifetime<I extends LifetimeInput, O extends any>(
  fn: (lib: {range: LifetimeRange; buffer: LifetimeBuffer}, ...input: I) => O
): (...input: I) => O extends Promise<any> ? O : Promise<O> {
  let f = async (...input: I) => {
    const lt = new Lifetime()
    for (let i of input) {
      if (i instanceof Buffer && i.consumed) {
        i.consumed = false
        lt.buffers.add(i)
      }
    }
    function decorate<F extends Function>(f: F) {
      return ((...args: any[]) => {
        let result = f(...args)
        if (result instanceof Range) {
          let range = result as any
          for (let k in range) if (typeof range[k] === 'function') range[k] = decorate(range[k])
        } else if (result instanceof Array) {
          for (let b of result) lt.buffers.add(b)
        } else {
          lt.buffers.add(result)
        }
        return result
      }) as unknown as F
    }
    let result = await fn({range: decorate(range), buffer: decorate(buffer)}, ...input)
    let seen = new Set<any>()
    let stack = [result] as any[]
    let except = new Set<Buffer>()
    while (stack.length) {
      let current = stack.pop()!
      if (current instanceof Buffer) except.add(current)
      if (current instanceof Buffer || seen.has(current)) continue
      seen.add(current)
      stack.push(...Object.values(current))
    }
    lt.free(except)
    return result
  }
  return f as any
}
