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
    return new Promise( function(resolve, reject) {
      const json = gltfContent.gltf;
      if (gltfContent.containerData && gltfContent.info.container.mimetype == 'model/gltf-binary') {
        var array = new Uint8Array(gltfContent.containerData);
        validator.validateBytes(gltfContent.info.name, bytes, loadExternalResource)
          .then(resolve)
          .catch(reject);
      }
      else if (json) {
        var string = JSON.stringify(json);
        validator.validateString(gltfContent.info.name, string, loadExternalResource)
          .then(resolve)
          .catch(reject);
      }
    });
  }
}

if (window.toolManager !== undefined) {
  window.toolManager.addTool(new ToolGLTFValidator());
}
else {
  console.error('ToolManager NOT FOUND');
}
