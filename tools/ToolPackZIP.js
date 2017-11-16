const zip = require('zipjs-browserify');

class ToolPackZIP {

  constructor () {
    this.title = 'Pack zip';
    this.name = 'Pack';
    this.version = 'ZIP';
    //this.icon = '🗀'; // folder unicode character
    this.icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path stroke-width='+
    '"0" d="M21.3 4.6l-8-4c0 0 0 0 0 0-0.8-0.4-1.8-0.4-2.7 0l-8 4c-1 0.5-1.6 1.5-1.6 2.6v9.5c0 1'+
    '.1 0.6 2.2 1.7 2.7l8 4c0.4 0.2 0.9 0.3 1.3 0.3 0.5 0 0.9-0.1 1.3-0.3l8-4c1-0.5 1.7-1.5 1.7-'+
    '2.7v-9.5c0-1.1-0.6-2.1-1.7-2.6zM11.6 2.3c0.1-0.1 0.3-0.1 0.4-0.1 0.2 0 0.3 0 0.4 0.1l7.4 3.'+
    '7-2.8 1.4-7.8-3.9 2.4-1.2zM12 9.9l-7.8-3.9 2.8-1.4 7.8 3.9-2.8 1.4zM3.5 17.7c-0.3-0.2-0.5-0'+
    '.6-0.5-0.9v-9.2l8 4v9.8l-7.5-3.7zM20.4 17.7l-7.4 3.7v-9.8l8-4v9.2c0 0.4-0.2 0.7-0.6 0.9z"><'+
    '/path></svg>';
    this.order = 21;
  }

