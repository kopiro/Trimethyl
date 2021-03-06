/**
 * @module  calendar
 * @author  Andrea Jonus <andrea.jonus@caffeina.com>
 */

var Dialog = require('T/dialog');
var Util = require('T/util');
var Permissions = require('T/permissions');

/** 
 * Adds a Ti.Calendar.Event to a calendar selected from an option dialog.
 * 
 * @param {Ti.Calendar.Event}	newEvent	The Event to add to the calendar. See the doc page for Titanium.Calendar.Event.
 * @param {Function}			success		The callback to invoke on success.
 * @param {Function}			error		The callback to invoke on error.
 */
exports.addEvent = function(newEvent, success, error) {
	title = L('calendar', 'Calendar');
	success = _.isFunction(success) ? success : Alloy.Globals.noop;
	error = _.isFunction(error) ? error : Alloy.Globals.noop;

	Permissions.requestCalendarPermissions(function() {
		var options = _.map(Ti.Calendar.allCalendars, function(calendar) {
			return {
				title: calendar.name,
				calendarID: calendar.id,
				callback: function (e) {
					var result = false;
					var cre = calendar.createEvent(newEvent);
					if (OS_IOS) { // iOS needs an event.save()
						result = cre.save(Titanium.Calendar.SPAN_THISEVENT);
					} else {
						result = cre && !_.isEmpty(cre);
					}
					if (result == true) {
						success(cre);
						return true;
					} else {
						error();
						return false;
					}
				}
			};
		});
		options.push({title: L('cancel', 'Cancel'), cancel: true});

		if (OS_IOS) {
			if (Ti.Calendar.eventsAuthorization === Ti.Calendar.AUTHORIZATION_AUTHORIZED) {
				Dialog.option(title, options);
			}
			else Ti.Calendar.requestEventsAuthorization(function(e) {
				if (e.success) Dialog.option(title, options);
				else Dialog.alert(L('warning', 'Warning!'), L('calendar_unauthorized', 'You are not authorized to modify this calendar.'), error);
			});
		} else if (OS_ANDROID) {
			Dialog.option(title, options);
		}
	}, error);
};
