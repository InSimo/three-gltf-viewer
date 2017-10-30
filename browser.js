const Detector = require('./lib/Detector');
const Viewer = require('./Viewer');
const DropController = require('./DropController');
const ToolManager = require('./lib/ToolManager');
const queryString = require('query-string');
//const JSZip = require('jszip');
const FileSaver = require('file-saver');
const renderjson = require('renderjson');
const GLTFBinding = require('./GLTFBinding');

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error('The File APIs are not fully supported in this browser.');
} else if (!Detector.webgl) {
  console.error('WebGL is not supported in this browser.');
}

var gltfContent = window.gltfContent = new GLTFBinding();
var toolManager = window.toolManager = new ToolManager(gltfContent);

function humanFileSize(size) {
  var i = ( size <= 0 ) ? 0 : Math.min( 4, Math.floor( Math.log(size) / Math.log(1000) ) );
  return ( size / Math.pow(1000, i) ).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
};

document.addEventListener('DOMContentLoaded', () => {

  const hash = location.hash ? queryString.parse(location.hash) : {};
  if (window.loadIndex && window.loadIndex.model) {
    hash.model = window.loadIndex.model;
  }
  if (!hash.model && location.search) hash.model = location.search.substr(1);

  let viewer;
  let viewerEl;
  let rootName = '';

  function scheduleResize() {
    if (viewer) {
      setTimeout(viewer.resize.bind(viewer), 0);
    }
  }

  // make sure only one menu is visible at any given time
  // we can't use radio buttons because we do need to be able to have none
  // and we want the main menu buttons to behave like a toggle
  let menuCheckBoxes = document.querySelectorAll('.menu-checkbox');
  let menuLabels = document.querySelectorAll('.menu-label');
  for (let cb of menuCheckBoxes) {
    cb.addEventListener( 'change', function() {
      if(this.checked) {
        for (let cb2 of menuCheckBoxes) {
          if (cb2 !== this && cb2.checked) {
            cb2.checked = false;
          }
        }
      }
      for (let lb of menuLabels) {
        if (lb.htmlFor == this.id) {
          if (this.checked) {
            lb.classList.add('checked');
          }
          else {
            lb.classList.remove('checked');
          }
        }
        else if (this.checked && lb.classList.contains('checked')) {
          lb.classList.remove('checked');
        }
      }
      scheduleResize();
    });
  }
  let kioskCheckBox = document.querySelector('.kiosk-checkbox');
  kioskCheckBox.addEventListener( 'change', scheduleResize );

  const updateButtons = ( params = {} ) => {
    if (window.content) {
      closeBtnEl.style.display = null;
    }
    if (gltfContent.binary) {
      downloadBtnEl.style.display = (!params.hasOwnProperty('canSave') || params.canSave) ? null : 'none';
      if (IS_UPLOAD_SUPPORTED && (!params.hasOwnProperty('canShare') || params.canShare)) {
        shareBtnEl.style.display = null;
        var text = '';
        if (window.gltfContent.binary.size > 0) {
          text = '(' + humanFileSize(window.gltfContent.binary.size) + ')';
        }
        shareBtnEl.lastElementChild.innerHTML = text;
      }
      else {
        shareBtnEl.style.display = 'none';
      }
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

  toolManager.setupGUI();

  toolManager.on('toolstart', () => {
    spinnerEl.style.display = null;
  });

  toolManager.on('toolerror', () => {
    spinnerEl.style.display = 'none';
  });

  toolManager.on('tooldone', () => {
    spinnerEl.style.display = 'none';
    updateButtons();
  });

  const dropEl = document.querySelector('.dropzone');
  const dropCtrl = new DropController(dropEl);

  dropCtrl.on('drop', ({containerFile, rootFile, rootPath, fileMap}) => view(containerFile, rootFile, rootPath, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  const previewEl = document.querySelector('.preview');

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
      if (previewEl) // hide preview
        previewEl.style.display = 'none';
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
    const headerEls = document.querySelectorAll('header');
    for (let headerEl of headerEls) {
      headerEl.style.display = 'none';
    }
  }
  if (hash.model) {
    view(hash.model, hash.model, '', new Map(), window.loadIndex || {});
  }

});
