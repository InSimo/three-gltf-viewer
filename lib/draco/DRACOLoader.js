// Copyright 2016 The Draco Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
'use strict';

// |dracoPath| sets the path for the Draco decoder source files. The default
// path is "./". If |dracoDecoderType|.type is set to "js", then DRACOLoader
// will load the Draco JavaScript decoder.
THREE.DRACOLoader = function(dracoPath, dracoDecoderType, manager) {
    this.timeLoaded = 0;
    this.manager = (manager !== undefined) ? manager :
        THREE.DefaultLoadingManager;
    this.materials = null;
    this.verbosity = 0;
    this.attributeOptions = {};
    if (dracoDecoderType !== undefined) {
      THREE.DRACOLoader.dracoDecoderType = dracoDecoderType;
    }
    this.drawMode = THREE.TrianglesDrawMode;
    this.dracoSrcPath = (dracoPath !== undefined) ? dracoPath : './';
    // If draco_decoder.js or wasm code is already loaded/included, then do
    // not dynamically load the decoder.
    if (typeof DracoDecoderModule === 'undefined') {
      THREE.DRACOLoader.loadDracoDecoder(this);
    }
};

THREE.DRACOLoader.dracoDecoderType = {};

THREE.DRACOLoader.prototype = {

    constructor: THREE.DRACOLoader,

    load: function(url, onLoad, onProgress, onError) {
        var scope = this;
        var loader = new THREE.FileLoader(scope.manager);
        loader.setPath(this.path);
        loader.setResponseType('arraybuffer');
        if (this.crossOrigin !== undefined) {
          loader.crossOrigin = this.crossOrigin;
        }
        loader.load(url, function(blob) {
            scope.decodeDracoFile(blob, onLoad);
        }, onProgress, onError);
    },

    setPath: function(value) {
        this.path = value;
    },

    setCrossOrigin: function(value) {
        this.crossOrigin = value;
    },

    setVerbosity: function(level) {
        this.verbosity = level;
    },

    /**
     *  Sets desired mode for generated geometry indices.
     *  Can be either:
     *      THREE.TrianglesDrawMode
     *      THREE.TriangleStripDrawMode
     */
    setDrawMode: function(drawMode) {
        this.drawMode = drawMode;
    },

    /**
     * Skips dequantization for a specific attribute.
     * |attributeName| is the THREE.js name of the given attribute type.
     * The only currently supported |attributeName| is 'position', more may be
     * added in future.
     */
    setSkipDequantization: function(attributeName, skip) {
        var skipDequantization = true;
        if (typeof skip !== 'undefined')
          skipDequantization = skip;
        this.getAttributeOptions(attributeName).skipDequantization =
            skipDequantization;
    },

    /**
     * |attributeIdTypeMap| specifies for each Draco attribute id that should
     * be decoded and provided to the callback, the type of Array created to
     * store the data. The type for indices can be given as entry -1 in the map
     * or it will be either Uint16Array or Uint32Array depending on the number
     * of points.
     */
    decodeDracoFileData: function(rawBuffer, callback, attributeIdTypeMap) {
      var scope = this;
      THREE.DRACOLoader.getDecoder(this,
          function(dracoDecoder) {
            scope.decodeDracoFileInternal(rawBuffer, dracoDecoder, callback,
                attributeIdTypeMap);
      });
    },

    decodeDracoFileInternal: function(rawBuffer, dracoDecoder, callback,
                                      attributeIdTypeMap) {
      /*
       * Here is how to use Draco Javascript decoder and get the geometry.
       */
      var buffer = new dracoDecoder.DecoderBuffer();
      buffer.Init(new Int8Array(rawBuffer), rawBuffer.byteLength);
      var decoder = new dracoDecoder.Decoder();

      /*
       * Determine what type is this file: mesh or point cloud.
       */
      var geometryType = decoder.GetEncodedGeometryType(buffer);
      if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
        if (this.verbosity > 0) {
          console.log('Loaded a mesh.');
        }
      } else if (geometryType == dracoDecoder.POINT_CLOUD) {
        if (this.verbosity > 0) {
          console.log('Loaded a point cloud.');
        }
      } else {
        var errorMsg = 'THREE.DRACOLoader: Unknown geometry type.'
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      // return decoded indices and attributes directly
      callback(this.decodeDracoGeometryData(dracoDecoder, decoder,
          geometryType, buffer, attributeIdTypeMap));
    },

    decodeDracoGeometryData: function(dracoDecoder, decoder, geometryType,
                                  buffer, attributeIdTypeMap) {
        if (this.getAttributeOptions('position').skipDequantization === true) {
          decoder.SkipAttributeTransform(dracoDecoder.POSITION);
        }
        var dracoGeometry;
        var decodingStatus;
        const start_time = performance.now();
        if (geometryType === dracoDecoder.TRIANGULAR_MESH) {
          dracoGeometry = new dracoDecoder.Mesh();
          decodingStatus = decoder.DecodeBufferToMesh(buffer, dracoGeometry);
        } else {
          dracoGeometry = new dracoDecoder.PointCloud();
          decodingStatus =
              decoder.DecodeBufferToPointCloud(buffer, dracoGeometry);
        }
        if (!decodingStatus.ok() || dracoGeometry.ptr == 0) {
          var errorMsg = 'THREE.DRACOLoader: Decoding failed: ';
          errorMsg += decodingStatus.error_msg();
          console.error(errorMsg);
          dracoDecoder.destroy(decoder);
          dracoDecoder.destroy(dracoGeometry);
          throw new Error(errorMsg);
        }

        var decode_end = performance.now();
        dracoDecoder.destroy(buffer);
        /*
         * Example on how to retrieve mesh and attributes.
         */
        var numFaces;
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          numFaces = dracoGeometry.num_faces();
          if (this.verbosity > 0) {
            console.log('Number of faces loaded: ' + numFaces.toString());
          }
        } else {
          numFaces = 0;
        }

        var numPoints = dracoGeometry.num_points();
        var numAttributes = dracoGeometry.num_attributes();
        if (this.verbosity > 0) {
          console.log('Number of points loaded: ' + numPoints.toString());
          console.log('Number of attributes loaded: ' +
              numAttributes.toString());
        }

        // Verify if there is position attribute.
        var posAttId = decoder.GetAttributeId(dracoGeometry,
                                              dracoDecoder.POSITION);
        if (posAttId == -1) {
          var errorMsg = 'THREE.DRACOLoader: No position attribute found.';
          console.error(errorMsg);
          dracoDecoder.destroy(decoder);
          dracoDecoder.destroy(dracoGeometry);
          throw new Error(errorMsg);
        }
        var posAttribute = decoder.GetAttribute(dracoGeometry, posAttId);

        // Structure for converting to THREEJS geometry later.
        var geometryBuffer = {};
        geometryBuffer.numPoints = numPoints;
        geometryBuffer.attributes = {};

        for (var attributeId in attributeIdTypeMap) {
          if (attributeId < 0) continue; // ignore negative ids (used for indices)
          var attributeArrayType = attributeIdTypeMap[attributeId];
          if (attributeArrayType === undefined) attributeArrayType = Float32Array;
          var attribute = decoder.GetAttribute(dracoGeometry, attributeId);
          if (attribute.ptr === 0) {
            var errorMsg = 'THREE.DRACOLoader: No attribute ' + attributeName;
            console.error(errorMsg);
            throw new Error(errorMsg);
          }
          var isFloat = ( attributeArrayType.name.slice(0,5) == "Float" );
          var numComponents = attribute.num_components();
          var attributeData;

          // TODO: the current Draco encoder javascript API only supports Float
          // attributes. As a result, when int values are encoded (such as for
          // skinning joints ids), due to quantization they may be decoded into
          // float values that are slightly below the input values. In this case
          // GetAttributeIntForAllPoints() does a simple casting that will
          // result in integers that can be reduced by 1. Instead, until either
          // the encoder or the decoder API is fixed, we always use
          // GetAttributeFloatForAllPoints(), and convert to integers by
          // rounding to the nearest value with Math.round().

          if (true /*isFloat*/) {
            attributeData = new dracoDecoder.DracoFloat32Array();
            decoder.GetAttributeFloatForAllPoints(
                dracoGeometry, attribute, attributeData);
          } else {
            attributeData = new dracoDecoder.DracoInt32Array();
            decoder.GetAttributeIntForAllPoints(
                dracoGeometry, attribute, attributeData);
          }
          var numValues = numPoints * numComponents;
          // Allocate space for attribute.
          var attributeBuffer = new attributeArrayType(numValues);
          // Copy data from decoder.
          if (isFloat) {
            for (var i = 0; i < numValues; i++) {
              attributeBuffer[i] = attributeData.GetValue(i);
            }
          } else {
            for (var i = 0; i < numValues; i++) {
              attributeBuffer[i] = Math.round(attributeData.GetValue(i));
            }
          }
          geometryBuffer.attributes[attributeId] = attributeBuffer;
          dracoDecoder.destroy(attributeData);
        }

        // For mesh, we need to generate the faces.
        if (geometryType == dracoDecoder.TRIANGULAR_MESH) {
          var indicesArrayType = attributeIdTypeMap[-1];
          if (indicesArrayType === undefined)
            indicesArrayType = numPoints > 65535 ? Uint32Array : Uint16Array;
          if (this.drawMode === THREE.TriangleStripDrawMode) {
            var stripsArray = new dracoDecoder.DracoInt32Array();
            var numStrips = decoder.GetTriangleStripsFromMesh(
                dracoGeometry, stripsArray);
            var indices = new indicesArrayType(stripsArray.size());
            for (var i = 0; i < stripsArray.size(); ++i) {
              indices[i] = stripsArray.GetValue(i);
            }
            geometryBuffer.indices = indices;
            dracoDecoder.destroy(stripsArray);
          } else {
            var numIndices = numFaces * 3;
            var indices = new indicesArrayType(numIndices);
            var ia = new dracoDecoder.DracoInt32Array();
            for (var i = 0; i < numFaces; ++i) {
              decoder.GetFaceFromMesh(dracoGeometry, i, ia);
              var index = i * 3;
              indices[index] = ia.GetValue(0);
              indices[index + 1] = ia.GetValue(1);
              indices[index + 2] = ia.GetValue(2);
            }
            dracoDecoder.destroy(ia);
            geometryBuffer.indices = indices;
          }
        }

        geometryBuffer.drawMode = this.drawMode;
        var posTransform = new dracoDecoder.AttributeQuantizationTransform();
        if (posTransform.InitFromAttribute(posAttribute)) {
          // Quantized attribute. Store the quantization parameters.
          geometryBuffer.attributes[posAttId].isQuantized = true;
          geometryBuffer.attributes[posAttId].maxRange = posTransform.range();
          geometryBuffer.attributes[posAttId].numQuantizationBits =
              posTransform.quantization_bits();
          geometryBuffer.attributes[posAttId].minValues = new Float32Array(3);
          for (var i = 0; i < 3; ++i) {
            geometryBuffer.attributes[posAttId].minValues[i] =
                posTransform.min_value(i);
          }
        }
        dracoDecoder.destroy(posTransform);
        dracoDecoder.destroy(decoder);
        dracoDecoder.destroy(dracoGeometry);

        this.decode_time = decode_end - start_time;
        this.import_time = performance.now() - decode_end;

        if (this.verbosity > 0) {
          console.log('Decode time: ' + this.decode_time);
          console.log('Import time: ' + this.import_time);
        }
        return geometryBuffer;
    },

    isVersionSupported: function(version, callback) {
        THREE.DRACOLoader.getDecoder(this,
            function(decoder) {
              callback(decoder.isVersionSupported(version));
            });
    },

    getAttributeOptions: function(attributeName) {
        if (typeof this.attributeOptions[attributeName] === 'undefined')
          this.attributeOptions[attributeName] = {};
        return this.attributeOptions[attributeName];
    }
};

