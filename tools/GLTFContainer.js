// no longer using crypto because it adds too much dependencies, using sha.js directly instead
//const crypto = require('crypto');
const Sha224 = require('sha.js/sha224');
const SceneInformation = require('./SceneInformation');
const LicensesJson = require('./licenses.json');

/**
 * This class is meant as a thin layer on top of a GLTF file,
 * allowing for simple parsing of the contained scene and implementing
 * simple processing tools.
 * For now the API is loading all resources at the beginning
 * and stored as readily-available BufferArrays.
 */

module.exports = class GLTFContainer {

  constructor () {
    this.name = ''; // the most relevant name of this scene (filename of the original container, or of the GLTF file)
    this.containerFileUri = undefined; // path to the original container file (used to resolve external uris)
    this.mainFilePath = undefined; // path to the main file (containing the GLTF json content)
    this.files = new Map(); // maps of files associated with this scene. the keys are paths (relative to the same root as mainFilePath), and the values are the ArrayBuffer content of each file
    this.gltf = {}; // the parsed json GLTF content
    this.glbBody = undefined; // if the scene is packaged as a GLB file, this is the content of the binary chunk
    this.containerData = undefined; // if everything is in a single file (ZIP or GLB), content of that file
    this.info = new SceneInformation(); // metadata about this scene
  }

  clear() {
    this.name = '';
    this.mainFilePath = undefined;
    this.files = new Map();
    this.gltf = {};
    this.glbBody = undefined;
    this.containerData = undefined;
    this.containerFileUri = undefined;
    this.info = new SceneInformation();
  }

  getNameFromUri(uri) {
    return uri.match(/([^.\/#?]+)(.[^\/#?]*)($|\?|#)/)[1];
  }

  convertUint8ArrayToString( array ) {
	if ( window.TextDecoder !== undefined ) {
	  return new TextDecoder().decode( array );
	}
	// Avoid the String.fromCharCode.apply(null, array) shortcut, which
	// throws a "maximum call stack size exceeded" error for large arrays.
	var s = '';
	for ( var i = 0, il = array.length; i < il; i ++ ) {
	  s += String.fromCharCode( array[ i ] );
	}
	return s;
  }

  promiseArrayBuffer(data, originUri = undefined) {
    if (data instanceof ArrayBuffer) { // arraybuffer, return it directly
      return Promise.resolve(data);
    }
    else if (data instanceof Blob || data instanceof File) { // use FileReader
      var fileReader = new FileReader();
      return new Promise(function(resolve, reject) {
        fileReader.onload = resolve;
        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(data);
      }).then( event => {
        return fileReader.result;
      });
    }
    else if (typeof data === 'string' || data instanceof URL) { // use fetch
      var uri = data;
      if (typeof data === 'string' && originUri) {
        uri = new URL(data, originUri);
      }
      return fetch(uri).then(response => {
        return response.arrayBuffer()
      });
    }
    else {
      return Promise.reject(new Error('Unsupported data type '+(typeof data)));
    }
  }

  load(uri, name=undefined, mainFilePath=undefined, data=undefined, files = undefined) {
    if ( data === undefined && mainFilePath !== undefined &&
         files !== undefined && files.has(mainFilePath) ) {
      data = files.get(mainFilePath);
    }
    if ( files === undefined || files.size == 0 ||
         ( files.size == 1 && files.has(mainFilePath) ) ) {
      return this.loadSingleFile(uri, name, data);
    } else {
      return this.loadFiles(uri, name, mainFilePath, files, data);
    }
  }

  /**
   * @param  {string} uri
   * @param  {string} name
   * @param  {ArrayBuffer|Blob|File} data
   */
  loadSingleFile(uri, name=undefined, data=undefined) {
    this.clear();
    this.containerFileUri = uri || data.name || name;
    this.name = name || this.getNameFromUri(uri);
    var promise = this.promiseArrayBuffer(data || uri);
    return promise.then(buffer => {
      this.containerData = buffer;
      this.parse(buffer);
      return this.updateSceneInformation(data);
    });
  }

  /**
   * @param  {string} uri
   * @param  {string} name
   * @param  {string} mainFilePath
   * @param  {Map<string,string|Blob|ArrayBuffer>} files
   */
  loadFiles(uri, name, mainFilePath, files) {
    this.clear();
    this.containerFileUri = uri;
    this.name = name || this.getNameFromUri(uri) || this.getNameFromUri(mainFilePath);
    if (!files.has(mainFilePath)) {
      return Promise.reject(new Error('mainFilePath '+mainFilePath+' not found in files'));
    }
    this.mainFilePath = mainFilePath;
    this.files = new Map();
    return Promise.all(Array.from(files.entries()).map( e => {
      var [filePath, data] = e;
      return this.promiseArrayBuffer(data).then(buffer => {
        this.files.set(filePath, buffer);
      });
    })).then( () => {
      var mainFileData = this.files.get(mainFilePath);
      this.parse(mainFileData);
      // copy AUTHOR and LICENSE info into the glTF itself, so packing to GLB will preserve the appropriate credit
      // possible names for author file, TODO: case insensitive lookup
      var authorFileNames = [ 'AUTHOR', 'AUTHOR.txt', this.resolveURL('AUTHOR'), this.resolveURL('AUTHOR.txt') ];
      authorFileNames = authorFileNames.filter(v => this.files.has(v));
      if (authorFileNames.length > 0) {
        var authorFileName = authorFileNames[0];
        var authorFileData = this.files.get(authorFileName);
        var authorString = this.convertUint8ArrayToString( new Uint8Array( authorFileData ) );
        this.addAuthors(authorString);
      }
      var licenseFileNames = [ 'LICENSE', 'LICENSE.txt', this.resolveURL('LICENSE'), this.resolveURL('LICENSE.txt') ];
      licenseFileNames = licenseFileNames.filter(v => this.files.has(v));
      if (licenseFileNames.length > 0) {
        var licenseFileName = licenseFileNames[0];
        var licenseFileData = this.files.get(licenseFileName);
        var licenseString = this.convertUint8ArrayToString( new Uint8Array( licenseFileData ) );
        this.addLicense(licenseString);
      }
      return this.updateSceneInformation();
    });
  }

  parse( data ) {
	var BINARY_EXTENSION_HEADER_MAGIC = 'glTF';
	var magic = this.convertUint8ArrayToString( new Uint8Array( data, 0, 4 ) );
	if ( magic === BINARY_EXTENSION_HEADER_MAGIC ) {
      return this.parseGLB(data);
    } else {
      return this.parseGLTF(data);
    }
  }
  parseGLTF( data ) {
    return this.gltf = JSON.parse( this.convertUint8ArrayToString( new Uint8Array( data ) ) );
  }
  parseGLB( data ) {
    var BINARY_EXTENSION_HEADER_LENGTH = 12;
    var BINARY_EXTENSION_CHUNK_TYPES = { JSON: 0x4E4F534A, BIN: 0x004E4942 };
    var dataView = new DataView( data );
    var json = null;
    var body = null;
	var header = {
	  magic: this.convertUint8ArrayToString( new Uint8Array( data.slice( 0, 4 ) ) ),
	  version: dataView.getUint32( 4, true ),
	  length:  dataView.getUint32( 8, true )
	};
    var byteLength = Math.min(header.length, dataView.byteLength);
    var dataIndex = BINARY_EXTENSION_HEADER_LENGTH;
    while ( dataIndex + 8 < byteLength ) {

      var chunkLength = dataView.getUint32( dataIndex, true );
      dataIndex += 4;
      var chunkType = dataView.getUint32( dataIndex, true );
      dataIndex += 4;

      if ( chunkType === BINARY_EXTENSION_CHUNK_TYPES.JSON ) {
        json = this.convertUint8ArrayToString( new Uint8Array( data.slice( dataIndex, dataIndex + chunkLength ) ) );
      }
      else if ( chunkType === BINARY_EXTENSION_CHUNK_TYPES.BIN ) {
        body = data.slice( dataIndex, dataIndex + chunkLength );
      }
      dataIndex += chunkLength;
    }
    this.glbBody = body;
    return this.gltf = JSON.parse( json );
  }

  addAuthors(authorString) {
    var authors = [];
    if (this.gltf.asset.extras !== undefined && this.gltf.asset.extras.authors !== undefined) {
      authors = this.gltf.asset.extras.authors;
    }
    var authorRe = /^(.*)(?:\((https?:\/\/.*)\))\w*$/;
    authorString.split("\n").forEach(line => {
      line = line.trim();
      var [ line2, name, uri ] = line.match(authorRe);
      var author = { name: name.trim() };
      if (uri !== undefined) {
        author.uri = uri.trim();
      }
      // only add it if the same author was not already added earlier
      if (authors.findIndex(x => (x.name === author.name)) == -1) {
        authors.push(author);
      }
    });
    if (this.gltf.asset.extras === undefined) {
      this.gltf.asset.extras = {};
    }
    this.gltf.asset.extras.authors = authors;
  }

  addLicense(licenseString) {
    // remove '=+' and whitespaces to being as independent as possible to changes of formatting
    var text = licenseString.replace(/=+/g, '').replace(/\s+/g, ' ');
    //var hash = crypto.createHash('sha224').update(text).digest('hex');
    var hash = new Sha224().update(text).digest('hex');
    // Licenses by hash
    const LicensesByHashSha224 = Object.entries(LicensesJson).reduce((r,x) => { if (x[1].hash_sha224 !== undefined) { r[x[1].hash_sha224] = x[0]; } return r; }, {});
    if (hash in LicensesByHashSha224) {
      var licenseId = LicensesByHashSha224[hash];
      var license = { name: licenseId };
      if (LicensesJson[licenseId].uri !== undefined) {
        license.uri = LicensesJson[licenseId].uri;
      }
      if (this.gltf.asset.extras === undefined) {
        this.gltf.asset.extras = {};
      }
      if (this.gltf.asset.extras.licenses === undefined) {
        this.gltf.asset.extras.licenses = [];
      }
      // only add it if the same license was not already added earlier
      if (this.gltf.asset.extras.licenses.findIndex(x => (x.name === license.name)) == -1) {
        this.gltf.asset.extras.licenses.push(license);
      }
    }
  }

  updateSceneInformation(data) {
    var info = this.info = new SceneInformation();
    var gltf = this.gltf;

	const EXTMAP = {
	  'gltf': 'model/gltf',
	  'glb': 'model/gltf.binary',
	  'zip': 'application/zip'
	};
    // reverse of EXTMAP
    const MIMEMAP = Object.entries(EXTMAP).reduce((r,x) => { r[x[1]] = x[0]; return r; }, {});

    info.name = this.name;
    var fullfilename = this.containerFileUri || this.mainFilePath;
    if (!fullfilename) {
      info.filename = '';
      info.fileextension = '';
    }
    else {
      info.filename = fullfilename.match(/([^\/\\]+)$/)[1];
      info.fileextension = fullfilename.toLowerCase().match(/.([^.\/\\]+)$/)[1];
    }
    if (this.containerFileUri) {
      info.container.fileextension = this.containerFileUri.toLowerCase().match(/.([^.\/\\]+)$/)[1];
      if (info.container.fileextension in EXTMAP) {
        info.container.mimetype = EXTMAP[info.container.fileextension];
      }
    }
    info.format.name = 'glTF';
    info.format.version = gltf.asset.version;
    info.format.extensions = [];
    if (gltf.extensionsUsed)
      gltf.extensionsUsed.forEach(v => info.format.extensions.push(v));

    if (this.containerData) {
      info.container.size = this.containerData.byteLength;
    }
    if ( this.glbBody ) {
      info.fileextension = 'glb';
      info.format.extensions.push('KHR_binary_glTF');
    }
    if ( !this.containerData &&
         ( this.files.size == 0 ||
           ( this.files.size == 1 && this.files.has(this.mainFilePath) ) ) ) {
      // the GLTF/GLB file is also the container, as it is the only file
      info.container.mimetype = 'model/gltf';
      info.container.fileextension = 'gltf';
      // TODO: this is only approximate, does not consider added bytes due to utf-8 encoding
      info.container.size = JSON.stringify(this.gltf).length;
      if (this.glbBody) {
        info.container.mimetype = 'model/gltf.binary';
        info.container.fileextension = 'glb';
        info.container.size += 12+2*8; // headers
        info.container.size += this.glbBody.byteLength;
      }
    }

    if (data !== undefined && data instanceof File)
    {
      info.container.mimetype = data.type || info.container.mimetype;
      info.container.size = data.size || info.container.size;
      if (info.container.mimetype in MIMEMAP) {
        info.container.fileextension = MIMEMAP[info.container.mimetype];
      }
    }

    var totalAssetSize = 0;
    if (this.files.size) {
      for(const [k,v] of this.files.entries()) {
        info.internalFiles[k] = v.byteLength || 0;
        totalAssetSize += v.byteLength || 0;
      }
    }
/*
    if (externalURLs !== undefined) {
      for(const [k,v] of externalURLs.entries()) {
        info.externalURLs[k] = k.status || '';
      }
    }
*/
    if (totalAssetSize > 0) {
      info.size = totalAssetSize;
    }
    else if (info.container.size) {
      info.size = info.container.size;
    }

    return info;
  }

  getCredits() {
    var authors = (this.gltf.asset.extras||{}).authors || [];
    var licenses = (this.gltf.asset.extras||{}).licenses || [];
    if (!authors && !licenses) {
      return undefined;
    }
    var res = document.createElement('div');
    res.classList.add('gltf-credits');
    if (authors) {
      var resAuthorList = document.createElement('div');
      resAuthorList.classList.add('gltf-authors');
      res.appendChild(resAuthorList);
      for(let i = 0; i < authors.length; ++i) {
        let inter = document.createElement('span');
        inter.innerHTML = (i == 0) ? 'By ' : ', ';
        resAuthorList.appendChild(inter);
        var name = authors[i].name;
        var uri = authors[i].uri;
        var resAuthor = document.createElement(uri ? 'a' : 'span');
        resAuthor.classList.add('gltf-author');
        if (uri) {
          resAuthor.setAttribute('href',uri);
          resAuthor.setAttribute('target','_blank');
        }
        resAuthor.appendChild(document.createTextNode(name));
        resAuthorList.appendChild(resAuthor);
      }
    }
    if (licenses) {
      var resLicenseList = document.createElement('div');
      resLicenseList.classList.add('gltf-licenses');
      res.appendChild(resLicenseList);
      for(let i = 0; i < licenses.length; ++i) {
        var name = licenses[i].name;
        var uri = licenses[i].uri;
        var resLicense = document.createElement(uri ? 'a' : 'span');
        resLicense.classList.add('gltf-license');
        if (uri) {
          resLicense.setAttribute('href',uri);
          resLicense.setAttribute('target','_blank');
        }
        resLicense.appendChild(document.createTextNode(name));
        resLicenseList.appendChild(resLicense);
      }
    }
    return res;
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

  resolveURL( url ) {
	// Invalid URL
	if ( typeof url !== 'string' || url === '' )
	  return '';
	// Absolute URL http://,https://,//
	if ( /^(https?:)?\/\//i.test( url ) ) {
	  return url;
	}
	// Data or Blob URI
	if ( /^(data|blob):.*,.*$/i.test( url ) ) {
	  return url;
	}
	// Relative URL
    var fileURL = (this.mainFilePath || 'file') + '/../' + url;
    //fileURL = fileURL.replace(/\/(\.?\/)+/, '/');
    //fileURL = fileURL.replace(/(^|\/[^\.\/][^\/]*|\/\.[^\.\/][^\/]*|\/\.\.[^\/]+)\/\.\.\//,/\1\//);
    // resolve '/../', remove '/./' or '//'
    fileURL = fileURL.split('/').reduce((result,dir) => {
      if (dir==='..' && result.length > 0 &&
          result[result.length-1]!=='..' &&
          result[result.length-1] !== '' ) {
        result.pop();
      } else if ((result.length === 0 || dir !== '') && dir !== ".") {
        result.push(dir);
      }
      return result;
    }, []).join('/');
    return fileURL;
  }

  getFileArrayBuffer(uri) {
    // TODO: support external URIs
    return this.files.get(this.resolveURL(uri));
  }

  getBufferArrayBuffer(bufferIndex) {
    var buffer = this.gltf.buffers[bufferIndex];
    if (buffer.uri) {
      return this.getFileArrayBuffer(buffer.uri);
    }
    else if (this.glbBody) {
      return this.glbBody;
    }
    return undefined;
  }

  getAccessorByteLength(accessorIndex) {
    var accessor = this.gltf.accessors[accessorIndex];
    var componentTypeArray = this.getComponentTypeArray(accessor.componentType);
    var typeCount = this.getTypeCount(accessor.type);
    var elementSize = componentTypeArray.BYTES_PER_ELEMENT*typeCount;
    return elementSize*accessor.count;
  }

  getAccessorArrayBuffer(accessorIndex) {
    var accessor = this.gltf.accessors[accessorIndex];
    var bufferView = this.gltf.bufferViews[accessor.bufferView];
    var stride = 0;
    var buffer = undefined;
    var componentTypeArray = this.getComponentTypeArray(accessor.componentType);
    var typeCount = this.getTypeCount(accessor.type);
    var elementSize = componentTypeArray.BYTES_PER_ELEMENT*typeCount;
    var bufferArray = this.getBufferArrayBuffer(bufferView.buffer);
    if (bufferView.hasOwnProperty('byteStride')) {
      stride = bufferView.byteStride;
    }

    var offset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
    if (stride == 0 || stride == elementSize) {
      buffer = new componentTypeArray(bufferArray.slice(offset, offset + elementSize*accessor.count));

    } else {

      var inbuffer = new componentTypeArray(bufferArray.slice(offset, offset + bufferView.byteLength));
      buffer = new componentTypeArray(accessor.count*typeCount);

      for(var i = 0; i<accessor.count; i++) {

        var inoffset = i * stride/elementSize;
        var outoffset = i * typeCount;

        for (var c = 0; c < typeCount; ++c) {
          buffer[outoffset + c] = inbuffer[inoffset + c];
        }
      }
    }
    return buffer;
  }

  addBuffer(uri, data, size) {
    const id = this.gltf.buffers.length;
    this.gltf.buffers.push({byteLength: size, uri: uri});
    this.files.set(this.resolveURL(uri), data);
    return id;
  }

  addBufferView(bufferId, offset, size) {
    const id = this.gltf.bufferViews.length;
    this.gltf.bufferViews.push({buffer: bufferId, byteOffset: offset, byteLength: size});
    return id;
  }

  helperVisitJsonObjects(json, functor) {
    const visitor = (x) => {
      if (Array.isArray(x)) {
        x.forEach(visitor);
      } else if (x instanceof Object) {
        functor(x);
        Object.values(x).forEach(visitor);
      } else { // final value, ignore
      }
    };
    visitor(json);
  }

  removeUnusedBufferViews(bufferViewsToRemoveArray) {
    if (!this.gltf.bufferViews) return; // no bufferViews -> nothing to do
    // count the number of reference for each bufferView ID
    var bufferViews = this.gltf.bufferViews;
    var bufferViewsRefs = new Array(bufferViews.length).fill(0);
    this.helperVisitJsonObjects(this.gltf, (x) => {
      if ('bufferView' in x) {
        var bufferViewId = x['bufferView'];
        if (bufferViewId >= 0 && bufferViewId < bufferViews.length) { // valid Id
          ++bufferViewsRefs[bufferViewId];
        } else {
          console.error('Invalid bufferView reference ' + bufferViewId);
        }
      }
    });
    // only remove bufferViews without any reference
    // also store a set of candidate buffer ids to remove
    var buffersToRemoveSet = new Set();
    bufferViewsToRemoveArray = bufferViewsToRemoveArray.filter((id) => !bufferViewsRefs[id]);
    if (bufferViewsToRemoveArray.length == 0) return; // no unused bufferView
    var bufferViewsToRemoveSet = new Set(bufferViewsToRemoveArray);
    var bufferViewsNewIds = new Array(bufferViews.length).fill(-1);
    var newBufferViews = [];
    for (let i = 0; i < bufferViews.length; ++i) {
      if (bufferViewsToRemoveSet.has(i)) { // remove this bufferView
        if ('buffer' in bufferViews[i]) {
          buffersToRemoveSet.add(bufferViews[i].buffer);
        }
      } else { // preserve this bufferView
        bufferViewsNewIds[i] = newBufferViews.length;
        newBufferViews.push(bufferViews[i]);
      }
    }
    // convert all existing references to the new (compacted) bufferView ids
    this.helperVisitJsonObjects(this.gltf, (x) => {
      if ('bufferView' in x) {
        var bufferViewId = x['bufferView'];
        if (bufferViewId >= 0 && bufferViewId < bufferViews.length) { // valid Id
          x['bufferView'] = bufferViewsNewIds[bufferViewId];
        } else {
          console.error('Invalid bufferView reference ' + bufferViewId);
        }
      }
    });
    // now we can replace the old bufferViews array with the new one
    this.gltf.bufferViews = newBufferViews;
    console.log('Removed ' + bufferViewsToRemoveArray.length + ' bufferView(s)');
    if (buffersToRemoveSet.size > 0) {
      var buffersToRemoveArray = Array.from(buffersToRemoveSet);
      this.removeUnusedBuffers(buffersToRemoveArray);
    }
  }

  removeUnusedBuffers(buffersToRemoveArray) {
    if (!this.gltf.buffers) return; // no buffers -> nothing to do
    // count the number of reference for each buffer ID
    var buffers = this.gltf.buffers;
    var buffersRefs = new Array(buffers.length).fill(0);
    this.helperVisitJsonObjects(this.gltf, (x) => {
      if ('buffer' in x) {
        var bufferId = x['buffer'];
        if (bufferId >= 0 && bufferId < buffers.length) { // valid Id
          ++buffersRefs[bufferId];
        } else {
          console.error('Invalid buffer reference ' + bufferId);
        }
      }
    });
    // only remove buffers without any reference
    // also store a set of candidate file uris to remove
    var filesToRemoveSet = new Set();
    buffersToRemoveArray = buffersToRemoveArray.filter((id) => !buffersRefs[id]);
    if (buffersToRemoveArray.length == 0) return; // no unused buffer
    var buffersToRemoveSet = new Set(buffersToRemoveArray);
    var buffersNewIds = new Array(buffers.length).fill(-1);
    var newBuffers = [];
    for (let i = 0; i < buffers.length; ++i) {
      if (buffersToRemoveSet.has(i)) { // remove this buffer
        if ('uri' in buffers[i]) {
          filesToRemoveSet.add(this.resolveURL(buffers[i].uri));
        }
      } else { // preserve this buffer
        buffersNewIds[i] = newBuffers.length;
        newBuffers.push(buffers[i]);
      }
    }
    // convert all existing references to the new (compacted) buffer ids
    this.helperVisitJsonObjects(this.gltf, (x) => {
      if ('buffer' in x) {
        var bufferId = x['buffer'];
        if (bufferId >= 0 && bufferId < buffers.length) { // valid Id
          x['buffer'] = buffersNewIds[bufferId];
        } else {
          console.error('Invalid buffer reference ' + bufferId);
        }
      }
    });
    // now we can replace the old buffers array with the new one
    this.gltf.buffers = newBuffers;
    console.log('Removed ' + buffersToRemoveArray.length + ' buffer(s)');
    if (filesToRemoveSet.size > 0) {
      var filesToRemoveArray = Array.from(filesToRemoveSet);
      this.removeUnusedFiles(filesToRemoveArray);
    }
  }

  removeUnusedFiles(filesToRemoveArray) {
    var filesToRemoveSet = new Set(filesToRemoveArray);
    // remove any uri that still exists in the json
    this.helperVisitJsonObjects(this.gltf, (x) => {
      if ('uri' in x) {
        var fileId = this.resolveURL(x['url']);
        if (filesToRemoveSet.has(fileId)) {
          console.log('File ' + fileId + ' is still referenced.');
          filesToRemoveSet.delete(fileId)
        }
      }
    });
    // all files in filesToRemoveArray are no longer referenced anywhere
    // they are safe to delete from our stored files
    var count = 0;
    filesToRemoveSet.forEach((fileId) => {
      if (this.files.has(fileId)) {
        this.files.delete(fileId);
        ++count;
        console.log('File ' + fileId + ' removed');
      } else {
        console.log('File ' + fileId + ' cannot be removed as it is not stored');
      }
    });
    console.log('Removed ' + count + ' file(s)');
  }
}