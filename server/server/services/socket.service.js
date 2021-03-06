'use strict';

import socketioJwt from 'socketio-jwt';
import User from '../models/user.model';
import cfg from '../config/env';
import Conversation from '../models/conversation.model';
import Messages from '../models/messages.model';

const app = require('express')();
const http = require('http').Server(app);
const _ = require('underscore')._;
const io = require('socket.io')(http);
const util = require('util');
const Room = require('../models/room.js');
var mongo = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;
var db_collection_messages = null;
var db_collection_conversations = null;

/**
 * Listen socket service and register listeners
 */
function listen() {
    http.listen(cfg.socketPort, () => {
        console.log('Socket service started on port ' + cfg.socketPort);
        mongo.connect(cfg.db, function(err, db) {
            if (err) {
                console.log("Error connecting Mongo for sockets: " + util.inspect(err, false, null));
            }
            db_collection_messages = db.collection('messages');
            db_collection_conversations = db.collection('conversations');
            listeners();
        });
    });
}

//io.set("log level", 1);
var people = {};
var rooms = {};
var sockets = [];
//var chatHistory = {};

/**
 * Listeners
 */
function listeners() {
    io
    .on('connection', socketioJwt.authorize({
            secret: cfg.jwt,
            timeout: 60000
                     }), console.log('Socket connection on port ' + cfg.socketPort))
        .on('authenticated', function(socket) {
            console.log("authenticated: " + socket.decoded_token._id);
             people[socket.id] = {
	            "id": socket.decoded_token._id,
	            "name": "",
	            "owns": "",
	            "inroom": "",
	            "device": "",
	            "participants": []
	        };
	        sockets.push(socket);

            //        joinRoom(socket);
            connectedListeners(socket);
            //        nearestAd(socket);
        });
    //    .on('connection', nearestAd);
}

/**
 * Connected listeners
 * @param socket {socket} - socket connection
 */
