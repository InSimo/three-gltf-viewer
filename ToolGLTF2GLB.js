const mime = require('mime-types');

module.exports = class ToolGLTF2GLB {

  constructor () {
    this.name = 'glTF ➔ glb';
    this.icon = '▶';
  }

  run ( gltfContent ) {

    // input files Map
    const files = gltfContent.files;
    // input json, modified in-place so we clone it first
    var json = JSON.parse(JSON.stringify(gltfContent.gltf));
    var buffers = json.buffers = json.buffers || [];
    var bufferViews = json.bufferViews = json.bufferViews || [];
    var images = json.images || [];

    // 1. create an array of all the data 'chunk' to be concatenated into the unique binary buffer
    //    relevant data is all buffers and all images
    //    Possible cases for input data:
    //     a. data in binary files, with or without a specified length
    //     b. data as base64-encoded uri (NOT HANDLED YET)
    //     c. data in external files/uris (NOT HANDLED YET)

    // each chunk has:
    //    - size
    //    - data (as Blob or ArrayBuffer)
    var outputBufferSize = 0;
    var outputChunks = []

    // TODO: WIP
    // number of buffers in output, which is buffer 0 for embedded binary data + any buffer refering to external urls
    //var outputBufferCount;

    var inputBufferStartInOutputBuffer = {};

    for (var i = 0; i < buffers.length; ++i) {
      // let's assume no buffer refer to the same file
      var buffer = buffers[i];
      var uri = buffer.uri;
      if (files.has(uri)) { // case a.
        var file = files.get(uri);
        console.log('Buffer ',i,': refers to file ',file);
        var chunkIndex = outputChunks.length;
        var chunk = { size: file.size, data: file };
        outputChunks.push(chunk);
        inputBufferStartInOutputBuffer[i] = outputBufferSize;
        outputBufferSize += chunk.size;
      }
      else {
        console.log('Buffer ',i,': NOT FOUND ',uri);
      }
    }

    var inputImageStartInOutputBuffer = {};

    for (var i = 0; i < images.length; ++i) {
      // let's assume no image refer to the same file
      var image = images[i];
      if (image.uri) { // this image refers to a file
        var uri = image.uri;
        if (files.has(uri)) { // case a.
          var file = files.get(uri);
          console.log('Image ',i,': refers to file ',file);
          var chunkIndex = outputChunks.length;
          var chunk = { size: file.size, data: file };
          outputChunks.push(chunk);
          inputImageStartInOutputBuffer[i] = outputBufferSize;
          outputBufferSize += chunk.size;
        }
        else {
          console.log('Image ',i,': NOT FOUND ',uri);
        }
      }
      else if (image.bufferView) {
        // nothing to do, the underlying buffer is already covered above
      }
    }

    // 2. update the GLTF json to refer to the output buffer instead of the input files

    // for now, we consider only one remaining output buffer
    json.buffers = [ { byteLength: outputBufferSize } ];

    for (var i = 0; i < bufferViews.length; ++i) {
      // let's assume no buffer refer to the same file
      var bufferView = bufferViews[i];
      bufferView.byteOffset += inputBufferStartInOutputBuffer[bufferView.buffer];
      bufferView.buffer = 0;
    }

    for (var i = 0; i < images.length; ++i) {
      // let's assume no image refer to the same file
      var image = images[i];
      if (image.uri) { // this image refers to a file
        var uri = image.uri;
        if (files.has(uri)) { // case a.
          var file = files.get(uri);
          delete image.uri;
          // we need to create a bufferView for this image
          var bufferViewIndex = bufferViews.length;
          var bufferView = { buffer: 0, byteOffset: inputImageStartInOutputBuffer[i], byteLength: file.size };
          var mimeType = mime.lookup(uri);
          if (mimeType) {
            image.mimeType = mimeType;
          }
          else {
            console.log('ERROR: unknown image extension',uri);
          }
          bufferViews.push(bufferView);
          image.bufferView = bufferViewIndex;
        }
        else {
          console.log('Image ',i,': NOT FOUND ',uri);
        }
      }
      else if (image.bufferView) {
        // nothing to do, the underlying buffer is already covered above
      }
    }

    console.log(json);

    // 3. now we have the output json, we need to concatenate it with the binary chunks and the header / separators

    // json -> string
    var jsonString = JSON.stringify(json);
    // string -> Uint8Array
    var jsonArray = new TextEncoder().encode(jsonString);

	const BINARY_EXTENSION_HEADER_MAGIC_UINT32 = 0x46546C67;
	const BINARY_EXTENSION_HEADER_LENGTH = 12;
	const BINARY_EXTENSION_CHUNK_HEADER_LENGTH = 8;
	const BINARY_EXTENSION_CHUNK_TYPES = { JSON: 0x4E4F534A, BIN: 0x004E4942 };

    var jsonLength = jsonArray.length * jsonArray.BYTES_PER_ELEMENT;
    var jsonPadding = (4-(jsonLength % 4))%4;

    var binaryLength = outputBufferSize;
    var binaryPadding = (4-(binaryLength % 4))%4;

    var totalLength = BINARY_EXTENSION_HEADER_LENGTH + BINARY_EXTENSION_CHUNK_HEADER_LENGTH + jsonLength + jsonPadding + BINARY_EXTENSION_CHUNK_HEADER_LENGTH + binaryLength + binaryPadding;

    var headerArray = Uint32Array.from( [
      /* magic */ BINARY_EXTENSION_HEADER_MAGIC_UINT32,
      /* version */ 2,
      /* length */ totalLength
    ] );

    var jsonHeaderArray = Uint32Array.from( [
      /* chunkLength */ jsonLength + jsonPadding,
      /* chunkType */ BINARY_EXTENSION_CHUNK_TYPES.JSON
    ] );

    var binaryHeaderArray = Uint32Array.from( [
      /* chunkLength */ binaryLength + binaryPadding,
      /* chunkType */ BINARY_EXTENSION_CHUNK_TYPES.BIN
    ] );

    var outputBinaryItems = [];

    outputBinaryItems.push(headerArray);
    outputBinaryItems.push(jsonHeaderArray);
    outputBinaryItems.push(jsonArray);
    if (jsonPadding) {
      //outputBinaryItems.push(new Uint8Array(jsonPadding)); -> fails, because we need to insert spaces (0x20)
      outputBinaryItems.push(Uint8Array.from({length: jsonPadding}, x => 0x20));
    }
    outputBinaryItems.push(binaryHeaderArray);
    for (var c of outputChunks) {
      outputBinaryItems.push(c.data);
    }

    if (binaryPadding) {
      outputBinaryItems.push(new Uint8Array(binaryPadding));
    }

    var outputBinary = new Blob(outputBinaryItems, { type: 'model/gltf-binary' });

    console.log(outputBinary);

    gltfContent.binary = outputBinary;
    gltfContent.files = new Map();
    gltfContent.gltf = json;

  }
}
