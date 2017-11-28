# glTF Tools

This directory contains a set of tools for simple manipulation of glTF assets. They are independent of the rest of the source code. They could be used as command-line tools or integrated in another application, client webpage, or server-side processing.

* Web (https://gltf.insimo.com/)
* Desktop apps for Windows, MacOS, and Linux (no download yet)

## Currently Included Tools

* ToolPackGLB.js: pack asset as a GLB binary file
* ToolPackZIP.js: pack asset as a ZIP archive containing GLTF json file and associated binary buffers and images
* ToolPackBase64.js: pack asset as a GLTF json file embedding binary buffers and images as base64-encoded data uris
* ToolGLTFValidator.js: wrap [glTF Validator](https://github.com/KhronosGroup/glTF-Validator) to validate conformance to the glTF 2.0 specification
* ToolDracoCompressor.js: wrap [Draco](https://github.com/google/draco) to compress meshes data *(glTF extension currently being reviewed)*
* ToolGLTFPipeline.js: wrap [gltf-pipeline](https://github.com/AnalyticalGraphicsInc/gltf-pipeline) to optimize the scene *(2.0-cesium branch, not functional yet, see AnalyticalGraphicsInc/gltf-pipeline#330)*