function connectedListeners(socket) {

    socket.onclose = function(reason) {

	  var i = sockets.indexOf(socket);
	  if(i >= 0) {
	  	//console.log("deleted from sockets")
	  	sockets.splice(i, 1);
	  }

	 // var numClients = io.sockets.adapter.rooms[socket.room]
	 // if (numClients == undefined) {
		////console.log(socket.decoded_token._id + " was last in a room " + socket.room)
		//delete rooms[socket.room]
	 // }

	  var rooms = Object.keys(socket.rooms)
	  rooms.forEach(function(room) {
		  try { // in case there are no sockets in room
		  	io.sockets.in(room).emit("update-people", {onlineStatus: false, id: people[socket.id].id})
		  } catch(err) {
		  }
	  })

	  people[socket.id].participants.forEach(function(id) {
		for(var key in people) {
			if(id == people[key].id) {
				try {
					io.sockets.connected[key].emit("update-people", {onlineStatus: false, id: people[socket.id].id})
				} catch (err) {
				}
			}
		};
	  })

	  delete people[socket.id];

      Object.getPrototypeOf(this).onclose.call(this, reason);
    }



	socket.on('disconnect', function() {
	  console.log('Got disconnect! ' + socket.decoded_token._id);
	});

    socket.on("joinserver", function(name, device) {
        console.log("joined server: " + name);
        //                  var exists = false;
        people[socket.id].name = name
        people[socket.id].device = device

        var sizePeople = _.size(people);
        var sizeRooms = _.size(rooms);
        socket.emit("joined"); //extra emit for GeoLocation
        //io.sockets.emit("update", people[socket.id].name + " is online.")
        //                  }
    });

    socket.on("send", function(data) {
    	//console.log("updated conversation: " + util.inspect(data,false,null));
        var conversationId = data.conversationId;
        var whitespacePattern = /^\s*$/;
        if (whitespacePattern.test(data.message)) {
            //console.log('Invalid! Cannot insert empty string.');
            socket.emit("update", 'Did you typed in a MESSAGE yet?');
            return;
        }

 	 	//var found = false;
        if (data.opponent != null) { // private message

        	var msTime = data.date;
            new Promise((resolve, reject) => {
        		if(conversationId != null)
        			resolve({_id: conversationId})

            	return Conversation.getConversation([socket.decoded_token._id, data.opponent])
            	.then(c => {
                		if(c)
                			resolve(c) 

			        	resolve(Conversation.create([socket.decoded_token._id, data.opponent]))			        								        		
			     })		
           	})
        	.then(function(conv, error) {
                Messages.insert({
                	guid: data.guid,
                	conversationId: ObjectId(conv._id),
                    createdAt: msTime,
                    Name: people[socket.id].name,
                    Message: data.message,
                    _creator: ObjectId(socket.decoded_token._id),
                    _to:ObjectId(data.opponent),
                    replyGuid: data.replyGuid,
                    replyId: data.replyId,
                    replyQuote: data.replyQuote
                }).then((message, error) => {
                	if(error)
                		console.log(error)

                    Conversation.updateWithMessage(message)
                    .then((c, err) => {
						if(c) {
							socket.emit("conversation", message.conversationId);

							User.get({_id:ObjectId(socket.decoded_token._id)}, {image: 1})
							.then(u => { 
				                User.get({_id:ObjectId(data.opponent)}, {image: 1})
				                .then( u => {
						            var keys = Object.keys(people);
						            var whisperId;
						            if (keys.length != 0) {
						                for (var i = 0; i < keys.length; i++) {
						                    if (people[keys[i]].id === data.opponent) {
						                        whisperId = keys[i];

								                io.sockets.connected[keys[i]].emit("whisper", {
								                	userAvatarPrefix:cfg.userAvatarPrefix(),
								                    msTime: msTime,
								                    socketID: people[socket.id],
								                    msg: data.message,
								                    userImage: u.image || false,
								                    participantOnline: true,
								                    replyGuid: data.replyGuid,
								                    replyId: data.replyId,
								                    replyQuote: data.replyQuote,
								                    guid: data.guid
								                })

						                        break;
						                    }
						                }
						            }
					            })
					            .catch(e => console.log(e))
			                })
			                .catch(e => console.log(e))
						}
					})
					.catch(e => console.log(e))
                })
		    })
        	.catch(e => console.log({success: false, error: e}))
        } else { // if not wisper
            if (io.sockets.adapter.sids[socket.id][socket.room] !== undefined) {

				User.get({_id:ObjectId(socket.decoded_token._id)}, {image: 1})
				.then(u => { 
	              io.sockets.connected[socket.id].broadcast.to(socket.room).emit("chat", {
				        userAvatarPrefix:cfg.userAvatarPrefix(),
	                    msTime: msTime,
	                    socketID: people[socket.id],
	                    userImage: u.image || false,
	                    msg: data.message,
	                    replyGuid: data.replyGuid,
	                    replyId: data.replyId,
	                    replyQuote: data.replyQuote,
	                    guid: data.guid
	                });
	                Messages.insert({
	                	guid: data.guid,
	                    Room: socket.room,
	//                    createdAt: msTime,
	                    Name: people[socket.id].name,
	                    Message: data.message,
	                    _creator: ObjectId(socket.decoded_token._id),
	                    _to:ObjectId(data.id),
	                    replyGuid: data.replyGuid,
	                    replyId: data.replyId,
	                    replyQuote: data.replyQuote
	                }).then((message, error) => {
	                	if(error)
	                    	console.log('error inserting a message into db: ' + error);
	                });
                });

            } else {
                socket.emit("update", "Please connect to a room.");
            }
        }
    });

    //Room functions
    function CreateRoom(name) {
	// TODO: sometimes crashes with: Cannot read property 'inroom' of undefined
        //                  var id = uuid.v4();
        var id = name;
        var room = new Room(name, id, socket.id);
        rooms[id] = room;
        var sizeRooms = _.size(rooms);
        socket.emit("roomList", {
            rooms: rooms,
            count: sizeRooms
        });
        //add room to socket, and auto join the creator of the room
        socket.room = name;
        socket.join(socket.room);
        people[socket.id].owns = id;
        people[socket.id].inroom = id;
        room.addPerson(socket.id);
        socket.emit("update", "Welcome to " + room.name + ".");
        socket.emit("sendRoomID", {
            id: id
        });
        //                      chatHistory[socket.room] = [];
    };

    socket.on("check", function(name, fn) {
        var match = false;
        _.find(rooms, function(key, value) {
            if (key.name === name)
                return match = true;
        });
        fn({
            result: match
        });
    });

    socket.on("removeRoom", function(id) {
        var room = rooms[id];
        if (socket.id === room.owner) {
            purge(socket, "removeRoom");
        } else {
            socket.emit("update", "Only the owner can remove a room.");
        }
    });

    socket.on("joinRoom", function(id) {
        if (io.sockets.adapter.rooms[id] == undefined) {
            CreateRoom(id)
        }
        var room = rooms[id];
        room.addPerson(socket.id);
        people[socket.id].inroom = id;
        socket.room = room.name;
        socket.join(socket.room);
        var user = people[socket.id];
        io.sockets.in(socket.room).emit("update", user.name + " has connected to " + room.name + " room.");
        socket.emit("update", "Welcome to " + room.name + ".");
        socket.emit("sendRoomID", {
            id: id
        });
        //                                      var keys = _.keys(chatHistory);
        //                                      if (_.contains(keys, socket.room)) {
        //                                          socket.emit("history", chatHistory[socket.room]);
        //                                      }
    });

    socket.on("leaveRoom", function(id) {
        var room = rooms[id];
        if (room)
            purge(socket, "leaveRoom");
    });

    io.on('disconnect', () => {
        changeStatus({
            _id: socket.decoded_token._id,
            status: 0
        })
        console.log('Socket service disconnect on port ' + cfg.socketPort);
    });

    io.on('connect_error', () => console.log('Connection failed'));

    io.on('reconnect_failed', () => console.log('Reconnection failed'));
}

