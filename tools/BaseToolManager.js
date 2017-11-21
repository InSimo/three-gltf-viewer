const EventEmitter = require('events').EventEmitter;

module.exports = class BaseToolManager extends EventEmitter {

  constructor ( state ) {
    super();
    this.tools = []
    this.state = state;
  }

  setupGUI (addToolGUIFunction) {
    this.addToolGUIFunction = addToolGUIFunction;
    for (let tool of this.tools) {
      this.addToolGUI(tool);
    }
  }

  /**
   * @param  {Tool} tool
   */
  addToolGUI (tool) {
    if (this.addToolGUIFunction === undefined) return; // setupGUI was not called yet
    // find the tool before which this one will be shown, based on order
    var nextTool = undefined;
    for (let t of this.tools) {
      if (t === tool) break; // other tools do not have their GUI yet
      if ( tool.order < t.order &&
          ( nextTool === undefined || t.order < nextTool.order ) ) {
        nextTool = t;
      }
    }
    this.addToolGUIFunction(tool, nextTool);
  }

  /**
   * @param  {Tool} tool
   */
  addTool (tool) {
    if (tool.order === undefined) {
      tool.order = 0;
    }
    this.tools.push(tool);
    this.addToolGUI(tool);
    console.log('Added Tool '+tool.name);
    this.emit('tooladded', {tool: tool});
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
