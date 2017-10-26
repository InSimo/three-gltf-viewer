const DRACOLoader = require('./lib/draco/DRACOLoader');
const FileSaver = require('file-saver');

module.exports = class ToolDracoCompressor {

  constructor () {
    this.name = 'Draco Compressor';
    this.icon = '▶';
  }

  run (gltfContent) {

    console.log(gltfContent);

    var primitive = gltfContent.gltf.meshes[0].primitives[0];

    const encoderModule = DracoEncoderModule();
    const encoder = new encoderModule.Encoder();
    const meshBuilder = new encoderModule.MeshBuilder();
    const dracoMesh = new encoderModule.Mesh();

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

    console.log(encodedLen);
    if (encodedLen==0)
      console.log('ERROR encoded lenght is 0');
      
    const compressedBufferId = gltfContent.addBuffer("mesh0.bin",encodedData, encodedLen);
    const compressedBufferViewId = gltfContent.addBufferView(compressedBufferId,0, encodedLen);

    gltfContent.gltf["extensionsRequired"] = ["KHR_draco_mesh_compression"];
    gltfContent.gltf["extensionsUsed"] = ["KHR_draco_mesh_compression"];

    gltfContent.gltf.meshes[0].primitives[0]["extensions"] = {
      KHR_draco_mesh_compression : {
        bufferView: compressedBufferViewId,
        attributes: compressedAttributes
      }
    }

    for(var [key, value] of Object.entries(primitive.attributes)) {
      delete gltfContent.gltf.accessors[value].bufferView;
    }
    delete gltfContent.gltf.accessors[primitive.indices].bufferView;

    console.log(gltfContent.gltf);
  }
}
