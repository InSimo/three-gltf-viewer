const DracoEncoderModule = require('../lib/draco/draco_encoder')();

class ToolDracoCompressor {

  constructor () {
    this.name = 'Draco Compressor';
    this.icon = '<img src="assets/icons/draco-56.png" alt="Draco">';
    this.order = 10;
  }

  run (gltfContent) {

    // compression options
    // TODO: add GUI to control them
    const options = {
      pos_quantization_bits: 14,
      tex_coords_quantization_bits: 12,
      normals_quantization_bits: 8,
      colors_quantization_bits: 8,
      generic_quantization_bits: 8,
      method: "edgebreaker",
      compression_level: 7
    };

    var scope = this;
    return new Promise( function(resolve, reject) {
      var res = scope.runInPromise(gltfContent, options);
      resolve(res);
    });
  }

  runInPromise(gltfContent, options) {
    console.time( 'DracoCompressor' );
    var gltf = gltfContent.gltf;
    var result = {};
    result.overall = {};
    result.meshes = {};
    var totalInputSize = 0;
    var totalOutputSize = 0;
    var totalTime = 0;
    var bufferViewsToRemoveSet = new Set();
    for (var j = 0; j < gltf.meshes.length; ++j) {
      for (var k = 0; k < gltf.meshes[j].primitives.length; ++k) { 
        var res = result.meshes[j + '_' + (gltf.meshes[j].name || 'mesh') + '_' + k] = {};
        var primitive = gltf.meshes[j].primitives[k];
        if (primitive.extensions !== undefined &&
            primitive.extensions.KHR_draco_mesh_compression !== undefined) {
          // this primitive is already compressed, do not change it
          res.status = 'already compressed';
          // gather stats
          var inputSize = 0;
          inputSize += gltfContent.getAccessorByteLength(primitive.indices);
          for(var [key, value] of Object.entries(primitive.attributes)) {
            inputSize += gltfContent.getAccessorByteLength(value);
          }
          var outputSize = gltf.bufferViews[primitive.extensions.KHR_draco_mesh_compression.bufferView].byteLength;
          res.inputSize = inputSize;
          res.outputSize = outputSize;
          res.ratio = Math.round(1000.0 * outputSize / inputSize)/10 + ' %';
          totalInputSize += inputSize;
          totalOutputSize += outputSize;
          var dracoData = gltfContent.getBufferViewArrayBuffer(primitive.extensions.KHR_draco_mesh_compression.bufferView);
          if (dracoData !== undefined)
          {
            res.info = this.inspectDraco(dracoData);
          }
          continue;
        }
        if (primitive.indices === undefined || (primitive.mode !== undefined && primitive.mode != 4 /*GL_TRIANGLES*/ ) ) {
          res.status = 'not indexed triangles: ' + primitive.mode;
          continue;
        }

        var tstart = performance.now();
        var inputSize = 0;

        // console.time( 'DracoCompressorAttribute' );
        const encoder = new DracoEncoderModule.Encoder();
        const meshBuilder = new DracoEncoderModule.MeshBuilder();
        const dracoMesh = new DracoEncoderModule.Mesh();

        var indices = gltfContent.getAccessorArrayBuffer(primitive.indices);
        inputSize += indices.byteLength;

        const numFaces = indices.length / 3;
        meshBuilder.AddFacesToMesh(dracoMesh, numFaces, indices);

        var compressedAttributes = {};

        for(var [key, value] of Object.entries(primitive.attributes)) {
          var encoderType = DracoEncoderModule.GENERIC;
          if (key=='POSITION')
            encoderType = DracoEncoderModule.POSITION;
          else if (key=='NORMAL')
            encoderType = DracoEncoderModule.NORMAL;
          else if (key.slice(0,8)=='TEXCOORD')
            encoderType = DracoEncoderModule.TEX_COORD;
          else if (key.slice(0,5)=='COLOR')
            encoderType = DracoEncoderModule.COLOR;

          var attrArray = gltfContent.getAccessorArrayBuffer(value);
          inputSize += attrArray.byteLength;

          var typeCount = gltfContent.getTypeCount(gltf.accessors[value].type);

          var id = meshBuilder.AddFloatAttributeToMesh(
            dracoMesh, encoderType, attrArray.length / typeCount, typeCount, attrArray);
          if (id == -1) {
            console.log(gltf.accessors[value]);
            throw new Error('DRACO MeshBuilder AddFloatAttributeToMesh() failed for attribute ' + key);
          }
          compressedAttributes[key] = id;
        }
        // console.timeEnd( 'DracoCompressorAttribute' );


        // console.time( 'DracoCompressorEncoder' );
        const encodedData = new DracoEncoderModule.DracoInt8Array();

        const speed = 10 - options.compression_level;
        encoder.SetSpeedOptions(speed, speed);
        encoder.SetAttributeQuantization(DracoEncoderModule.POSITION, options.pos_quantization_bits);
        encoder.SetAttributeQuantization(DracoEncoderModule.TEX_COORD, options.tex_coords_quantization_bits);
        encoder.SetAttributeQuantization(DracoEncoderModule.NORMAL, options.normals_quantization_bit);
        encoder.SetAttributeQuantization(DracoEncoderModule.COLOR, options.colors_quantization_bit);
        encoder.SetAttributeQuantization(DracoEncoderModule.GENERIC, options.generic_quantization_bits);
        if (options.method === "edgebreaker") {
          encoder.SetEncodingMethod(DracoEncoderModule.MESH_EDGEBREAKER_ENCODING);
        } else if (options.method === "sequential") {
          encoder.SetEncodingMethod(DracoEncoderModule.MESH_SEQUENTIAL_ENCODING);
        }
        console.log(dracoMesh);
        console.log(meshBuilder);
        console.log(encoder);
        const encodedLen = encoder.EncodeMeshToDracoBuffer(dracoMesh, encodedData);
        DracoEncoderModule.destroy(dracoMesh);
        DracoEncoderModule.destroy(meshBuilder);
        DracoEncoderModule.destroy(encoder);

        // console.timeEnd( 'DracoCompressorEncoder' );

        if (encodedLen==0)
          console.error('ERROR encoded length is 0');
        
        // console.time('ArrayInt8');
        var encodedDataSize = encodedLen;
        var encodedArrayBuffer = new ArrayBuffer(encodedDataSize);
        var encodedIntArray = new Int8Array(encodedArrayBuffer);
        for (var i = 0; i < encodedDataSize; ++i){
          encodedIntArray[i] = encodedData.GetValue(i);
        }
        // console.timeEnd('ArrayInt8');

        // console.time( 'DracoCompressorGLTF' );
        const compressedBufferId = gltfContent.addBuffer("mesh_"+j+"_"+k+".drc",encodedArrayBuffer, encodedLen);
        const compressedBufferViewId = gltfContent.addBufferView(compressedBufferId,0, encodedLen);

        if (primitive.extensions === undefined) {
          primitive.extensions = {};
        }
        primitive.extensions.KHR_draco_mesh_compression = {
            bufferView: compressedBufferViewId,
            attributes: compressedAttributes
        };

        for(var [key, value] of Object.entries(primitive.attributes)
            .concat([['', primitive.indices]])) {
          var accessor = gltf.accessors[value];
          bufferViewsToRemoveSet.add(accessor.bufferView);
          delete accessor.bufferView;
          if (accessor.byteOffset)
            delete accessor.byteOffset;
        }
        var tend = performance.now();
        var telapsed = tend - tstart;
        totalInputSize += inputSize;
        totalOutputSize += encodedLen;
        totalTime += telapsed;
        res.inputSize = inputSize;
        res.outputSize = encodedLen;
        res.ratio = Math.round(1000.0 * encodedLen / inputSize)/10 + ' %';
        res.time = Math.round(telapsed) + ' ms';

        if (encodedArrayBuffer !== undefined) {
          res.info = this.inspectDraco(encodedArrayBuffer);
        }
      }
      // console.timeEnd( 'DracoCompressorGLTF' );
    }
    result.overall.inputSize = totalInputSize;
    result.overall.outputSize = totalOutputSize;
    result.overall.ratio = Math.round(1000.0 * totalOutputSize / totalInputSize)/10 + ' %';
    result.overall.time = Math.round(totalTime) + ' ms';
    if (gltf.extensionsRequired === undefined) {
      gltf.extensionsRequired = [];
    }
    if (gltf.extensionsRequired.indexOf("KHR_draco_mesh_compression") == -1) {
      gltf.extensionsRequired.push("KHR_draco_mesh_compression");
    }
    if (gltf.extensionsUsed === undefined) {
      gltf.extensionsUsed = [];
    }
    if (gltf.extensionsUsed.indexOf("KHR_draco_mesh_compression") == -1) {
      gltf.extensionsUsed.push("KHR_draco_mesh_compression");
    }

    if (bufferViewsToRemoveSet) {
      var bufferViewsToRemoveArray = Array.from(bufferViewsToRemoveSet.values());
      gltfContent.removeUnusedBufferViews(bufferViewsToRemoveArray);
    }

    // invalidate existing container
    gltfContent.containerData = undefined;
    gltfContent.updateSceneInformation();

    // console.log(gltf);

    console.timeEnd( 'DracoCompressor' );
    return result;
  }

