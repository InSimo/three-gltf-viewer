/* global dat */

const THREE = window.THREE = require('three');
const Stats = require('./lib/stats.min.js');
const environments = require('./assets/environment/index');
const createVignetteBackground = require('three-vignette-background');
const SceneInformation = require('./SceneInformation');

require('./lib/draco/draco_decoder');
require('./lib/draco/DRACOLoader');
require('./lib/GLTFLoader');
require('./lib/OrbitControls');

const DEFAULT_CAMERA = '[default]';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

module.exports = class Viewer {

  constructor (el, options) {
    this.el = el;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;
    this.sceneInformation = null;

    this.state = {
      environment: environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,

      // Lights
      addLights: true,
      'direct ↔ ambient': 0.25,
      intensity: 1.0,
    };

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    // support for Three.js Inspector chrome extension https://github.com/jeromeetienne/threejs-inspector
    window.scene = this.scene;
    window.THREE = THREE;

    this.defaultCamera = new THREE.PerspectiveCamera( 60, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.defaultCamera.name = DEFAULT_CAMERA;
    this.activeCamera = this.defaultCamera;
    this.scene.add( this.defaultCamera );

    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    this.renderer.setClearColor( 0x000000, 0 );
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( el.clientWidth, el.clientHeight );

    this.controls = new THREE.OrbitControls( this.defaultCamera, this.renderer.domElement );
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;

    this.background = createVignetteBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: ['#ffffff', '#353535']
    });
    this.background.name = '[Vignette]';
    this.background.renderOrder = -100; // make sure the background is always rendered first

    this.el.appendChild(this.renderer.domElement);

    this.lightCtrl = null;
    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];

    this.addGUI();
    if (options.kiosk) this.gui.close();

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
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

  render (getImage = false) {
    this.renderer.render( this.scene, this.activeCamera );
    if (getImage) {
      return this.renderer.domElement.toDataURL();
    }
  }

  renderImage (w,h,cb) {
    // set the image size
    const clientHeight = w, clientWidth = h;
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
    this.renderer.domElement.toBlob( (data) => {
      // reset renderer settings
      this.renderer.setPixelRatio( window.devicePixelRatio );
      // reset size and background
      this.resize();
      this.updateEnvironment();
      this.render();
      cb(data);
     });
  }

  resize () {

    const {clientHeight, clientWidth} = this.el.parentElement;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.background.style({aspect: this.defaultCamera.aspect});
    this.renderer.setSize(clientWidth, clientHeight);

  }

  load ( gltfContent, rootName, containerFile, url, rootPath, assetMap, initState = {} ) {

    return new Promise((resolve, reject) => {

      const loadedURLs = new Map();

      const manager = new THREE.LoadingManager((url) => {
        loadedURLs.set(url, { status: 'Started' });
      }, (url) => {
        loadedURLs[url].status = 'OK';
      }, (url) => {
        loadedURLs[url].status = 'Error';
      });

      const loader = new THREE.GLTFLoader();
      loader.setDRACOLoader( new THREE.DRACOLoader( undefined, {type: 'js'} ) );
      loader.setCrossOrigin('anonymous');
      const blobURLs = [];

      // Hack to intercept relative URLs.
      window.gltfPathTransform = (url, path) => {

        const normalizedURL = rootPath + url.replace(/^(\.?\/)/, '');
        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      };

      loader.load(url, (gltf) => {

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];
        const contentBinary = gltf.binaryBlob;
        this.setSceneInformation(rootName, containerFile, url, rootPath, assetMap, gltf, loader, loadedURLs);
        this.setContent(gltfContent, scene, clips, gltf.json, contentBinary, assetMap, initState);

        blobURLs.forEach(URL.revokeObjectURL);

        resolve();

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   * @param {Blob} contentBinary
   */
  setContent (gltfContent, object, clips, contentGLTF, contentBinary, assetMap, initState = {} ) {

    this.clear();

    object.updateMatrixWorld();
    var box = new THREE.Box3().setFromObject(object);
    const size = box.getSize().length();
    var center = box.getCenter();

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.position.copy(center);
    this.defaultCamera.position.x += size / 2.0;
    this.defaultCamera.position.y += size / 5.0;
    this.defaultCamera.position.z += size / 2.0;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();
    this.defaultCamera.lookAt(center);

    this.setCamera(DEFAULT_CAMERA);

    this.controls.saveState();
    object.name = 'glTF';
    this.scene.add(object);
    this.content = object;
    this.contentGLTF = contentGLTF;
    this.contentBinary = contentBinary;
    this.contentFiles = assetMap;

    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.setClips(clips);

    console.log(initState);
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
    this.updateDisplay();
    this.updateGUISceneInformation();

    window.content = this.content;

    gltfContent.setGLTF(this.contentGLTF);
    gltfContent.setBinary(this.contentBinary);
    gltfContent.setFiles(this.contentFiles);
    gltfContent.setInfo(this.sceneInformation);

    console.info('[glTF Viewer] THREE.Scene exported as `window.content`, GLTF as `gltfContent.gltf`, metadata as `gltfContent.info`.');
    if (gltfContent.binary) {
      console.log('binary blob version as `gltfContent.binary`');
    }
    if (gltfContent.files) {
      console.log('binary files version as `gltfContent.files`');
    }
    this.printGraph(this.content);
    console.log(this.sceneInformation);

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

  updateLights () {
    const lights = this.lights;

    if (this.state.addLights && !lights.length) {
      this.addLights();
    } else if (!this.state.addLights && lights.length) {
      this.removeLights();
    }

    if (lights.length) {
      const ratio = this.state['direct ↔ ambient'];
      const intensity = this.state.intensity;
      lights[0].intensity = lights[0].userData.baseIntensity * intensity * ratio;
      lights[1].intensity = lights[1].userData.baseIntensity * intensity * (1 - ratio);
      lights[2].intensity = lights[2].userData.baseIntensity * intensity * (1 - ratio);
      lights[3].intensity = lights[3].userData.baseIntensity * intensity * (1 - ratio);
    }
  }

  addLights () {
    const ratio = this.state['direct ↔ ambient'];

    const light1  = new THREE.AmbientLight(0x808080, 1.0);
    light1.userData.baseIntensity = light1.intensity;
    light1.intensity *= ratio;
    light1.name = 'ambient_light';
    this.scene.add( light1 );

    const light2  = new THREE.DirectionalLight(0xFFFFFF, 0.375);
    light2.userData.baseIntensity = light2.intensity;
    light2.intensity *= (1 - ratio);
    light2.position.set(3, 1, -2.6);
    light2.name = 'back_light';
    this.scene.add( light2 );

    const light3  = new THREE.DirectionalLight(0xFFFFFF, 0.625);
    light3.userData.baseIntensity = light3.intensity;
    light3.intensity *= (1 - ratio);
    light3.position.set(0, -1, 2);
    light3.name   = 'key_light';
    this.scene.add( light3 );

    const light4  = new THREE.DirectionalLight(0xFFFFFF, 1.25);
    light4.userData.baseIntensity = light4.intensity;
    light4.intensity *= (1 - ratio);
    light4.position.set(2, 3, 3);
    light4.name = 'fill_light';
    this.scene.add( light4 );

    this.lights.push(light1, light2, light3, light4);

  }

  removeLights () {

    this.lights.forEach((light) => this.scene.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment () {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];
    const {path, format} = environment;

    let envMap = null;
    if (path) {
        envMap = new THREE.CubeTextureLoader().load([
          path + 'posx' + format, path + 'negx' + format,
          path + 'posy' + format, path + 'negy' + format,
          path + 'posz' + format, path + 'negz' + format
        ]);
        envMap.format = THREE.RGBFormat;
    }

    if ((!this.state.background) && this.activeCamera === this.defaultCamera) {
      this.scene.add(this.background);
    } else {
      this.scene.remove(this.background);
    }

    this.content.traverse((node) => {
      if (node.material && 'envMap' in node.material) {
        node.material.envMap = envMap;
        node.material.needsUpdate = true;
      }
    });

    this.scene.background = this.state.background ? envMap : null;

  }

  updateDisplay () {
    this.content.traverse((node) => {
      if (node.isMesh) {
        node.material.wireframe = this.state.wireframe;
      }
    });
  }

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260});

    // Display controls.
    const dispFolder = gui.addFolder('Display');
    this.envMapCtrl = dispFolder.add(this.state, 'environment', environments.map((env) => env.name));
    this.envMapCtrl.onChange(() => this.updateEnvironment());
    this.envBackgroundCtrl = dispFolder.add(this.state, 'background');
    this.envBackgroundCtrl.onChange(() => this.updateEnvironment());
    const wireframeCtrl = dispFolder.add(this.state, 'wireframe').listen();
    wireframeCtrl.onChange(() => this.updateDisplay());
    dispFolder.add(this.controls, 'autoRotate').listen();

    // Lighting controls.
    const lightFolder = gui.addFolder('Lights');
    this.lightCtrl = lightFolder.add(this.state, 'addLights').listen();
    this.lightCtrl.onChange(() => this.updateLights());
    const intensityCtrl = lightFolder.add(this.state,'intensity', 0, 2).listen();
    intensityCtrl.onChange(() => this.updateLights());
    const directAmbientRatio = lightFolder.add(this.state,'direct ↔ ambient', 0, 1).listen();
    directAmbientRatio.onChange(() => this.updateLights());

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1).listen();
    playbackSpeedCtrl.onChange((speed) => {
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
    this.envMapCtrl.updateDisplay();
    this.envBackgroundCtrl.updateDisplay();
    this.lightCtrl.updateDisplay();

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
          const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1).listen();
          this.morphCtrls.push(ctrl);
        }
      });
    }

    if (this.clips.length) {
      this.animFolder.domElement.style.display = '';
      const actionStates = this.state.actionStates = {};
      this.clips.forEach((clip, clipIndex) => {
        // Autoplay the first clip.
        let action;
        if (clipIndex === 0) {
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
          playAnimation ? action.play() : action.halt();
        });
        this.animCtrls.push(ctrl);
      });
    }
  }

  clear () {

    this.scene.remove( this.content );
  }

  getState() {
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

  setSceneInformation( rootName, containerFile, url, rootPath, assetMap, gltf, loader, externalURLs) {
    const parser = loader.parser;
    const json = gltf.json;
    var info = this.sceneInformation = new SceneInformation();
    info.name = rootName;
    var fullfilename;
    if (!fullfilename && containerFile !== undefined) {
      if (typeof containerFile === 'string') {
        fullfilename = containerFile;
      }
      else if (containerFile.name) {
        fullfilename = containerFile.name;
      }
    }
    if (!fullfilename && url !== undefined) {
      if (typeof url === 'string') {
        fullfilename = url;
      }
      else if (url.name) {
        fullfilename = url.name;
      }
    }
    if (!fullfilename) {
      info.filename = '';
    }
    else {
      info.filename = fullfilename.match(/([^\/\\]+)$/)[1];
    }

    info.format.name = 'glTF';
    info.format.version = json.asset.version;
    info.format.extensions = json.extensionsUsed || [];

	const EXTMAP = {
	  'gltf': 'model/gltf',
	  'glb': 'model/gltf.binary',
	  'zip': 'application/zip'
	};

    // reverse of EXTMAP
    const MIMEMAP = Object.entries(EXTMAP).reduce((r,x) => { r[x[1]] = x[0]; return r; }, {});

    if (gltf.binaryData) {
      info.container.size = gltf.binaryData.size || gltf.binaryData.byteLength;
      info.container.mimetype = 'model/gltf.binary';
      info.container.extension = 'glb';
      info.format.extensions.push('KHR_binary_glTF');
    }

    if (containerFile !== undefined)
    {
      if (typeof containerFile === 'string') {
        info.container.extension = fullfilename.toLowerCase().match(/.([^.\/\\]+)$/)[1] || info.container.extension;
        if (info.container.extension in EXTMAP) {
          info.container.mimetype = EXTMAP[info.container.extension];
        }
        //info.internalFiles.push(containerFile);
      }
      else { // assuming it's a file
        info.container.mimetype = containerFile.type || info.container.mimetype;
        info.container.size = containerFile.size || info.container.size;
        if (info.container.mimetype in MIMEMAP) {
          info.container.extension = MIMEMAP[info.container.mimetype];
        }
        //info.internalFiles.push(containerFile.name || rootName);
      }
    }

    var totalAssetSize = 0;
    if (assetMap !== undefined) {
      for(const [k,v] of assetMap.entries()) {
        info.internalFiles[k] = v.size || 0;
        totalAssetSize += v.size || 0;
      }
    }

    if (externalURLs !== undefined) {
      for(const [k,v] of externalURLs.entries()) {
        info.externalURLs[k] = k.status || '';
      }
    }

    if (totalAssetSize > 0) {
      info.size = totalAssetSize;
    }
    else if (info.container.size > 0) {
      info.size = info.container.size;
    }

    return info;
  }

  updateGUISceneInformation () {
    this.updateGUIInfoFolder(this.sceneInformation, this.infoGUI );
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
