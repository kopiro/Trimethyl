/**
 * @module  permissions
 * @author  Andrea Jonus <andrea.jonus@caffeina.com>
 */

/**
 * @property config
 */
exports.config = _.extend({
	// Placeholder for future configurations
}, Alloy.CFG.T ? Alloy.CFG.permissions : {});

var PERMISSIONS_TYPES = [
{ name: 'Calendar', proxy: 'Calendar'},
{ name: 'Camera', proxy: 'Media'},
{ name: 'Contacts', proxy: 'Contacts'},
{ name: 'Location', proxy: 'Geolocation'},
{ name: 'Storage', proxy: 'Filesystem'}
];

PERMISSIONS_TYPES.forEach(function(type) {
	exports['request' + type.name + 'Permissions'] = function(success, error) {
		success = _.isFunction(success) ? success : Alloy.Globals.noop;
		error = _.isFunction(error) ? error : Alloy.Globals.noop;

		if (Ti[type.proxy]['has' + type.name + 'Permissions']() !== true) {
			Ti[type.proxy]['request' + type.name + 'Permissions'](function(res) {
				if (res.success === true) {
					success();
				} else {
					Ti.API.error('Permissions: Error while requesting ' + type.name + ' permissions:', res.error);
					error({ message: L('error_' + type.name.toLowerCase() + '_permissions', 'Missing ' + type.name.toLowerCase() + ' permissions') });
				}
			});
		} else {
			success();
		}
	};
});