  run ( gltfContent ) {

    // input json, modified in-place so we clone it first
    var json = JSON.parse(JSON.stringify(gltfContent.gltf));
    console.log(json);
    var buffers = json.buffers = json.buffers || [];
    var bufferViews = json.bufferViews = json.bufferViews || [];
    var images = json.images || [];
    var meshes = json.meshes || [];

    // invalidate existing container
    gltfContent.containerData = undefined;
    gltfContent.containerFileUri = undefined;
    // delete the original file (as it will be replaced, maybe with a new name/extension)
    if (gltfContent.files.has(gltfContent.mainFilePath)) {
      gltfContent.files.delete(gltfContent.mainFilePath);
    }
    var defaultName = (gltfContent.name || 'model').replace(/[\/\\#?:]/,'');

	const imageMIMEExt = {
	  'image/png': 'png',
	  'image/jpeg': 'jpg'
	};

    if (gltfContent.glbBody) {
      // input was a GLB, extract the binary buffer into one or more files
      // we separate images, and draco-compressed bufferViews
      // as they can be used independently of the gltf file
      if (buffers[0] === undefined || buffers[0].uri !== undefined) {
        throw new Error('GLB buffer[0] MUST not have an uri defined');
      }
      // find references to views from images
      var bufferViewRefsImages = new Array(bufferViews.length);
      for (let imageId of images.keys()) {
        let bufferViewId = images[imageId].bufferView;
        if (bufferViewId !== undefined) {
          if (bufferViewRefsImages[bufferViewId] === undefined)
            bufferViewRefsImages[bufferViewId] = [];
          bufferViewRefsImages[bufferViewId].push(imageId);
        }
      }
      // find references to views from compressed meshes
      var bufferViewRefsDracoMeshes = new Array(bufferViews.length);
      if ((json.extensionsUsed || []).indexOf('KHR_draco_mesh_compression') != -1) {
        for (let j = 0; j < meshes.length; ++j) {
          for (let k = 0; k < meshes[j].primitives.length; ++k) {
            let primitive = meshes[j].primitives[k];
            if (primitive.extensions !== undefined &&
                primitive.extensions.KHR_draco_mesh_compression !== undefined) {
              // this primitive is compressed
              let bufferViewId = primitive.extensions.KHR_draco_mesh_compression.bufferView;
              if (bufferViewId !== undefined) {
                if (bufferViewRefsDracoMeshes[bufferViewId] === undefined)
                  bufferViewRefsDracoMeshes[bufferViewId] = [];
                bufferViewRefsDracoMeshes[bufferViewId].push([j,k]);
              }
            }
          }
        }
      }

      // gather all bufferViews pointing to the GLB buffer
      var viewIds = Array.from(bufferViews.keys()).filter((v) => bufferViews[v].buffer == 0);
      // sort them by offset
      viewIds.sort((a,b) => (bufferViews[a].byteOffset||0) - (bufferViews[b].byteOffset||0));
      console.log(viewIds);
      // Ids of views that we will export as separate files
      var separateViewIds = [];
      // Chunks to be merged in the created binary file: { inputBegin, inputEnd, outputOffset }
      var outputBinChunks = [];
      // Size of the created binary file
      var outputBinSize = 0;
      for (let i = 0; i < viewIds.length; ++i) {
        let bufferViewId = viewIds[i];
        let bufferView   = bufferViews[bufferViewId];
        let inputBegin   = bufferView.byteOffset || 0;
        let inputEnd     = inputBegin + bufferView.byteLength;
        // check for overlap with next view(s)
        let ioverlap = i;
        while (ioverlap+1 < viewIds.length && (bufferViews[viewIds[ioverlap+1]].byteOffset || 0) < inputEnd) {
          ++ioverlap;
          let end2 = (bufferViews[viewIds[ioverlap]].byteOffset||0) + bufferViews[viewIds[ioverlap]].byteLength;
          if (end2 > inputEnd) {
            inputEnd = end2;
          }
        }
        if (ioverlap == i &&
            ((bufferViewRefsImages[bufferViewId] || []).length > 0 ||
             (bufferViewRefsDracoMeshes[bufferViewId] || []).length > 0)) {
          // separate file -> TODO
          separateViewIds.push(bufferViewId);
        }
        else {
          // write to output binary file
          if (outputBinSize%4) {
            outputBinSize += 4-(outputBinSize%4);
          }
          let outputOffset = outputBinSize;
          if (inputBegin != outputOffset) {
            // adjust offsets
            for (let j = i; j <= ioverlap; ++j) {
              let bufferView2 = bufferViews[viewIds[j]];
              bufferView2.byteOffset = (bufferView2.byteOffset||0) - inputBegin + outputOffset;
            }
          }
          outputBinChunks.push({inputBegin: inputBegin, inputEnd: inputEnd, outputOffset:outputOffset});
          outputBinSize += inputEnd - inputBegin;
        }
      }
      var inputBufferBytes = new Uint8Array(gltfContent.glbBody);
      var nextAvailableBufferId = 0;
      if (outputBinSize > 0) { // a binary file need to be created
        var outputBinUri = gltfContent.getUniqueFileUri();
        buffers[0].uri = outputBinUri;
        delete buffers[0].byteOffset;
        buffers[0].byteLength = outputBinSize;
        nextAvailableBufferId = buffers.length;
        var outputBinBuffer = new ArrayBuffer(outputBinSize);
        var outputBinBytes = new Uint8Array(outputBinBuffer);
        for (let c of outputBinChunks) {
          outputBinBytes.set( inputBufferBytes.slice(c.inputBegin, c.inputEnd), c.outputOffset);
        }
        gltfContent.setFileArrayBuffer(outputBinUri, outputBinBuffer);
      }
      for(let bufferViewId of separateViewIds) {
        let bufferView = bufferViews[bufferViewId];
        let inputBegin = bufferView.byteOffset || 0;
        let inputEnd   = inputBegin + bufferView.byteLength;
        let uri = bufferView.name;
        let ext = undefined;
        for(let imageId of (bufferViewRefsImages[bufferViewId]||[])) {
          let image = images[imageId];
          if (!uri) {
            uri = image.name || ('image'+imageId);
          }
          if (!ext && image.mimeType) {
            ext = imageMIMEExt[image.mimeType];
          }
        }
        for(let ids of (bufferViewRefsDracoMeshes[bufferViewId]||[])) {
          let j = ids[0];
          let k = ids[1];
          let name = '' + j + '_' + (meshes[j].name || 'mesh').replace(/[\/\\:#?]/,'') + '_' + k;
          if (!uri) {
            uri = name;
          }
          if (!ext) {
            ext = 'drc';
          }
        }
        if (!uri) {
          uri = defaultName;
        }
        if (!(uri.match(/.([^.\/\\]+)$/)[1])) {
          ext = 'bin'; // default extension
        }
        // append ext to uri (replacing any existing extension)
        uri = uri.replace(/\.([^.\/\\]+)$/,'') + '.' + ext;

        var outputBinUri = gltfContent.getUniqueFileUri(uri);
        var outputBufferId = nextAvailableBufferId;
        var outputLength = inputEnd - inputBegin;
        var buffer = {};
        buffer.uri = outputBinUri;
        buffer.byteLength = outputLength;
        buffers[outputBufferId] = buffer;
        nextAvailableBufferId = buffers.length;
        bufferView.buffer = outputBufferId;
        delete bufferView.byteOffset;
        var outputBinBuffer = new ArrayBuffer(outputLength);
        var outputBinBytes = new Uint8Array(outputBinBuffer);
        outputBinBytes.set( inputBufferBytes.slice(inputBegin, inputEnd) );

        gltfContent.setFileArrayBuffer(outputBinUri, outputBinBuffer);
      }
      // now we can remove the GLB body
      gltfContent.glbBody = undefined;
    }
    let mainFileExt = 'gltf';
    if (!gltfContent.mainFilePath) {
      gltfContent.mainFilePath = defaultName + '.' + mainFileExt;
    }
    else { // replace extension
      gltfContent.mainFilePath = gltfContent.mainFilePath.replace(/\.([^.\/\\]+)$/,'') + '.' + mainFileExt;
    }

    gltfContent.gltf = json;
    // json -> string (with whitespaces for readability, zip will compress it anyway)
    var jsonString = JSON.stringify(json,undefined,2);
    // string -> Uint8Array
    var jsonArray = new TextEncoder().encode(jsonString);
    var jsonBuffer = jsonArray.buffer;
    gltfContent.setMainFileArrayBuffer(jsonBuffer);

    // finally we can pack everything in a zip archive
    console.log(zip);
    return new Promise((resolve, reject) => {
        console.log('ZIP: creating writer');
      zip.createWriter(new zip.BlobWriter("application/zip"), resolve, reject);
    }).then ((zipWriter) => {
      // use a BlobReader object to read the data stored into blob variable
      // not clear if zipWrite support starting several add() concurrently,
      // so we use a sequential composition instead of Promise.all
      return Array.from(gltfContent.files.entries()).reduce((p,e) => {
        return p.then(() => {
          var [filePath, data] = e;
          return new Promise((resolve, reject) => {
            console.log('ZIP: adding ' + filePath + ' ( ' + data.byteLength + ' )');
            zipWriter.add(filePath, new zip.BlobReader(new Blob([data], {type: 'application/octet-stream'})), resolve);
          });
        });
      }, Promise.resolve()).then(() => zipWriter);
    }).then((zipWriter) => {
      return new Promise((resolve, reject) => {
        console.log('ZIP: closing writer');
        // close the writer and calls callback function
        zipWriter.close(resolve);
      });
    }).then((zipBlob) => {
      console.log('ZIP: reading Blob');
      return gltfContent.promiseArrayBuffer(zipBlob);
    }).then((zipBuffer) => {
      console.log('ZIP: storing containerData');
      gltfContent.containerFileUri = defaultName + '.zip';
      gltfContent.containerData = zipBuffer;
      return gltfContent.updateSceneInformation();
    });
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolPackZIP());
}
else {
  console.error('ToolManager NOT FOUND');
}
