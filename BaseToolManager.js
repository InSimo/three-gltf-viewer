const EventEmitter = require('events').EventEmitter;

module.exports = class BaseToolManager extends EventEmitter {

  constructor ( state ) {
    super();
    this.tools = []
    this.state = state;
  }

  setupGUI (toolsMenuElement) {
    this.toolsMenuElement = toolsMenuElement;
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
    button.addEventListener('click', (e) => this.runTool(tool));
    tool.buttonElement = button;
  }

  /**
   * @param  {Tool} tool
   */
  runTool (tool) {
    //spinnerEl.style.display = '';
    this.emit('toolstart',{tool: tool});
    let my = this; // this is not preserved in callbacks
    return new Promise((resolve,reject) => {
      resolve(this.state);
    }).then((state) => {
      return tool.run( my.state );
    }).then((res) => {
      console.log(res);
      my.emit('tooldone', {tool: tool, result: res});
    }).catch(function (err) {
      console.error(err);
      my.emit('toolerror', {tool: tool, error: err});
    });
  }
}
