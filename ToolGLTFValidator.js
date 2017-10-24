require('setimmediate');
const validator = require('gltf-validator');

module.exports = class ToolGLTFValidator {

  constructor () {
    this.name = 'Validator';
    this.icon = '<img src="assets/icons/glTF.svg" alt="glTF">';
    this.title = 'glTF Validator';
  }

  run () {
    return new Promise( function(resolve, reject) {
      const blob = window.contentBinary;
      const json = window.contentGLTF;
      if (blob) {
        //var array = new Uint8Array(blob);
        var reader = new FileReader();
        reader.readAsArrayBuffer(blob);
        reader.onload = function() {
          var arrayBuffer = reader.result
          var bytes = new Uint8Array(arrayBuffer);
          validator.validateBytes(window.contentInfo.name,bytes)
            .then(resolve)
            .catch(reject);
        }
      }
      else if (json) {
        var string = JSON.stringify(json);
        validator.validateString(window.contentInfo.name,string)
          .then(resolve)
          .catch(reject);
      }
    });
  }
}
