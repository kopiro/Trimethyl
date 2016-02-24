/**
 * @class  	HTTP
 * @author  Flavio De Stefano <flavio.destefano@caffeinalab.com>
 */

/**
 * @property config
 * @property {String}  config.base The base URL of the API
 * @property {Number}  [config.timeout=30000] Global timeout for the reques. after this value (express in milliseconds) the requests throw an error.
 * @property {Object}  [config.headers={}] Global headers for all requests.
 * @property {Object}  [config.useCache=true] Global cache flag.
 * @property {Object}  [config.offlineCache=false] Global offline cache.
 * @property {Boolean} [config.log=false] Log the requests.
 * @property {Boolean} [config.bodyEncodingInJSON=false] Force to encoding in JSON of body data is the input is a JS object.
 */
exports.config = _.extend({
	base: '',
	timeout: 30000,
	headers: {},
	useCache: true,
	offlineCache: false,
	log: false,
	bodyEncodingInJSON: false
}, Alloy.CFG.T ? Alloy.CFG.T.http : {});

var Event = require('T/event');
var Util = require('T/util');
var Cache = require('T/cache');
var Q = require('T/ext/q');

function extractHTTPText(data, info) {
	if (info != null && data != null) {
		if (info.format === 'json') {
			return Util.parseJSON(data);
		}
	}
	return data;
}

