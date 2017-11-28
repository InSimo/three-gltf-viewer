'use strict';
var Cesium = require('cesium');
var Promise = require('bluebird');
var path = require('path');

var MergeDuplicateProperties = require('./MergeDuplicateProperties');
var RemoveUnusedProperties = require('./RemoveUnusedProperties');
var addDefaults = require('./addDefaults');
var addPipelineExtras = require('./addPipelineExtras');
var bakeAmbientOcclusion = require('./bakeAmbientOcclusion');
var combineNodes = require('./combineNodes');
var combinePrimitives = require('./combinePrimitives');
var compressIntegerAccessors = require('./compressIntegerAccessors');
var compressTextureCoordinates = require('./compressTextureCoordinates');
//var compressTextures = require('./compressTextures');
var convertDagToTree = require('./convertDagToTree');
var encodeImages = require('./encodeImages');
var generateModelMaterialsCommon = require('./generateModelMaterialsCommon');
var generateNormals = require('./generateNormals');
var generateTangentsBitangents = require('./generateTangentsBitangents');
var getStatistics = require('./getStatistics');
var mergeDuplicateVertices = require('./mergeDuplicateVertices');
var octEncodeNormals = require('./octEncodeNormals');
var optimizeForVertexCache = require('./optimizeForVertexCache');
var processModelMaterialsCommon = require('./processModelMaterialsCommon');
var processPbrMetallicRoughness = require('./processPbrMetallicRoughness');
var removeDuplicatePrimitives = require('./removeDuplicatePrimitives');
var removeNormals = require('./removeNormals');
var removeUnusedVertices = require('./removeUnusedVertices');
var quantizeAttributes = require('./quantizeAttributes');
var updateVersion = require('./updateVersion');
var uninterleaveAndPackBuffers = require('./uninterleaveAndPackBuffers');

var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;

module.exports = processJSONWithExtras;

/**
 * Process a glTF asset that already has extras and loaded uris.
 *
 * @param {Object} gltfWithExtras A javascript object holding a glTF hierarchy with extras.
 * @param {Object} [options] Options to apply to stages during optimization.
 * @param {Object} [options.aoOptions=undefined] Options to pass to the bakeAmbientOcclusion stage, if undefined, stage is not run.
 * @param {Object} [options.encodeNormals=false] Flag to run octEncodeNormals stage.
 * @param {Object} [options.compressTextureCoordinates=false] Flag to run compressTextureCoordinates stage.
 * @param {Object} [options.kmcOptions=undefined] Options to pass to the generateModelMaterialsCommon stage, if undefined, stage is not run.
 * @param {Object} [options.quantize] Flag to run quantizeAttributes stage.
 * @param {Object|Object[]} [options.textureCompressionOptions=undefined] Options to pass to the compressTextures stage. If an array of options is given, the textures will be compressed in multiple formats. If undefined, stage is not run.
 * @param {Function} compressTextures compressTextures function (as a parameter so it is not pulled as a dependency of this file)
 * @returns {Promise} A promise that resolves to the processed glTF asset.
 */
function processJSONWithExtras (gltfWithExtras, options, compressTextures) {
    options = defaultValue(options, {});

    updateVersion(gltfWithExtras, options);
    addPipelineExtras(gltfWithExtras);
    addDefaults(gltfWithExtras, options);
    processModelMaterialsCommon(gltfWithExtras, options);
    processPbrMetallicRoughness(gltfWithExtras, options);

    // Print statistics for unoptimized input
    if (options.stats) {
        console.log('\nStatistics for ' + options.inputPath + '\n------------------');
        options.inputStats = getStatistics(gltfWithExtras);
        console.log(options.inputStats.toString());
    }

    var shouldRemoveNormals = defaultValue(options.removeNormals, false);
    var shouldPreserve = defaultValue(options.preserve, false);
    if (shouldRemoveNormals) {
        removeNormals(gltfWithExtras);
    }

    RemoveUnusedProperties.removeAll(gltfWithExtras);
    var smoothNormals = defaultValue(options.smoothNormals, false);
    var faceNormals = defaultValue(options.faceNormals, false);
    if (smoothNormals || faceNormals) {
        generateNormals(gltfWithExtras, options);
    }
    if (!shouldPreserve) {
        mergeDuplicateVertices(gltfWithExtras);
        removeUnusedVertices(gltfWithExtras);
        MergeDuplicateProperties.mergeAll(gltfWithExtras);
        RemoveUnusedProperties.removeAll(gltfWithExtras);
        removeDuplicatePrimitives(gltfWithExtras);
        combinePrimitives(gltfWithExtras);
        convertDagToTree(gltfWithExtras);
        combineNodes(gltfWithExtras);
        combinePrimitives(gltfWithExtras);
        MergeDuplicateProperties.mergeAll(gltfWithExtras);
        removeDuplicatePrimitives(gltfWithExtras);
        RemoveUnusedProperties.removeAll(gltfWithExtras);
        optimizeForVertexCache(gltfWithExtras);
    }

    // run generation of tangents / bitangents and AO after
    // optimizeForVertexCache since those steps add new attributes.
    if (options.tangentsBitangents) {
        generateTangentsBitangents(gltfWithExtras);
    }

    var aoOptions = options.aoOptions;
    if (defined(aoOptions)) {
        bakeAmbientOcclusion(gltfWithExtras, aoOptions);
    }

    if (options.encodeNormals) {
        octEncodeNormals(gltfWithExtras);
    }
    if (options.compressTextureCoordinates) {
        compressTextureCoordinates(gltfWithExtras);
    }
    compressIntegerAccessors(gltfWithExtras, {
        semantics : ["JOINT"]
    });
    if (options.quantize) {
        var quantizedOptions = {
            findMinMax : true,
            exclude : [
                'JOINT',
                '_OCCLUSION'
            ]
        };
        if (options.compressTextureCoordinates) {
            quantizedOptions.exclude.push('TEXCOORD');
        }
        quantizeAttributes(gltfWithExtras, quantizedOptions);
    }
    var textureCompressionOptions = options.textureCompressionOptions;
    var promise;
    if (defined(textureCompressionOptions)) {
        promise = compressTextures(gltfWithExtras, textureCompressionOptions);
    } else {
        promise = encodeImages(gltfWithExtras);
    }
    return promise.then(function() {
            var kmcOptions = options.kmcOptions;
            if (defined(kmcOptions)) {
                generateModelMaterialsCommon(gltfWithExtras, options.kmcOptions);
            }

            // Print statistics for optimized glTF
            if (options.stats) {
                console.log('\nStatistics for ' + options.outputPath + '\n------------------');
                options.outputStats = getStatistics(gltfWithExtras);
                console.log(options.outputStats.toString() + '\n');
            }

            uninterleaveAndPackBuffers(gltfWithExtras);
            return gltfWithExtras;
        });
};
