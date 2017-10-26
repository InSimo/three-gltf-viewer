const Detector = require('./lib/Detector');
const Viewer = require('./Viewer');
const DropController = require('./DropController');
const queryString = require('query-string');
const JSZip = require('jszip');
const FileSaver = require('file-saver');
const renderjson = require('renderjson');
const GLTFBindig = require('./GLTFBinding');
const ToolGLTFValidator = require('./ToolGLTFValidator');
const ToolGLTF2GLB = require('./ToolGLTF2GLB');
const ToolDracoCompressor = require('./ToolDracoCompressor');

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error('The File APIs are not fully supported in this browser.');
} else if (!Detector.webgl) {
  console.error('WebGL is not supported in this browser.');
}

var ToolsAvailable = [
  new ToolGLTFValidator(),
  new ToolGLTF2GLB(),
  new ToolDracoCompressor()
];

document.addEventListener('DOMContentLoaded', () => {

  const hash = location.hash ? queryString.parse(location.hash) : {};
  if (!hash.model && location.search) hash.model = location.search.substr(1);
  if (!hash.model && location.pathname.substring(0,2) == '/v' ) {
    hash.model = location.pathname.substring(0,40) + '/model.glb';
    console.log(hash.model);
  }
  if (!hash.json && location.pathname.substring(40,41) == '.' ) {
    hash.json = location.pathname.substring(0,40) + '/' + location.pathname.substring(41) + '.json';
    console.log(hash.json);
  }

  let viewer;
  let viewerEl;
  let rootName = '';

  let gltfContent = new GLTFBindig();
  
  // make sure only one menu is visible at any given time
  // we can't use radio buttons because we do need to be able to have none
  // and we want the main menu buttons to behave like a toggle
  let menuCheckBoxes = document.querySelectorAll('.menu-checkbox');
  for (let cb of menuCheckBoxes) {
    cb.addEventListener( 'change', function() {
    if(this.checked) {
      for (let cb2 of menuCheckBoxes) {
        if (cb2 !== this && cb2.checked) {
          cb2.checked = false;
        }
      }
    }
    });
  }

  const updateButtons = ( params = {} ) => {
    if (window.content) {
      closeBtnEl.style.display = null;
    }
    if (gltfContent.binary) {
      downloadBtnEl.style.display = (!params.hasOwnProperty('canSave') || params.canSave) ? null : 'none';
      shareBtnEl.style.display = (!params.hasOwnProperty('canShare') || params.canShare) ? null : 'none';
    }
    else {
      downloadBtnEl.style.display = 'none';
      shareBtnEl.style.display = 'none';
    }
  };

  const spinnerEl = document.querySelector('.spinner');
  spinnerEl.style.display = 'none';

  const downloadBtnEl = document.querySelector('#download-btn');
  downloadBtnEl.addEventListener('click', function () {
    if (gltfContent.binary) {
      FileSaver.saveAs(gltfContent.binary, (rootName||'output')+'.glb');
    }
  });
  const closeBtnEl = document.querySelector('#close-btn');
  closeBtnEl.addEventListener('click', function () {
    if (!viewer) return;
    viewer.clear();
    rootName = '';
    document.title = 'glTF Viewer';
    // show dropzone UI elements
    [].forEach.call(dropEl.children, (child) => {
      if (child.classList.contains('noscene')) child.style.opacity = null;
    });
    // hide viewer
    viewerEl.style.display = 'none';
    // hide scene UI
    closeBtnEl.style.display = 'none';
    downloadBtnEl.style.display = 'none';
    shareBtnEl.style.display = 'none';
  });
  const shareBtnEl = document.querySelector('#share-btn');
  shareBtnEl.addEventListener('click', function () {
  viewer.renderImage(512,512,function(imageBlob) {
    var formData = new FormData();
    var glbBlob = gltfContent.binary;
    var viewState = viewer.getState();
    //viewState.name = rootName;
    var viewBlob = new Blob([JSON.stringify(viewState)], {type: 'application/json'});
    console.log(rootName);
    formData.append('name', rootName);
    formData.append('glb', glbBlob);
    formData.append('image', imageBlob);
    formData.append('view', viewBlob);
    fetch('/upload', { method: 'POST', body : formData, redirect: 'manual'})
          .then(res=>{
              console.log(res);
              if (!res.ok) {
                  throw new Error('Upload failed');
              }
              return res.text()
          }).then(data=>{
              console.log(data);
              window.location.href = data;
          });
    });
  });

  const panelTitleEl = document.querySelector('#panel-title');
  const panelContentEl = document.querySelector('#panel-content');
  const panelCheckBox = document.querySelector('#panel-input');

  const toolsMenuEl = document.querySelector('#tools-menu');
  const toolsMenuElChild0 = toolsMenuEl.children[0];

  for(let i = 0; i < ToolsAvailable.length; ++i) {
    let tool = ToolsAvailable[i];
    let button = document.createElement("button");
    button.setAttribute('class','item');
    button.innerHTML = '<span class="icon">'+tool.icon+'</span>&nbsp;&nbsp;'+tool.name+'</button>';
    toolsMenuEl.insertBefore(button,toolsMenuElChild0);
    button.addEventListener('click', function(e) {
      spinnerEl.style.display = '';
      panelTitleEl.innerHTML = tool.title || tool.name;
      panelContentEl.innerHTML = 'Processing...';
      panelContentEl.classList.remove('status-wip','status-ok','status-error');
      panelContentEl.classList.add('status-wip');
      try {
        var p = tool.run( gltfContent );
        if (p) {
          panelCheckBox.checked = true;
          p.then(function(res) {
            console.log(res);
            spinnerEl.style.display = 'none';
            panelContentEl.classList.remove('status-wip');
            panelContentEl.classList.add((res.error || res.errors) ? 'status-error' : 'status-ok');
            if (typeof res === 'string') {
              panelContentEl.innerHTML = res;
            }
            else {
              //panelContentEl.innerHTML = JSON.stringify(res, null, 2);
              panelContentEl.innerHTML = ''; // clear the panel content
              var resEl = renderjson.set_show_to_level(2)(res);
              panelContentEl.appendChild(resEl);
            }
          })
            .catch(function (err) {
              console.error(err);
              spinnerEl.style.display = 'none';
              panelContentEl.classList.remove('status-wip');
              panelContentEl.classList.add('status-error');
              panelContentEl.innerHTML = err;
            });
        }
        else {
          panelContentEl.classList.remove('status-wip');
          panelContentEl.classList.add('status-ok');
          panelContentEl.innerHTML = '';
        }
      }
      catch (err) {
        console.error(err);
        spinnerEl.style.display = 'none';
          panelCheckBox.checked = true;
        panelContentEl.classList.remove('status-wip');
        panelContentEl.classList.add('status-error');
        panelContentEl.innerHTML = err;
      }
      updateButtons();
    });
  }

  const dropEl = document.querySelector('.dropzone');
  const dropCtrl = new DropController(dropEl);

  dropCtrl.on('drop', ({containerFile, rootFile, rootPath, fileMap}) => view(containerFile, rootFile, rootPath, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  function view (containerFile, rootFile, rootPath, fileMap, params = {}) {
    console.log(containerFile);
    console.log(rootFile);
    console.log(rootPath);
    console.log(fileMap);
    console.log(params);
    // hide dropzone UI elements (but don't remove them, so Open menu button still works)
    [].forEach.call(dropEl.children, (child) => {
      if (child.classList.contains('noscene')) child.style.opacity = 0;
    });
    if (!viewer) {
      viewerEl = document.createElement('div');
      viewerEl.classList.add('viewer');
      dropEl.appendChild(viewerEl);
      viewer = new Viewer(viewerEl, {kiosk: !!hash.kiosk});
    } else {
      viewer.clear();
      // show viewer
      viewerEl.style.display = null;
    }

    const fileURL = typeof rootFile === 'string'
      ? rootFile
      : URL.createObjectURL(rootFile);

    rootName = '';
    if (!rootName && params.hasOwnProperty('name')) {
      rootName = params.name;
    }
    if (!rootName && typeof containerFile === 'string') {
      rootName = containerFile.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
    }
    if (!rootName && typeof rootFile === 'string') {
      rootName = rootFile.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
    }
    if (fileMap.size) {
      if (!rootName && containerFile) {
        rootName = containerFile.name.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
      }
      if (!rootName && rootFile) {
        rootName = rootFile.name.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
      }
    }

    const postLoad = () => {
      document.title = rootName == '' ? 'glTF Viewer' : rootName + ' - glTF';
      updateButtons(params);
    };

    const cleanup = () => {
      spinnerEl.style.display = 'none';
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }
    };

    spinnerEl.style.display = '';
    viewer.load(gltfContent, rootName, containerFile || rootFile, fileURL, rootPath, fileMap, params.view || {})
      .then(postLoad)
      .then(cleanup)
      .catch((error) => {
        if (error && error.target && error.target instanceof Image) {
          error = 'Missing texture: ' + error.target.src.split('/').pop();
        }
        window.alert((error||{}).message || error);
        console.error(error);
        cleanup();
      });
  }

  if (hash.kiosk) {
    const headerEl = document.querySelector('header');
    headerEl.style.display = 'none';
  }
  if (hash.json) {
    fetch(hash.json)
    .then(res=>{
      if (res.ok) {
        return res.json();
      } else {
        console.log('Fetch json',hash.json,' failed');
        return new Promise.resolve({});
      }
    }).then(data=>{
      view(hash.model, hash.model, '', new Map(), data);
    });
  } else if (hash.model) {
    view(hash.model, hash.model, '', new Map());
  }

});
