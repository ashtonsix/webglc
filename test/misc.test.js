import {format as f, kernel, buffer, range, gpu} from '../dist/index.js'
import {log, assert} from './testUtils.js'

// disable "Multiple instances of Three.js" warning
Object.defineProperty(window, '__THREE__', {get() {}, set() {}})

afterEach(() => {
  for (let b of gpu.buffers) b.free()
  gpu.pool.clear()
})

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

describe('consume', () => {
  it('frees a buffer after one use', async () => {
    let double = kernel(f.float, f.float)`
      void map(int i) {
        write(read(i) * 2.);
      }`
    log(double.programs.main.vs)
    let bdata = buffer(f.float, [1, 2, 3, 4, 5, 6, 7, 8])
    bdata = await range(8).map(double, bdata.consume())
    assert.equal(await bdata.read(), [2, 4, 6, 8, 10, 12, 14, 16])
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
    let k = kernel(f.null, f.float)`
      void map(int i) {
        write(random());
      }`
    let n = 500
    let bdata = await range(n).map(k)
    let unique = Array.from(new Set(await bdata.read()))
    assert.equal(unique.length, n)
  })
  it('generates numbers between 0 and 1', async () => {
    let k = kernel(f.null, f.float)`
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
    let kinside = kernel(f.null, f.float)`
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

describe('errors', () => {
  // TODO
})

function readFromWebGLCanvas(canvas) {
  return new Promise((resolve) => {
    let image = new Image()
    image.addEventListener(
      'load',
      function () {
        let canvas = document.createElement('canvas')
        let context = canvas.getContext('2d')
        canvas.width = image.width
        canvas.height = image.height
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        let raw = context.getImageData(0, 0, canvas.width, canvas.height).data
        let pixels = []
        let rows = []
        for (let i = 0; i < raw.length; i += 4) {
          pixels.push(Array.from(raw.slice(i, i + 4), (v) => v / 255))
        }
        for (let i = 0; i < pixels.length; i += image.width) {
          rows.push(pixels.slice(i, i + image.width))
        }
        rows.reverse()
        let data = rows.flat()
        resolve(data)
      },
      false
    )
    image.src = canvas.toDataURL()
    setTimeout(() => resolve(), 1000)
  })
}

for (let version of [137, 138, 139]) {
  describe(`three (version ${version})`, () => {
    it('creates a buffer geometry', async () => {
      let THREE = await import(`../node_modules/three${version}/build/three.module.js`)
      let renderer = gpu.createThreeRenderer(THREE)
      document.body.appendChild(gpu.dom)
      let buf = buffer({position: f.vec2, velocity: f.vec2}, [{position: [5, 5], velocity: [2, 3]}])
      let geom = await buf.createThreeBufferGeometry()
      geom.dispose()
      renderer.dispose()
    })
    it('creates/updates a texture', async () => {
      let THREE = await import(`../node_modules/three${version}/build/three.module.js`)
      let renderer = gpu.createThreeRenderer(THREE)
      document.body.appendChild(gpu.dom)

      renderer.setClearColor(0x000000, 1)
      renderer.setSize(2, 2)

      const scene = new THREE.Scene()
      const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1e20)

      camera.position.x = 0
      camera.position.y = 0
      camera.position.z = 1
      camera.lookAt(0, 0, 0)

      let data = [
        [0, 0, 0, 1],
        [0, 1, 0, 1],
        [0, 1, 1, 1],
        [0, 0, 1, 1],
      ]
      let buf = buffer(f.vec4, data)
      let map = await buf.createThreeTexture(2, 2)

      const material = new THREE.MeshBasicMaterial({map})
      const sprite = new THREE.Sprite(material)
      scene.add(sprite)

      renderer.clear()
      renderer.render(scene, camera)

      let result = await readFromWebGLCanvas(gpu.canvas)
      assert.equal(result, data)

      data[0][0] = 1
      data[1][2] = 1
      data[2][2] = 0
      await buf.write(data)
      await buf.updateThreeTexture(map)
      renderer.clear()
      renderer.render(scene, camera)
      result = await readFromWebGLCanvas(gpu.canvas)
      assert.equal(result, data)
      document.body.removeChild(gpu.dom)
      renderer.dispose()
    })
  })
}

describe(`blit`, () => {
  /**
   * Confirming this test passes requires a manual check. Change "it" to "it.only", launch Karma (in Firefox),
   * and enter debug mode. You should see a red canvas, it should remain on-screen, and NOT dissapear.
   *
   * The underlying issue is tracked at https://bugzilla.mozilla.org/show_bug.cgi?id=1763507
   **/
  it(`doesn't clear the canvas when invoking a kernel`, async () => {
    gpu.canvas.width = 300
    gpu.canvas.height = 300
    document.body.appendChild(gpu.dom)
    gpu.gl.clearColor(1, 0, 0, 1)
    gpu.gl.clear(gpu.gl.COLOR_BUFFER_BIT)
    if (gpu.info.hasFlickerBug) gpu.blitToBackgroundCanvas()

    await new Promise((resolve) => setTimeout(resolve, 100))

    let double = kernel(f.float, f.float)`
      void map(int i) {
        write(read(i) * 2.);
      }`
    let bdata = buffer(f.float, [1, 2, 3, 4])
    await range(bdata.length).map(double, bdata)
  })
})
