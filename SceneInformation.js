/**
 * Store information about current 3D scene
 * @author Jeremie Allard / https://twitter.com/JeremieAllard
 */

module.exports = class SceneInformation {

  /**
   * @param  {Element} el
   */
  constructor () {
    this.name = '';
    this.filename = '';
    this.size = '';
    this.format = {
      name: '',
      version: '',
      extensions: []
    }
    this.container = {
      extension: '',
      mimetype: '',
      size: ''
    }
    this.internalFiles = {};
    this.externalURLs = {};
  }

  /**
   * Check if this scene exactly match the given format
   * @param  {string} name
   * @param  {string} version
   * @param  {Array<string>} extensions
   */
  matchFormat(name, version = '', extensions = []) {
    if (name && this.format.name && name != this.format.name) return false;
    if (version && this.format.version && version != this.format.version) return false;
    for (const e of extensions || []) {
      if (!(e in (this.format.extensions||[]))) return false;
    }
    return true;
  }
  /**
   * Check if this scene match the given container, either with the mimetype or the file extension
   * @param  {string} mimetype
   * @param  {string} extension
   */
  matchContainer(mimetype, extension = '') {
    if (mimetype && this.container.mimetype && mimetype == this.container.mimetype) return true;
    if (extension && this.container.extension && extension == this.container.extension) return true;
    return false;
  }
}