// This function loads a JavaScript file and adds it to the page. "path"
// is the path to the JavaScript file. "onLoadFunc" is the function to be
// called when the JavaScript file has been loaded.
THREE.DRACOLoader.loadJavaScriptFile = function(path, onLoadFunc,
    dracoDecoder) {
  var previous_decoder_script = document.getElementById("decoder_script");
  if (previous_decoder_script !== null) {
    return;
  }
  var head = document.getElementsByTagName('head')[0];
  var element = document.createElement('script');
  element.id = "decoder_script";
  element.type = 'text/javascript';
  element.src = path;
  if (onLoadFunc !== null) {
    element.onload = onLoadFunc(dracoDecoder);
  } else {
    element.onload = function(dracoDecoder) {
      THREE.DRACOLoader.timeLoaded = performance.now();
    };
  }
  head.appendChild(element);
}

THREE.DRACOLoader.loadWebAssemblyDecoder = function(dracoDecoder) {
  THREE.DRACOLoader.dracoDecoderType['wasmBinaryFile'] =
      dracoDecoder.dracoSrcPath + 'draco_decoder.wasm';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', dracoDecoder.dracoSrcPath + 'draco_decoder.wasm', true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = function() {
    // draco_wasm_wrapper.js must be loaded before DracoDecoderModule is
    // created. The object passed into DracoDecoderModule() must contain a
    // property with the name of wasmBinary and the value must be an
    // ArrayBuffer containing the contents of the .wasm file.
    THREE.DRACOLoader.dracoDecoderType['wasmBinary'] = xhr.response;
    THREE.DRACOLoader.timeLoaded = performance.now();
  };
  xhr.send(null)
}

