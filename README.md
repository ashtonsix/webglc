# WebGLC

WebGLC (WebGL Compute) is an accelerated compute library for web browsers, ideal for physics simulations, cellular automata, linear algebra and data analysis. WebGLC kernels can go up to 20x faster than the equivalent JavaScript. WebGLC is an alternative to [GPU.js](https://github.com/gpujs/gpu.js). Whereas GPU.js prioritises convenience, WebGLC prioritises advanced compute capabilities.

Here's a feature comparison table:

|                                       | WebGLC       | GPU.js         |
| ------------------------------------- | ------------ | -------------- |
| Kernel Language                       | GLSL 3.0     | JavaScript     |
| Native Functions                      | **Yes**      | Opt-In         |
| Browser Support                       | **Yes**      | **Yes**        |
| Node.JS Support                       | No           | **Yes**        |
| Debugger                              | No           | **Yes**        |
| `random`                              | **Yes**      | **Yes**        |
| `map`                                 | **Yes**      | **Yes**        |
| `filtro`<br />(`filter`, but Italian) | **Yes**      | No             |
| `reduce`                              | **Yes**      | No             |
| `scan`                                | **Yes**      | No             |
| `group`                               | Coming soon  | No             |
| `sort`                                | **Yes**      | No             |
| Kernel Output                         | **Flexible** | 1 to 4 numbers |
| Batch Read/Write                      | **Yes**      | No             |
| Integrates with Three.js              | **Yes**      | No             |

## Content

- [Install](#install)
- [Introductory Example](#introductory-example)
- [Concept Overview](#concept-overview)
- [Kernels](#kernels)
  - [Map](#map)
  - [Filtro](#filtro)
  - [Reduce & Scan](#reduce--scan)
  - [Group](#group)
  - [Sort](#sort)
- [Format](#format)
- [Buffers](#buffers)
- [Performance](#performance)
  - [Batch Read/Write](#batch-readwrite)
  - [Group Kernel Definitions](#group-kernel-definitions)
- [Memory Management](#memory-management)
- [Scope](#scope)
- [Display](#display)
- [License](#license)
- [Roadmap](#roadmap)
- [Links](#links)
- [Credit](#credit)

## Install

```sh
npm install --save webglc
```

Editor support coming soon (syntax highlighting and error checking, for VSCode and CodeMirror).

## Introductory Example

To obtain a quick flavour of WebGLC let's generate 100,000 particles, move them once, find their average position, and read that value to the CPU:

```ts
import {format as f, ParsedFormat, kernel, lifetime} from 'webglc'

let fparticle = {
  position: f.vec2,
  velocity: f.vec2,
}

let generate = kernel(f.null, fparticle)`
  void map(int i) {
    write_position(vec2(random(), random()));
    write_velocity(vec2(random(), random()));
  }`

let move = kernel(fparticle, fparticle)`
  void map(int i) {
    vec2 p = read_position(i);
    vec2 v = read_velocity(i);
    write_position(p + v);
    write_velocity(v);
  }`

let getTotalPosition = kernel(fparticle, f.vec2)`
  const identity_position = vec2(0., 0.);
  void reduce(int i) {
    vec2 a = read_position(i);
    vec2 b = read_position(i + 1);
    vec2 c = read_position(i + 2);
    vec2 d = read_position(i + 3);
    write(a + b + c + d);
  }`

let positionAverage = lifetime(async ({range}) => {
  let bparticle = await range(100_000).map(generate)
  bparticle = await range(bparticle.length).map(move, bparticle)
  let bpositionTotal = await range(bparticle.length).reduce(getTotalPosition, bparticle)
  let [positionTotal] = await bpositionTotal.read()
  let positionAverage = {
    x: positionTotal[0] / bparticle.length,
    y: positionTotal[1] / bparticle.length,
  }
  return positionAverage
})()
```

## Concept Overview

Let's do a bird's eye view of how things fits together. We'll look at each concept in detail later.

- `format` - types, can be simple like `f.int` or complex like `{position: f.vec2, velocity: f.vec2}`
- `range` - like a 'for' loop, but different
- `kernel` - like a function, but different
- `buffer` - like an array, but, y'know.. different (returned by `range().method()`)
- `lifetime`/`consume` - utilities for memory management (webgl lacks automatic garbage collection)
- `gpu` - namespace for anything global

## Kernels

There are 6 kinds of kernel, as determined by the entrypoint's name. They are:

```txt
map:    [0, 1, 2, 3] -> [0,  2,  4,  6] (*2)
filtro: [0, 1, 2, 3] -> [1,  3, -1, -1] (%2)  out=index
reduce: [0, 1, 2, 3] -> [6]             (+)
scan:   [0, 1, 2, 3] -> [0,  1,  3,  6] (+)
group:  [12, 5, 11]  -> [1, -1,  0,  2] (/10) out=index
sort:   [12, 5, 11]  -> [0,  2,  1]     (-)   out=index
```

The output for filtro, group and sort contain not values from the original array, but rather, indices to values in the original array; here -1 indicates the absence of a value.

Kernels look like this:

```ts
kernel(readFormat, writeFormat)`
  const identity_x = 0.; // basically a default value for "read_x()"

  void entrypoint(int i) {
    read_x(i); // use identity, read(), and write() for simple formats (eg, f.float)
    write_x(value);
  }`
```

All entrypoint functions accept an index, return nothing, and use the read/write functions generated by WebGLC for I/O. Any "out-of-bounds" read will return the identity value.

### Map

Example:

```ts
let double = kernel(f.float, f.float)`
  void map(int i) {
    write(read(i) * 2.);
  }`
```

### Filtro

> Filtro is spelled Italian because you can't create a function called "filter" in GLSL (it's a reserved keyword)

Write `0` to drop a value, or any other integer to keep it.

Example:

```ts
let keepOdd = kernel(f.int, f.int)`
  void map(int i) {
    write(read(i) % 2);
  }`

let bdata = buffer(f.int, [0, 1, 2, 3])
bdata = await range(bdata.length).filtro(keepOdd, bdata.consume())
let adata = await bdata.read() // [1, 3, -1, -1]
```

You can see how many values passed the kernel by passing the `length` flag like this:

```ts
// range().method() returns an array of buffers when given the appropiate flags
// bdata = [1, 3, -1, -1], blength = [2]
let blength: Buffer<typeof f.int>
;[bdata, blength] = await range(bdata.length).filtro(keepOdd, bdata.consume(), 'length')
```

<details>
<summary>Collapse/Expand Additional Example</summary>

`filtro` outputs indices and pads it's output with -1's. You can get `filtro` to behave more like its JavaScript equivalent by slicing the buffer and using `map` to inline the values like this:

```ts
let fproduct = {id: f.int, quantity: f.int, value: f.float}

let _keepValuable = filtro(fproduct, f.int)`
  void filtro(int i) {
    write(read_value(i) > 7. ? 1 : 0);
  }`

let _inline = map({...fproduct, index: f.int}, fproduct)`
  void map(int i) {
    i = read_index(i);
    write_id(read_id(i));
    write_quantity(read_quantity(i));
    write_value(read_value(i));
  }`

let bproduct = buffer(fproduct, [
  {id: 0, quantity: 2, value: 10},
  {id: 1, quantity: 4, value: 2},
  {id: 2, quantity: 1, value: 20},
])

let keepValuable = lifetime(async ({range, buffer}, bproduct) => {
  // bindex = [0, 2, -1], blength = [2]
  let [bindex, blength] = await range(bproduct.length).filtro(_keepValuable, bproduct, 'length')
  // bproduct = [{id: 0, quantity: 2, value: 10}, {id: 2, quantity: 1, value: 20}, {id: 0, quantity: 0, value: 0}]
  bproduct = await range(bproduct.length).map(_inline, await bproduct.merge({index: bindex}))
  // bproduct = [{id: 0, quantity: 2, value: 10}, {id: 2, quantity: 1, value: 20}]
  bproduct = await bproduct.slice(0, (await blength.read())[0])
  return bproduct
})

bproduct = await keepValuable(bproduct.consume())
```

</details>

### Reduce & Scan

`reduce` kernels combine the values at `i`, `i+1`, `i+2` and `i+3` (will make sense if/when you read the ["performance"](./#Performance) section). `scan` kernels combine the values at `i` and `i+1`.

`reduce` and `scan` kernels must be associative (ie, `(a + b) + c == a + (b + c)`) and provide an identity element (such that `a + id == a` and `id + b == b`). As a corollary the read and write formats for a `scan`/`reduce` kernel must be identical.

`reduce` example:

```ts
let sum = kernel(f.float, f.float)`
  const identity = 0.;
  void reduce(int i) {
    float a = read(i);
    float b = read(i + 1);
    float c = read(i + 2);
    float d = read(i + 3);
    write(a + b + c + d);
  }`

range(4).reduce(sum, buffer(f.float, [0, 1, 2, 3])) // [6]
```

<details>
<summary>Expand/Collapse Additional Example</summary>

If you want a `reduce` function that combines just two values at a time do like this:

```ts
let sum = kernel(f.float, f.float)`
  const identity = 0.;
  float sum(float a, float b) { return a + b; }
  void reduce(int i) {
    float a = sum(read(i    ), read(i + 1));
    float b = sum(read(i + 2), read(i + 3));
    float c = sum(a, b);
    write(c);
  }`
```

</details>

`scan` example:

```ts
let prefixSum = kernel(f.float, f.float)`
  const identity = 0.;
  void reduce(int i) {
    float a = read(i);
    float b = read(i + 1);
    write(a + b);
  }`

// [0, 1, 3, 6] (0, 0+1, 0+1+2, 0+1+2+3)
range(4).scan(prefixSum, buffer(f.float, [0, 1, 2, 3]))
```

`scan`/`reduce` kernels may be non-commutative (ie, `a + b != b + a`). `reduce` kernels don't need any modification for this, but non-commutative `scan` kernels will need to swap `i` with `i+1` if `swapped == 1` like this:

```ts
let nonCommutativeScan = kernel(f.float, f.float)`
  const identity = 0.;
  void scan(int i, int swapped) {
    float a;
    float b;
    if (swapped == 0) {
      a = read(i);
      b = read(i + 1);
    } else {
      a = read(i + 1);
      b = read(i);
    }
    // float result = ...
    write(result);
  }`
```

### Group

Not implemented yet, you can use `sort` to group values in the meantime

### Sort

Compare the value at `i` with the value at `j`. Write `0` to leave the order unchanged, a negative integer for `i` to come first, or a positive integer for `j` to come first.

```ts
let sort = kernel(f.int, f.int)`
  void sort(int i, int j) {
    write(read(i) - read(j));
  }`
log(sort.programs.main.vs)
let bdata = buffer(f.int, [0, 4, 6, 2, 5, 7, 3, 1])
let bsorted = await range(bdata.length).sort(sort, bdata)
let data = await bdata.read()
// [0, 1, 2, 3, 4, 5, 6, 7]
let sorted = (await bsorted.read()).map((i) => data[i])
```

## Format

Scalar formats include `f.float`, `f.int` and `f.uint`; and we got some vector formats too: `f.vec[234]`, `f.ivec[234]` and `f.uvec[234]`.

Each format has a certain number of 'components'. For example `{mass: f.float, position: f.vec2, velocity: f.vec2}` has 5 components (1 + 2 + 2; scalar + vec2 + vec2), and 3 attributes (mass, position, velocity). Right now formats are limited to 16 components, but I hope to remove that restriction soon.

You can use the `ParsedFormat` utility to get a typescript type like this:

```ts
import {format as f, ParsedFormat, buffer} from 'webglc'

let fparticle = {mass: f.float, position: f.vec2, velocity: f.vec2}

// equivalent to {mass: number, position: [number, number], velocity: [number, number]}
type Particle = ParsedFormat<typeof fparticle>
```

Use `f.null` for kernels that don't accept any input.

## Buffers

Holds data. You can read/write to them, and manipulate.

Here's a few ways to write:

```ts
import {format as f, buffer} from 'webglc'

let a = buffer(f.int, [0, 1, 2, 3, 4]) // on creation (synchronous)
await a.write([5, 6, 7, 8]) // after creation (asynchronous)

a = range(a.length).map(someKernel, a.consume()) // as output of a kernel
```

Here is how to read:

```ts
await a.read() // [5, 6, 7, 8]
```

All methods are asynchronous, and can be called either as instance methods (as above) or as static methods:

```ts
import {buffer} from 'webglc'

// as instance method:
a.concat(b)

// as static method:
buffer.concat(a, b)
```

Here are the other methods:

**.copy()**

```ts
buf.copy()
```

**.slice()**

```ts
buf.slice(start, end)
```

**.concat()**

```ts
buf.concat(a, b, c, d /* ... */)
```

**.split()**

Turn a complex buffer into multiple simple buffers

```ts
let buf = buffer({a: f.int, b: f.int}, [
  {a: 0, b: 8},
  {a: 1, b: 9},
])
// a=[0,1], b=[8,9]
let {a, b} = await buf.split()
```

**.merge()**

Join simple and/or complex buffers into a complex buffer:

```ts
// {[x]: Buffer<Format>} or Buffer<ComplexFormat>
await buffer.merge(
  {a: buffer(f.int, [0, 1, 2, 3])},
  buffer({b: f.int}, [{b: 5}, {b: 6}])
  // ...
)
```

**.rename()**

Renames attributes. You can also use this method to omit attributes. Use it like this:

```ts
// buf.format = {birds: f.int}
let buf = buffer({penguins: f.int, tigers: f.int}).rename({penguins: 'birds'})
```

Use the name `"."` to refer to a simple format like this:

```ts
// buf.format = {octopus: f.int}
let buf = rename(buffer(format.int), {'.': 'octopus'})

// buf.format = f.int
let buf = rename(buffer({ants: format.int}), {ants: '.'})
```

If you're using TypeScript use `as const` on the dictionary:

```ts
let buf = buffer({dolphins: f.int}).rename({dolphins: 'cetaceans'} as const)
```

### Memory Management

WebGLC lacks automatic garbage collection, so buffers need to be manually deallocated when they're no longer needed.

Let's begin this topic with an example of what one should NOT do:

```ts
let addOne = kernel(f.int, f.int)`void map(int i) { write(read(i) + 1); }`

let tick = async () => {
  buf = await range(buf.length).map(addOne, buf)
  requestAnimationFrame(tick)
}
tick()
```

The above code will create a new buffer every tick, use up all the browser's memory and eventually cause a context loss (webgl's equivalent to crashing). New buffers are created whenever you invoke a kernel or buffer method (eg, `buffer.slice()`).

WebGLC provides three ways to deallocate memory `free`, `consume` & `lifetime`. Here's how to use `free`:

```ts
let tick = async () => {
  let next = await range(buf.length).map(addOne, buf)
  buf.free()
  buf = next
  requestAnimationFrame(tick)
}
```

Then we've got `consume`, which marks the buffer to be freed after one use. I think it makes for tidier code than `free` does. Using `consume` may occasionally result in a performance boost, since its use indicates the buffer can be modified in-place (in all other cases buffers are copied before being modified).

```ts
let tick = async () => {
  buf = await range(buf.length).map(addOne, buf.consume())
  requestAnimationFrame(tick)
}

// or like:
buf = await buf.consume().slice(1)
```

In a more complex program you may have many temporary buffers; and that's a potential source of bugs, since forgetting to deallocate one can introduce a hard-to-detect memory leak. `lifetime` is meant to tackle this problem, you use it like this:

```ts
import {format as f, lifetime, Buffer} from 'webglc'

let superkernel = lifetime(async ({range, buffer}, buf: Buffer<typeof f.float>) => {
  buf = await range(buf.length).map(addOne, buf)
  buf = await range(buf.length).map(double, buf)
  return buf
})

buf = await superkernel(buf.consume())
```

All buffers created within the lifetime are freed after it returns, except for buffers in the return value (this can be an array or object like `{buf0, buf1, someOtherValue}`). The inputs to the lifetime are also freed if they have been marked by `consume`. For `lifetime` to work as intended you must use the copy of `range`/`buffer` given to that lifetime.

## Performance

### Batch Read/Write

Earlier we saw an implementation of sum like this:

```ts
let sum = kernel(f.float, f.float)`
  const identity = 0.;
  void reduce(int i) {
    float a = read(i);
    float b = read(i + 1);
    float c = read(i + 2);
    float d = read(i + 3);
    write(a + b + c + d);
  }`
```

Here's another implementation with ~3x better performance (power consumption and execution time):

```ts
let sum = kernel(f.float, f.float)`
  const identity = 0.;
  const ones = vec4(1., 1., 1., 1.);
  void reduce(int i) {
    vec4 input = read(i, f_vec4);
    // dot(input, ones) is equivalent to input.x + input.y + input.z + input.w (but faster)
    float output = dot(input, ones);
    write(output);
  }`
```

Here we see `read_x(i, format)` accepts a second parameter which allows reading multiple values at a time. You can read 2/4 scalar values at a time, or 2 vec2/ivec2/uvec2 values at a time with this parameter; just prepend `f_` to the format type.

<details>

<summary>Troubleshooting batch reads</summary>

One may assume `i` in `read_x(i, format)` refers to the start index of a read but that's not quite right.

Doing `read(7, f_vec4)`, for example, would return the values at `i=4,5,6,7` (if reading from a scalar attribute). One could imagine reading from an array that's been broken up into chunks, and observe `i` refers to a particular chunk index rather than a value index. To give a JavaScript equivalent:

```ts
// let data = [[0,1,2,3],[4,5,6,7],[8,9,10,11]]
function read(i, count) {
  let j = i % 4
  let chunk = data[Math.floor(i / 4)]
  if (count === 1) return chunk[j]
  if (count === 2) return j < 2 ? chunk.slice(0, 2) : chunk.slice(2, 4)
  if (count === 4) return chunk
}
read(7, 4) // [4,5,6,7]
```

You should also be mindful about doing batch reads when the read buffer's length is not divisible by 4. When reading from the last chunk in the buffer any "out-of-bounds" values will copy from the identity. For example:

```ts
let k = kernel(f.float, f.float)`
  const float identity = 99.;
  void map(int i) {
    vec4 v = read(i, f_vec4);
    write(v.x, v.y, v.z, v.w);
  }`
let bdata = buffer(f.float, [0, 1])
bdata = await range(4).map(k, bdata) // [0, 1, 99, 99]
```

</details>

We can also write multiple values at a time, here's an effcient way to double the values in a buffer:

```ts
let double = kernel(f.float, f.float)`
  void map(int i) {
    vec4 v = read(i, f_vec4) * 2.;
    // write_x() takes 1, 2 or 4 arguments
    write(v.x, v.y, v.z, v.w);
  }`
```

Passing multiple arguments into `write_x()` will affect how the entrypoint is called. If the write batch size is `1` entrypoint will be called with `i=0,1,2,3,4,5...` if write batch size is `2` then `i=0,2,4,6,8...`, if `4` then `i=0,4,8,12...`.

OK, so `map`, `filtro` and `group` support multi-read and multi-batch as above. With `reduce` you just write one value at a time. Same with `sort`, it's just not practical to use multi-read/multi-write for `sort` kernels.

`scan` is a bit different. You'll want to write `combine(i, i+1), combine(i+2, i+3), combine(i+4, i+5), combine(i+6, i+7)`.

Here's how to do a prefix sum with multi-write:

```ts
let prefixSum = kernel(f.float, f.float)`
  const int identity = 0;
  void scan(int i) {
    float a = read(i);
    float b = read(i + 1);
    float c = read(i + 2);
    float d = read(i + 3);
    float e = read(i + 4);
    float f = read(i + 5);
    float g = read(i + 6);
    float h = read(i + 7);
    write(a + b, c + d, e + f, g + h);
  }`
```

<details>

<summary>Fast Prefix Sum</summary>

```ts
let prefixSum = kernel(f.float, f.float)`
  const int identity = 0;
  void scan(int i) {
    vec4 in0 = read(i, f_vec4);
    vec4 in1 = read(i + 4, f_vec4);
    vec4 r = vec4(in0.xz, in1.xz) + vec4(in0.yw, in1.yw);
    write(r.x, r.y, r.z, r.w);
  }`
```

</details>

<details>

<summary>Non-Commutative Scan</summary>

```ts
let whatever = kernel(f.float, f.float)`
  const int identity = 0;
  void scan(int i, int swapped) {
    vec4 a;
    vec4 b;
    vec4 in0 = read(i, f_vec4);
    vec4 in1 = read(i + 4, f_vec4);
    if (swapped == 0) {
      a = vec4(in0.xz, in1.xz);
      b = vec4(in0.yw, in1.yw);
    } else {
      a = vec4(in0.yw, in1.yw);
      b = vec4(in0.xz, in1.xz);
    }
    // ...
  }`
```

</details>

### Avoid passing data between the CPU and GPU

Shuffling information between the CPU and GPU via `buffer.read()`/`buffer.write()` has a significant performance overhead. Avoid where practical.

### GLSL Tips

Use Google, useful search terms (to get started): "GLSL optimsation", "SIMD / vectorize", "Swizzle", "MAD instruction", "lerp", "dot".

### Group Kernel Definitions

Prefer this (browser compiles kernels in parallel):

```ts
kernel()``
kernel()``
kernel()``
range().method()
range().method()
range().method()
```

To this (browser compiles kernels one-by-one):

```ts
kernel()``
range().method()
kernel()``
range().method()
kernel()``
range().method()
```

## Scope

The read buffer has some restrictions that prevent it from covering every use case, namely:

1. Reduce and scan kernels must have matching read/write formats
2. TODO: document groupsize-related restriction
3. You cannot mix attributes of different lengths

To illustrate restriction 3:

```ts
let addX = kernel({a: f.int, b: f.int}, f.int)`
  void map(int i) {
    int result = read_a(i) + read_b(); // index for read_b() defaults to "0"
    write(result);
  }`

let a = buffer(f.int, [0, 1, 2, 3])
let b = buffer(f.int, [1])
let merged = buffer.merge({a, b}) // merge is allowed, and creates a mixed-length buffer
console.log(merged.length) // NaN
range(merged.length).map(addX, merged) // will throw error
```

Specifying a scope buffer let's you get around these:

```ts
// kernel(read, write, scope)
let addX = kernel(f.int, f.int, {add: f.int})`
  void map(int i) {
    int result = read(i) + read_add();
    write(result);
  }`

let a = buffer(f.int, [0, 1, 2, 3])
a = await range(merged.length).map(addX, a, buffer({add: f.int}, [{add: 5}]))
await a.read() // [5, 6, 7, 8]
```

The scope format must be complex (eg, `{[x]: f.int}` rather than `f.int`). The scope's attribute lengths don't need to match.

## Display

There are a few different ways to do display:

1. Read the data to CPU and do stuff (`buf.read`, slow)
2. Use the browser's WebGL2 API (`gpu.gl`, complicated)
3. Use the Three.js integration (reccomended)

### Method 1 (`buf.read`)

Do `buf.read()` and then do more code.

### Method 2 (`gpu.gl`)

Draw a red rectangle:

```ts
document.body.appendChild(gpu.dom)
gpu.gl.clearColor(1, 0, 0, 1) // 1,0,0,1 = red
gpu.gl.clear(gpu.gl.COLOR_BUFFER_BIT)
// do blitToBackgroundCanvas after updating the canvas
if (gpu.info.hasFlickerBug) gpu.blitToBackgroundCanvas()
```

### Method 3 (Three.js)

To get started with the Three.js integration, replace the following lines of code:

```ts
// this:
let renderer = new THREE.WebGLRenderer()
// becomes:
let renderer = gpu.createThreeRenderer(THREE)

// this:
document.body.appendChild(renderer.domElement)
// becomes:
document.body.appendChild(gpu.dom)
```

> Using `gpu.dom` protects against this Mozilla Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1763507

To create/update geometery:

```ts
let geom = buf.createThreeBufferGeometry()
buf.updateThreeBufferGeometry(geom)
```

To create/update texture:

```ts
let tex = buf.createThreeTexture()
buf.updateThreeTexture(tex)
```

Go to [threejs.org/docs](https://threejs.org/docs) if you need help setting up THREE, or figuring out what to do with the geometry/texture.

## License

MIT

## Roadmap

- Faster `group` implementation
- Groupsize parameter for `range` (eg, max in each group)
- Editor extension for VSCode
- WebGLC website with featured projects and interactive examples
- `group` kernel
- Use vertex array objects / uniform buffers for input where practical (performance)

## Links

- Discord Community: https://discord.gg/D27BDpJr
- WebGL2 Fundamentals: https://webgl2fundamentals.org
- GPU Gems 3: https://developer.nvidia.com/gpugems/gpugems3
- GLES 3.0 System Specification: https://www.khronos.org/registry/OpenGL/specs/es/3.0/es_spec_3.0.pdf
- GLES 3.0 Language Specification: https://www.khronos.org/registry/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf

## Credit

WebGLC was created by Ashton Six (currently unemployed, resume at [ashtonsix.com/resume.pdf](https://ashtonsix.com/resume.pdf))

Creating WebGLC would have been much harder without [webgl2fundamentals.org](https://webgl2fundamentals.org/) (created by [@greggman](https://twitter.com/greggman)) and [GPU Gems 3](https://developer.nvidia.com/gpugems/gpugems3/contributors) (parts 5 and 6 in particular).
