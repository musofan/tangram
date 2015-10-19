// Miscellaneous utilities
/*jshint worker: true*/

import log from 'loglevel';
import yaml from 'js-yaml';
import bowser from 'bowser';
import Geo from '../geo';

var Utils;
export default Utils = {};

// Add a base URL for schemeless or protocol-less URLs
// Defaults to adding current window protocol and base, or adds a custom base if specified
// Maybe use https://github.com/medialize/URI.js if more robust functionality is needed
Utils.addBaseURL = function (url, base) {
    if (!url) {
        return;
    }

    // Schemeless, add protocol
    if (url.substr(0, 2) === '//') {
        url = window.location.protocol + url;
    }
    // No http(s) or data, add base
    else if (url.search(/^(http|https|data|blob):/) < 0) {
        var relative = (url[0] !== '/');
        var base_info;
        if (base) {
            base_info = document.createElement('a'); // use a temporary element to parse URL
            base_info.href = base;
        }
        else {
            base_info = window.location;
        }

        if (relative) {
            let path = base_info.href.match(/([^\#]+)/); // strip hash
            path = (path && path.length > 1) ? path[0] : '';
            url = path + url;
        }
        else {
            // Easy way
            if (base_info.origin) {
                url = base_info.origin + '/' + url;
            }
            // Hard way (IE11)
            else {
                var origin = url.match(/^((http|https|data|blob):\/\/[^\/]*\/)/);
                origin = (origin && origin.length > 1) ? origin[0] : '';
                url = origin + url;
            }
        }
    }
    return url;
};

Utils.pathForURL = function (url) {
    if (url.search(/^(data|blob):/) === -1) {
        return url.substr(0, url.lastIndexOf('/') + 1) || './';
    }
    return './';
};

Utils.cacheBusterForUrl = function (url) {
    if (url.search(/^(data|blob):/) > -1) {
        return url; // no cache-busting on object or data URLs
    }
    return url + '?' + (+new Date());
};

// Add a set of query string params to a URL
// params: hash of key/value pairs of query string parameters
Utils.addParamsToURL = function (url, params) {
    if (!params || Object.keys(params).length === 0) {
        return url;
    }

    var qs_index = url.indexOf('?');
    var hash_index = url.indexOf('#');

    // Save and trim hash
    var hash = '';
    if (hash_index > -1) {
        hash = url.slice(hash_index);
        url = url.slice(0, hash_index);
    }

    // Start query string
    if (qs_index === -1) {
        qs_index = url.length;
        url += '?';
    }
    qs_index++; // advanced past '?'

    // Build query string params
    var url_params = '';
    for (var p in params) {
        url_params += `${p}=${params[p]}&`;
    }

    // Insert new query string params and restore hash
    // NOTE: doesn't replace any values already present on query string, just inserts dupe values
    url = url.slice(0, qs_index) + url_params + url.slice(qs_index) + hash;

    return url;
};

// Polyfill (for Safari compatibility)
Utils._createObjectURL = undefined;
Utils.createObjectURL = function (url) {
    if (Utils._createObjectURL === undefined) {
        Utils._createObjectURL = (window.URL && window.URL.createObjectURL) || (window.webkitURL && window.webkitURL.createObjectURL);

        if (typeof Utils._createObjectURL !== 'function') {
            Utils._createObjectURL = null;
            log.warn(`window.URL.createObjectURL (or vendor prefix) not found, unable to create local blob URLs`);
        }
    }

    if (Utils._createObjectURL) {
        return Utils._createObjectURL(url);
    }
    else {
        return url;
    }
};

Utils.io = function (url, timeout = 60000, responseType = 'text', method = 'GET', headers = {}) {
    var request = new XMLHttpRequest();
    var promise = new Promise((resolve, reject) => {
        request.open(method, url, true);
        request.timeout = timeout;
        request.responseType = responseType;
        request.onload = () => {
            if (request.status === 200) {
                if (['text', 'json'].indexOf(request.responseType) > -1) {
                    resolve(request.responseText);
                }
                else {
                    resolve(request.response);
                }
            } else {
                reject(Error('Request error with a status of ' + request.statusText));
            }
        };
        request.onerror = (evt) => {
            reject(Error('There was a network error' + evt.toString()));
        };
        request.ontimeout = (evt) => {
            reject(Error('timeout '+ evt.toString()));
        };
        request.send();
    });

    Object.defineProperty(promise, 'request', {
        value: request
    });

    return promise;
};

Utils.parseResource = function (body) {
    var data;
    try {
        data = yaml.safeLoad(body);
    } catch (e) {
        throw e;
    }
    return data;
};

Utils.loadResource = function (source) {
    return new Promise((resolve, reject) => {
        if (typeof source === 'string') {
            Utils.io(Utils.cacheBusterForUrl(source)).then((body) => {
                try {
                    let data = Utils.parseResource(body);
                    resolve(data);
                }
                catch(e) {
                    reject(e);
                }
            }, reject);
        } else {
            resolve(source);
        }
    });
};

// Wrapper for browser info
Utils.browser = function () {
    return bowser;
};

// Needed for older browsers that still support WebGL (Safari 6 etc.)
Utils.requestAnimationFramePolyfill = function () {
    if (typeof window.requestAnimationFrame !== 'function') {
        window.requestAnimationFrame =
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame    ||
            window.oRequestAnimationFrame      ||
            window.msRequestAnimationFrame     ||
            function (cb) {
                setTimeout(cb, 1000 /60);
            };
    }
};

// Stringify an object into JSON, but convert functions to strings
Utils.serializeWithFunctions = function (obj) {
    var serialized = JSON.stringify(obj, function(k, v) {
        // Convert functions to strings
        if (typeof v === 'function') {
            return v.toString();
        }
        return v;
    });

    return serialized;
};

// Parse a JSON string, but convert function-like strings back into functions
Utils.deserializeWithFunctions = function(serialized, wrap) {
    var obj = JSON.parse(serialized);
    obj = Utils.stringsToFunctions(obj, wrap);
    return obj;
};

// Recursively parse an object, attempting to convert string properties that look like functions back into functions
Utils.stringsToFunctions = function(obj, wrap) {
    // Convert string
    if (typeof obj === 'string') {
        obj = Utils.stringToFunction(obj, wrap);
    }
    // Loop through object properties
    else if (typeof obj === 'object') {
        for (let p in obj) {
            obj[p] = Utils.stringsToFunctions(obj[p], wrap);
        }
    }
    return obj;
};

// Convert string back into a function
// TODO: make function matching tolerant of whitespace and multilines
Utils.stringToFunction = function(val, wrap) {
    // Convert strings back into functions
    if (val.match(/^\s*function\s*\w*\s*\([\s\S]*\)\s*\{[\s\S]*\}/m) != null) {
        var f;
        try {
            if (typeof wrap === 'function') {
                eval('f = ' + wrap(val)); // jshint ignore:line
            }
            else {
                eval('f = ' + val); // jshint ignore:line
            }
            return f;
        }
        catch (e) {
            // fall-back to original value if parsing failed
            return val;
        }
    }
    return val;
};

// Log wrapper, sends message to main thread for display, and includes worker id #
Utils.log = function (level, ...msg) {
    level = level || 'info';
    if (Utils.isWorkerThread) {
        self.postMessage({
            type: 'log',
            level: level,
            worker_id: self._worker_id,
            msg: msg
        });
    }
    else if (typeof log[level] === 'function') {
        log[level](...msg);
    }
};

// Default to allowing high pixel density
Utils.use_high_density_display = true;
Utils.updateDevicePixelRatio = function () {
    Utils.device_pixel_ratio = (Utils.use_high_density_display && window.devicePixelRatio) || 1;
};

// Mark thread as main or worker
(function() {
    try {
        if (window.document !== undefined) {
            Utils.isWorkerThread = false;
            Utils.isMainThread   = true;
            Utils.updateDevicePixelRatio();
        }
    }
    catch (e) {
        if (self !== undefined) {
            Utils.isWorkerThread = true;
            Utils.isMainThread   = false;
        }
    }
})();

// Get URL that the current script was loaded from
// If currentScript is not available, loops through <script> elements searching for a list of provided paths
// e.g. Utils.findCurrentURL('tangram.debug.js', 'tangram.min.js');
Utils.findCurrentURL = function (...paths) {
    // Find currently executing script
    var script = document.currentScript;
    if (script) {
        return script.src;
    }
    else if (Array.isArray(paths)) {
        // Fallback on looping through <script> elements if document.currentScript is not supported
        var scripts = document.getElementsByTagName('script');
        for (var s=0; s < scripts.length; s++) {
            for (var path of paths) {
                if (scripts[s].src.indexOf(path) > -1) {
                   return scripts[s].src;
                }
            }
        }
    }
};

// Used for differentiating between power-of-2 and non-power-of-2 textures
// Via: http://stackoverflow.com/questions/19722247/webgl-wait-for-texture-to-load
Utils.isPowerOf2 = function(value) {
    return (value & (value - 1)) === 0;
};

Utils.nextPowerOf2 = function(value) {
    return Math.pow(2, Math.ceil(Math.log2(value)));
};

// Interpolate 'x' along a series of control points
// 'points' is an array of control points in the form [x, y]
//
// Example:
//     Control points:
//         [0, 5]:  when x=0, y=5
//         [4, 10]: when x=4, y=10
//
//     Utils.interpolate(2, [[0, 5], [4, 10]]);
//     -> computes x=2, halfway between x=0 and x=4: (10 - 5) / 2 +5
//     -> returns 7.5
//
// TODO: add other interpolation methods besides linear
//
Utils.interpolate = function(x, points) {
    // If this doesn't resemble a list of control points, just return the original value
    if (!Array.isArray(points) || !Array.isArray(points[0])) {
        return points;
    }
    else if (points.length < 1) {
        return points;
    }

    var x1, x2, d, y;

    // Min bounds
    if (x <= points[0][0]) {
        y = points[0][1];
    }
    // Max bounds
    else if (x >= points[points.length-1][0]) {
        y = points[points.length-1][1];
    }
    // Find which control points x is between
    else {
        for (var i=0; i < points.length - 1; i++) {
            if (x >= points[i][0] && x < points[i+1][0]) {
                // Linear interpolation
                x1 = points[i][0];
                x2 = points[i+1][0];

                // Multiple values
                if (Array.isArray(points[i][1])) {
                    y = [];
                    for (var c=0; c < points[i][1].length; c++) {
                        d = points[i+1][1][c] - points[i][1][c];
                        y[c] = d * (x - x1) / (x2 - x1) + points[i][1][c];
                    }
                }
                // Single value
                else {
                    d = points[i+1][1] - points[i][1];
                    y = d * (x - x1) / (x2 - x1) + points[i][1];
                }
                break;
            }
        }
    }
    return y;
};

// Iterators (ES6 generators)

// Iterator for key/value pairs of an object
Utils.entries = function* (obj) {
    for (var key of Object.keys(obj)) {
        yield [key, obj[key]];
    }
};

// Iterator for values of an object
Utils.values = function* (obj) {
    for (var key of Object.keys(obj)) {
        yield obj[key];
    }
};

// Recursive iterators for all properties of an object, no matter how deeply nested
// TODO: fix for circular structures
Utils.recurseEntries = function* (obj) {
    if (!obj) {
        return;
    }
    for (var key of Object.keys(obj)) {
        if (obj[key]) {
            yield [key, obj[key], obj];
            if (typeof obj[key] === 'object') {
                yield* Utils.recurseEntries(obj[key]);
            }
        }
    }
};

Utils.recurseValues = function* (obj) {
    if (!obj) {
        return;
    }
    for (var key of Object.keys(obj)) {
        if (obj[key]) {
            yield obj[key];
            if (typeof obj[key] === 'object') {
                yield* Utils.recurseValues(obj[key]);
            }
        }
    }
};

// Scale a *signed* short for use in a GL VBO
// `unit` is an optional scaling factor to mimic fixed point, since these values will be
// normalized to 0-1, e.g. divide input by unit on the way in, multiply it back in the shader
Utils.scaleInt16 = function (val, unit) {
    return (val / unit) * 32767;
};

Utils.degToRad = function (degrees) {
    return degrees * Math.PI / 180;
};

Utils.radToDeg = function (radians) {
    return radians * 180 / Math.PI;
};

Utils.toCanvasColor = function (color) {
    return 'rgb(' +  Math.round(color[0] * 255) + ',' + Math.round(color[1]  * 255) + ',' + Math.round(color[2] * 255) + ')';
};

// Some Canvas implementations have pre-multiplied alpha that we need to adjust for
Utils.canvasPremultipliedAlpha = function () {
    return (Utils.browser().ios ? false : true);
};

Utils.toPixelSize = function (size, kind) {
    if (kind === "px") {
        return size;
    } else if (kind === "em") {
        return 16 * size;
    } else if (kind === "pt") {
        return size / 0.75;
    } else if (kind === "%") {
        return size / 6.25;
    }
};

Utils.pointInTile = function (point) {
    return point[0] >= 0 && point[1] > -Geo.tile_scale && point[0] < Geo.tile_scale && point[1] <= 0;
};

// http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
Utils.hashString = function(str) {
    if (str.length === 0) {
        return 0;
    }
    let hash = 0;

    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash;
};

Utils.debounce = function (func, wait, immediate) {
    let timeout;
    return function() {
        let context = this,
            args = arguments;
        let later = function() {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };
        let callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) {
            func.apply(context, args);
        }
    };
};
