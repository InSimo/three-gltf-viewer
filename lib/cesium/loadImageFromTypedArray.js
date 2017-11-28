'use strict';


var Check = require('./Check');
var loadImage = require('./loadImage');

/**
 * @private
 */
function loadImageFromTypedArray(uint8Array, format, request) {
    //>>includeStart('debug', pragmas.debug);
    Check.typeOf.object('uint8Array', uint8Array);
    Check.typeOf.string('format', format);
    //>>includeEnd('debug');

    var blob = new Blob([uint8Array], {
        type : format
    });

    var blobUrl = window.URL.createObjectURL(blob);
    return loadImage(blobUrl, false, request).then(function(image) {
        window.URL.revokeObjectURL(blobUrl);
        return image;
    }, function(error) {
        window.URL.revokeObjectURL(blobUrl);
        return Promise.reject(error);
    });
}

module.exports = loadImageFromTypedArray;

