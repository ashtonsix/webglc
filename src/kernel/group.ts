// for hashing
let primeBiggest = 1048576
let primeSieve = new Uint8Array(primeBiggest)
let primes = [] as number[]
function prime(gte: number) {
  let lo = 0
  let hi = primes.length
  let guess = Math.floor((lo + hi) / 2)
  while (lo !== guess) {
    if (primes[guess] >= gte && primes[guess - 1] < gte) break
    if (primes[guess] > gte) hi = guess
    else lo = guess
    guess = Math.min(Math.floor((lo + hi) / 2), primes.length - 1)
  }
  if (primes[guess] >= gte) return primes[guess]
  for (let i = primes[guess] ?? 2; i < primeBiggest; i++) {
    if (primeSieve[i]) continue
    primes.push(i)
    for (let j = i; j < primeBiggest; j += i) primeSieve[j] = 1
    if (i >= gte) return i
  }
  return primes[primes.length - 1]
}
