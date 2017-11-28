'use strict';

var Uri = require('urijs');
var defaultValue = require('./defaultValue');
var defined = require('./defined');
var DeveloperError = require('./DeveloperError');

/**
 * Given a relative Uri and a base Uri, returns the absolute Uri of the relative Uri.
 * @exports getAbsoluteUri
 *
 * @param {String} relative The relative Uri.
 * @param {String} [base] The base Uri.
 * @returns {String} The absolute Uri of the given relative Uri.
 *
 * @example
 * //absolute Uri will be "https://test.com/awesome.png";
 * var absoluteUri = Cesium.getAbsoluteUri('awesome.png', 'https://test.com');
 */
function getAbsoluteUri(relative, base) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(relative)) {
        throw new DeveloperError('relative uri is required.');
    }
    //>>includeEnd('debug');
    base = defaultValue(base, document.location.href);
    var baseUri = new Uri(base);
    var relativeUri = new Uri(relative);
    return relativeUri.resolve(baseUri).toString();
}

module.exports = getAbsoluteUri;

