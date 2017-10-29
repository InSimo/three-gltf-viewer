const DRACOLoader = require('./lib/draco/DRACOLoader');
const FileSaver = require('file-saver');

module.exports = class ToolDracoCompressor {

  constructor () {
    this.name = 'Draco Compressor';
    this.icon = '<img src="assets/icons/draco-56.png" alt="Draco">';
  }

  run (gltfContent) {
    console.time( 'DracoCompressor' );

    for (var j = 0; j < gltfContent.gltf.meshes.length; ++j) {
      for (var k = 0; k < gltfContent.gltf.meshes[j].primitives.length; ++k) { 

        // console.time( 'DracoCompressorAttribute' );
        const encoderModule = DracoEncoderModule();
        const encoder = new encoderModule.Encoder();
        const meshBuilder = new encoderModule.MeshBuilder();
        const dracoMesh = new encoderModule.Mesh();
        
        var primitive = gltfContent.gltf.meshes[j].primitives[k];

        var indices = gltfContent.getAccessorArrayBuffer(primitive.indices);

        const numFaces = indices.length / 3;
        meshBuilder.AddFacesToMesh(dracoMesh, numFaces, indices);

        var compressedAttributes = {};

        for(var [key, value] of Object.entries(primitive.attributes)) {
          var encoderType = encoderModule.GENERIC;
          if (key=='POSITION')
            encoderType = encoderModule.POSITION;
          else if (key=='NORMAL')
            encoderType = encoderModule.NORMAL;
          else if (key.slice(0,8)=='TEXCOORD')
            encoderType = encoderModule.TEX_COORD;
          else if (key.slice(0,5)=='COLOR')
            encoderType = encoderModule.COLOR;
          
          var attrArray = gltfContent.getAccessorArrayBuffer(value);

          var id = meshBuilder.AddFloatAttributeToMesh(
            dracoMesh, encoderType, attrArray.length, gltfContent.getTypeCount(gltfContent.gltf.accessors[value].type), attrArray);
          compressedAttributes[key] = id;
        }
        // console.timeEnd( 'DracoCompressorAttribute' );


        // console.time( 'DracoCompressorEncoder' );
        const encodedData = new encoderModule.DracoInt8Array();
        
        var method = "edgebreaker";
        if (method === "edgebreaker") {
          encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);
        } else if (method === "sequential") {
          encoder.SetEncodingMethod(encoderModule.MESH_SEQUENTIAL_ENCODING);
        }
        
        // Use default encoding setting.
        const encodedLen = encoder.EncodeMeshToDracoBuffer(dracoMesh, encodedData);
        encoderModule.destroy(dracoMesh);
        encoderModule.destroy(encoder);
        encoderModule.destroy(meshBuilder);

        // console.timeEnd( 'DracoCompressorEncoder' );

        if (encodedLen==0)
          console.log('ERROR encoded lenght is 0');
        
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

        gltfContent.gltf.meshes[j].primitives[k]["extensions"] = {
          KHR_draco_mesh_compression : {
            bufferView: compressedBufferViewId,
            attributes: compressedAttributes
          }
        }

        for(var [key, value] of Object.entries(primitive.attributes)) {
          delete gltfContent.gltf.accessors[value].bufferView;
        }
        delete gltfContent.gltf.accessors[primitive.indices].bufferView;
      }
      // console.timeEnd( 'DracoCompressorGLTF' );
    }
    gltfContent.gltf["extensionsRequired"] = ["KHR_draco_mesh_compression"];
    gltfContent.gltf["extensionsUsed"] = ["KHR_draco_mesh_compression"];

    // console.log(gltfContent.gltf);

    console.timeEnd( 'DracoCompressor' );
  }
}
