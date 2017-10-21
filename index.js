const Detector = require('./lib/Detector');
const Viewer = require('./Viewer');
const DropController = require('./DropController');
const queryString = require('query-string');
const JSZip = require('jszip');
const FileSaver = require('file-saver');

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error('The File APIs are not fully supported in this browser.');
} else if (!Detector.webgl) {
  console.error('WebGL is not supported in this browser.');
}

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

  let files;
  let rootName = '';

  const spinnerEl = document.querySelector('.spinner');
  spinnerEl.style.display = 'none';

  const downloadBtnEl = document.querySelector('#download-btn');
  downloadBtnEl.addEventListener('click', function () {
    if (window.contentBinary) {
        FileSaver.saveAs(new Blob([new Uint8Array(window.contentBinary)], {type: 'model/gltf.binary'}), `output.glb`);
    }
  });
  const shareBtnEl = document.querySelector('#share-btn');
  shareBtnEl.addEventListener('click', function () {
  viewer.renderImage(512,512,function(imageBlob) {
    var formData = new FormData();
    var glbBlob = new Blob([new Uint8Array(window.contentBinary)], {type: 'model/gltf.binary'});
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
  const dropEl = document.querySelector('.dropzone');
  const dropCtrl = new DropController(dropEl);

  dropCtrl.on('drop', ({rootFile, rootPath, fileMap}) => view(rootFile, rootPath, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  function view (rootFile, rootPath, fileMap, params = {}) {
    console.log(rootFile);
    console.log(rootPath);
    console.log(fileMap);
    console.log(params);
    if (!viewer) {
      viewerEl = document.createElement('div');
      viewerEl.classList.add('viewer');
      dropEl.innerHTML = '';
      dropEl.appendChild(viewerEl);
      viewer = new Viewer(viewerEl, {kiosk: !!hash.kiosk});
    } else {
      viewer.clear();
    }

    const fileURL = typeof rootFile === 'string'
      ? rootFile
      : URL.createObjectURL(rootFile);

    const postLoad = () => {
      rootName = '';
      if (params.hasOwnProperty('name')) {
        rootName = params.name;
      }
      else if (typeof rootFile === 'string') {
        rootName = rootFile.match(/([^\/]+)\.(gltf|glb)$/)[1];
      }
      else if (typeof rootFile === 'string') {
        rootName = rootFile.match(/([^\/]+)\.(gltf|glb)$/)[1];
      }
      else if (fileMap.size) {
        files = fileMap;
        rootName = rootFile.name.match(/([^\/]+)\.(gltf|glb)$/)[1];
      }
      document.title = rootName == '' ? 'glTF Viewer' : rootName + ' - glTF';
      if (window.contentBinary) {
        downloadBtnEl.style.display = (!params.hasOwnProperty('canSave') || params.canSave) ? null : 'none';
        shareBtnEl.style.display = (!params.hasOwnProperty('canShare') || params.canShare) ? null : 'none';
      }
      else {
        console.warn('NOT BINARY');
      }
    };

    const cleanup = () => {
      spinnerEl.style.display = 'none';
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }
    };

    spinnerEl.style.display = '';
    viewer.load(fileURL, rootPath, fileMap, params.view || {})
    .then(postLoad)
    .then(cleanup)
    .catch((error) => {
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
      view(hash.model, '', new Map(), data);
    });
  } else if (hash.model) {
    view(hash.model, '', new Map());
  }

});
