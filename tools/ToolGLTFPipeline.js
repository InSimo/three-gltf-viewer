const cesium = require('cesium');
const addPipelineExtras = require('../lib/gltf-pipeline/addPipelineExtras');
const processJSONWithExtras = require('../lib/gltf-pipeline/processJSONWithExtras');
const removePipelineExtras = require('../lib/gltf-pipeline/removePipelineExtras');
const writeSources = require('../lib/gltf-pipeline/writeSources');

class ToolGLTFPipeline {

  constructor () {
    this.name = 'glTF Pipeline';
    this.title = 'glTF Pipeline';
    //this.version = 'Optimizer';
    this.version = 'Optimizer ⚠ WIP ⚠';
    //this.icon = '<img src="assets/icons/glTF.svg" alt="glTF">';
    this.icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 283 147 167"><circle fill='+
    '"#FFFFFF" cx="223.6" cy="356.5" r="72.3"/><path fill="#7A9C49" d="M283,346.8c-2.1,0-4.2,1.2'+
    '-5.8,3.3l-20.3,26.9c-3.4,4.5-8.2,7-13.1,7c0,0,0,0,0,0c0,0,0,0,0,0c-5,0-9.8-2.6-13.1-7l-20.3'+
    '-26.9c-1.6-2.1-3.7-3.3-5.8-3.3c-2.1,0-4.2,1.2-5.8,3.3l-20.3,26.9c-3.3,4.4-8.1,7-13,7c10.4,2'+
    '1.9,32.6,37,58.4,37c35.7,0,64.6-28.9,64.6-64.6c0-2.5-0.2-5-0.5-7.4C286.4,347.6,284.7,346.8,'+
    '283,346.8z"/><path fill="#6DABE4" d="M223.6,291.8c-35.7,0-64.7,28.9-64.7,64.7c0,5.7,0.8,11.'+
    '2,2.2,16.4c1.2,0.9,2.6,1.5,4,1.5c2.1,0,4.2-1.2,5.8-3.3l20.3-26.9c3.4-4.5,8.2-7,13.1-7c5,0,9'+
    '.7,2.6,13.1,7l19.6,25.9l0.8,1c1.6,2.1,3.7,3.3,5.8,3.3c2.1,0,4.2-1.2,5.8-3.3l0.9-1l19.6-25.9'+
    'c3.4-4.5,8.1-7,13.1-7c0.8,0,1.6,0.1,2.4,0.2C277.2,311,252.6,291.8,223.6,291.8zM245.2,332.9c'+
    '-3.7,0-6.8-3-6.8-6.8c0-3.7,3-6.8,6.8-6.8c3.7,0,6.8,3,6.8,6.8C251.9,329.8,248.9,332.9,245.2,'+
    '332.9z"/></svg>';
    this.order = 11;
    this.options = {
      preserve: false,
      optimizeForCesium: false,
      quantize: false,
      encodeNormals: false,
      compressTextureCoordinates: false,
      removeNormals: false,
      smoothNormals: false,
      faceNormals: false,
      tangentsBitangents : false,
      "KHR Materials Common": {
        enable: false,
        doubleSided: false,
        technique: 'PHONG'
      },
      "Ambient Occlusion": {
        enable: false,
        toTexture: false,
        groundPlane: false,
        ambientShadowContribution: 0.5,
        quality: 'low',
      },
      stats : true
    }
    this.optionsGUI = {
      "KHR Materials Common": {
        technique: { options: ['CONSTANT', 'BLINN', 'PHONG', 'LAMBERT']}
      },
      "Ambient Occlusion": {
        quality: { options: ['high', 'medium', 'low']},
        ambientShadowContribution: {min: 0.0, max: 1.0}
      }
    };
  }

  run ( gltfContent ) {

    var options = this.options;
    options.kmcOptions = (options["KHR Materials Common"].enable ? options["KHR Materials Common"] : undefined);
    options.aoOptions = (options["Ambient Occlusion"].enable ? options["Ambient Occlusion"] : undefined);
    // for stats
    options.inputPath = 'Input';
    options.outputPath = 'Output';

    const imageMIMEExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg'
    };

    return Promise.resolve(gltfContent.gltf).then((input) => {
      // input json, modified in-place so we clone it first
      var gltf = JSON.parse(JSON.stringify(input));
      var buffers = gltf.buffers || [];
      var images = gltf.images || [];
      // 1. Adds extras._pipeline to each object that can have extras in the glTF asset.
      addPipelineExtras(gltf);
      // 1. add the buffers and images data
      for (var i = 0; i < buffers.length; ++i) {
        var buffer = buffers[i];
        var bufferData = gltfContent.getBufferArrayBuffer(i);
        if (bufferData === undefined) {
          console.error('Buffer '+i+': NOT FOUND ');
          continue;
        }
        var ext = 'bin';
        if (buffer.uri !== undefined && buffer.uri.slice(0,5)!= 'data:' && buffer.uri.slice(0,5) != 'blob:') {
          ext = buffer.uri.toLowerCase().match(/.([^.\/\\]+)$/)[1];
        }
        buffer.extras._pipeline.source = Buffer.from(bufferData);
        buffer.extras._pipeline.extension = ext;
      }
      for (var i = 0; i < images.length; ++i) {
        var image = images[i];
        if (image.uri === undefined) continue; // no uri for this image
        var imageData = gltfContent.getImageArrayBuffer(i);
        if (imageData === undefined) {
          console.error('Image '+i+': NOT FOUND ');
          continue;
        }
        var ext;
        if (image.mimeType && image.mimeType in imageMIMEExt) {
          ext = imageMIMEExt[image.mimeType];
        }
        else if (image.uri !== undefined && image.uri.slice(0,5)!= 'data:' && image.uri.slice(0,5) != 'blob:') {
          ext = image.uri.toLowerCase().match(/.([^.\/\\]+)$/)[1];
        }
        image.extras._pipeline.source = Buffer.from(imageData);
        image.extras._pipeline.extension = ext;
      }
      // TODO: shaders, compressed images
      return gltf;
    }).then((gltf) => {
      // 2. run the pipeline
      return processJSONWithExtras(gltf, options)
    }).then((gltf) => {
      // 3. write data as embedded data uri
      // TODO: would be more efficient to extract it as arraybuffer in gltfContent
      return writeSources(gltf, undefined, undefined, undefined);
    }).then((gltf) => {
      // 4. remove extra gltf-pipeline info
      gltf = removePipelineExtras(gltf);
      return gltf;
    }).then((gltf) => {
      // 5. convert to json then to ArrayBuffer
      // json -> string
      var jsonString = JSON.stringify(gltf);
      // string -> Uint8Array
      var jsonArray = new TextEncoder().encode(jsonString);
      return jsonArray;
    }).then((jsonArray) => {
      // Uint8Array -> ArrayBuffer
      var jsonBuffer = jsonArray.buffer;
      // 6. re-create gltfContent from the new buffer
      return gltfContent.loadSingleFile(gltfContent.name+'.gltf', gltfContent.name, jsonBuffer);
    }).then(() => {
      if (options.stats) {
        return {
          inputStats: options.inputStats,
          outputStats: options.outputStats
        }
      }
      else {
        return gltfContent.info;
      }
    });
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolGLTFPipeline());
}
else {
  console.error('ToolManager NOT FOUND');
}
