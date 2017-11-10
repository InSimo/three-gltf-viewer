// we no longer include mime-types, because it adds 140KB of minified js code
// while we only need to recognize image types, which can only be jpeg or png
// according to the glTF 2.0 specification
//const mime = require('mime-types');

class ToolPackGLB {

  constructor () {
    this.name = 'Pack ➔ glb';
    this.icon = '🗀'; // folder unicode character
    this.order = 20;
  }

  run ( gltfContent ) {

    // input json, modified in-place so we clone it first
    var json = JSON.parse(JSON.stringify(gltfContent.gltf));
    var buffers = json.buffers = json.buffers || [];
    var bufferViews = json.bufferViews = json.bufferViews || [];
    var images = json.images || [];

	const imageExtMIME = {
	  'png':'image/png',
	  'jpg':'image/jpeg',
	  'jpeg':'image/jpeg'
	};

    // 1. create an array of all the data 'chunk' to be concatenated into the unique binary buffer
    //    relevant data is all buffers and all images
    //    Possible cases for input data:
    //     a. data in the input GLB buffer
    //     b. data in binary files, with or without a specified length
    //     c. data as base64-encoded uri (NOT HANDLED YET)
    //     d. data in external files/uris (NOT HANDLED YET)

    // each chunk has:
    //    - size
    //    - data (as Blob or ArrayBuffer)
    var outputBufferSize = 0;
    var outputChunks = []

    // TODO: WIP
    // number of buffers in output, which is buffer 0 for embedded binary data + any buffer refering to external urls
    //var outputBufferCount;

    var inputBufferStartInOutputBuffer = {};
    var inputFileStartInOutputBuffer = {};

    for (var i = 0; i < buffers.length; ++i) {
      var buffer = buffers[i];
      var uri = buffer.uri;
      var bufferData = gltfContent.getBufferArrayBuffer(i);
      if (bufferData === undefined) {
        if (uri === undefined) {
          console.error('Buffer '+i+': does not have a uri but no pre-existing GLB body found');
        }
        else {
          console.error('Buffer ',i,': NOT FOUND ',uri);
        }
        continue;
      }

      if (uri !== undefined && uri in inputFileStartInOutputBuffer) { // already included
        inputBufferStartInOutputBuffer[i] = inputFileStartInOutputBuffer[uri];
        continue;
      }

      // add alignment chunk to 4 bytes if necessary
      // TODO: check actual alignment requirements, currently 4 works for all supported types
      if (outputBufferSize%4) {
        var size = 4-(outputBufferSize%4);
        outputChunks.push({size: size, data: new ArrayBuffer(size)});
        outputBufferSize += size;
      }
      var chunkIndex = outputChunks.length;
      var chunk = { size: bufferData.byteLength, data: bufferData };
      outputChunks.push(chunk);
      inputBufferStartInOutputBuffer[i] = outputBufferSize;
      if (uri !== undefined) {
        inputFileStartInOutputBuffer[uri] = outputBufferSize;
      }
      outputBufferSize += chunk.size;
    }

    var inputImageStartInOutputBuffer = {};

    for (var i = 0; i < images.length; ++i) {
      var image = images[i];
      if (image.bufferView !== undefined) {
        // nothing to do, the underlying buffer is already covered above
        continue;
      }
      var imageData = gltfContent.getImageArrayBuffer(i);
      if (imageData === undefined) {
        console.error('Image ',i,': NOT FOUND ',uri);
        continue;
      }
      // add alignment chunk to 4 bytes if necessary
      // TODO: check actual alignment requirements, currently 4 works for all supported types
      if (outputBufferSize%4) {
        var size = 4-(outputBufferSize%4);
        outputChunks.push({size: size, data: new ArrayBuffer(size)});
        outputBufferSize += size;
      }
      var uri = image.uri;

      if (uri !== undefined && uri in inputFileStartInOutputBuffer) { // already included
        inputImageStartInOutputBuffer[i] = inputFileStartInOutputBuffer[uri];
        continue;
      }

      var chunkIndex = outputChunks.length;
      var chunk = { size: imageData.byteLength, data: imageData };
      outputChunks.push(chunk);
      inputImageStartInOutputBuffer[i] = outputBufferSize;
      if (uri !== undefined) {
        inputFileStartInOutputBuffer[uri] = outputBufferSize;
      }
      outputBufferSize += chunk.size;
    }

    // 2. update the GLTF json to refer to the output buffer instead of the input files

    for (var i = 0; i < bufferViews.length; ++i) {
      var bufferView = bufferViews[i];
      // preserve the original buffer uri as the name on its dataViews
      if (!bufferView.name && buffers[bufferView.buffer].uri) {
        bufferView.name = buffers[bufferView.buffer].uri;
      }
      bufferView.byteOffset += inputBufferStartInOutputBuffer[bufferView.buffer];
      bufferView.buffer = 0;
    }

    // for now, we consider only one remaining output buffer
    json.buffers = [ { byteLength: outputBufferSize } ];

    for (var i = 0; i < images.length; ++i) {
      var image = images[i];
      if (image.bufferView !== undefined) {
        // nothing to do, the underlying buffer is already covered above
        continue;
      }
      var imageData = gltfContent.getImageArrayBuffer(i);
      if (imageData === undefined) {
        continue;
      }
      var uri = image.uri;
      if (image.uri) { // this image refers to a file
        delete image.uri;
      }
      // we need to create a bufferView for this image
      var bufferViewIndex = bufferViews.length;
      var bufferView = { buffer: 0, byteOffset: inputImageStartInOutputBuffer[i], byteLength: imageData.byteLength, name: uri };
      var extension = uri.match(/\.([^\.\/\?#]+)($|\?|#)/)[1];
      var mimeType = imageExtMIME[extension];
      if (mimeType) {
        image.mimeType = mimeType;
      }
      else {
        console.error('ERROR: unknown image extension',uri);
      }
      bufferViews.push(bufferView);
      image.bufferView = bufferViewIndex;
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

    //console.log(outputBinary);

    return gltfContent.loadSingleFile(gltfContent.name+'.glb', gltfContent.name, outputBinary)
      .then(() => gltfContent.info );
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolPackGLB());
}
else {
  console.error('ToolManager NOT FOUND');
}
