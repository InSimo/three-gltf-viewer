'use strict';
var Promise = require('bluebird');

var writeSource = require('./writeSource');

module.exports = writeSources;

function writeSources(gltf, basePath, options, fsOutputFile) {
    /*var options = {
        embed: true,
        embedImage = true
    };*/
    var writeSourcePromises = [
        writeSource(gltf.buffers, 'buffers', basePath, options, fsOutputFile),
        writeSource(gltf.images, 'images', basePath, options, fsOutputFile),
        writeSource(gltf.shaders, 'shaders', basePath, options, fsOutputFile)
    ];

    return Promise.all(writeSourcePromises)
        .then(function() {
            return gltf;
        });
}
