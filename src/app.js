const WEBGL = require('../lib/WebGL');
const Viewer = require('./viewer');
const Loader = require('./loader');
const Exporter = require('./exporter');
const SimpleDropzone = require('simple-dropzone');
// Disabled as gltf-validator is integrated as part of the tools in this branch
//const ValidationController = require('./validation-controller');
const queryString = require('query-string');
const GLTFContainer = require('../tools/GLTFContainer');
const BaseToolManager = require('../tools/BaseToolManager');
const FileSaver = require('file-saver');
const renderjson = require('renderjson');
const dat = require('dat.gui');

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
  console.error('The File APIs are not fully supported in this browser.');
} else if (!WEBGL.isWebGLAvailable()) {
  console.error('WebGL is not supported in this browser.');
}

class App {

  /**
   * @param  {Element} el
   * @param  {Location} location
   */
  constructor (el, location) {
    this.rootName = '';
    this.gltfContent = window.gltfContent = new GLTFContainer();
    this.toolManager = window.toolManager = new BaseToolManager(gltfContent);

    const hash = location.hash ? queryString.parse(location.hash) : {};
    if (window.loadIndex && window.loadIndex.model) {
      hash.model = window.loadIndex.model;
    }
    if (!hash.model && location.search) hash.model = location.search.substr(1);

    this.options = {
      kiosk: Boolean(hash.kiosk),
      model: hash.model || '',
      preset: hash.preset || '',
      cameraPosition: hash.cameraPosition
        ? hash.cameraPosition.split(',').map(Number)
        : null
    };

    this.el = el;
    this.viewer = null;
    this.viewerEl = null;
    this.spinnerEl = el.querySelector('.spinner');
    this.dropEl = el.querySelector('.dropzone');
    this.inputEl = el.querySelector('#file-input');
    //this.validationCtrl = new ValidationController(el);
    this.placeholderEl = el.querySelector('.placeholder');
    this.previewEl = el.querySelector('.preview');
    this.loader = null;
    this.exporter = null;

    this.createDropzone();
    this.hideSpinner();
    this.setupMenus();
    this.setupLoaders();

    const options = this.options;

    if (options.kiosk) {
      this.headerEl = document.querySelector('header');
      this.headerEl.style.display = 'none';
    }

    if (options.model) {
      this.load(options.model, new Map(), window.loadIndex || {});
    }
  }

  /**
   * Sets up the drag-and-drop controller.
   */
  createDropzone () {
    const dropCtrl = new SimpleDropzone(this.dropEl, this.inputEl);
    dropCtrl.on('drop', ({files, archive}) => this.load(archive, files));
    dropCtrl.on('dropstart', () => this.showSpinner());
    dropCtrl.on('droperror', () => this.hideSpinner());
  }

  /**
   * Hide the drag-and-drop controls (but don't remove them, so Open button still works)
   */
  hideDropzone () {
    [].forEach.call(this.dropEl.children, (child) => {
      if (child.classList.contains('noscene')) child.style.opacity = 0;
    });
  }

  /**
   * Show the drag-and-drop controls
   */
  showDropzone () {
    // show dropzone UI elements
    [].forEach.call(this.dropEl.children, (child) => {
      if (child.classList.contains('noscene')) child.style.opacity = null;
    });
  }

  /**
   * Sets up the view manager.
   * @return {Viewer}
   */
  createViewer () {
    this.viewerEl = document.createElement('div');
    this.viewerEl.classList.add('viewer');
    //this.dropEl.innerHTML = '';
    this.dropEl.appendChild(this.viewerEl);
    this.viewer = new Viewer(this.viewerEl, this.options);
    return this.viewer;
  }

  hideViewer () {
    // hide viewer
    this.viewerEl.style.display = 'none';
  }

  showViewer () {
    // show viewer
    this.viewerEl.style.display = null;
  }

