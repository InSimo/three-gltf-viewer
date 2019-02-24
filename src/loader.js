const THREE = require('three');

// For FBXLoader: emulate https://github.com/imaya/zlib.js with https://github.com/juliangruber/zipjs-browserify
const zip = require('zipjs-browserify/vendor/inflate.js');
const Zlib = {}
Zlib.Inflate = class {
  constructor(inputArray) {
    this.input = inputArray;
    this.inflater = new zip.Inflater();
  }
  decompress() {
    let data = this.inflater.append(this.input.slice(2,-4)); // skip the 2 bytes header and the 4 bytes checksum
    this.inflater.flush();
    return data;
  }
}
window.Zlib = Zlib;

require('three/examples/js/loaders/GLTFLoader');
require('three/examples/js/loaders/DRACOLoader');
require('three/examples/js/loaders/ColladaLoader');
require('three/examples/js/loaders/FBXLoader');
require('three/examples/js/loaders/OBJLoader');
require('three/examples/js/loaders/PLYLoader');
require('three/examples/js/loaders/STLLoader');
require('three/examples/js/loaders/VTKLoader');

module.exports = class Loader {

  constructor (options) {
    this.content = null;
    this.loaders = {};

    this.loaders['gltf']  =
      this.loaders['glb']      = { priority: 100, loader: 'GLTFLoader',       gltf: true };
    // from the loaders list as the three.js editor, first the common ones
    this.loaders['dae']        = { priority:  50, loader: 'ColladaLoader',    };
    this.loaders['fbx']        = { priority:  40, loader: 'FBXLoader',        };
    this.loaders['obj']        = { priority:  30, loader: 'OBJLoader',        };
    this.loaders['ply']        = { priority:  20, loader: 'PLYLoader',        };
    this.loaders['stl']        = { priority:  20, loader: 'STLLoader',        };
    this.loaders['vtk']        = { priority:  10, loader: 'VTKLoader',        };
    // untested loaders below
    /*
    this.loaders['3ds']        = { priority:   0, loader: 'TDSLoader',        };
    this.loaders['amf']        = { priority:   0, loader: 'AMFLoader',        };
    this.loaders['awd']        = { priority:   0, loader: 'AWDLoader',        };
    this.loaders['babylon']    = { priority:   0, loader: 'BabylonLoader',    };
    //this.loaders['babylonmeshdata'] = { priority:   0, loader: 'BabylonLoader' }; // require custom parsing with parseGeometry ?
    //this.loaders['ctm']        = { priority:   0, loader: 'CTMLoader',        }; // require custom parsing with createModel ?
    this.loaders['kmz']        = { priority:   0, loader: 'KMZLoader',        };
    this.loaders['md2']        = { priority:   0, loader: 'MD2Loader',        };
    this.loaders['playcanvas'] = { priority:   0, loader: 'PlayCanvasLoader', };
    this.loaders['wrl']        = { priority:   0, loader: 'VRMLLoader',       };
    */
  }

  load ( url, rootPath, assetMap, rootName, rootFileExt ) {

    const baseURL = THREE.Loader.prototype.extractUrlBase(url);

    return new Promise((resolve, reject) => {

      const manager = new THREE.LoadingManager();

      // Intercept and override relative URLs.
      manager.setURLModifier((url, path) => {

        const normalizedURL = rootPath + url
          .replace(baseURL, '')
          .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      });

      const loaderInfo = this.loaders[rootFileExt] || this.loaders['gltf'];
      console.log('Loading ' + rootFileExt + ' asset using ' + loaderInfo.loader);
      const loader = new THREE[loaderInfo.loader](manager);
      if ('setCrossOrigin' in loader) {
        console.log('Setting cross-origin to anonymous');
        loader.setCrossOrigin('anonymous');
      }

      if (loader instanceof THREE.GLTFLoader) {
        console.log('Enabling Draco support');
        THREE.DRACOLoader.setDecoderPath( 'lib/draco/' );
        loader.setDRACOLoader( new THREE.DRACOLoader( manager ) );
      }

      const blobURLs = [];

      loader.load(url, (content) => {
        console.log(content);
        if (content instanceof THREE.BufferGeometry) { // geometry loader -> create mesh with default material
          var geometry = content;
          var material = new THREE.MeshStandardMaterial();
          content = new THREE.Mesh( geometry, material );
          content.name = rootName;
          console.log(content);
        }
        if ((content instanceof THREE.Object3D) && !(content instanceof THREE.Scene)) { // object -> scene
          var object = content;
          var scene = new THREE.Scene();
          scene.name = rootName;
          scene.add(object);
          content = scene;
        }
        if (content instanceof THREE.Scene) { // scene -> gltf content
          content = { scene: content };
        }
        if (loaderInfo.gltf) {
          content.gltf = true;
        }

        blobURLs.forEach(URL.revokeObjectURL);
        resolve(content);

      }, undefined, reject);

    });

  }
};