function HTTPRequest(opt) {
	var self = this;
	if (opt.url == null) {
		throw new Error('HTTP.Request: URL not set');
	}

	this.opt = opt;

	// if the url is not matching a protocol, assign the base URL
	if (/\:\/\//.test(opt.url)) {
		this.url = opt.url;
	} else {
		this.url = exports.config.base.replace(/\/$/, '') + '/' + opt.url.replace(/^\//, '');
	}

	this.domain = Util.getDomainFromURL(this.url);
	this.method = opt.method != null ? opt.method.toUpperCase() : 'GET';

	// Construct headers: global + per-domain + local
	this.headers = _.extend({}, exports.getHeaders(), exports.getHeaders(this.domain), opt.headers);
	this.timeout = opt.timeout != null ? opt.timeout : exports.config.timeout;

	// Rebuild the URL if is a GET and there's data
	if (opt.data != null) {
		if (this.method === 'GET') {
			if (typeof opt.data === 'object') {
				var exQuery = /\?.*/.test(this.url);
				this.url = this.url + Util.buildQuery(opt.data, exQuery ? '&' : '?');
			}
		} else {
			if (exports.config.bodyEncodingInJSON == true || opt.bodyEncodingInJSON == true) {
				this.headers['Content-Type'] = 'application/json';
				this.data = JSON.stringify(opt.data);
			} else {
				this.data = opt.data;
			}
		}
	}

	this.hash = this._calculateHash();
	this.uniqueId = exports.getUniqueId();

	// Fill the defer, we will manage the callbacks through it
	this.defer = Q.defer();
	this.defer.promise.then(function() { self._onSuccess.apply(self, arguments); });
	this.defer.promise.fail(function() { self._onError.apply(self, arguments); });
	this.defer.promise.fin(function() { self._onFinally.apply(self, arguments); });

	if (!ENV_PRODUCTION) {
		Ti.API.debug('HTTP: <' + this.uniqueId + '>', this.method, this.url, this.data);
	}
}

HTTPRequest.prototype.toString = function() {
	return this.hash;
};

HTTPRequest.prototype._maybeCacheResponse = function(data) {
	if (this.method !== 'GET') return;

	if (exports.config.useCache === false || this.opt.cache === false) {
		Ti.API.trace('HTTP: <' + this.uniqueId + '> cache has been disabled');
		return;
	}

	if (this.responseInfo.ttl <= 0) {
		Ti.API.trace('HTTP: <' + this.uniqueId + '> cache is not applicable');
		return;
	}

	Cache.set(this.hash, data, this.responseInfo.ttl, this.responseInfo);
};

HTTPRequest.prototype.getCachedResponse = function() {
	if (exports.config.useCache === false || this.opt.cache === false || this.opt.refresh === true || this.method !== 'GET') {
		return;
	}

	this.cachedData = Cache.get(this.hash);

	if (this.cachedData == null) {
		return;
	}

	Ti.API.trace('HTTP: <' + this.uniqueId + '> cache hit up to ' + (this.cachedData.expire - Util.now()) + 's');

	if (this.cachedData.info.format === 'blob') {
		return this.cachedData.value;
	}

	return extractHTTPText(this.cachedData.value.text, this.cachedData.info);
};

HTTPRequest.prototype._getResponseInfo = function() {
	if (this.client == null || this.client.readyState <= 1) {
		throw new Error('HTTP.Request: Client is null or not ready');
	}

	var headers = {
		Expires: this.client.getResponseHeader('Expires'),
		ContentType: this.client.getResponseHeader('Content-Type'),
		TTL: this.client.getResponseHeader('X-Cache-Ttl')
	};

	var info = {
		format: 'blob',
		ttl: 0
	};

	if (this.client.responseText != null) {
		info.format = 'text';
		if (/^application\/json/.test(headers.ContentType)) info.format = 'json';
	}

	// Always prefer X-Cache-Ttl over Expires
	if (headers.TTL != null) {
		info.ttl = headers.TTL;
	} else if (headers.Expires != null) {
		info.ttl = Util.timestamp(headers.Expires) - Util.now();
	}

	// Override
	if (this.opt.format != null) info.format = this.opt.format;
	if (this.opt.ttl != null) info.ttl = this.opt.ttl;

	return info;
};

HTTPRequest.prototype._onError = function(err) {
	var self = this;
	Ti.API.error('HTTP: <' + this.uniqueId + '>', err);

	if (_.isFunction(this.opt.error)) this.opt.error(err);
};

HTTPRequest.prototype._onSuccess = function() {
	if (exports.config.log === true) {
		Ti.API.trace('HTTP: <' + this.uniqueId + '>', arguments[0]);
	}

	if (OS_ANDROID && this.client != null) {
		if ((this.client.status >= 300 && this.client.status < 400) && this.client.location != this.url) {
			Ti.API.trace('HTTP: <' + this.uniqueId + '> following redirect to ' + this.client.location);

			exports.send(_.extend(this.opt, { url: this.client.location }));
			return;
		}
	}

	if (_.isFunction(this.opt.success)) this.opt.success.apply(this, arguments);
};

HTTPRequest.prototype._onFinally = function() {
	if (_.isFunction(this.opt.complete)) this.opt.complete.apply(this, arguments);
}

HTTPRequest.prototype._whenComplete = function(e) {
	this.endTime = Date.now();
	exports.removeFromQueue(this);

	// Fire the global event
	if (this.opt.silent !== true) {
		Event.trigger('http.end', {
			hash: this.hash,
			eventName: this.opt.eventName
		});
	}

	try {
		this.responseInfo = this._getResponseInfo();
	} catch (ex) {
		this.defer.reject({ broken: true });
		return;
	}

	var data = null;
	if (this.opt.format === 'blob') {
		data = this.client.responseData;
	} else {
		data = extractHTTPText(this.client.responseText, this.responseInfo);
	}

	if (e.success) {
		Ti.API.trace('HTTP: <' + this.uniqueId + '> response success (in ' + (this.endTime-this.startTime) + 'ms)');

		this._maybeCacheResponse(data);
		this.defer.resolve(data);

	} else {
		this.defer.reject({
			message: (this.opt.format === 'blob') ? null : Util.getErrorMessage(data),
			error: e.error,
			code: this.client.status,
			response: data
		});
	}
};

HTTPRequest.prototype._calculateHash = function() {
	var hash = this.url + Util.hashJavascriptObject(this.data) + Util.hashJavascriptObject(this.headers);
	return 'http_' + Ti.Utils.md5HexDigest(hash);
};


HTTPRequest.prototype.send = function() {
	var self = this;

	var promise = Q();
	_.each(filters, function(filter) {
		promise = promise.then( filter.bind(null, self) );
	});

	promise
	.then(self._send.bind(self))
	.fail(function(err) {
		Ti.API.error('HTTP: <' + self.uniqueId + '> send prevented by filters', err);
	})
};

HTTPRequest.prototype._send = function() {
	var self = this;

	var client = Ti.Network.createHTTPClient({
		timeout: this.timeout,
		cache: false,
	});

	client.onload = client.onerror = function(e) { self._whenComplete(e); };

	// Add this request to the queue
	exports.addToQueue(this);

	if (this.opt.silent !== true) {
		Event.trigger('http.start', {
			hash: this.hash,
			eventName: this.opt.eventName
		});
	}

	// Progress callbacks
	if (_.isFunction(this.opt.ondatastream)) client.ondatastream = this.opt.ondatastream;
	if (_.isFunction(this.opt.ondatasend)) client.ondatasend = this.opt.ondatasend;

	client.open(this.method, this.url);

	// Set file receiver
	if (this.opt.file != null) {
		client.file = this.opt.file;
	}

	// Set headers
	_.each(this.headers, function(h, k) {
		client.setRequestHeader(k, h);
	});

	// Send the request over Internet
	this.startTime = Date.now();
	if (this.data != null) {
		client.send(this.data);
	} else {
		client.send();
	}

	this.client = client;
};

HTTPRequest.prototype.resolve = function() {	
	var cache = null;

	if (Ti.Network.online) {

		cache = this.getCachedResponse();
		if (cache != null) {
			this.defer.resolve(cache);
		} else {
			this.send();
		}

	} else {

		Event.trigger('http.offline');

		if (exports.config.offlineCache === true || this.opt.offlineCache === true) {
			cache = this.getCachedResponse();
			if (cache != null) {
				this.defer.resolve();
			} else {
				this.defer.reject({
					offline: true,
					message: L('network_offline', 'Check your connectivity.')
				});
			}
		} else {
			this.defer.reject({
				offline: true,
				message: L('network_offline', 'Check your connectivity.')
			});
		}

	}
};

HTTPRequest.prototype.abort = function() {
	if (this.client != null) {
		this.client.abort();
		Ti.API.debug('HTTP: <' + this.uniqueId + '> aborted!');
	}
};

HTTPRequest.prototype.success = HTTPRequest.prototype.then = function(func) {
	this.defer.promise.then(func);
	return this;
};

HTTPRequest.prototype.error = HTTPRequest.prototype.fail = HTTPRequest.prototype.catch = function(func) {
	this.defer.promise.catch(func);
	return this;
};

HTTPRequest.prototype.complete = HTTPRequest.prototype.fin = HTTPRequest.prototype.finally = function(func) {
	this.defer.promise.finally(func);
	return this;
};

HTTPRequest.prototype.getPromise = function() {
	return this.defer.promise;
};


var filters = {};

/**
 * @method addFilter
 * @param {String} 	name 	The name of the middleware
 * @param {Function} func  The function
 */
exports.addFilter = function(name, func) {
	filters[name] = func;
};

/**
 * @method removeFilter
 * @param {String} 	name 	The name of the middleware
 */
exports.removeFilter = function(name, func) {
	delete filters[name];
};

/**
 * @method event
 */
exports.event = function(name, cb) {
	Event.on('http.' + name, cb);
};

/**
 * @method getUniqueId
 * @return {String}
 */
var __uniqueId = 0;
exports.getUniqueId = function() {
	return __uniqueId++;
};

var headers = _.clone(exports.config.headers);
var headersPerDomain = {};

/**
 * @method getHeaders
 * @return {Object}
 */
exports.getHeaders = function(domain) {
	if (domain == null) {
		return headers;
	} else {
		return headersPerDomain[domain] || {};
	}
};

/**
 * @method addHeader
 * Add a global header for all requests
 * @param {String} key 					The header key
 * @param {String} value 				The header value
 * @param {String} [domain=null]		Optional domain
 */
exports.addHeader = function(key, value, domain) {
	if (domain == null) {
		headers[key] = value;
	} else {
		headersPerDomain[domain] = headersPerDomain[domain] || {};
		headersPerDomain[domain][key] = value;
	}
};

/**
 * @method removeHeader
 * Remove a global header
 * @param {String} key 					The header key
 * @param {String} [domain=null] 	Optional domain
 */
exports.removeHeader = function(key, domain) {
	if (domain == null) {
		delete headers[key];
	} else {
		if (headersPerDomain[domain] != null) {
			delete headersPerDomain[domain][key];
		}
	}
};

/**
 * @method resetHeaders
 * Reset all globals headers
 * @param {String} [domain=null]		Optional domain
 */
exports.resetHeaders = function(domain) {
	if (domain == null) {
		headers = {};
		headersPerDomain = {};
	} else {
		headersPerDomain[domain] = {};
	}
};


var queue = [];

/**
 * @method isQueueEmpty
 * Check if the requests queue is empty
 * @return {Boolean}
 */
exports.isQueueEmpty = function(){
	return _.isEmpty(queue);
};

/**
 * @method getQueue
 * Get the current requests queue
 * @return {Array}
 */
exports.getQueue = function(){
	return queue;
};

/**
 * @method addToQueue
 * Add a request to queue
 * @param {HTTP.Request} request
 */
exports.addToQueue = function(request) {
	queue[request.hash] = request;
};

/**
 * @method removeFromQueue
 * Remove a request from queue
 */
exports.removeFromQueue = function(request) {
	delete queue[request.hash];
};

/**
 * @method resetCookies
 * Reset the cookies for all requests
 */
exports.resetCookies = function() {
	Ti.Network.createHTTPClient().clearCookies(exports.config.base);
};


/**
 * The main function of the module.
 *
 * Create an HTTP.Request and resolve it
 *
 * @param  {Object}	 opt 		The request dictionary
 * * * **url**: The endpoint URL
 * * **method**: The HTTP method to use (GET|POST|PUT|PATCH|..)
 * * **headers**: An Object key-value of additional headers
 * * **timeout**: Timeout after stopping the request and triggering an error
 * * **cache**: Set to false to disable the cache
 * * **success**: The success callback
 * * **error**: The error callback
 * * **format**: Override the format for that request (like `json`)
 * * **ttl**: Override the TTL seconds for the cache
 * @return {HTTP.Request}
 */
function send(opt) {
	var request = new HTTPRequest(opt);
	request.resolve();
	return request;
}
exports.send = send;


/**
 * @method get
 * Make a GET request to that URL
 * @param  {String}   	url The endpoint url
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error Error callback
 * @return {HTTP.Request}
 */
exports.get = function(url, success, error) {
	return send({
		url: url,
		method: 'GET',
		success: success,
		error: error
	});
};


/**
 * @method post
 * Make a POST request to that URL
 * @param  {String}   	url 		The endpoint url
 * @param  {Object}   	data 		The data
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error 	Error callback
 * @return {HTTP.Request}
 */
exports.post = function(url, data, success, error) {
	return send({
		url: url,
		method: 'POST',
		data: data,
		success: success,
		error: error
	});
};


/**
 * @method  getJSON
 * Make a GET request to that url with that data and setting the format forced to JSON
 * @param  {String}   	url 		The endpoint url
 * @param  {Object}   	data 		The data
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error 	Error callback
 * @return {HTTP.Request}
 */
exports.getJSON = function(url, data, success, error) {
	return send({
		url: url,
		data: data,
		method: 'GET',
		format: 'json',
		success: success,
		error: error
	});
};


/**
 * @method  postJSON
 * Make a POST request to that url with that data and setting the format forced to JSON
 * @param  {String}   	url 			The endpoint url
 * @param  {Object}   	data 			The data
 * @param  {Function} 	success  	Success callback
 * @param  {Function} 	error 		Error callback
 * @return {HTTP.Request}
 */
exports.postJSON = function(url, data, success, error) {
	return send({
		url: url,
		data: data,
		method: 'POST',
		format: 'json',
		success: success,
		error: error
	});
};


/**
 * @method download
 * @param  {String}  			url  				The url
 * @param  {Object}  			filename  		File name or `Ti.File`
 * @param  {Function}  			success  		Success callback
 * @param  {Function} 			error  			Error callback
 * @param  {Function}  			ondatastream  	Progress callback
 * @return {HTTP.Request}
 */
exports.download = function(url, file, success, error, ondatastream) {
	var doDownload = function() {
		var tiFile = null;
		if (file == null) {
			tiFile = Ti.Filesystem.getFile(Util.getAppDataDirectory(), _.uniqueId('http_'));
		} else if (_.isString(file)) {
			tiFile = Ti.Filesystem.getFile(Util.getAppDataDirectory(), file);
		} else {
			tiFile = file;
		}

		if (tiFile.exists()) {
			Ti.API.warn('HTTP: Previous file ' + tiFile.nativePath + ' exists and has been deleted');
			tiFile.deleteFile();
		}

		send({
			url: url,
			cache: false,
			refresh: true,
			format: 'blob',
			file: tiFile.resolve(),
			ondatastream: ondatastream,
			error: error,
			success: function() {
				if (tiFile.exists()) {
					success(tiFile);
				} else {
					error({
						message: L('unable_to_write_file', 'Unable to write file')
					});
				}
			}
		});
	};

	if (OS_IOS) {
		doDownload();
	} else if (OS_ANDROID) {
		if (Ti.Media.hasCameraPermissions() === true) {
			doDownload();
		} else {
			Ti.Media.requestCameraPermissions(function(e) {
				if (e.success === false) {
					return error({
						message: L('missing_permission_write_file', 'Missing permission to write file')
					});
				}

				doDownload();
			});
		}
	}
};

/**
 * @method exportCookiesToSystem
 * Export the HTTP cookies to the system to make them available to `WebViews`
 * @param  {String} domain The domain. Default is `HTTP.config.base`
 */
exports.exportCookiesToSystem = function(domain) {
	if (!OS_ANDROID) return;

	domain = domain || exports.config.base.replace('http://', '');
	_.each(Ti.Network.getHTTPCookiesForDomain(domain), function(c) {
		Ti.Network.addSystemCookie(c);
	});
};


//////////
// Init //
//////////

headers['X-Ti-Version']  = Ti.version;
headers['X-Platform'] = Util.getPlatformFullName();

headers['X-App-Id'] = Ti.App.id;
headers['X-App-Version'] = Ti.App.version;
headers['X-App-DeployType'] = Ti.App.deployType;

if (OS_IOS) {
	headers['X-App-InstallId'] = Ti.App.installId;
}