  /**
   * Loads a fileset provided by user action.
   * @param  {File|string} containerFile
   * @param  {Map<string, File>} fileMap
   * @param  {} params
   */
  load (containerFile, fileMap, params = {}) {
    if (!this.loader) {
      this.loader = new Loader();
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
        if (extension in this.loader.loaders && this.loader.loaders[extension].priority > rootFilePriority) {
          rootFile = file;
          rootFilePath = path;
          rootFileExt = extension;
          rootFilePriority = this.loader.loaders[extension].priority;
        }
      });
    }

    if (!rootFile) {
      var error = 'No supported asset found.';
      console.error(error);
      this.onToolError({tool:{title:''}, error:error });
      return;
    }

    this.rootName = '';
    if (!this.rootName && params.hasOwnProperty('name')) {
      this.rootName = params.name;
    }
    if (!this.rootName && typeof containerFile === 'string') {
      this.rootName = containerFile.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
    }
    if (!this.rootName && typeof rootFile === 'string') {
      this.rootName = rootFile.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
    }
    if (fileMap.size) {
      if (!this.rootName && containerFile) {
        this.rootName = containerFile.name.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
      }
      if (!this.rootName && rootFile) {
        this.rootName = rootFile.name.match(/([^\/.]+)(\.[^\/]*)?$/)[1];
      }
    }

    console.log(containerFile);
    console.log(rootFile);
    console.log(rootFilePath);
    console.log(rootFileExt);
    console.log(fileMap);
    console.log(this.rootName);
    console.log(params);

    this.hideDropzone();

    if (this.viewer) {
      this.viewer.clear();
      this.showViewer();
    }

    const viewer = this.viewer || this.createViewer();

    const fileURL = typeof rootFile === 'string'
      ? rootFile
      : URL.createObjectURL(rootFile);

    this.onToolStart({tool:{title:this.rootName.replace(/_/g,' ')}, message:'Loading...'});

    const postViewerLoad = (content) => {
      document.title = this.rootName == '' ? 'glTF Viewer' : this.rootName + ' - glTF';
      if (this.previewEl) // hide preview
        this.previewEl.style.display = 'none';
      if (content.gltf) {
        return this.gltfContent.load(fileOriginalURL, this.rootName, rootFilePath, containerFile, fileMap);
      }
      else {
        if (!this.exporter) {
          this.exporter = new Exporter();
        }
        return this.exporter.exportContent(content, 'glb')
          .then((data) => {
            return this.gltfContent.loadSingleFile(fileOriginalURL, this.rootName, data);
          });
      }
    };
    const postGLTFLoad = () => {
      this.onToolDone({tool:{title:this.rootName.replace(/_/,' ')}, result:this.gltfContent.getCredits()});
    };

    const cleanup = () => {
      this.hideSpinner();
      if (typeof rootFile === 'object') {
        URL.revokeObjectURL(fileURL);
      }
    };

    if (!this.options.kiosk) {
      // Disabled as gltf-validator is integrated as part of the tools in this branch
      //validationCtrl.validate(fileURL, rootPath, fileMap);
    }

    const rootPath = rootFilePath.slice(0, rootFilePath.length - rootFilePath.split('/').pop().length);

    this.showSpinner();
    this.loader.load(fileURL, rootPath, fileMap, this.rootName, rootFileExt || 'gltf')
      .then((content) => {
        this.viewer.loadContent(content, this.rootName, params.view || {});
        return content;
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
        this.onToolError({tool:{title:this.rootName}, error:((error||{}).message || error)});
        cleanup();
      });
  }

  /**
   * @param  {Error} error
   */
  onError (error) {
    let message = (error||{}).message || error.toString();
    if (message.match(/ProgressEvent/)) {
      message = 'Unable to retrieve this file. Check JS console and browser network tab.';
    } else if (message.match(/Unexpected token/)) {
      message = `Unable to parse file content. Verify that this file is valid. Error: "${message}"`;
    } else if (error && error.target && error.target instanceof Image) {
      message = 'Missing texture: ' + error.target.src.split('/').pop();
    }
    window.alert(message);
    console.error(error);
  }

  showSpinner () {
    this.spinnerEl.style.display = '';
  }

  hideSpinner () {
    this.spinnerEl.style.display = 'none';
  }

  setupMenus () {

    this.downloadBtnEl = document.querySelector('#download-btn');
    this.closeBtnEl = document.querySelector('#close-btn');
    this.shareBtnEl = document.querySelector('#share-btn');
    this.shareSizeEl = document.querySelector('#share-btn .size');
    this.downloadBtnEl.addEventListener('click', this.download.bind(this));
    this.closeBtnEl.addEventListener('click', this.close.bind(this));
    this.shareBtnEl.addEventListener('click', this.share.bind(this));

    this.toolsMenuElement = document.querySelector('#tools-menu');
    this.toolsMenuElementChild0 = this.toolsMenuElement.children[0];
    this.panelTitleElement = document.querySelector('#panel-title');
    this.panelContentElement = document.querySelector('#panel-content');
    this.panelCheckBox = document.querySelector('#panel-input');
    this.toolManager.setupGUI((tool, nextTool) => this.addToolButton(tool, nextTool));
    this.toolManager.on('toolstart', (e) => this.onToolStart(e));
    this.toolManager.on('tooldone', (e) => this.onToolDone(e));
    this.toolManager.on('toolerror', (e) => this.onToolError(e));

    // Make sure only one menu is visible at any given time.
    // We can't use radio buttons because we do need to be able to have none
    // and we want the main menu buttons to behave like a toggle.
    // Compatibility note: Edge does not seem to support iterating directly on
    // the result of querySelectorAll, which is why Array.from was added.
    let menuCheckBoxes = Array.from(document.querySelectorAll('.menu-checkbox'));
    let menuLabels = Array.from(document.querySelectorAll('.menu-label'));
    let app = this;
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
        app.scheduleResize();
      });
    }
    let kioskCheckBox = document.querySelector('.kiosk-checkbox');
    kioskCheckBox.addEventListener( 'change', function() {
      // also disable the panel if going to kiosk mode
      if(this.checked && app.panelCheckBox !== undefined) {
        app.panelCheckBox.checked = false;
      }
      app.scheduleResize();
    });
  }

  setupLoaders () {
    // Show the list of supported extensions
    if (this.placeholderEl) {
      if (!this.loader) {
        this.loader = new Loader();
      }
      var extlist = Array.from(Object.keys(this.loader.loaders)).filter(x => !this.loader.loaders[x].gltf);
      if (extlist) {
        var text = "Experimental importing of files in ";
        text += extlist.join(', ');
        text += ' formats';
        var p = document.createElement('p');
        p.appendChild(document.createTextNode(text));
        this.placeholderEl.appendChild(p);
      }
    }
  }

  download () {
    if (this.gltfContent.containerData) {
      var glbBlob = new Blob([this.gltfContent.containerData], { type: this.gltfContent.info.container.mimetype || 'model/gltf-binary' });
      FileSaver.saveAs(glbBlob, (this.gltfContent.name||'output')+'.'+(this.gltfContent.info.container.fileextension||'glb'));
    }
  }

  close () {
    if (!this.viewer) return;
    this.viewer.clear();
    this.gltfContent.clear();
    if (this.panelCheckBox) {
      this.panelCheckBox.checked = false;
    }
    this.rootName = '';
    document.title = 'glTF Viewer';
    // show dropzone UI elements
    [].forEach.call(this.dropEl.children, (child) => {
      if (child.classList.contains('noscene')) child.style.opacity = null;
    });
    this.hideViewer();
    // hide scene UI
    this.closeBtnEl.style.display = 'none';
    this.downloadBtnEl.style.display = 'none';
    this.shareBtnEl.style.display = 'none';
  }

  share () {
    this.viewer.renderImage(1024,512,(imageBlob) => {
      var formData = new FormData();
      var glbBlob = new Blob([this.gltfContent.containerData], { type: this.gltfContent.info.container.mimetype || 'model/gltf-binary' });
      var viewState = this.viewer.getState();
      //viewState.name = this.rootName;
      var viewBlob = new Blob([JSON.stringify(viewState)], {type: 'application/json'});
      console.log(this.rootName);
      formData.append('name', this.rootName);
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
  }

  addToolButton(tool, nextTool) {
    var nextEl = (nextTool !== undefined) ? nextTool.buttonElement : this.toolsMenuElementChild0;
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
    button.addEventListener('click', (e) => this.toolManager.runTool(tool));
    this.toolsMenuElement.insertBefore(toolEl,nextEl);
    tool.buttonElement = toolEl;
  }

  onToolStart ({tool, message}) {
    this.showSpinner();
    if (this.panelTitleElement !== undefined) {
      this.panelTitleElement.innerHTML = tool.title || tool.name;
    }
    if (this.panelContentElement !== undefined) {
      this.panelContentElement.innerHTML = message || 'Processing...';
      this.panelContentElement.classList.remove('status-wip','status-ok','status-error');
      this.panelContentElement.classList.add('status-wip');
    }
  }

  onToolDone ({tool, result}) {
    this.hideSpinner();
    console.log(result);
    if (result && this.panelCheckBox !== undefined && !this.panelCheckBox.checked) {
      this.panelCheckBox.checked = true;
    }
    if (this.panelContentElement !== undefined) {
      this.panelContentElement.classList.remove('status-wip');
      this.panelContentElement.classList.add((result && (result.error || result.errors)) ? 'status-error' : 'status-ok');
      this.panelContentElement.innerHTML = ''; // clear the panel content
      if (result === undefined) {
      } else if (typeof result === 'string') {
        this.panelContentElement.appendChild(document.createTextNode(result));
      } else if (result instanceof Node) {
        this.panelContentElement.appendChild(result);
      } else { // assume JSON-like data
        //this.panelContentElement.innerHTML = JSON.stringify(result, null, 2);
        var resEl = renderjson.set_show_to_level(2)(result);
        this.panelContentElement.appendChild(resEl);
      }
    }
    this.viewer.updateGUISceneInformation(this.gltfContent.info);
    this.updateButtons();
  }

  onToolError ({tool, error}) {
    this.hideSpinner();
    if (this.panelCheckBox !== undefined) {
      this.panelCheckBox.checked = true;
    }
    if (this.panelContentElement !== undefined) {
      this.panelContentElement.classList.remove('status-wip');
      this.panelContentElement.classList.add('status-error');
      this.panelContentElement.innerHTML = error;
    }
  }

  updateButtons ( params = {} ) {
    if (window.content) {
      this.closeBtnEl.style.display = null;
    }
    if (this.gltfContent.containerData) {
      this.downloadBtnEl.style.display = (!params.hasOwnProperty('canSave') || params.canSave) ? null : 'none';
      if (this.gltfContent.info.container.mimetype == 'model/gltf-binary' && window.IS_UPLOAD_SUPPORTED &&
          (!params.hasOwnProperty('canShare') || params.canShare)) {
        this.shareBtnEl.style.display = null;
        if (this.shareSizeEl !== undefined) {
          var text = '';
          if (this.gltfContent.containerData.byteLength > 0) {
            text = '(' + this.humanFileSize(this.gltfContent.containerData.byteLength) + ')';
          }
          this.shareSizeEl.innerHTML = text;
        }
      }
      else {
        this.shareBtnEl.style.display = 'none';
      }
    }
    else {
      this.downloadBtnEl.style.display = 'none';
      this.shareBtnEl.style.display = 'none';
    }
  };

  scheduleResize() {
    if (this.viewer) {
      setTimeout(this.viewer.resize.bind(this.viewer), 0);
    }
  }

  humanFileSize(size) {
    var i = ( size <= 0 ) ? 0 : Math.min( 4, Math.floor( Math.log(size) / Math.log(1000) ) );
    return ( size / Math.pow(1000, i) ).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
  };

}

document.addEventListener('DOMContentLoaded', () => {

  const app = window.app = new App(document.body, location);

});
