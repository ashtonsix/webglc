import {format as f, kernel, buffer, range, gpu} from '../dist/index.js'
import {log, assert} from './testUtils.js'

afterEach(() => {
  for (let b of gpu.buffers) b.free()
  gpu.pool.clear()
})

let fparticle = {
  position: f.vec2,
  velocity: f.vec2,
}

let {ceil, random} = Math

describe('map', () => {
  it('doubles a scalar value', async () => {
    let double = kernel(f.float, f.float)`
      void map(int i) {
        write(read(i) * 2.);
      }`
    log(double.programs.main.vs)
    let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8])
    bdata = await range(8).map(double, bdata)
    assert.equal(await bdata.read(), [2, 4, 6, 8, 10, 12, 14, 16])
  })
  it('moves a particle', async () => {
    let move = kernel(fparticle, fparticle)`
      void map(int i) {
        vec2 p = read_position(i, f_vec2);
        vec2 v = read_velocity(i, f_vec2);
        write_position(p + v);
        write_velocity(v);
      }`
    log(move.programs.main.vs)
    let aparticle = [{position: [5, 6], velocity: [1, 1]}]
    let bparticle = buffer(fparticle, aparticle)
    bparticle = await range(1).map(move, bparticle)
    aparticle = await bparticle.read()
    assert.equal(aparticle, [{position: [6, 7], velocity: [1, 1]}])
  })
  it('doubles a scalar value (longer version)', async () => {
    let double = kernel(f.float, f.float)`
      void map(int i) {
        write(read(i) * 2.);
      }`
    log(double.programs.main.vs)
    let data = Array.from({length: ceil(random() * 50)}, () => ceil(random() * 50))
    let bdata = await range(data.length).map(double, buffer(f.float, data))
    assert.equal(
      await bdata.read(),
      data.map((v) => v * 2)
    )
  })
  it('doubles many attributes', async () => {
    let keys = 'abcdefghijklmnopqrstuvwxyz'.split('')
    let fmt = {}
    for (let k of keys) fmt[k] = f.int
    let double = kernel(fmt, fmt)`
      void map(int i) {
        ${kernel.dynamic(keys.map((k) => `write_${k}(read_${k}(i) * 2);`).join('\n'))}
      }`
    let data = [{}]
    for (let k of keys) data[0][k] = 1
    let buf = buffer(fmt, data)
    buf = await range(1).map(double, buf)
    for (let k of keys) data[0][k] *= 2
    assert.equal(await buf.read(), data)
  })
})

describe('reduce', () => {
  it('does a sum', async () => {
    let sum = kernel(f.float, f.float)`
      const float identity = 0.;
      const vec4 ones = vec4(1., 1., 1., 1.);
      void reduce(int i) {
        write(dot(read(i, f_vec4), ones));
      }`
    log(sum.programs.main.vs)
    let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8])
    bdata = await range(bdata.length).reduce(sum, bdata)
    assert.equal(await bdata.read(), [36])
  })
  it('does a product', async () => {
    let sum = kernel(f.float, f.float)`
      const float identity = 1.;
      void reduce(int i) {
        vec4 v = read(i, f_vec4);
        write(v.x * v.y * v.z * v.w);
      }`
    log(sum.programs.main.vs)
    let bdata = buffer(f.float, [1, 2, 3, 4])
    bdata = await range(bdata.length).reduce(sum, bdata)
    assert.equal(await bdata.read(), [24])
  })
  it('does a sum (longer version)', async () => {
    let sum = kernel(f.float, f.float)`
      const float identity = 0.;
      const vec4 ones = vec4(1., 1., 1., 1.);
      void reduce(int i) {
        write(dot(read(i, f_vec4), ones));
      }`
    log(sum.programs.main.vs)
    let data = Array.from({length: ceil(random() * 50)}, () => ceil(random() * 50))
    let bdata = await range(data.length).reduce(sum, buffer(f.float, data))
    assert.equal(await bdata.read(), [data.reduce((pv, v) => pv + v, 0)])
  })
  it('sums many attributes', async () => {
    let keys = 'abcdefghijklmnopqrstuvwxyz'.split('')
    let fmt = {}
    for (let k of keys) fmt[k] = f.float
    let sum = kernel(fmt, fmt)`
      const float identity = 0.;
      const vec4 ones = vec4(1., 1., 1., 1.);
      void reduce(int i) {
        ${kernel.dynamic(
          keys.map((k) => `write_${k}(dot(read_${k}(i, f_vec4), ones));`).join('\n')
        )}
      }`
    let data = []
    let n = 5
    for (let i = 0; i < n; i++) {
      data.push({})
      for (let k of keys) data[i][k] = ceil(random() * 10)
    }
    let buf = buffer(fmt, data)
    buf = await range(n).reduce(sum, buf)
    data = [
      data.reduce((pv, v) => {
        pv = {...pv}
        for (let k in pv) pv[k] += v[k]
        return pv
      }),
    ]
    assert.equal(await buf.read(), data)
  })
})

