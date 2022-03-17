# webglc Appendix

> [Return to README.md](./README.md)

## TODO

buffer:

- test lifetime / memory management

General:

- Multi-pass execution (for unlimited write components)
- Benchmarks

kernels:

- group kernel
- start parameter for range
- groupsize parameter for range

Optimisations:

- Vertex array object for non-random reads
- Uniform buffer for small buffers

Other Optimisations:

- Vertex array for sort
- Histogram (stencil buffer)
- Do groups in parralel
- Thread blocks for Bitonic Sort (can eliminate dependent reads when partition.y <= 64, would also enable more effcient reads inside user code for first 21 draw calls of sort operation)
- blendEquation/blendFunc for linear algebra (can SRC_ALPHA_SATURATE be used for fast logic?)

Documentation:

- ThreeJS tutorial
- Nice website
- Interactive examples

Developer Experience (general):

- Validation errors for non-typescript users
- Source error formatting (make them look like https://babeljs.io/docs/en/babel-code-frame)

Developer Experience (CodeMirror/VSCode extensions):

- Syntax highlighting
- Error highlighting (starting point: https://github.com/KhronosGroup/glslang)
- Module system (error checking should take `kernel.include` into account)
- Autocomplete?
- Autoformat?

## Implementation Notes

WebGL2 exposes quite a few ways to transfer data around the GPU

### Kernel Input

Factors: latency

- Texture
- Vertex Array
- Uniform Buffer

### Kernel Output

- Transform Feedback (Interleaved)
- Transform Feedback (Separate)
- Framebuffer (Texture)
- Framebuffer (Renderbuffer)
- Framebuffer v2 (Varyings)

### Putting it Together

- Custom interleave
- PIXEL_PACK, PIXEL_UNPACK