  inspectDraco(dracoData) {
    const dracoView = new DataView(dracoData);
    var offset = 0;
    var res = {};
    // https://google.github.io/draco/spec/

    // Draco standard constants
    // (taken directly from the bitstream specification)
    const DRACO = {
      MAGIC: 'DRACO',
      EncoderType: [ 'POINT_CLOUD', 'TRIANGULAR_MESH' ],
      EncoderMethod: [ 'MESH_SEQUENTIAL_ENCODING', 'MESH_EDGEBREAKER_ENCODING' ],
      AttributeDecoderType: [ 'MESH_VERTEX_ATTRIBUTE', 'MESH_CORNER_ATTRIBUTE' ],
      AttributeDecoderMethod: [ 'MESH_TRAVERSAL_DEPTH_FIRST', 'MESH_TRAVERSAL_PREDICTION_DEGREE' ]
    };

    //
    // draco header
    //
    var draco_string = '';
    for (let i = 0; i < 5; ++i) {
      draco_string += String.fromCharCode(dracoView.getUint8(offset+i));
    }
    offset += 5;
    if (draco_string !== DRACO.MAGIC) {
      res.error = 'draco_string mismatch: "'+draco_string+'"';
      return res;
    }
    const major_version  = dracoView.getUint8(offset); offset+=1;
    const minor_version  = dracoView.getUint8(offset); offset+=1;
    const encoder_type   = dracoView.getUint8(offset); offset+=1;
    const encoder_method = dracoView.getUint8(offset); offset+=1;
    const flags          = dracoView.getUint16(offset); offset+=2;
    res.version = major_version + '.' + minor_version;
    res.encoder_type = DRACO.EncoderType[encoder_type] || encoder_type;
    res.encoder_method = DRACO.EncoderMethod[encoder_method] || encoder_method;
    res.flags = flags;
    return res;
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolDracoCompressor());
}
else {
  console.error('ToolManager NOT FOUND');
}