describe('scan', () => {
  it('does a prefix sum (batch size = 1)', async () => {
    let prefixSum = kernel(f.float, f.float)`
      void scan(int i) {
        vec2 r = read(i, f_vec2);
        write(r.x + r.y);
      }`
    log(prefixSum.programs.down.vs)
    for (let length of [8]) {
      let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8].slice(0, length))
      bdata = await range(bdata.length).scan(prefixSum, bdata)
      assert.equal(await bdata.read(), [1, 3, 6, 10, 15, 21, 28, 36].slice(0, length))
    }
  })
  it('does a prefix sum (batch size = 2)', async () => {
    let prefixSum = kernel(f.float, f.float)`
      void scan(int i) {
        vec4 v = read(i, f_vec4);
        write(v.x + v.y, v.z + v.w);
      }`
    for (let length of [5, 6, 7, 8]) {
      let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8].slice(0, length))
      bdata = await range(bdata.length).scan(prefixSum, bdata)
      assert.equal(await bdata.read(), [1, 3, 6, 10, 15, 21, 28, 36].slice(0, length))
    }
  })
  it('does a prefix sum (batch size = 4)', async () => {
    let prefixSum = kernel(f.float, f.float)`
      void scan(int i) {
        vec4 in0 = read(i, f_vec4);
        vec4 in1 = read(i + 4, f_vec4);
        vec4 r = vec4(in0.xz, in1.xz) + vec4(in0.yw, in1.yw);
        write(r.x, r.y, r.z, r.w);
      }`
    log(prefixSum.programs.down.vs)
    for (let length of [5, 6, 7, 8]) {
      let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8].slice(0, length))
      bdata = await range(bdata.length).scan(prefixSum, bdata)
      assert.equal(await bdata.read(), [1, 3, 6, 10, 15, 21, 28, 36].slice(0, length))
    }
  })
  it('does a prefix sum (longer list)', async () => {
    let prefixSum = kernel(f.float, f.float)`
      void scan(int i) {
        vec2 r = read(i, f_vec2);
        write(r.x + r.y);
      }`
    log(prefixSum.programs.down.vs)
    for (let i = 0; i < 5; i++) {
      let data = Array.from({length: ceil(random() * 150)}, () => ceil(random() * 10))
      let expected = []
      for (let v of data) expected.push((expected[expected.length - 1] ?? 0) + v)
      let bdata = await range(data.length).scan(prefixSum, buffer(f.float, data))
      assert.equal(await bdata.read(), expected)
    }
  })
  it('does a prefix sum (many attributes)', async () => {
    let fmt = {a: f.float, b: f.float, c: f.float, d: f.float, e: f.float, f: f.float}
    let keys = Object.keys(fmt)
    let prefixSum = kernel(fmt, fmt)`
      void scan(int i) {
        ${kernel.dynamic(
          keys.map((k) => `write_${k}(read_${k}(i) + read_${k}(i + 1));`).join('\n')
        )}
      }`
    log(prefixSum.programs.down.vs)
    let bdata = buffer(
      fmt,
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        a: n + 0,
        b: n + 1,
        c: n + 2,
        d: n + 3,
        e: n + 4,
        f: n + 5,
      }))
    )
    bdata = await range(bdata.length).scan(prefixSum, bdata)
    assert.equal(
      await bdata.read(),
      [1, 3, 6, 10, 15, 21, 28, 36].map((n, i) => ({
        a: n + (i + 1) * 0,
        b: n + (i + 1) * 1,
        c: n + (i + 1) * 2,
        d: n + (i + 1) * 3,
        e: n + (i + 1) * 4,
        f: n + (i + 1) * 5,
      }))
    )
  })
})

