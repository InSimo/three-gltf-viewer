
module.exports = class GLTFBinding {

  constructor (gltf=undefined, bin=undefined, files=undefined, info=undefined) {
    this.gltf = gltf;
    this.binary = bin;
    this.files = files;
    this.info = info;
    this.arrayBuffer = undefined;
    this.gltfBody = undefined;
  }

  setGLTF(gltf) {
    this.gltf = gltf;
  }

  setBinary(bin) {
    this.binary = bin;
    if (this.binary)
      this.setArrayBufferFromBinary(this.binary);
  }
  setFiles(files) {
    this.files = files;
    if (this.files)
      this.setArrayBufferFromFiles(this.files)
  }

  setInfo(info) {
    this.info = info;
  }

  setArrayBufferFromBinary(bin) {
    var fileReader = new FileReader();
    new Promise(function(resolve, reject) {
      fileReader.onload = resolve;
      fileReader.onerror = reject;
      fileReader.readAsArrayBuffer(bin);
    })
    .then(  buffer =>  {
      this.arrayBuffer = buffer.currentTarget.result;
      this.setBodyFromGLTFBinaryArrayBuffer(this.arrayBuffer);
    });
  }

  setArrayBufferFromFiles(files) {
    files.forEach(function(file, key){
      if(key.substr(key.length - 5) != '.gltf') {
        var fileReader = new FileReader();
        new Promise(function(resolve, reject) {
          fileReader.onload = resolve;
          fileReader.onerror = reject;
          fileReader.readAsArrayBuffer(file);
        })
        .then(  buffer =>  {
          this.gltfBody = buffer.target.result;
        });
      }
    },this);
  }

  getComponentTypeArray(componentType) {
    var componentTypeArray = {
      5120: Int8Array, /*BYTE*/
      5121: Uint8Array, /*UNSIGNED_BYTE*/
      5122: Int16Array, /*SHORT*/
      5123: Uint16Array, /*UNSIGNED_SHORT*/
      5125: Uint32Array, /*UNSIGNED_INT*/
      5126: Float32Array /*FLOAT*/
    };
    return componentTypeArray[componentType];
  }

  getComponentTypeSize(componentType) {
    return this.getComponentTypeArray(componentType).BYTES_PER_ELEMENT;
  }

  getTypeCount(type) {
    var typeCount = {
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
      MAT2: 2*2,
      MAT3: 3*3,
      MAT4: 4*4
    };
    return typeCount[type];
  }

  getElementTypeSize(componentType, type) {
    return this.getTypeCount(type)*this.getComponentTypeSize(componentType);
  }
  
  getBufferArray(bufferIndex) {
    var buffer = this.gltf.buffers[bufferIndex];
    if (buffer.uri) {
      return this.files.get(buffer.uri);
    }
    else if (this.gltfBody) {
      return this.gltfBody;
    }
    return undefined;
  }

  getAccessorArrayBuffer(accessorIndex) {
    
    var accessor = this.gltf.accessors[accessorIndex];
    var bufferView = this.gltf.bufferViews[accessor.bufferView];
    var stride = 0;
    var buffer = undefined;
    var componentTypeArray = this.getComponentTypeArray(accessor.componentType);
    var typeCount = this.getTypeCount(accessor.type);
    var elementSize = componentTypeArray.BYTES_PER_ELEMENT*typeCount;
    // var bufferArray = this.getBufferArray(bufferView.buffer);
    var bufferArray = this.gltfBody;
    console.log(bufferArray);
    if (bufferView.hasOwnProperty('byteStride')) {
      stride = bufferView.byteStride;
    }

    if (stride == 0 || stride == elementSize) {

      buffer = new componentTypeArray(bufferArray.slice(accessor.byteOffset + bufferView.byteOffset, accessor.byteOffset + bufferView.byteOffset + elementSize*accessor.count));

    } else {

      var inbuffer = new componentTypeArray(bufferArray.slice(accessor.byteOffset + bufferView.byteOffset, accessor.byteOffset + bufferView.byteOffset + bufferView.byteLength));
      buffer = new componentTypeArray(accessor.count*typeCount);

      for(var i = 0; i<accessor.count; i++) {

        var inoffset = i * stride/elementSize;
        var outoffset = i * typeCount;

        for (var c = 0; c < typeCount; ++c) {
          buffer[outoffset + c] = inbuffer[inoffset + c];
        }
      }
    }
    console.log(buffer);
    return buffer;
  }

	setBodyFromGLTFBinaryArrayBuffer( data ) {

    var BINARY_EXTENSION_HEADER_LENGTH = 12;
    var BINARY_EXTENSION_CHUNK_TYPES = { JSON: 0x4E4F534A, BIN: 0x004E4942 };

    var content = null;
    var chunkView = new DataView( data, BINARY_EXTENSION_HEADER_LENGTH );
    var chunkIndex = 0;

    while ( chunkIndex < chunkView.byteLength ) {

      var chunkLength = chunkView.getUint32( chunkIndex, true );
      chunkIndex += 4;
      var chunkType = chunkView.getUint32( chunkIndex, true );
      chunkIndex += 4;

      if ( chunkType === BINARY_EXTENSION_CHUNK_TYPES.BIN ) {
        var byteOffset = BINARY_EXTENSION_HEADER_LENGTH + chunkIndex;
        this.gltfBody = data.slice( byteOffset, byteOffset + chunkLength );
      }
      chunkIndex += chunkLength;
    }
  }
  addBuffer(uri, data, size) {
    const id = this.gltf.buffers.length;
    this.gltf.buffers.push({byteLength: size, uri: uri});
    this.files.set(uri, data);
    return id;
  }
  addBufferView(bufferId, offset, size) {
    const id = this.gltf.bufferViews.length;
    this.gltf.bufferViews.push({buffer: bufferId, byteOffset: offset, byteLength: size});
    return id;
  }
}