// This function will test if the browser has support for WebAssembly. If
// it does it will download the WebAssembly Draco decoder, if not it will
// download the asmjs Draco decoder.
THREE.DRACOLoader.loadDracoDecoder = function(dracoDecoder) {
  if (typeof WebAssembly !== 'object' ||
      THREE.DRACOLoader.dracoDecoderType.type === 'js') {
    // No WebAssembly support
    THREE.DRACOLoader.loadJavaScriptFile(dracoDecoder.dracoSrcPath +
        'draco_decoder.js', null, dracoDecoder);
  } else {
    THREE.DRACOLoader.loadJavaScriptFile(dracoDecoder.dracoSrcPath +
        'draco_wasm_wrapper.js',
        function (dracoDecoder) {
          THREE.DRACOLoader.loadWebAssemblyDecoder(dracoDecoder);
        }, dracoDecoder);
  }
}

/**
 * Creates and returns a singleton instance of the DracoDecoderModule.
 * The module loading is done asynchronously for WebAssembly. Initialized module
 * can be accessed through the callback function
 * |onDracoDecoderModuleLoadedCallback|.
 */
THREE.DRACOLoader.getDecoder = (function() {
    var decoder;
    var decoderCreationCalled = false;

    return function(dracoDecoder, onDracoDecoderModuleLoadedCallback) {
        if (typeof decoder !== 'undefined') {
          // Module already initialized.
          if (typeof onDracoDecoderModuleLoadedCallback !== 'undefined') {
            onDracoDecoderModuleLoadedCallback(decoder);
          }
        } else {
          if (typeof DracoDecoderModule === 'undefined') {
            // Wait until the Draco decoder is loaded before starting the error
            // timer.
            if (THREE.DRACOLoader.timeLoaded > 0) {
              var waitMs = performance.now() - THREE.DRACOLoader.timeLoaded;

              // After loading the Draco JavaScript decoder file, there is still
              // some time before the DracoDecoderModule is defined. So start a
              // loop to check when the DracoDecoderModule gets defined. If the
              // time is hit throw an error.
              if (waitMs > 5000) {
                throw new Error(
                    'THREE.DRACOLoader: DracoDecoderModule not found.');
              }
            }
          } else {
            if (!decoderCreationCalled) {
              decoderCreationCalled = true;
              THREE.DRACOLoader.dracoDecoderType['onModuleLoaded'] =
                  function(module) {
                    decoder = module;
                  };
              DracoDecoderModule(THREE.DRACOLoader.dracoDecoderType);
            }
          }

          // Either the DracoDecoderModule has not been defined or the decoder
          // has not been created yet. Call getDecoder() again.
          setTimeout(function() {
            THREE.DRACOLoader.getDecoder(dracoDecoder,
                onDracoDecoderModuleLoadedCallback);
          }, 10);
        }
    };

})();
