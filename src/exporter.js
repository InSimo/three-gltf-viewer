const THREE = require('three');

require('three/examples/js/exporters/GLTFExporter');

module.exports = class Exporter {

  constructor (options) {
  }

  exportContent ( content, extension = 'glb' ) {

    return new Promise((resolve, reject) => {
      const exporter = new THREE.GLTFExporter();
      const scene = content.scene || content.scenes[0];
      console.log('Exporting three.js scene to ' + extension + ' format');
      console.log(scene);
      exporter.parse(scene, resolve, {binary: (extension == 'glb')});
    });

  }
};
