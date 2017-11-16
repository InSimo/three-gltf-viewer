const DracoEncoderModule = require('../lib/draco/draco_encoder')();
const DracoInspector = require('./DracoInspector');

class ToolDracoCompressor {

  constructor () {
    this.name = 'Draco Compressor';
    this.icon = '<img src="assets/icons/draco-56.png" alt="Draco">';
    this.order = 10;
    this.inspector = new DracoInspector();
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
    var totalCompressedMeshes = 0;
    var totalUncompressedMeshes = 0;

    // In order to handle data used in multiple primitives, we now use a first
    // pass to gather all the meshes that should be compressed, merging all
    // their attributes.
    // Then we do compress all of them using Draco encoder.
    // And finally we update the gltf to refer to the newly compressed meshes.

    // map of meshes data gathered to provide to Draco
    // indexed by indicesAccessor+'/'+positionAccessor
    // (for lack of tuple keys in JS...)
    var meshesToCompressMap = new Map();

    var accessorDataToRemoveSet = new Set();
    var bufferViewsToRemoveSet = new Set();

    // for stats purpose
    var inputAccessorsSet = new Set();
    var outputBufferViewsSet = new Set();
    //
    // Step 1: gather all the meshes that should be compressed
    //
    for (let j = 0; j < gltf.meshes.length; ++j) {
      for (let k = 0; k < gltf.meshes[j].primitives.length; ++k) {
        var name = j + '_' + (gltf.meshes[j].name || 'mesh') + '_' + k;
        var primitive = gltf.meshes[j].primitives[k];
        if (primitive.extensions !== undefined &&
            primitive.extensions.KHR_draco_mesh_compression !== undefined) {
          // this primitive is already compressed, do not change it
          var res = result.meshes[name] = {};
          res.status = 'already compressed';
          // gather stats
          var compressedBufferViewId = primitive.extensions.KHR_draco_mesh_compression.bufferView;
          var outputSize = gltf.bufferViews[compressedBufferViewId].byteLength;
          var inputSize = 0;
          for(let value of Object.values(primitive.attributes).concat([primitive.indices])) {
            var size = gltfContent.getAccessorByteLength(value);
            inputSize += size;
            if (!inputAccessorsSet.has(value)) {
              inputAccessorsSet.add(value);
              totalInputSize += size;
            }
          }
          res.inputSize = inputSize;
          res.outputSize = outputSize;
          res.ratio = Math.round(1000.0 * outputSize / inputSize)/10 + ' %';
          if (outputBufferViewsSet.has(compressedBufferViewId)) {
            res.status += ' (duplicate)';
          }
          else {
            outputBufferViewsSet.add(compressedBufferViewId);
            totalOutputSize += outputSize;
            totalCompressedMeshes += 1;
            var dracoData = gltfContent.getBufferViewArrayBuffer(compressedBufferViewId);
            if (dracoData !== undefined)
            {
              res.info = this.inspector.inspectDraco(dracoData);
            }
          }
          continue;
        }
        if (primitive.indices === undefined || (primitive.mode !== undefined &&
                                                primitive.mode != 4 /*GL_TRIANGLES*/ ) ) {
          result.meshes[name] = 'not indexed triangles: ' + primitive.mode;
          totalUncompressedMeshes += 1;
          continue;
        }
        if (!('POSITION' in primitive.attributes)) {
          result.meshes[name] = 'no POSITION';
          totalUncompressedMeshes += 1;
          continue;
        }

        var indicesAccessorId = primitive.indices;
        var positionAccessorId = primitive.attributes['POSITION'];
        var mapKey = indicesAccessorId + '/' + positionAccessorId;
        var compressedMeshData;
        if (meshesToCompressMap.has(mapKey)) {
          compressedMeshData = meshesToCompressMap.get(mapKey);
        }
        else {
          compressedMeshData = {
            name: name,
            indices: indicesAccessorId,
            accessors: new Map(),
            primitives: []
          };
          compressedMeshData.accessors.set(positionAccessorId, { encoderType: DracoEncoderModule.POSITION });
          meshesToCompressMap.set(mapKey, compressedMeshData);
        }
        compressedMeshData.primitives.push(primitive);

        for(let [key, value] of Object.entries(primitive.attributes)) {
          if (compressedMeshData.accessors.has(value)) {
            continue; // this attribute is already added
          }
          var encoderType = DracoEncoderModule.GENERIC;
          if (key=='POSITION')
            encoderType = DracoEncoderModule.POSITION;
          else if (key=='NORMAL')
            encoderType = DracoEncoderModule.NORMAL;
          else if (key.slice(0,8)=='TEXCOORD')
            encoderType = DracoEncoderModule.TEX_COORD;
          else if (key.slice(0,5)=='COLOR')
            encoderType = DracoEncoderModule.COLOR;

          compressedMeshData.accessors.set(value, { encoderType: encoderType });
        }
      }
    }
    //console.log(meshesToCompressMap);

    //
    // Step 2: encode (compress) the meshes using Draco
    //
    if (meshesToCompressMap.size > 0) {

      const encoder = new DracoEncoderModule.Encoder();

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

      for (let [mapKey, compressedMeshData] of meshesToCompressMap.entries()) {
        var res = result.meshes[compressedMeshData.name] = {};
        var tstart = performance.now();
        var inputSize = 0;

        // console.time( 'DracoCompressorAttribute' );
        const dracoMesh = new DracoEncoderModule.Mesh();

        const meshBuilder = new DracoEncoderModule.MeshBuilder();

        const indices = gltfContent.getAccessorArrayBuffer(compressedMeshData.indices);
        inputSize += indices.byteLength;
        if (!inputAccessorsSet.has(compressedMeshData.indices)) {
          inputAccessorsSet.add(compressedMeshData.indices);
          totalInputSize += indices.byteLength;
        }

        const numFaces = indices.length / 3;
        meshBuilder.AddFacesToMesh(dracoMesh, numFaces, indices);

        var numVertices = 0;
        for(let [accessorId, accessorData] of Array.from(compressedMeshData.accessors.entries()).reverse()) {
          var encoderType = accessorData.encoderType;
          var attrArray = gltfContent.getAccessorArrayBuffer(accessorId);
          inputSize += attrArray.byteLength;
          if (!inputAccessorsSet.has(accessorId)) {
            inputAccessorsSet.add(accessorId);
            totalInputSize += attrArray.byteLength;
          }

          var typeCount = gltfContent.getTypeCount(gltf.accessors[accessorId].type);

          if (numVertices == 0) {
            numVertices = attrArray.length / typeCount;
          }
          else if (numVertices != attrArray.length / typeCount) {
            console.error('Draco: mismatched accessor size for ' + accessorId);
          }
          var id = meshBuilder.AddFloatAttributeToMesh(
            dracoMesh, encoderType, attrArray.length / typeCount, typeCount, attrArray);
          if (id == -1) {
            console.log(gltf.accessors[accessorId]);
            throw new Error('DRACO MeshBuilder AddFloatAttributeToMesh() failed for accessor ' + accessorId);
          }
          accessorData.compressedId = id;
        }
        // console.timeEnd( 'DracoCompressorAttribute' );

        console.log('Encoding ' + compressedMeshData.name + ': ' + numFaces + ' faces, ' +
                    numVertices + ' vertices, ' + compressedMeshData.accessors.size + ' attributes');
        // console.time( 'DracoCompressorEncoder' );
        const encodedData = new DracoEncoderModule.DracoInt8Array();

        const encodedLen = encoder.EncodeMeshToDracoBuffer(dracoMesh, encodedData);

        if (encodedLen==0) {
          throw new Error('Encoded length is 0');
        }
        console.log('Encoding DONE: ' + inputSize + ' ->  ' + encodedLen);

        // console.timeEnd( 'DracoCompressorEncoder' );

        // console.time('ArrayInt8');
        var encodedDataSize = encodedLen;
        var encodedArrayBuffer = new ArrayBuffer(encodedDataSize);
        var encodedIntArray = new Int8Array(encodedArrayBuffer);
        for (let i = 0; i < encodedDataSize; ++i){
          encodedIntArray[i] = encodedData.GetValue(i);
        }
        // console.timeEnd('ArrayInt8');

        // console.time( 'DracoCompressorGLTF' );
        const compressedBufferId = gltfContent.addBuffer(compressedMeshData.name+".drc",
                                                         encodedArrayBuffer, encodedLen);
        const compressedBufferViewId = gltfContent.addBufferView(compressedBufferId,0, encodedLen);
        compressedMeshData.compressedBufferViewId = compressedBufferViewId;
        // console.timeEnd( 'DracoCompressorGLTF' );
        var tend = performance.now();
        var telapsed = tend - tstart;
        outputBufferViewsSet.add(compressedBufferViewId);
        totalOutputSize += encodedLen;
        totalCompressedMeshes += 1;
        totalTime += telapsed;
        res.inputSize = inputSize;
        res.outputSize = encodedLen;
        res.ratio = Math.round(1000.0 * encodedLen / inputSize)/10 + ' %';
        res.time = Math.round(telapsed) + ' ms';

        DracoEncoderModule.destroy(meshBuilder);
        DracoEncoderModule.destroy(dracoMesh);

        if (encodedArrayBuffer !== undefined) {
          // DISABLED, apply the tool again to get detailed info
          //res.info = this.inspector.inspectDraco(encodedArrayBuffer);
        }
      }
      DracoEncoderModule.destroy(encoder);
      //console.log(meshesToCompressMap);
    }

    //
    // Step 3: update the gltf to refer to the newly compressed meshes
    //
    for (let [mapKey, compressedMeshData] of meshesToCompressMap.entries()) {
      for (let primitive of compressedMeshData.primitives) {

        accessorDataToRemoveSet.add(primitive.indices);
        var compressedAttributes = {};
        for(let [key, value] of Object.entries(primitive.attributes)) {
          var compressedId = (compressedMeshData.accessors.get(value) || {}).compressedId;
          if (compressedId !== undefined) {
            compressedAttributes[key] = compressedId;
            accessorDataToRemoveSet.add(value);
          }
        }

        // console.time( 'DracoCompressorGLTF' );
        const compressedBufferViewId = compressedMeshData.compressedBufferViewId;

        if (primitive.extensions === undefined) {
          primitive.extensions = {};
        }
        primitive.extensions.KHR_draco_mesh_compression = {
            bufferView: compressedBufferViewId,
            attributes: compressedAttributes
        };
        // console.timeEnd( 'DracoCompressorGLTF' );
      }
    }
    if (totalCompressedMeshes > 0) {
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
    }

    //
    // Step 4: remove uncompressed input data that is no longer necessary
    //

    if (accessorDataToRemoveSet.size > 0) {
      // look at all uncompressed attributes and make sure we don't remove them
      for (let j = 0; j < gltf.meshes.length; ++j) {
        for (let k = 0; k < gltf.meshes[j].primitives.length; ++k) {
          var primitive = gltf.meshes[j].primitives[k];
          var compressedAttributes = {};
          if (primitive.extensions !== undefined &&
              primitive.extensions.KHR_draco_mesh_compression !== undefined) {
            // this primitive is compressed, look for uncompressed attributes
            compressedAttributes = primitive.extensions.KHR_draco_mesh_compression.attributes;
          }
          else {
            // this primitive is not compressed, make sure we preserve the indices as well
            if (primitive.indices !== undefined && accessorDataToRemoveSet.has(primitive.indices)) {
              console.warn('Indices accessor ' + primitive.indices + ' still in use in primitive ' +
                           JSON.stringify(primitive));
              accessorDataToRemoveSet.delete(primitive.indices);
            }
          }
          for(let [key, value] of Object.entries(primitive.attributes)) {
            if (!(key in compressedAttributes) && accessorDataToRemoveSet.has(value)) {
              console.warn('Attribute accessor ' + value + ' still in use in primitive ' +
                           JSON.stringify(primitive));
              accessorDataToRemoveSet.delete(value);
            }
          }
        }
      }
      console.log(accessorDataToRemoveSet);
      // now we can remove the bifferView references, and put them as candidates for removal
      for(let value of accessorDataToRemoveSet) {
        var accessor = gltf.accessors[value];
        bufferViewsToRemoveSet.add(accessor.bufferView);
        if (accessor.bufferView !== undefined)
          delete accessor.bufferView;
        if (accessor.byteOffset !== undefined)
          delete accessor.byteOffset;
      }
    }

    if (bufferViewsToRemoveSet.size > 0) {
      var bufferViewsToRemoveArray = Array.from(bufferViewsToRemoveSet.values());
      gltfContent.removeUnusedBufferViews(bufferViewsToRemoveArray);
    }

    // invalidate existing container
    gltfContent.containerData = undefined;
    gltfContent.updateSceneInformation();

    if (totalCompressedMeshes > 0) {
      result.overall.compressedMeshes = totalCompressedMeshes;
    }
    if (totalUncompressedMeshes > 0) {
      result.overall.uncompressedMeshes = totalUncompressedMeshes;
    }
    result.overall.inputSize = totalInputSize;
    result.overall.outputSize = totalOutputSize;
    if (totalInputSize > 0) {
      result.overall.ratio = Math.round(1000.0 * totalOutputSize / totalInputSize)/10 + ' %';
    }
    if (totalTime > 0) {
      result.overall.time = Math.round(totalTime) + ' ms';
    }

    console.timeEnd( 'DracoCompressor' );
    return result;
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolDracoCompressor());
}
else {
  console.error('ToolManager NOT FOUND');
}
