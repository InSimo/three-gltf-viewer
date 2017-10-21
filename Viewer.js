/* global dat */

const THREE = window.THREE = require('three');
const Stats = require('./lib/stats.min.js');
const environments = require('./assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

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

    this.state = {
      environment: environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      addLights: true,
      directColor: 0xffeedd,
      directIntensity: 1,
      ambientColor: 0x222222,
      ambientIntensity: 1,
      camera: DEFAULT_CAMERA,
      wireframe: false
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

  load ( url, rootPath, assetMap, initState = {} ) {

    return new Promise((resolve, reject) => {

      const loader = new THREE.GLTFLoader();
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
        const contentBinary = gltf.binaryData;
        this.setContent(scene, clips, contentBinary, initState);

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
  setContent ( object, clips, contentBinary, initState = {} ) {

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
    this.contentBinary = contentBinary;

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

    window.content = this.content;
    window.contentBinary = this.contentBinary;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`, binary blob version as `window.contentBinary`.');

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

  /**
   * @param {string} name
   */
  setCamera ( name ) {
    this.scene.remove( this.activeCamera );
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
    this.scene.add( this.activeCamera );
  }

  updateLights () {
    if (this.state.addLights && !this.lights.length) {
      this.addLights();
    } else if (!this.state.addLights && this.lights.length) {
      this.removeLights();
    }
  }

  addLights () {

    const light1 = new THREE.DirectionalLight( this.state.directColor );
    light1.name = '[Default light1]';
    light1.position.set( 0, 0, 1 );
    this.scene.add(light1);

    const light2 = new THREE.DirectionalLight( this.state.directColor );
    light2.name = '[Default light2]';
    light2.position.set( 0, 5, -5 );
    this.scene.add(light2);

    const light3 = new THREE.AmbientLight( this.state.ambientColor );
    light3.name = '[Default light3]';
    this.scene.add( light3 );

    this.lights.push(light1, light2, light3);

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
    const directColor = lightFolder.addColor(this.state, 'directColor').listen();
    directColor.onChange((hex) => {
      this.lights[0].color.setHex(hex);
      this.lights[1].color.setHex(hex);
    });
    const directIntensity = lightFolder.add(this.state, 'directIntensity', 0, 1).listen();
    directIntensity.onChange((intensity) => {
      this.lights[0].intensity = intensity;
      this.lights[1].intensity = intensity;
    });
    const ambientColor = lightFolder.addColor(this.state, 'ambientColor').listen();
    ambientColor.onChange((hex) => {
      this.lights[2].color.setHex(hex);
    });
    const ambientIntensity = lightFolder.add(this.state, 'ambientIntensity', 0, 1).listen();
    ambientIntensity.onChange((intensity) => {
      this.lights[2].intensity = intensity;
    });

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1).listen();
    playbackSpeedCtrl.onChange((speed) => {
      if (this.mixer) this.mixer.timeScale = speed;
    });

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
      const actionStates = {};
      this.clips.forEach((clip) => {
        actionStates[clip.name] = false;
        const ctrl = this.animFolder.add(actionStates, clip.name);
        let action;
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

};
