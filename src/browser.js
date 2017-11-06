const Detector = require('../lib/Detector');
const Viewer = require('./viewer');
const DropController = require('./drop-controller');
const GLTFContainer = require('../tools/GLTFContainer');
const BaseToolManager = require('../tools/BaseToolManager');
const queryString = require('query-string');
//const JSZip = require('jszip');
const FileSaver = require('file-saver');
const renderjson = require('renderjson');

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error('The File APIs are not fully supported in this browser.');
} else if (!Detector.webgl) {
  console.error('WebGL is not supported in this browser.');
}

const gltfContent = window.gltfContent = new GLTFContainer();
const toolManager = window.toolManager = new BaseToolManager(gltfContent);

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
  kioskCheckBox.addEventListener( 'change', function() {
    // also disable the panel if going to kiosk mode
    if(this.checked && panelCheckBox !== undefined) {
      panelCheckBox.checked = false;
    }
    scheduleResize();
  });

  function updateButtons ( params = {} ) {
    if (window.content) {
      closeBtnEl.style.display = null;
    }
    if (gltfContent.containerData) {
      downloadBtnEl.style.display = (!params.hasOwnProperty('canSave') || params.canSave) ? null : 'none';
      if (window.IS_UPLOAD_SUPPORTED !== undefined && IS_UPLOAD_SUPPORTED && (!params.hasOwnProperty('canShare') || params.canShare)) {
        shareBtnEl.style.display = null;
        var text = '';
        if (gltfContent.containerData.byteLength > 0) {
          text = '(' + humanFileSize(gltfContent.containerData.byteLength) + ')';
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
    if (gltfContent.containerData) {
      var glbBlob = new Blob([gltfContent.containerData], { type: gltfContent.info.container.mimetype || 'model/gltf-binary' });
      FileSaver.saveAs(glbBlob, (gltfContent.name||'output')+'.'+(gltfContent.info.container.fileextension||'glb'));
    }
  });
  const closeBtnEl = document.querySelector('#close-btn');
  closeBtnEl.addEventListener('click', function () {
    if (!viewer) return;
    viewer.clear();
    gltfContent.clear();
    if (panelCheckBox) {
      panelCheckBox.checked = false;
    }
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
  viewer.renderImage(1024,512,function(imageBlob) {
    var formData = new FormData();
    var glbBlob = new Blob([gltfContent.containerData], { type: gltfContent.info.container.mimetype || 'model/gltf-binary' });
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

  const toolsMenuElement = document.querySelector('#tools-menu');
  const panelTitleElement = document.querySelector('#panel-title');
  const panelContentElement = document.querySelector('#panel-content');
  const panelCheckBox = document.querySelector('#panel-input');
  toolManager.setupGUI(toolsMenuElement);

  function onToolStart ({tool, message}) {
    spinnerEl.style.display = null;
    if (panelTitleElement !== undefined) {
      panelTitleElement.innerHTML = tool.title || tool.name;
    }
    if (panelContentElement !== undefined) {
      panelContentElement.innerHTML = message || 'Processing...';
      panelContentElement.classList.remove('status-wip','status-ok','status-error');
      panelContentElement.classList.add('status-wip');
    }
  }

  function onToolDone ({tool, result}) {
    spinnerEl.style.display = 'none';
    if (panelCheckBox !== undefined && !kioskCheckBox.checked) {
      panelCheckBox.checked = true;
    }
    if (panelContentElement !== undefined) {
      panelContentElement.classList.remove('status-wip');
      panelContentElement.classList.add((result && (result.error || result.errors)) ? 'status-error' : 'status-ok');
      panelContentElement.innerHTML = ''; // clear the panel content
      if (result === undefined) {
      } else if (typeof result === 'string') {
        panelContentElement.appendChild(document.createTextNode(result));
      } else if (result instanceof Node) {
        panelContentElement.appendChild(result);
      } else { // assume JSON-like data
        //panelContentElement.innerHTML = JSON.stringify(result, null, 2);
        var resEl = renderjson.set_show_to_level(2)(result);
        panelContentElement.appendChild(resEl);
      }
    }
    viewer.updateGUISceneInformation(gltfContent.info);
    updateButtons();
  }

  function onToolError ({tool, error}) {
    spinnerEl.style.display = 'none';
    if (panelCheckBox !== undefined) {
      panelCheckBox.checked = true;
    }
    if (panelContentElement !== undefined) {
      panelContentElement.classList.remove('status-wip');
      panelContentElement.classList.add('status-error');
      panelContentElement.innerHTML = error;
    }
  }

  toolManager.on('toolstart', onToolStart);
  toolManager.on('tooldone', onToolDone);
  toolManager.on('toolerror', onToolError);

  const dropEl = document.querySelector('.dropzone');
  const dropCtrl = new DropController(dropEl);

  dropCtrl.on('drop', ({containerFile, rootFile, rootFilePath, fileMap}) => view(containerFile, rootFile, rootFilePath, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  const previewEl = document.querySelector('.preview');

  function view (containerFile, rootFile, rootFilePath, fileMap, params = {}) {
    console.log(containerFile);
    console.log(rootFile);
    console.log(rootFilePath);
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
    const fileOriginalURL = typeof containerFile === 'string' ? containerFile :
      containerFile instanceof File ? containerFile.name : '';
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

    onToolStart({tool:{title:rootName.replace(/_/g,' ')}, message:'Loading...'});

    const postLoad = () => {
      document.title = rootName == '' ? 'glTF Viewer' : rootName + ' - glTF';
      if (previewEl) // hide preview
        previewEl.style.display = 'none';
      return gltfContent.load(fileOriginalURL, rootName, rootFilePath, containerFile, fileMap)
        .then(() => gltfContent.getCredits())
        .then((result) => {
          onToolDone({tool:{title:rootName.replace(/_/,' ')}, result:result});
          //updateButtons(params);
          //viewer.updateGUISceneInformation(gltfContent.info)
        });
    };

    const cleanup = () => {
      spinnerEl.style.display = 'none';
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }
    };

    const rootPath = rootFilePath.lastIndexOf('/') == -1 ? '': rootFilePath.slice(0, rootFilePath.lastIndexOf('/'));

    spinnerEl.style.display = '';
    viewer.load(fileURL, rootPath, fileMap, params.view || {})
      .then(postLoad)
      .then(cleanup)
      .catch((error) => {
        if (error && error.target && error.target instanceof Image) {
          error = 'Missing texture: ' + error.target.src.split('/').pop();
        }
        window.alert((error||{}).message || error);
        console.error(error);
        onToolError({tool:{title:rootName}, error:((error||{}).message || error)});
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
