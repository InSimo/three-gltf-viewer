'use strict';

var Uri = require('urijs');

var combine = require('./combine');
var defaultValue = require('./defaultValue');
var defined = require('./defined');
var DeveloperError = require('./DeveloperError');
var objectToQuery = require('./objectToQuery');
var queryToObject = require('./queryToObject');
var Request = require('./Request');
var RequestScheduler = require('./RequestScheduler');

/**
 * Requests a resource using JSONP.
 *
 * @exports loadJsonp
 *
 * @param {String} url The URL to request.
 * @param {Object} [options] Object with the following properties:
 * @param {Object} [options.parameters] Any extra query parameters to append to the URL.
 * @param {String} [options.callbackParameterName='callback'] The callback parameter name that the server expects.
 * @param {Proxy} [options.proxy] A proxy to use for the request. This object is expected to have a getURL function which returns the proxied URL, if needed.
 * @param {Request} [request] The request object. Intended for internal use only.
 * @returns {Promise.<Object>|undefined} a promise that will resolve to the requested data when loaded. Returns undefined if <code>request.throttle</code> is true and the request does not have high enough priority.
 *
 *
 * @example
 * // load a data asynchronously
 * Cesium.loadJsonp('some/webservice').then(function(data) {
 *     // use the loaded data
 * }).catch(function(error) {
 *     // an error occurred
 * });
 *
 * @see {@link http://wiki.commonjs.org/wiki/Promises/A|CommonJS Promises/A}
 */
function loadJsonp(url, options, request) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(url)) {
        throw new DeveloperError('url is required.');
    }
    //>>includeEnd('debug');

    options = defaultValue(options, defaultValue.EMPTY_OBJECT);

    //generate a unique function name
    var functionName;
    do {
        functionName = 'loadJsonp' + Math.random().toString().substring(2, 8);
    } while (defined(window[functionName]));

    var uri = new Uri(url);

    var queryOptions = queryToObject(defaultValue(uri.query, ''));

    if (defined(options.parameters)) {
        queryOptions = combine(options.parameters, queryOptions);
    }

    var callbackParameterName = defaultValue(options.callbackParameterName, 'callback');
    queryOptions[callbackParameterName] = functionName;

    uri.query = objectToQuery(queryOptions);

    url = uri.toString();

    var proxy = options.proxy;
    if (defined(proxy)) {
        url = proxy.getURL(url);
    }

    request = defined(request) ? request : new Request();
    request.url = url;
    request.requestFunction = function() {
        var deferred = Promise.defer();

        //assign a function with that name in the global scope
        window[functionName] = function(data) {
            deferred.resolve(data);

            try {
                delete window[functionName];
            } catch (e) {
                window[functionName] = undefined;
            }
        };

        loadJsonp.loadAndExecuteScript(url, functionName, deferred);
        return deferred.promise;
    };

    return RequestScheduler.request(request);
}

// This is broken out into a separate function so that it can be mocked for testing purposes.
loadJsonp.loadAndExecuteScript = function(url, functionName, deferred) {
    var script = document.createElement('script');
    script.async = true;
    script.src = url;

    var head = document.getElementsByTagName('head')[0];
    script.onload = function() {
        script.onload = undefined;
        head.removeChild(script);
    };
    script.onerror = function(e) {
        deferred.reject(e);
    };

    head.appendChild(script);
};

loadJsonp.defaultLoadAndExecuteScript = loadJsonp.loadAndExecuteScript;

module.exports = loadJsonp;

