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
