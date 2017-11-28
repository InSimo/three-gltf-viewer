// gltf-validator fails to run if setimmediate is not also imported
require('setimmediate');
const validator = require('gltf-validator');

class ToolGLTFValidator {

  constructor () {
    this.name = 'Validator';
    this.icon = '<img src="assets/icons/glTF.svg" alt="glTF">';
    this.title = 'glTF Validator';
    this.order = 1;
  }

  /**
   * @param {GLTFContainer} gltfContent - Input GLTF scene to validate
   * @returns {Promise} - Promise with json result
   */
  run (gltfContent) {
    /**
     * @param {string} uri - Relative URI of the external resource
     * @returns {Promise} - Promise with Uint8Array data
     */
    var loadExternalResource = function(uri) {
      var array = gltfContent.getFileArrayBuffer(uri);
      if (array !== undefined) {
        return Promise.resolve(new Uint8Array(array));
      } else {
        return Promise.reject(new Error('loadExternalResource failed, uri ' + uri + ' not found.'));
      }
    }
    const options = {
      uri: gltfContent.info.name,
      externalResourceFunction: loadExternalResource
    };
    return Promise.resolve(gltfContent.gltf)
      .then((json) => {
        if (gltfContent.containerData && gltfContent.info.container.mimetype == 'model/gltf-binary') {
          var array = new Uint8Array(gltfContent.containerData);
          return array;
        }
        else if (json){
          // json -> string
          var jsonString = JSON.stringify(json);
          // string -> Uint8Array
          var jsonArray = new TextEncoder().encode(jsonString);
          return jsonArray;
        }
        else {
          return Promise.reject('No GLTF asset');
        }
      }).then((array) => {
        return validator.validateBytes(array, options);
      });
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolGLTFValidator());
}
else {
  console.error('ToolManager NOT FOUND');
}
