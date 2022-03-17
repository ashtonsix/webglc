import {format as f, kernel, buffer, range, gpu} from '../dist/index.js'
import {log, assert} from './testUtils.js'

afterEach(() => gpu.freeAll())

let fparticle = {
  position: f.vec2,
  velocity: f.vec2,
}

describe('read/write', () => {
  it('reads/writes to a simple buffer', async () => {
    let fdata = f.float
    let adata = [5, 6, 7]
    let bdata = buffer(fdata, adata)
    assert.equal(await bdata.read(), adata)
    await bdata.acquire('gl')
    bdata.js = null
    assert.equal(await bdata.read(), adata)
  })
  it('reads/writes to a complex buffer', async () => {
    let aparticle = [{position: [1, 2], velocity: [3, 4]}]
    let bparticle = buffer(fparticle, aparticle)
    log(aparticle)
    assert.equal(await bparticle.read(), aparticle)
    await bparticle.acquire('gl')
    bparticle.js = null
    assert.equal(await bparticle.read(), aparticle)
  })
  it('reads/writes to a texture', async () => {
    let fdata = f.float
    let adata = [5, 6, 7]
    let bdata = buffer(fdata, adata)
    // from js
    await bdata.acquire('js')
    bdata.gl = null
    bdata.tex = null
    await bdata.acquire('tex')
    bdata.js = null
    bdata.gl = null
    log(bdata)
    assert.equal(await bdata.read(), adata)
    // from gl
    await bdata.acquire('gl')
    bdata.js = null
    bdata.tex = null
    await bdata.acquire('tex')
    bdata.js = null
    bdata.gl = null
    assert.equal(await bdata.read(), adata)
  })
})

describe('merge', () => {
  it('merges two buffers', async () => {
    let bmerged = await buffer.merge(
      {a: buffer(f.int, [0, 1, 2, 3])},
      buffer({b: f.int}, [{b: 5}, {b: 6}])
    )
    assert.equal(await bmerged.read(), [{a: 0, b: 5}, {a: 1, b: 6}, {a: 2}, {a: 3}])
    bmerged = await bmerged.merge({
      a: buffer(f.vec2, [[7, 8]]),
      d: buffer(f.float, [1, 8, 9, 11, 14]),
    })
    assert.equal(await bmerged.read(), [
      {a: [7, 8], b: 5, d: 1},
      {b: 6, d: 8},
      {d: 9},
      {d: 11},
      {d: 14},
    ])
  })
})

describe('split', () => {
  it('splits a buffer', async () => {
    let buf = buffer({a: f.int, b: f.int}, [
      {a: 0, b: 10},
      {a: 1, b: 11},
      {a: 2, b: 12},
      {a: 3, b: 13},
      {a: 4, b: 14},
      {a: 5, b: 15},
      {a: 6, b: 16},
      {a: 7, b: 17},
      {a: 8, b: 18},
      {a: 9, b: 19},
    ])
    let {a, b} = await buf.split()
    let data = await a.read()
    assert.equal(data, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    data = await b.read()
    assert.equal(data, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })
})

describe('rename', () => {
  it("renames a buffer's attributes", async () => {
    let buf = await buffer({penguins: f.int, tigers: f.int}, [{penguins: 1, tigers: 2}]).rename({
      penguins: 'birds',
    })
    assert.equal(await buf.read(), [{birds: 1}])
    buf = await buffer(f.int, [5]).rename({'.': 'lemurs'})
    assert.equal(await buf.read(), [{lemurs: 5}])
    buf = await buffer({ants: f.int}, [{ants: 9}]).rename({ants: '.'})
    assert.equal(await buf.read(), [9])
  })
})

describe('slice', () => {
  it('slices a simple buffer', async () => {
    let a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    // prettier-ignore
    for (let [start, end] of [[0, 0], [0, 1], [1, 2], [4, 7], [3, 7], [3, undefined], [3, -2]]) {
      let buf = buffer(f.int, a)
      assert.equal(await (await buf.slice(start, end)).read(), a.slice(start, end))
    }
  })
  it('slices a complex buffer', async () => {
    let a = []
    for (let i = 0; i < 10; i++) a.push({a: i, b: i})
    // prettier-ignore
    for (let [start, end] of [[0, 0], [0, 1], [1, 2], [4, 7], [3, 7], [3, undefined], [3, -2]]) {
      let buf = buffer({a: f.int, b: f.int}, a)
      assert.equal(await (await buf.slice(start, end)).read(), a.slice(start, end))
    }
  })
})

describe('concat', () => {
  it('concatenates some simple buffers', async () => {
    let a = [0, 1, 2, 3, 4, 5, 6, 7]
    let b = [8, 9, 10, 11, 12, 13]
    let c = [14, 15, 16, 17, 18]
    assert.equal(
      await (await buffer.concat(buffer(f.int, a), buffer(f.int, b))).read(),
      [].concat(a, b)
    )
    assert.equal(
      await (await buffer.concat(buffer(f.int, a), buffer(f.int, b), buffer(f.int, c))).read(),
      [].concat(a, b, c)
    )
  })
  it('concatenates some complex buffers', async () => {
    let a = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({a: i, b: i * 2}))
    let b = [8, 9, 10, 11, 12, 13].map((i) => ({a: i, b: i * 2}))
    let c = [14, 15, 16, 17, 18].map((i) => ({a: i, b: i * 2}))
    let fmt = {a: f.int, b: f.int}
    assert.equal(
      await (await buffer.concat(buffer(fmt, a), buffer(fmt, b))).read(),
      [].concat(a, b)
    )
    assert.equal(
      await (await buffer.concat(buffer(fmt, a), buffer(fmt, b), buffer(fmt, c))).read(),
      [].concat(a, b, c)
    )
  })
})
