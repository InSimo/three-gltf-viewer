'use strict';
var Cesium = require('cesium');
var Promise = require('bluebird');
var path = require('path');
var fsExtra = require('fs-extra');

var addPipelineExtras = require('./addPipelineExtras');
var compressTextures = require('./compressTextures');
var loadGltfUris = require('./loadGltfUris');
var processJSONWithExtras = require('./processJSONWithExtras');
var readGltf = require('./readGltf');
var removePipelineExtras = require('./removePipelineExtras');
var writeGltf = require('./writeGltf');
var writeBinaryGltf = require('./writeBinaryGltf');
var writeSources = require('./writeSources');

var fsOutputFile = Promise.promisify(fsExtra.outputFile);

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;

module.exports = Pipeline;

/**
 * Main optimization pipeline.
 * @constructor
 */
function Pipeline() {}

/**
 * Add pipeline extras and load uris, then process the glTF asset.
 * Options are passed to loadGltfUris and processJSONWithExtras.
 *
 * @param {Object} gltf A javascript object containing a glTF asset.
 * @param {Object} [options] Options to apply to stages during optimization.
 * @returns {Promise} A promise that resolves to the processed glTF asset.
 *
 * @see loadGltfUris
 * @see processJSONWithExtras
 */
Pipeline.processJSON = function(gltf, options) {
    options = defaultValue(options, {});
    return loadGltfUris(gltf, options)
        .then(function(gltf) {
            return processJSONWithExtras(gltf, options, compressTextures);
        })
        .then(function(gltf) {
            return writeSources(gltf, undefined, undefined, fsOutputFile);
        })
        .then(function(gltf) {
            gltf = removePipelineExtras(gltf);
            return gltf;
        });
};

/**
 * Process a glTF asset that already has extras and loaded uris.
 *
 * @see processJSONWithExtras
 */
Pipeline.processJSONWithExtras  = processJSONWithExtras;

/**
 * Process a glTF asset on disk into memory.
 * Options are passed to processJSONWithExtras.
 *
 * @param {String} inputPath The input file path.
 * @param {Object} [options] Options to apply to stages during optimization.
 * @returns {Object} The processed glTF asset.
 *
 * @see processJSONWithExtras
 */
Pipeline.processFile = function processFile(inputPath, options) {
    options = defaultValue(options, {});
    return readGltf(inputPath, options)
        .then(function(gltf) {
            return processJSONWithExtras(gltf, options, compressTextures);
        })
        .then(function(gltf) {
            return writeSources(gltf, undefined, undefined, fsOutputFile);
        })
        .then(function(gltf) {
            gltf = removePipelineExtras(gltf);
            return gltf;
        });
};

/**
 * Process a gltf in memory and writes it out to disk.
 * Options are passed to loadGltfUris, processJSONWithExtras, writeGltf, and writeBinaryGltf.
 *
 * @param {Object} gltf A javascript object containing a glTF asset.
 * @param {String} outputPath The output file destination.
 * @param {Object} [options] Options to apply to stages during optimization.
 * @returns {Promise} A promise that resolves when the operation is complete.
 *
 * @see loadGltfUris
 * @see processJSONWithExtras
 * @see writeGltf
 * @see writeBinaryGltf
 */
Pipeline.processJSONToDisk = function(gltf, outputPath, options) {
    options = defaultValue(options, {});
    addPipelineExtras(gltf);
    return loadGltfUris(gltf, options)
        .then(function(gltf) {
            return processJSONWithExtras(gltf, options, compressTextures);
        })
        .then(function(gltf) {
            return writeFile(gltf, outputPath, options);
        });
};

/**
 * Processes a glTF asset on disk and writes it out to disk.
 * Options are passed to processJSONWithExtras, readGltf, writeGltf, and writeBinaryGltf.
 *
 * @param {String} inputPath The input file path.
 * @param {String} outputPath The output file destination
 * @param {Object} [options] Options to apply to stages during optimization.
 * @returns {Promise} A promise that resolves when the operation is complete.
 *
 * @see processJSONWithExtras
 * @see readGltf
 * @see writeGltf
 * @see writeBinaryGltf
 */
Pipeline.processFileToDisk = function(inputPath, outputPath, options) {
    options = defaultValue(options, {});
    return readGltf(inputPath, options)
        .then(function(gltf) {
            return processJSONWithExtras(gltf, options, compressTextures);
        })
        .then(function(gltf) {
            return writeFile(gltf, outputPath, options);
        });
};

function writeFile(gltf, outputPath, options) {
    var fileExtension = path.extname(outputPath);
    var binary = defaultValue(options.binary, false);
    var embed = defaultValue(options.embed, true);
    var embedImage = defaultValue(options.embedImage, true);
    var createDirectory = defaultValue(options.createDirectory, true);
    var writeOptions = {
        outputPath : outputPath,
        embed : embed,
        embedImage : embedImage,
        createDirectory : createDirectory
    };

    if (binary || fileExtension === '.glb') {
        return writeBinaryGltf(gltf, writeOptions);
    }
    return writeGltf(gltf, writeOptions);
}
