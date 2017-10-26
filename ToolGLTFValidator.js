require('setimmediate');
const validator = require('gltf-validator');

module.exports = class ToolGLTFValidator {

  constructor () {
    this.name = 'Validator';
    this.icon = '<img src="assets/icons/glTF.svg" alt="glTF">';
    this.title = 'glTF Validator';
  }

  run (gltfContent) {
    return new Promise( function(resolve, reject) {
      const blob = gltfContent.binary;
      const json = gltfContent.gltf;
      if (blob) {
        //var array = new Uint8Array(blob);
        var reader = new FileReader();
        reader.readAsArrayBuffer(blob);
        reader.onload = function() {
          var arrayBuffer = reader.result
          var bytes = new Uint8Array(arrayBuffer);
          validator.validateBytes(gltfContent.info.name,bytes)
            .then(resolve)
            .catch(reject);
        }
      }
      else if (json) {
        var string = JSON.stringify(json);
        validator.validateString(gltfContent.info.name,string)
          .then(resolve)
          .catch(reject);
      }
    });
  }
}