/**
 * Join user to individually room
 * Change status user to online
 * @param socket {socket} - socket connection
 */
function joinRoom(socket) {
    changeStatus({
        _id: socket.decoded_token._id,
        status: 1
    });
    socket.join(socket.decoded_token._id);
}

/**
 * Get nearest Group dates
 * @param socket {socket} - socket connection
 */
function nearestAd(socket) {
    console.log('a user connected')
    socket.emit('hi', 'more data');

    socket.on('hi2', function(d) {

        console.log("hi2" + d);
        socket.emit('hi2back', 'more data');
    });

    // simple test
    socket.on('hi', function(d) {
        console.log("hi" + d);
        socket.emit('hi', 'more data');
    });
}

function hi(socket) {
    console.log('on hi');
}

/**
 * Change status user
 * @param _id {_id} - Unique id user
 * @param status {status} - online status user
 */
function changeStatus({
    _id,
    status
}) {
    User.edit({
            _id: _id
        }, {
            status: status
        })
        .then()
        .catch(e => console.log(e))
}

/**
 * Alarm remove Group
 * @param _id {_id} - Unique ID user
 * @param data {data} - Send JSON user
 */
function alarmPublication(_id, data) {
    io.sockets.to(_id).emit('group:remove', data);
}

/**
 * Alarm nearest date Group
 * @param _id {_id} - Unique ID user
 * @param data {data} - Send JSON user
 */
function alarmNearest(_id, data) {
    io.sockets.to(_id).emit('group:nearest', data);
}

function getOnline(ids, client){
	var dictionary = {}
	var idsArr = ids.split(',')
	idsArr.forEach(function(id) {
		for(var key in people) {
			if(id == people[key].id) {
				dictionary[id] = true
				people[key].participants.push(client)
			}
		};

		if(dictionary[id] == undefined)
			dictionary[id] = false
	});
	return dictionary
}

function setIsTyping(user, client, room, timestamp){
	//console.log("is typing called with client: " + client + " room " + util.inspect(room, false, null) + " timestamp "+ timestamp)
	// TODO: move searching in people to redis
	for(var key in people) {
		try {
		      if (room.length > 0 && user == people[key].id) {
			      	io.sockets.connected[key].broadcast.to(room).emit("isTyping", {person: user})
			      	break
		      }
		      else if(client.length > 0 && client == people[key].id) // private chat
		      {
					io.sockets.connected[key].emit("isTyping", {person: user});
					break
		      }
	      } catch (err) {
	      	console.log(err)
	      }
	};
}

function broadcastDeleteMessage(user, client, room, messageGuid) {
	try {
		if (room != undefined) {
		  	io.sockets.in(room).emit("messageDeleted", {guid: messageGuid})
		} 
		else 
		{
			// TODO: move searching in people to redis
			for(var key in people) {
			      if(client.length > 0 && (client == people[key].id || user == people[key].id)) // private chat
			      {
					io.sockets.connected[key].emit("messageDeleted", {guid: messageGuid});
			      }
			};
		}
	} 
	catch (err) {
		console.log(err)
	}
}

function broadcastEditMessage(user, client, room, messageGuid, message) {
	try {
		if (room != undefined) {
		  	io.sockets.in(room).emit("messageEdited", {guid: messageGuid, message: message})
		} 
		else 
		{
			// TODO: move searching in people to redis
			for(var key in people) {
			      if(client.length > 0 && (client == people[key].id || user == people[key].id)) // private chat
			      {
					io.sockets.connected[key].emit("messageEdited", {guid: messageGuid, message: message});
			      }
			};
		}
	} 
	catch (err) {
		console.log(err)
	}
}

export default {
	broadcastEditMessage,
	broadcastDeleteMessage,
	setIsTyping,
    listen,
    alarmPublication,
    getOnline
};
