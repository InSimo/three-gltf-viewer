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

  let viewer;
  let viewerEl;

  let files;
  let rootName;

  const spinnerEl = document.querySelector('.spinner');
  spinnerEl.style.display = 'none';

  const downloadBtnEl = document.querySelector('#download-btn');
  downloadBtnEl.addEventListener('click', function () {
    if (window.contentBinary) {
        FileSaver.saveAs(new Blob([new Uint8Array(window.contentBinary)], {type: 'model/gltf.binary'}), `output.glb`);
    }
  });
  const uploadBtnEl = document.querySelector('#upload-btn');
  uploadBtnEl.addEventListener('click', function () {
    var formData = new FormData();
    var blob = new Blob([new Uint8Array(window.contentBinary)], {type: 'model/gltf.binary'});
    formData.append('obj', blob);
    var request = new XMLHttpRequest();
    request.open('post', '/upload');
    request.send(formData);
  });
  const dropEl = document.querySelector('.dropzone');
  const dropCtrl = new DropController(dropEl);

  dropCtrl.on('drop', ({rootFile, rootPath, fileMap}) => view(rootFile, rootPath, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  function view (rootFile, rootPath, fileMap) { 
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
    
    const cleanup = () => {
      spinnerEl.style.display = 'none';
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }

      if (!window.contentBinary) {
        console.warn('NOT BINARY');
      }
      if (window.contentBinary) {
        if (fileMap.size) {
          files = fileMap;
          rootName = rootFile.name.match(/([^\/]+)\.(gltf|glb)$/)[1];
          document.title = rootName;
        }
        else if (typeof rootFile === 'string') {
          rootName = rootFile.match(/([^\/]+)\.(gltf|glb)$/)[1];
          document.title = rootName;
        }
        downloadBtnEl.style.display = null;
        uploadBtnEl.style.display = null;
      }
    };

    spinnerEl.style.display = '';
    viewer.load(fileURL, rootPath, fileMap)
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
  if (hash.model) {
    view(hash.model, '', new Map());
  }

});
