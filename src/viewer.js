const THREE = window.THREE = require('three');
const Stats = require('../lib/stats.min');
const dat = require('dat.gui');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

require('three/examples/js/loaders/DDSLoader');
require('three/examples/js/controls/OrbitControls');
require('three/examples/js/loaders/RGBELoader');
require('three/examples/js/loaders/HDRCubeTextureLoader');
require('three/examples/js/pmrem/PMREMGenerator');
require('three/examples/js/pmrem/PMREMCubeUVPacker');

const DEFAULT_CAMERA = '[default]';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// glTF texture types. `envMap` is deliberately omitted, as it's used internally
// by the loader but not part of the glTF format.
const MAP_NAMES = [
  'map',
  'aoMap',
  'emissiveMap',
  'glossinessMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
];

const Preset = {ASSET_GENERATOR: 'assetgenerator'};

module.exports = class Viewer {

  constructor (el, options) {
    this.el = el;
    this.options = options;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;

    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
        ? 'Footprint Court (HDR)'
        : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: false,

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      ambientIntensity: 0.3,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8 * Math.PI, // TODO(#116)
      directColor: 0xFFFFFF,
      bgColor1: '#ffffff',
      bgColor2: '#353535'
    };

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    // support for Three.js Inspector chrome extension https://github.com/jeromeetienne/threejs-inspector
    window.scene = this.scene;

    const fov = options.preset === Preset.ASSET_GENERATOR
      ? 0.8 * 180 / Math.PI
      : 60;
    this.defaultCamera = new THREE.PerspectiveCamera( fov, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.activeCamera = this.defaultCamera;
    this.scene.add( this.defaultCamera );

    this.renderer = window.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    this.renderer.physicallyCorrectLights = true;
    this.renderer.gammaOutput = true;
    this.renderer.gammaFactor = 2.2;
    this.renderer.setClearColor( 0x000000, 0 );
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( el.clientWidth, el.clientHeight );

    this.controls = new THREE.OrbitControls( this.defaultCamera, this.renderer.domElement );
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;
    this.controls.screenSpacePanning = true;

    this.background = createVignetteBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: [this.state.bgColor1, this.state.bgColor2]
    });
    this.background.name = '[Vignette]';
    this.background.renderOrder = -100; // make sure the background is always rendered first

    this.el.appendChild(this.renderer.domElement);

    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];
    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

    this.addGUI();
    if (options.kiosk) this.gui.close();

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    this.lastClientWidth = el.clientWidth;
    this.lastClientHeight = el.clientHeight;
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate (time) {

    requestAnimationFrame( this.animate );

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render () {

    this.renderer.render( this.scene, this.activeCamera );

  }

  renderImage ( w, h, cb ) {
    // set the image size
    const clientHeight = h, clientWidth = w;
    this.renderer.setPixelRatio( 1.0 );
    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.background.style({aspect: this.defaultCamera.aspect});
    this.renderer.setSize(clientWidth, clientHeight);
    // remove vignette background
    this.scene.remove(this.background);
    // render the image
    this.renderer.render( this.scene, this.activeCamera );
    // immediatly capture image (this way preserveDrawingBuffer should not be required)
    var toBlobCB = (data) => {
      // reset renderer settings
      this.renderer.setPixelRatio( window.devicePixelRatio );
      // reset size and background
      this.lastClientWidth = -1;
      this.resize();
      this.updateEnvironment();
      this.render();
      cb(data);
    };
    if (this.renderer.domElement.toBlob !== undefined) {
      this.renderer.domElement.toBlob(toBlobCB);
    } else if (this.renderer.domElement.msToBlob !== undefined){
      var blob = this.renderer.domElement.msToBlob();
      toBlobCB(blob);
    } else {
      console.error('DOMCanvas.toBlob() not supported, no image preview generated');
      toBlobCB(undefined);
    }
  }

  resize () {

    const {clientHeight, clientWidth} = this.el.parentElement;
    if (clientHeight != this.lastClientHeight || clientWidth != this.lastClientWidth) {
      this.lastClientWidth = clientWidth;
      this.lastClientHeight = clientHeight;
      this.defaultCamera.aspect = clientWidth / clientHeight;
      this.defaultCamera.updateProjectionMatrix();
      this.background.style({aspect: this.defaultCamera.aspect});
      this.renderer.setSize(clientWidth, clientHeight);
    }
  }

  loadContent ( gltf, rootName = '', initState = {} ) {

    const scene = gltf.scene || gltf.scenes[0];
    const clips = gltf.animations || [];
    this.setContent(scene, clips, rootName, initState);
  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   * @param {Object} initState
   */
  setContent ( object, clips, rootName, initState = {} ) {

    this.clear();

    object.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();

    if (this.options.cameraPosition) {

      this.defaultCamera.position.fromArray( this.options.cameraPosition );
      this.defaultCamera.lookAt( new THREE.Vector3() );

    } else {

      this.defaultCamera.position.copy(center);
      this.defaultCamera.position.x += size / 2.0;
      this.defaultCamera.position.y += size / 5.0;
      this.defaultCamera.position.z += size / 2.0;
      this.defaultCamera.lookAt(center);

    }

    this.setCamera(DEFAULT_CAMERA);

    this.controls.saveState();
    //object.name = rootName || 'glTF';
    this.scene.add(object);
    this.content = object;

    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.setClips(clips);

    for (var a of Object.keys(initState)) {
      if (this.state.hasOwnProperty(a)) {
        console.log('Setting view ',a,' to ',initState[a]);
        this.state[a] = initState[a];
      }
    }
    if ('defaultCamera' in initState) {
      this.defaultCamera.position.copy(initState.defaultCamera.position);
      this.defaultCamera.quaternion.copy(initState.defaultCamera.quaternion);
      this.controls.target.copy(initState.defaultCamera.target);
      if ('autoRotate' in initState.defaultCamera) {
        this.controls.autoRotate = initState.defaultCamera.autoRotate;
      }
    }

    this.updateLights();
    this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateDisplay();

    window.content = this.content;

    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    //this.printGraph(this.content);

  }

  printGraph (node) {

    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();

  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips ( clips ) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    clips.forEach((clip) => {
      if (clip.validate()) clip.optimize();
    });

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer( this.content );
  }

  playAllClips () {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera ( name ) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding () {
    const encoding = this.state.textureEncoding === 'sRGB'
      ? THREE.sRGBEncoding
      : THREE.LinearEncoding;
    traverseMaterials(this.content, (material) => {
      if (material.map) material.map.encoding = encoding;
      if (material.emissiveMap) material.emissiveMap.encoding = encoding;
      if (material.map || material.emissiveMap) material.needsUpdate = true;
    });
  }

  updateLights () {
    const state = this.state;
    const lights = this.lights;

    if (state.addLights && !lights.length) {
      this.addLights();
    } else if (!state.addLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMappingExposure = state.exposure;

    if (lights.length === 2) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }
  }

  addLights () {
    const state = this.state;

    if (this.options.preset === Preset.ASSET_GENERATOR) {
      const hemiLight = new THREE.HemisphereLight();
      hemiLight.name = 'hemi_light';
      this.scene.add(hemiLight);
      this.lights.push(hemiLight);
      return;
    }

    const light1  = new THREE.AmbientLight(state.ambientColor, state.ambientIntensity);
    light1.name = 'ambient_light';
    this.defaultCamera.add( light1 );

    const light2  = new THREE.DirectionalLight(state.directColor, state.directIntensity);
    light2.position.set(0.5, 0, 0.866); // ~60º
    light2.name = 'main_light';
    this.defaultCamera.add( light2 );

    this.lights.push(light1, light2);
  }

  removeLights () {

    this.lights.forEach((light) => light.parent.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment () {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

    this.getCubeMapTexture( environment ).then(( { envMap, cubeMap } ) => {

      if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
        this.scene.add(this.background);
      } else {
        this.scene.remove(this.background);
      }

      traverseMaterials(this.content, (material) => {
        if (material.isMeshStandardMaterial || material.isGLTFSpecularGlossinessMaterial) {
          material.envMap = envMap;
          material.needsUpdate = true;
        }
      });

      this.scene.background = this.state.background ? cubeMap : null;

    });

  }

  getCubeMapTexture (environment) {
    const {path, format} = environment;

    // no envmap
    if ( ! path ) return Promise.resolve({envMap: null, cubeMap: null});

    const cubeMapURLs = [
      path + 'posx' + format, path + 'negx' + format,
      path + 'posy' + format, path + 'negy' + format,
      path + 'posz' + format, path + 'negz' + format
    ];

    // hdr
    if ( format === '.hdr' ) {

      return new Promise((resolve) => {

        new THREE.HDRCubeTextureLoader().load( THREE.UnsignedByteType, cubeMapURLs, ( hdrCubeMap ) => {

          var pmremGenerator = new THREE.PMREMGenerator( hdrCubeMap );
          pmremGenerator.update( this.renderer );

          var pmremCubeUVPacker = new THREE.PMREMCubeUVPacker( pmremGenerator.cubeLods );
          pmremCubeUVPacker.update( this.renderer );

          resolve( {
            envMap: pmremCubeUVPacker.CubeUVRenderTarget.texture,
            cubeMap: hdrCubeMap
          } );

        } );

      });

    }

    // standard
    const envMap = new THREE.CubeTextureLoader().load(cubeMapURLs);
    envMap.format = THREE.RGBFormat;
    return Promise.resolve( { envMap, cubeMap: envMap } );

  }

  updateDisplay () {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    traverseMaterials(this.content, (material) => {
      material.wireframe = this.state.wireframe;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new THREE.GridHelper();
        this.axesHelper = new THREE.AxesHelper();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
      }
    }
  }

  updateBackground () {
    this.background.style({colors: [this.state.bgColor1, this.state.bgColor2]});
  }

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260, hideable: true});

    // Display controls.
    const dispFolder = gui.addFolder('Display');
    this.envBackgroundCtrl = dispFolder.add(this.state, 'background');
    this.envBackgroundCtrl.onChange(() => this.updateEnvironment());
    this.wireframeCtrl = dispFolder.add(this.state, 'wireframe');
    this.wireframeCtrl.onChange(() => this.updateDisplay());
    this.skeletonCtrl = dispFolder.add(this.state, 'skeleton');
    this.skeletonCtrl.onChange(() => this.updateDisplay());
    this.gridCtrl = dispFolder.add(this.state, 'grid');
    this.gridCtrl.onChange(() => this.updateDisplay());
    this.autoRotateCtrl = dispFolder.add(this.controls, 'autoRotate');
    this.screenSpacePanningCtrl = dispFolder.add(this.controls, 'screenSpacePanning');
    this.bgColor1Ctrl = dispFolder.addColor(this.state, 'bgColor1');
    this.bgColor2Ctrl = dispFolder.addColor(this.state, 'bgColor2');
    this.bgColor1Ctrl.onChange(() => this.updateBackground());
    this.bgColor2Ctrl.onChange(() => this.updateBackground());

    // Lighting controls.
    const lightFolder = gui.addFolder('Lighting');
    this.encodingCtrl = lightFolder.add(this.state, 'textureEncoding', ['sRGB', 'Linear']);
    this.encodingCtrl.onChange(() => this.updateTextureEncoding());
    this.gammaOutputCtrl = lightFolder.add(this.renderer, 'gammaOutput');
    this.gammaOutputCtrl.onChange(() => {
      traverseMaterials(this.content, (material) => {
        material.needsUpdate = true;
      });
    });
    this.envMapCtrl = lightFolder.add(this.state, 'environment', environments.map((env) => env.name));
    this.envMapCtrl.onChange(() => this.updateEnvironment());
    [
      lightFolder.add(this.state, 'exposure', 0, 2).listen(),
      lightFolder.add(this.state, 'addLights').listen(),
      lightFolder.add(this.state, 'ambientIntensity', 0, 2).listen(),
      lightFolder.addColor(this.state, 'ambientColor').listen(),
      lightFolder.add(this.state, 'directIntensity', 0, 4).listen(), // TODO(#116)
      lightFolder.addColor(this.state, 'directColor').listen()
    ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    this.playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
    this.playbackSpeedCtrl.onChange((speed) => {
      if (this.mixer) this.mixer.timeScale = speed;
    });
    this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

    // Morph target controls.
    this.morphFolder = gui.addFolder('Morph Targets');
    this.morphFolder.domElement.style.display = 'none';

    // Camera controls.
    this.cameraFolder = gui.addFolder('Cameras');
    this.cameraFolder.domElement.style.display = 'none';

    // Stats.
    const perfFolder = gui.addFolder('Performance');
    const perfLi = document.createElement('li');
    this.stats.dom.style.position = 'static';
    perfLi.appendChild(this.stats.dom);
    perfLi.classList.add('gui-stats');
    perfFolder.__ul.appendChild( perfLi );

    // Scene Information
    this.infoFolder = gui.addFolder('Scene Information');
    this.infoGUI = { folder: this.infoFolder, items: new Map() };

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();

  }

  updateGUI () {
    this.envBackgroundCtrl.updateDisplay();
    this.wireframeCtrl.updateDisplay();
    this.skeletonCtrl.updateDisplay();
    this.gridCtrl.updateDisplay();
    this.autoRotateCtrl.updateDisplay();
    this.encodingCtrl.updateDisplay();
    this.gammaOutputCtrl.updateDisplay();
    this.envMapCtrl.updateDisplay();
    this.playbackSpeedCtrl.updateDisplay();

    this.cameraFolder.domElement.style.display = 'none';

    this.morphCtrls.forEach((ctrl) => ctrl.remove());
    this.morphCtrls.length = 0;
    this.morphFolder.domElement.style.display = 'none';

    this.animCtrls.forEach((ctrl) => ctrl.remove());
    this.animCtrls.length = 0;
    this.animFolder.domElement.style.display = 'none';

    const cameraNames = [];
    const morphMeshes = [];
    this.content.traverse((node) => {
      if (node.isMesh && node.morphTargetInfluences) {
        morphMeshes.push(node);
      }
      if (node.isCamera) {
        node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
        cameraNames.push(node.name);
      }
    });

    if (cameraNames.length) {
      this.cameraFolder.domElement.style.display = '';
      if (this.cameraCtrl) this.cameraCtrl.remove();
      const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
      this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
      this.cameraCtrl.onChange((name) => this.setCamera(name));
    }

    if (morphMeshes.length) {
      this.morphFolder.domElement.style.display = '';
      morphMeshes.forEach((mesh) => {
        if (mesh.morphTargetInfluences.length) {
          const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
          this.morphCtrls.push(nameCtrl);
        }
        for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
          const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1, 0.01).listen();
          Object.keys(mesh.morphTargetDictionary).forEach((key) => {
            if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
          });
          this.morphCtrls.push(ctrl);
        }
      });
    }

    if (this.clips.length) {
      this.animFolder.domElement.style.display = '';
      const actionStates = this.state.actionStates;
      this.clips.forEach((clip, clipIndex) => {
        // Autoplay the first clip.
        let action;
        if (clipIndex === 0 || actionStates[clip.name]) {
          actionStates[clip.name] = true;
          action = this.mixer.clipAction(clip);
          action.play();
        } else {
          actionStates[clip.name] = false;
        }

        // Play other clips when enabled.
        const ctrl = this.animFolder.add(actionStates, clip.name).listen();
        ctrl.onChange((playAnimation) => {
          action = action || this.mixer.clipAction(clip);
          action.setEffectiveTimeScale(1);
          playAnimation ? action.play() : action.stop();
        });
        this.animCtrls.push(ctrl);
      });
    }
  }

  clear () {

    if ( !this.content ) return;

    this.scene.remove( this.content );
    this.state.actionStates = {};
  }

  getState () {
    var copy = Object.assign({}, this.state);
    // copy the default camera position if it is the default camera
    copy.defaultCamera = {
        position: this.activeCamera.position,
        quaternion: this.activeCamera.quaternion,
        target: this.controls.target,
        autoRotate: this.controls.autoRotate
    };
    return copy;
  }

  updateGUISceneInformation (info) {
    this.updateGUIInfoFolder(info, this.infoGUI );
    // dispose geometry
    this.content.traverse((node) => {

      if ( !node.isMesh ) return;

      node.geometry.dispose();

    } );

    // dispose textures
    traverseMaterials( this.content, (material) => {

      MAP_NAMES.forEach( (map) => {

        if (material[ map ]) material[ map ].dispose();

      } );

    } );

  }

  updateGUIInfoFolder (info, gui) {
    // compute the sets of GUI elements that should exist given the data in info
    var validControllerKeys = [];
    var validFolderKeys = [];
    const inArray = Array.isArray(info);
    for (var key of Object.keys(info)) {
      var value = info[key];
      if (typeof value === 'object'/* && !Array.isArray(value)*/) { // folder
        if (Object.keys(value).length > 0) {
          validFolderKeys.push(key);
        }
      }
      else { // controller
        if ( value !== undefined && value !== '' &&
             !(Array.isArray(value) && value.length == 0) ) {
          validControllerKeys.push(key);
        }
      }
    }
    // remove properties that are no longer there
    var toRemoveKeys = [];
    for (var [gkey, value] of gui.items.entries()) {
      var key = gkey.substring(1);
      if (value.hasOwnProperty('folder')) { // folder
        if (validFolderKeys.indexOf(key) == -1) {
          //value.folder.destroy();
          //toRemoveKeys.push(key);
          // TODO: removing folders does not appear to be working
          // instead, we recursively remove all controllers by using an empty info
          this.updateGUIInfoFolder({},value);
        }
      }
      else { // controller
        // always remove from now, don't know now to link it to new instance
        gui.folder.remove(value.controller);
        toRemoveKeys.push(key);
      }
    };
    for (var key of toRemoveKeys) {
      var gkey = '@' + key;
      gui.items.delete(gkey);
    }
    // then add or update GUIs
    for (var key of validControllerKeys) {
      var gkey = '@' + key;
      var value = info[key];
      //console.log('GUI for',key,' in ',info);
      var controller;
      if (Array.isArray(value)) {
        var conv = {};
        conv[key] = value.join('\n');
        controller = gui.folder.add(conv, key);
      }
      else if (inArray) {
        var conv = {};
        conv[value] = '';
        controller = gui.folder.add(conv, value);
      }
      else {
        controller = gui.folder.add(info, key);
      }
      gui.items.set(gkey, { controller: controller });
    }
    for (var key of validFolderKeys) {
      var gkey = '@' + key;
      var value = info[key];
      if (!gui.items.has(gkey)) { // new folder
        var folder = gui.folder.addFolder(key);
        if (key === 'format') {
          folder.open();
        }
        gui.items.set(gkey, { folder: folder, items : new Map() });
      }
      this.updateGUIInfoFolder(value, gui.items.get(gkey));
    }
  }
};

function traverseMaterials (object, callback) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach(callback);
  });
}
