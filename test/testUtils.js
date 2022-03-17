export function log(message, error) {
  let replacer = (k, v) => (typeof v?.[0] === 'number' ? v.toString() : v)
  let str = typeof message === 'string' ? message : JSON.stringify(message, replacer, 2)
  let log = document.createElement('pre')
  let lines = str.split('\n')
  str = lines.map((s, i) => (i + 1 + '').padEnd(Math.log10(lines.length) + 2, ' ') + s).join('\n')
  log.textContent = str
  if (error) log.style.color = 'red'
  document.body.appendChild(log)
}

export const assert = {
  equal(a, b) {
    let as = JSON.stringify(a)
    let bs = JSON.stringify(b)
    if (as !== bs) throw new Error(`Expected ${as} to equal ${bs}`)
  },
  lessThan(a, b) {
    if (a >= b) throw new Error(`Expected ${a} to be less than ${b}`)
  },
}

export const proxyGL = (gl) => {
  let enabled = false
  let proxy = new Proxy(gl, {
    get(gl, key) {
      let location = new Error().stack.split('\n')[1]
      if (typeof gl[key] !== 'function') {
        // console.log(location)
        if (enabled) console.log(`gl.${key} // == ${gl[key]}. ${location}`)
        return gl[key]
      }
      return (...args) => {
        if (enabled) console.log(`gl.${key}(${args.toString()}) // ${location}`)
        return gl[key](...args)
      }
    },
    set(gl, key, value) {
      if (key === 'proxyEnabled') enabled = value
      else gl[key] = value
      return true
    },
  })
  return proxy
}

/**
 * Prints something like this if called as intended:
 *
 *                                             16
 *                      8                       8
 *          4           4           4           4
 *    2     2     2     2     2     2     2     2
 * 1  1  1  1  1  1  1  1  1  1  1  1  1  1  1  1
 *
 *                                             16
 *                      8                       0
 *          4           0           4           8
 *    2     0     2     4     2     8     2    12
 * 1  0  1  2  1  4  1  6  1  8  1 10  1 12  1 14
 * 1  2  3  4  5  6  7  8  9 10 11 12 13 14 15  0
 **/
export function debugScanLayers(layers) {
  let max = Math.max(...layers.map((l) => l.length))
  let pad = Math.ceil(Math.log10(Math.max(...layers.flat(3)))) + 1
  let slayers = layers.map((l) =>
    l.map((ll) => (ll + '').padStart(pad * Math.ceil(max / l.length))).join('')
  )
  pad = Math.max(...slayers.map((l) => l.length))
  for (let l of slayers) console.log(l.padStart(pad))
}
