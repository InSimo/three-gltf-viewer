const EventEmitter = require('events').EventEmitter;
const renderjson = require('renderjson');

module.exports = class ToolManager extends EventEmitter {

  constructor ( state ) {
    super();
    this.tools = []
    this.state = state;
  }

  setupGUI () {
    this.toolsMenuElement = document.querySelector('#tools-menu');
    this.panelTitleElement = document.querySelector('#panel-title');
    this.panelContentElement = document.querySelector('#panel-content');
    this.panelCheckBox = document.querySelector('#panel-input');
    for (let tool of this.tools) {
      addToolButton(tool);
    }
  }

  /**
   * @param  {Tool} tool
   */
  addTool (tool) {
    if (tool.order === undefined) {
      tool.order = 0;
    }
    this.tools.push(tool);
    if (this.toolsMenuElement !== undefined) {
      this.addToolButton(tool);
    }
    console.log('Added Tool '+tool.name);
    this.emit('tooladded', {tool: tool});
  }

  /**
   * @param  {Tool} tool
   */
  addToolButton (tool) {
    // find the tool before which this one will be shown, based on order
    var nextTool = undefined;
    for (let t of this.tools) {
      if (t !== tool && t.buttonElement !== undefined && tool.order < t.order &&
          ( nextTool === undefined || t.order < nextTool.order ) ) {
        nextTool = t;
      }
    }
    var nextEl = (nextTool !== undefined) ? nextTool.buttonElement : this.toolsMenuElement.children[0];
    var button = document.createElement("button");
    button.setAttribute('class','item');
    button.innerHTML = '<span class="icon">'+tool.icon+'</span>&nbsp;&nbsp;'+tool.name+'</button>';
    this.toolsMenuElement.insertBefore(button,nextEl);
    button.addEventListener('click', (e) => this.runTool(tool, e));
    tool.buttonElement = button;
  }

  /**
   * @param  {Tool} tool
   * @param  {Event} e
   */
  runTool (tool, e) {
    //spinnerEl.style.display = '';
    this.emit('toolstart',{tool: tool});
    let my = this; // this is not preserved in callbacks
    if (my.panelTitleElement !== undefined) {
      my.panelTitleElement.innerHTML = tool.title || tool.name;
    }
    if (my.panelContentElement !== undefined) {
      my.panelContentElement.innerHTML = 'Processing...';
      my.panelContentElement.classList.remove('status-wip','status-ok','status-error');
      my.panelContentElement.classList.add('status-wip');
    }
    try {
      var p = tool.run( my.state );
      if (p) {
        if (my.panelCheckBox !== undefined) {
          my.panelCheckBox.checked = true;
        }
        p.then(function(res) {
          console.log(res);
          if (my.panelContentElement !== undefined) {
            my.panelContentElement.classList.remove('status-wip');
            my.panelContentElement.classList.add((res.error || res.errors) ? 'status-error' : 'status-ok');
            if (typeof res === 'string') {
              my.panelContentElement.innerHTML = res;
            }
            else {
              //my.panelContentElement.innerHTML = JSON.stringify(res, null, 2);
              my.panelContentElement.innerHTML = ''; // clear the panel content
              var resEl = renderjson.set_show_to_level(2)(res);
              my.panelContentElement.appendChild(resEl);
            }
          }
          my.emit('tooldone', {tool: tool, result: res});
        })
          .catch(function (err) {
            console.error(err);
            if (my.panelContentElement !== undefined) {
              my.panelContentElement.classList.remove('status-wip');
              my.panelContentElement.classList.add('status-error');
              my.panelContentElement.innerHTML = err;
            }
            my.emit('toolerror', {tool: tool, error: err});
          });
      }
      else {
        if (my.panelContentElement !== undefined) {
          my.panelContentElement.classList.remove('status-wip');
          my.panelContentElement.classList.add('status-ok');
            my.panelContentElement.innerHTML = '';
        }
        my.emit('tooldone', {tool: tool});
      }
    }
    catch (err) {
      console.error(err);
      if (my.panelCheckBox !== undefined) {
        my.panelCheckBox.checked = true;
      }
      if (my.panelContentElement !== undefined) {
        my.panelContentElement.classList.remove('status-wip');
        my.panelContentElement.classList.add('status-error');
        my.panelContentElement.innerHTML = err;
      }
      my.emit('toolerror', {tool: tool, error: err});
    }
  }
}
