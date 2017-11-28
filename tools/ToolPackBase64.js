// Note: this implementation uses Node's Buffer.toString method to convert ArrayBuffers to base64.
// It works in browsers when packaged with browserify, but may require changes when using other
// packaging tools.

class ToolPackBase64 {

  constructor () {
    this.title = 'Pack base64';
    this.name = 'Pack';
    this.version = 'base64';
    //this.icon = '🗀'; // folder unicode character
    this.icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path stroke-width='+
    '"0" d="M21.3 4.6l-8-4c0 0 0 0 0 0-0.8-0.4-1.8-0.4-2.7 0l-8 4c-1 0.5-1.6 1.5-1.6 2.6v9.5c0 1'+
    '.1 0.6 2.2 1.7 2.7l8 4c0.4 0.2 0.9 0.3 1.3 0.3 0.5 0 0.9-0.1 1.3-0.3l8-4c1-0.5 1.7-1.5 1.7-'+
    '2.7v-9.5c0-1.1-0.6-2.1-1.7-2.6zM11.6 2.3c0.1-0.1 0.3-0.1 0.4-0.1 0.2 0 0.3 0 0.4 0.1l7.4 3.'+
    '7-2.8 1.4-7.8-3.9 2.4-1.2zM12 9.9l-7.8-3.9 2.8-1.4 7.8 3.9-2.8 1.4zM3.5 17.7c-0.3-0.2-0.5-0'+
    '.6-0.5-0.9v-9.2l8 4v9.8l-7.5-3.7zM20.4 17.7l-7.4 3.7v-9.8l8-4v9.2c0 0.4-0.2 0.7-0.6 0.9z"><'+
    '/path></svg>';
    this.order = 22;
  }

  run ( gltfContent ) {
    var gltf = gltfContent.gltf;
    console.log(gltf);
    var buffers = gltf.buffers || [];
    var bufferViews = gltf.bufferViews || [];
    var images = gltf.images || [];

    const imageExtMIME = {
      'png':'image/png',
      'jpg':'image/jpeg',
      'jpeg':'image/jpeg'
    };
  
    // invalidate existing container
    gltfContent.containerData = undefined;
    gltfContent.containerFileUri = undefined;

    var defaultName = (gltfContent.name || 'model').replace(/[\/\\#?:]/,'');

    // find references to buffers from images
    var bufferRefsImage = new Array(buffers.length);
    for (let imageId = 0; imageId < images.length; ++imageId) {
      let bufferViewId = images[imageId].bufferView;
      if (bufferViewId !== undefined) {
        let bufferId = bufferViews[bufferViewId].buffer;
        if (bufferRefsImage[bufferId] === undefined)
        bufferRefsImage[bufferId] = [];
        bufferRefsImage[bufferId].push(imageId);
      }
    }

    // convert the URI of all buffers to base64
    for (let bufferId = 0; bufferId < buffers.length; ++bufferId) {
      let buffer = buffers[bufferId];
      let data = gltfContent.getBufferArrayBuffer(bufferId);
      let mimeType;
      if (buffer.uri !== undefined &&
          buffer.uri.slice(0,5)!= 'data:' && buffer.uri.slice(0,5) != 'blob:') {
        let filename = buffer.uri.toLowerCase().match(/(?:^|\/)([^\/\\]+)$/)[1];
        let fileext = buffer.uri.toLowerCase().match(/.([^.\/\\]+)$/)[1];
        if (filename && !buffer.name) {
          buffer.name = filename;
        }
        //if (fileext in imageExtMIME) {
        //  mimeType = imageExtMIME[fileext];
        //}
      }
      for(let imageId of (bufferRefsImage[bufferId]||[])) {
        let image = images[imageId];
        //if (image.mimeType) {
        //  mimeType = image.mimeType;
        //}
      }
      if (!mimeType) {
        mimeType = "application/octet-stream";
      }
      let base64data = new Buffer(data).toString("base64");
      buffer.uri = "data:" + mimeType + ';base64,' + base64data;
      // make sure buffersData exists
      if (gltfContent.buffersData === undefined) {
        gltfContent.buffersData = new Array(buffers.length);
      }
      gltfContent.buffersData[bufferId] = data;
    }

    // convert the URI of all images to base64
    for (let imageId = 0; imageId < images.length; ++imageId) {
      let image = images[imageId];
      if (image.bufferView !== undefined) continue; // this image is already provided within a buffer
      let data = gltfContent.getImageArrayBuffer(imageId);
      if (image.uri.slice(0,5)!= 'data:' && image.uri.slice(0,5) != 'blob:') {
        let filename = image.uri.toLowerCase().match(/(?:^|\/)([^\/\\]+)$/)[1];
        let fileext = image.uri.toLowerCase().match(/.([^.\/\\]+)$/)[1];
        if (filename && !image.name) {
          image.name = filename;
        }
        if (image.mimeType === undefined && fileext in imageExtMIME) {
          image.mimeType = imageExtMIME[fileext];
        }
      }
      let mimeType;
      if (image.mimeType) {
        mimeType = image.mimeType;
      }
      if (!mimeType) {
        mimeType = "application/octet-stream";
      }
      let base64data = new Buffer(data).toString("base64");
      image.uri = "data:" + mimeType + ';base64,' + base64data;
      // make sure imagesData exists
      if (gltfContent.imagesData === undefined) {
        gltfContent.imagesData = new Array(images.length);
      }
      gltfContent.imagesData[imageId] = data;
    }

    let mainFileExt = 'gltf';

    gltfContent.gltf = gltf;
    // json -> string (with whitespaces for readability)
    var jsonString = JSON.stringify(gltf, undefined, 4);
    // string -> Uint8Array
    var jsonArray = new TextEncoder().encode(jsonString);
    var jsonBuffer = jsonArray.buffer;

    // remove reference to all previously referenced files
    gltfContent.mainFilePath = undefined;
    gltfContent.files = new Map();
    gltfContent.glbBody = undefined;
    gltfContent.containerFileUri = defaultName + '.' + mainFileExt;
    gltfContent.containerData = jsonBuffer;

    return gltfContent.updateSceneInformation();
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolPackBase64());
}
else {
  console.error('ToolManager NOT FOUND');
}