describe('filtro', () => {
  it('keeps odds', async () => {
    let keepOdd = kernel(f.int, f.int)`
      void filtro(int i) {
        ivec4 v = read(i, f_ivec4) % 2;
        write(v.x, v.y, v.z, v.w);
      }`
    log(keepOdd.programs.main.vs)
    let bdata = buffer(f.int, [0, 1, 2, 3, 4, 5, 6, 7])
    let bfiltered = await range(bdata.length).filtro(keepOdd, bdata)
    assert.equal(await bfiltered.read(), [1, 3, 5, 7, -1, -1, -1, -1])
    // with length
    let blength
    ;[bfiltered, blength] = await range(bdata.length).filtro(keepOdd, bdata, 'length')
    assert.equal(await bfiltered.read(), [1, 3, 5, 7, -1, -1, -1, -1])
    assert.equal(await blength.read(), [4])
  })
  it('drops any integer besides "0"', async () => {
    let keepOdd = kernel(f.int, f.int)`
      void filtro(int i) {
        int v = read(i);
        write(v % 2 == 1 ? -24 : 0);
      }`
    log(keepOdd.programs.main.vs)
    let bdata = buffer(f.int, [0, 1, 2, 3, 4, 5, 6, 7])
    let bfiltered = await range(bdata.length).filtro(keepOdd, bdata)
    assert.equal(await bfiltered.read(), [1, 3, 5, 7, -1, -1, -1, -1])
  })
  // TODO: investigate intermittent errors here
  it('keeps odds (longer list)', async () => {
    let keepOdd = kernel(f.int, f.int)`
      void filtro(int i) {
        int v = read(i);
        write(v % 2);
      }`
    log(keepOdd.programs.main.vs)
    for (let i = 0; i < 5; i++) {
      let data = Array.from({length: ceil(random() * 50)}, () => ceil(random() * 50))
      let bfiltered = await range(data.length).filtro(keepOdd, buffer(f.int, data))
      assert.equal(
        (await bfiltered.read()).filter((i) => i !== -1).map((i) => data[i]),
        data.filter((v) => v % 2)
      )
    }
  })
})

describe('sort', () => {
  it('sorts a list', async () => {
    let sort = kernel(f.int, f.int)`
      void sort(int i, int j) {
        write(read(i) - read(j));
      }`
    log(sort.programs.main.vs)
    let bdata = buffer(f.int, [0, 4, 6, 2, 5, 7, 3, 1])
    let bsorted = await range(bdata.length).sort(sort, bdata)
    let data = await bdata.read()
    let sorted = (await bsorted.read()).map((i) => data[i])
    assert.equal(sorted, [0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('sorts a list (non-power of 2)', async () => {
    let sort = kernel(f.int, f.int)`
      void sort(int i, int j) {
        write(read(i) - read(j));
      }`
    log(sort.programs.main.vs)
    for (let i = 0; i < 5; i++) {
      let data = Array.from({length: ceil(random() * 50)}, () => ceil(random() * 50))
      let bsorted = await range(data.length).sort(sort, buffer(f.int, data))
      let sorted = (await bsorted.read()).map((i) => data[i])
      assert.equal(
        sorted,
        data.slice().sort((a, b) => a - b)
      )
    }
  })
})
