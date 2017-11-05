const DracoEncoderModule = require('./lib/draco/draco_encoder')();

class ToolDracoCompressor {

  constructor () {
    this.name = 'Draco Compressor';
    this.icon = '<img src="assets/icons/draco-56.png" alt="Draco">';
    this.order = 10;
  }

  run (gltfContent) {
    return new Promise( function(resolve, reject) {
    console.time( 'DracoCompressor' );
    var gltf = gltfContent.gltf;
    var result = {};
    result.overall = {};
    result.meshes = {};
    var totalInputSize = 0;
    var totalOutputSize = 0;
    var totalTime = 0;
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
          continue;
        }
        if (primitive.indices === undefined || primitive.mode != 4 /*GL_TRIANGLES*/ ) {
          res.status = 'not indexed triangles';
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

          var id = meshBuilder.AddFloatAttributeToMesh(
            dracoMesh, encoderType, attrArray.length, gltfContent.getTypeCount(gltf.accessors[value].type), attrArray);
          compressedAttributes[key] = id;
        }
        // console.timeEnd( 'DracoCompressorAttribute' );


        // console.time( 'DracoCompressorEncoder' );
        const encodedData = new DracoEncoderModule.DracoInt8Array();
        /*
        var method = "edgebreaker";
        if (method === "edgebreaker") {
          encoder.SetEncodingMethod(DracoEncoderModule.MESH_EDGEBREAKER_ENCODING);
        } else if (method === "sequential") {
          encoder.SetEncodingMethod(DracoEncoderModule.MESH_SEQUENTIAL_ENCODING);
        }
        */
        encoder.SetSpeedOptions(3,3);
        // Use default encoding setting.
        const encodedLen = encoder.EncodeMeshToDracoBuffer(dracoMesh, encodedData);
        DracoEncoderModule.destroy(dracoMesh);
        DracoEncoderModule.destroy(encoder);
        DracoEncoderModule.destroy(meshBuilder);

        // console.timeEnd( 'DracoCompressorEncoder' );

        if (encodedLen==0)
          console.error('ERROR encoded length is 0');
        
        // console.time('ArrayInt8');
        var encodedDataSize = encodedData.size();
        var encodedArrayBuffer = new ArrayBuffer(encodedDataSize);
        var encodedIntArray = new Int8Array(encodedArrayBuffer);
        for (var i = 0; i < encodedDataSize; ++i){
          encodedIntArray[i] = encodedData.GetValue(i);
        }
        // console.timeEnd('ArrayInt8');

        // console.time( 'DracoCompressorGLTF' );
        const compressedBufferId = gltfContent.addBuffer("mesh_"+j+"_"+k+".bin",encodedArrayBuffer, encodedLen);
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
    gltfContent.containerData = undefined;
    gltfContent.updateSceneInformation();

    // console.log(gltf);

    console.timeEnd( 'DracoCompressor' );
    resolve(result);
    });
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolDracoCompressor());
}
else {
  console.error('ToolManager NOT FOUND');
}
