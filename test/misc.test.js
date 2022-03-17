import {format as f, kernel, buffer, range, gpu} from '../dist/index.js'
import {log, assert} from './testUtils.js'

afterEach(() => gpu.freeAll())

describe('read', () => {
  it('reads/writes two values at a time', async () => {
    let k = kernel(f.float, f.float)`
      void map(int i) {
        vec2 v = read(i, f_vec2);
        write(v.x, v.y);
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.float, [0, 1, 2, 3, 4, 5, 6, 7])
    bdata = await range(8).map(k, bdata)
    assert.equal(await bdata.read(), [0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('fills missing values with a given identity', async () => {
    let k = kernel(f.float, f.float)`
      const float identity = 99.;
      void map(int i) {
        vec4 v = read(i, f_vec4);
        write(v.x, v.y, v.z, v.w);
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.float, [0, 1, 2, 3, 4, 5, 6])
    bdata = await range(10).map(k, bdata)
    assert.equal(await bdata.read(), [0, 1, 2, 3, 4, 5, 6, 99, 99, 99])
  })
})

describe('scope', () => {
  it('can read from scope (kernel = map)', async () => {
    let k = kernel(f.float, f.float, {add: f.float})`
      void map(int i) {
        write(read(i) + read_add());
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.float, [0, 1, 2, 3, 4, 5, 6, 7])
    bdata = await range(8).map(k, bdata, buffer({add: f.float}, [{add: 1}]))
    assert.equal(await bdata.read(), [1, 2, 3, 4, 5, 6, 7, 8])
    bdata = await range(8).map(k, bdata, buffer({add: f.float}, [{add: 2}]))
    assert.equal(await bdata.read(), [3, 4, 5, 6, 7, 8, 9, 10])
  })
  it('can read from scope (kernel = filtro)', async () => {
    let k = kernel(f.int, f.int, {keep: f.int})`
      void filtro(int i) {
        write(int(read_keep() == read(i)));
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.int, [4, 5, 6, 7])
    bdata = await range(bdata.length).filtro(k, bdata, buffer({keep: f.int}, [{keep: 4}]))
    assert.equal(await bdata.read(), [0, -1, -1, -1])
    bdata = buffer(f.int, [4, 5, 6, 7])
    bdata = await range(bdata.length).filtro(k, bdata, buffer({keep: f.int}, [{keep: 6}]))
    assert.equal(await bdata.read(), [2, -1, -1, -1])
  })
  it('can read from scope (kernel = reduce)', async () => {
    let k = kernel(f.int, f.int, {disable: f.int})`
      void reduce(int i) {
        if (read_disable() == 1) {
          write(0);
        } else {
          ivec4 v = read(i, f_ivec4);
          write(v.x + v.y + v.z + v.w);
        }
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.int, [0, 1, 2, 3])
    bdata = await range(bdata.length).reduce(k, bdata, buffer({disable: f.int}, [{disable: 0}]))
    assert.equal(await bdata.read(), [6])
    bdata = buffer(f.int, [0, 1, 2, 3])
    bdata = await range(bdata.length).reduce(k, bdata, buffer({disable: f.int}, [{disable: 1}]))
    assert.equal(await bdata.read(), [0])
  })
  it('can read from scope (kernel = scan)', async () => {
    let k = kernel(f.int, f.int, {disable: f.int})`
      void scan(int i) {
        if (read_disable() == 1) {
          write(0);
        } else {
          ivec2 v = read(i, f_ivec2);
          write(v.x + v.y);
        }
      }`
    let bdata = buffer(f.int, [0, 1, 2, 3])
    bdata = await range(bdata.length).scan(k, bdata, buffer({disable: f.int}, [{disable: 0}]))
    assert.equal(await bdata.read(), [0, 1, 3, 6])
    bdata = buffer(f.int, [0, 1, 2, 3])
    bdata = await range(bdata.length).scan(k, bdata, buffer({disable: f.int}, [{disable: 1}]))
    assert.equal(await bdata.read(), [0, 0, 0, 0])
  })
  it('can read from scope (kernel = sort)', async () => {
    let k = kernel(f.int, f.int, {ascending: f.int})`
      void sort(int i, int j) {
        write((read(i) - read(j)) * (read_ascending() == 1 ? 1 : -1));
      }`
    log(k.programs.main.vs)
    let bdata = buffer(f.int, [5, 7, 3, 2])
    bdata = await range(bdata.length).sort(k, bdata, buffer({ascending: f.int}, [{ascending: 0}]))
    assert.equal(await bdata.read(), [1, 0, 2, 3])
    bdata = buffer(f.int, [5, 7, 3, 2])
    bdata = await range(bdata.length).sort(k, bdata, buffer({ascending: f.int}, [{ascending: 1}]))
    assert.equal(await bdata.read(), [3, 2, 0, 1])
  })
})

describe('random', () => {
  it('generates unique numbers', async () => {
    let k = kernel(null, f.float)`
      void map(int i) {
        write(random());
      }`
    let n = 500
    let bdata = await range(n).map(k)
    let unique = Array.from(new Set(await bdata.read()))
    assert.equal(unique.length, n)
  })
  it('generates numbers between 0 and 1', async () => {
    let k = kernel(null, f.float)`
    void map(int i) {
      write(random());
    }`
    let n = 500
    let bdata = await range(n).map(k)
    let bad = (await bdata.read()).filter((v) => v < 0 || v > 1)
    log(await bdata.read())
    assert.equal(bad.length, 0)
  })
  it('can approximate pi with randomly generated points', async () => {
    let kinside = kernel(null, f.float)`
      void map(int i) {
        write(length(vec2(random(), random())) < 1. ? 1. : 0.);
      }`
    let ksum = kernel(f.float, f.float)`
      const vec4 ones = vec4(1., 1., 1., 1.);
      void reduce(int i) {
        write(dot(read(i, f_vec4), ones));
      }`
    log(ksum.programs.main.vs)
    let n = 10000
    let binside = await range(n).reduce(ksum, await range(n).map(kinside))
    let [inside] = await binside.read()
    let estimate = (inside * 4) / n
    let error = Math.abs(estimate - Math.PI)
    assert.lessThan(error, 0.1)
  })
})
