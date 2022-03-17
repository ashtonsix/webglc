import {isComplexFormat, isSimpleFormat, ComplexFormat, Format} from '../format'
import {Buffer} from './buffer'
import {gpu} from '../gpu'
import {BufferGeometry, FramebufferTexture, GLBufferAttribute} from 'three138'

export async function createThreeBufferGeometry(buffer: Buffer<ComplexFormat>) {
  let {THREE, gl} = gpu
  if (!THREE) {
    throw new Error(`No THREE renderer detected. Have you called gpu.createThreeRenderer?`)
  }
  if (!isComplexFormat(buffer.format)) {
    throw new Error(`Expected buffer format to be complex. Maybe rename the buffer first?`)
  }
  let geom = new THREE.BufferGeometry()
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e32)
  geom.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1e32, -1e32, -1e32),
    new THREE.Vector3(1e32, 1e32, 1e32)
  )
  let buf = await buffer.split()
  for (let k in buf) {
    let b = buf[k]
    b.acquire('gl')
    gpu.buffers.delete(b)
    let type = {float: gl.FLOAT, int: gl.INT, uint: gl.UNSIGNED_INT}[b.format.base]
    let size = b.format.components
    let count = b.attribs[0].count
    geom.setAttribute(k, new THREE.GLBufferAttribute(b.gl!, type, size, 4, count) as any)
  }
  return geom
}

export async function updateThreeBufferGeometry(
  buffer: Buffer<ComplexFormat>,
  geom: BufferGeometry
) {
  let {gl, pool} = gpu
  let deleteBuffer = gl.deleteBuffer
  let removeEventListener = geom.removeEventListener
  for (let k in geom.attributes) {
    let a = geom.attributes[k] as unknown as GLBufferAttribute
    pool.reclaim(a.buffer)
  }
  try {
    gl.deleteBuffer = () => {}
    geom.removeEventListener = () => {}
    // Three.js tracks a whole bunch of internal state for each buffer geometry and .dispose()
    // is the only available interface that can access/clear it, which is unfortunate as it's
    // use has a lot of subtle potentially bug-causing side-effects
    geom.dispose()
  } finally {
    gl.deleteBuffer = deleteBuffer
    geom.removeEventListener = removeEventListener
  }
  let next = await buffer.createThreeBufferGeometry()
  Object.assign(geom, next, {
    name: geom.name,
    groups: geom.groups,
    boundingBox: geom.boundingBox,
    boundingSphere: geom.boundingSphere,
    drawRange: geom.drawRange,
    userData: geom.userData,
  })
  return geom
}

export async function createThreeTexture(buffer: Buffer<Format>, width: number, height: number) {
  let {THREE, threeRenderer, gl} = gpu
  if (!THREE || !threeRenderer) {
    throw new Error(`No THREE renderer detected. Have you called gpu.createThreeRenderer?`)
  }
  if (!isSimpleFormat(buffer.format) || buffer.format.name !== 'vec4') {
    throw new Error(`Expected buffer format to be vec4`)
  }
  let tex = new THREE.FramebufferTexture(width, height, THREE.RGBAFormat)
  tex.flipY = false
  tex.unpackAlignment = 4
  tex.premultiplyAlpha = false
  tex.internalFormat = 'RGBA32F'

  await buffer.acquire('gl')

  let writeTarget = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, writeTarget)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height)
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer.gl!)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, 0)
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)

  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTarget, 0)
  threeRenderer.copyFramebufferToTexture(new THREE.Vector2(0, 0), tex, 0)

  gl.bindTexture(gl.TEXTURE_2D, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  if (buffer.consumed) buffer.free()

  return tex
}

export async function updateThreeTexture(buffer: Buffer<Format>, texture: FramebufferTexture) {
  if (texture.isFramebufferTexture !== true) {
    throw new Error('updateThreeTexture() can only be used with FramebufferTexture')
  }
  let next = await buffer.createThreeTexture(texture.image.width, texture.image.height)
  texture.dispose()
  Object.assign(texture, next)
  let prevProps = gpu.threeRenderer!.properties.get(texture)
  let nextProps = gpu.threeRenderer!.properties.get(next)
  Object.assign(prevProps, nextProps)

  return texture
}
