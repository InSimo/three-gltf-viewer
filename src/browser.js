const Detector = require('../lib/Detector');
const Viewer = require('./viewer');
const Loader = require('./loader');
const Exporter = require('./exporter');
const DropController = require('./drop-controller');
// Disabled as gltf-validator is integrated as part of the tools in this branch
//const ValidationController = require('./validation-controller');
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

  let loader;
  let exporter;

  function scheduleResize() {
    if (viewer) {
      setTimeout(viewer.resize.bind(viewer), 0);
    }
  }

  // Make sure only one menu is visible at any given time.
  // We can't use radio buttons because we do need to be able to have none
  // and we want the main menu buttons to behave like a toggle.
  // Compatibility note: Edge does not seem to support iterating directly on
  // the result of querySelectorAll, which is why Array.from was added.
  let menuCheckBoxes = Array.from(document.querySelectorAll('.menu-checkbox'));
  let menuLabels = Array.from(document.querySelectorAll('.menu-label'));
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
      if (gltfContent.info.container.mimetype == 'model/gltf-binary' && window.IS_UPLOAD_SUPPORTED &&
          (!params.hasOwnProperty('canShare') || params.canShare)) {
        shareBtnEl.style.display = null;
        if (shareSizeEl !== undefined) {
          var text = '';
          if (gltfContent.containerData.byteLength > 0) {
            text = '(' + humanFileSize(gltfContent.containerData.byteLength) + ')';
          }
          shareSizeEl.innerHTML = text;
        }
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
  const shareSizeEl = document.querySelector('#share-btn .size');
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
    if (imageBlob) {
      formData.append('image', imageBlob);
    }
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
  const toolsMenuElementChild0 = toolsMenuElement.children[0];
  const panelTitleElement = document.querySelector('#panel-title');
  const panelContentElement = document.querySelector('#panel-content');
  const panelCheckBox = document.querySelector('#panel-input');
  toolManager.setupGUI(function addToolButton(tool, nextTool) {
    var nextEl = (nextTool !== undefined) ? nextTool.buttonElement : toolsMenuElementChild0;
    let hasGUI = (tool.options !== undefined);
    var toolEl = document.createElement("div");
    toolEl.classList.add('item-tool');
    var button = document.createElement("button" );
    toolEl.appendChild(button);
    button.classList.add('item');
    button.classList.add('item-flex');
    button.innerHTML = '<span class="icon">'+tool.icon+'</span>'+
      '<span class="title">'+
      '<span class="name">'+tool.name+'</span>'+
      (tool.version ? '<span class="version">'+tool.version+'</span>' : '')+
      '</span>';
    if (hasGUI) {
      function toolCreateGUI(gui, options, optionsGUI) {
        for (let name of Object.keys(options)) {
          let controller = undefined;
          const params = optionsGUI.hasOwnProperty(name) ? optionsGUI[name] : 
            optionsGUI.hasOwnProperty('default') ? optionsGUI['default'] : {};
          if (params === false) continue; // no GUI for this option
          if (typeof options[name] === 'object') {
            let folder = gui.addFolder(name);
            toolCreateGUI(folder, options[name], params);
          }
          else {
            if (params.options !== undefined) {
              controller = gui.add(options, name, params.options);
            }
            else if (params.min !== undefined && params.max !== undefined) {
              if (params.step !== undefined) {
                controller = gui.add(options, name, params.min, params.max, params.step);
              }
              else {
                controller = gui.add(options, name, params.min, params.max);
              }
            }
            else {
              controller = gui.add(options, name);
              if (params.min) controller.min(params.min);
              if (params.max) controller.max(params.max);
              if (params.step) controller.step(params.step);
            }
            controller.listen();
          }
        }
      }
      let options = tool.options;
      let optionsGUI = tool.optionsGUI || {};
      const gui = new dat.GUI({autoPlace: false, width: 300});
      //let actions = { Run: () => toolManager.runTool(tool) };
      //gui.add(actions, "Run");
      toolCreateGUI(gui, options, optionsGUI);
      let optionsEl = document.createElement("div");
      //let optionsElWrap = document.createElement("div");
      optionsEl.classList.add('tools-gui');
      //optionsElWrap.classList.add('gui-wrap');
      optionsEl/*Wrap*/.appendChild(gui.domElement);
      //optionsEl.appendChild(optionsElWrap);
      toolEl.appendChild(optionsEl);
      gui.open();
    }
    button.addEventListener('click', (e) => toolManager.runTool(tool));
    toolsMenuElement.insertBefore(toolEl,nextEl);
    tool.buttonElement = toolEl;
  });

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
    console.log(result);
    if (result && panelCheckBox !== undefined && !kioskCheckBox.checked) {
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
  const placeholderEl = document.querySelector('.placeholder');
  const dropCtrl = new DropController(dropEl);

  // Show the list of supported extensions
  if (placeholderEl) {
    if (!loader) {
      loader = new Loader();
    }
    var extlist = Array.from(Object.keys(loader.loaders)).filter(x => !loader.loaders[x].gltf);
    if (extlist) {
      var text = "Experimental importing of files in ";
      text += extlist.join(', ');
      text += ' formats';
      p = document.createElement('p');
      p.appendChild(document.createTextNode(text));
      placeholderEl.appendChild(p);
    }
  }

  dropCtrl.on('drop', ({containerFile, fileMap}) => view(containerFile, fileMap));
  dropCtrl.on('dropstart', () => (spinnerEl.style.display = ''));
  dropCtrl.on('droperror', () => (spinnerEl.style.display = 'none'));

  // Disabled as gltf-validator is integrated as part of the tools in this branch
  //const validationCtrl = new ValidationController(document.body);

  const previewEl = document.querySelector('.preview');

  function view (containerFile, fileMap, params = {}) {
    if (!loader) {
      loader = new Loader();
    }
    const fileOriginalURL = typeof containerFile === 'string' ? containerFile :
      containerFile instanceof File ? containerFile.name : '';

    let rootFile;
    let rootFilePath;
    let rootFileExt;
    let rootFilePriority = -1;
    if (fileMap.size === 0) {
      rootFile = containerFile;
      rootFilePath = '';
      var name = fileOriginalURL;
      var extension = name.lastIndexOf('.') == -1 ? '' : name.slice(name.lastIndexOf('.')+1).toLowerCase();
      rootFileExt = extension;
    } else {
      //const RE_GLTF = /\.(gltf|glb)$/;
      fileMap.forEach((file, path) => {
        var name = file.name;
        var extension = name.lastIndexOf('.') == -1 ? '' : name.slice(name.lastIndexOf('.')+1).toLowerCase();
        if (extension in loader.loaders && loader.loaders[extension].priority > rootFilePriority) {
          rootFile = file;
          rootFilePath = path;
          rootFileExt = extension;
          rootFilePriority = loader.loaders[extension].priority;
        }
      });
    }

    if (!rootFile) {
      var error = 'No supported asset found.';
      console.error(error);
      onToolError({tool:{title:''}, error:error });
      return;
    }

    console.log(containerFile);
    console.log(rootFile);
    console.log(rootFilePath);
    console.log(rootFileExt);
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

    onToolStart({tool:{title:rootName.replace(/_/g,' ')}, message:'Loading...'});

    const postViewerLoad = (content) => {
      document.title = rootName == '' ? 'glTF Viewer' : rootName + ' - glTF';
      if (previewEl) // hide preview
        previewEl.style.display = 'none';
      if (content.gltf) {
        return gltfContent.load(fileOriginalURL, rootName, rootFilePath, containerFile, fileMap);
      }
      else {
        if (!exporter) {
          exporter = new Exporter();
        }
        return exporter.exportContent(content, 'glb')
          .then((data) => {
            return gltfContent.loadSingleFile(fileOriginalURL, rootName, data);
          });
      }
    };
    const postGLTFLoad = () => {
      onToolDone({tool:{title:rootName.replace(/_/,' ')}, result:gltfContent.getCredits()});
    };

    const cleanup = () => {
      spinnerEl.style.display = 'none';
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }
    };

    if (!hash.kiosk) {
      // Disabled as gltf-validator is integrated as part of the tools in this branch
      //validationCtrl.validate(fileURL, rootPath, fileMap);
    }

    const rootPath = rootFilePath.slice(0, rootFilePath.length - rootFilePath.split('/').pop().length); //rootFilePath.slice(0, rootFilePath.lastIndexOf('/'));

    spinnerEl.style.display = '';
    loader.load(fileURL, rootPath, fileMap, rootName, rootFileExt || 'gltf')
      .then((content) => {
        return viewer.loadContent(content, rootName, params.view || {});
      })
      .then(postViewerLoad)
      .then(postGLTFLoad)
      .then(cleanup)
      .catch((error) => {
        if (error && error.target && error.target instanceof Image) {
          error = 'Missing texture: ' + error.target.src.split('/').pop();
        }
        //window.alert((error||{}).message || error);
        console.error(error);
        onToolError({tool:{title:rootName}, error:((error||{}).message || error)});
        cleanup();
      });
  }

  if (hash.kiosk) {
    const headerEls = Array.from(document.querySelectorAll('header'));
    for (let headerEl of headerEls) {
      headerEl.style.display = 'none';
    }
  }
  if (hash.model) {
    view(hash.model, new Map(), window.loadIndex || {});
  }

});
