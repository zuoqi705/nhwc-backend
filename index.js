const express = require('express');
const app = express();
const fs = require('fs');
var words = [];

//读取words.txt文件
fs.readFile('words.txt', function (err, data) {
  if (err) {
    return console.error(err)
  }
  words = data.toString().split('\n');

})
// 设置静态文件夹，会默认找当前目录下的index.html文件当做访问的页面
app.use(express.static(__dirname));

//设置跨域访问
app.all('*', function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
  res.header("X-Powered-By", ' 3.2.1')
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});


const server = require('http').createServer(app);
const io = require('socket.io')(server);
const uuidv1 = require('uuid/v1');
var uid = 1; //每个用户的标识
var users = []; //存储所有用户
var userNames = {}; //存储每个uid对应的username
var socketRooms = {}; //存储每个socketId对应的room
var rooms = []; //存储所有房间信息
var roomIds = []; //存储所有房间的roomId
var gameDatas = {}; //存储每个房间的gameData
var gameSeatsData = {}; //存储每个房间的gameSeats
var startedRooms = {}; //储存已经开局的房间
io.on('connection', socket => {
  console.log('connect success!', socket.id);
  socket.on('newUser', msg => {
    if (msg) {
      console.log('newUser')
      var userInfo = {
        socketId: socket.id,
        uid: uid,
        username: `user${uid}`,
        roomId: uuidv1().split('-')[0],
        joinRoomId: '',
        /*
        0: 没加入房间
        1：已加入房间但是没开始游戏
        2：已经开始游戏
        */
        state: 0,
      }
      users.push(userInfo);
      userNames[uid] = userInfo.username;
      socket.emit('userInfo', userInfo);
      socket.emit('rooms', rooms);
      uid++;
    }
  })

  //监听更改用户名事件
  socket.on('editUserName', msg => {
    if (userNames[msg.uid] != msg.username && Object.values(userNames).includes(msg.username)) { //如果更改的名字已存在
      socket.emit('editInfo', false)
    } else {
      users.forEach(user => {
        if (user.uid == msg.uid) {
          user.username = msg.username;
        }
      })
      rooms.forEach(room => {
        if (room.uid == msg.uid) {
          room.ownername = msg.username;
        }
      })
      socket.emit('editInfo', true);
      io.emit('rooms', rooms);
      userNames[msg.uid] = msg.username;
      console.log(userNames);
      console.log(users);
    }
  })

  //监听发送信息事件
  socket.on('message', msg => {
    console.log('server receive', msg);
    io.in(msg.roomId).emit('message', { //发给房间内所有人，包括发送者
      userInfo: msg.userInfo,
      text: msg.text
    });
  })

  //监听创建房间事件
  socket.on('createRoom', msg => {
    var roomData = { //存储每个房间信息
      ownerSocketId: socket.id,
      ownername: '',
      uid: '',
      players: [],
      roomId: '',
      seats: [],
      sittedNum: 0, //储存已经坐下的玩家数量
      start: false, //是否已经开始游戏
    }
    roomData.roomId = msg.roomId;
    // roomData.seats = new Array(8);
    for (let i = 0; i < 8; i++) {
      roomData.seats.push({
        index: i,
        userInfo: {},
        sitted: false //判断是否坐下
      })
    }
    roomData.ownername = msg.username;
    roomData.uid = msg.uid;
    roomData.players.push(msg);

    //存储room信息
    rooms.push(roomData);
    roomIds.push(roomData.roomId);
    socketRooms[socket.id] = roomData.roomId;

    // console.log(socketRooms);
    socket.join(msg.roomId, () => {
      // console.log('rooms:', rooms);
    })
    io.emit('rooms', rooms); //通知所有人，home页面监听数据改变
    socket.emit('join', {
      roomData: roomData
    });
  })

  //监听加入房间事件
  socket.on('joinRoom', msg => {
    rooms.forEach(room => {
      if (room.roomId == msg.joinRoomId) {
        roomData = room;
        let {
          socketId,
          uid,
          username,
          roomId
        } = msg;
        userInfo = {
          socketId,
          uid,
          username,
          roomId
        }
        console.log('joinUserInfo', userInfo);
        room.players.push(userInfo)
        socketRooms[socket.id] = msg.joinRoomId;
        // console.log(socketRooms);
      }
    })
    socket.join(msg.joinRoomId, () => {
      console.log('joined!')
    })
    socket.to(msg.joinRoomId).emit('join', {
      joinUserInfo: userInfo,
      roomData: roomData
    });
    socket.emit('join', { //需要单独给要加入room的人发,在Home页面监听，通过params传到Room页面
      joinUserInfo: userInfo,
      roomData: roomData
    });
    io.emit('rooms', rooms); //通知所有人，home页面监听数据改变
  })

  //监听刷新房间信息事件
  socket.on('refreshRooms', msg => {
    if (msg) {
      socket.emit('rooms', rooms);
    }
  })

  //监听某人离开房间事件
  socket.on('leave', msg => {
    console.log('leaved')
    socket.leave(msg.roomId);
    socketRooms[socket.id] = null;
    // console.log(socketRooms);
    rooms.forEach(room => {
      if (room.roomId == msg.roomId) {
        room.players.forEach((player, index) => { //删除该离开房间用户，更新players信息
          if (player.uid == msg.userInfo.uid) {
            // console.log('players',room.players);
            room.players.splice(index, 1);
            // console.log('players',room.players);
          }
        })

        //更新seats信息
        room.seats.forEach(seat => {
          if (seat.userInfo.uid == msg.userInfo.uid) {
            if (room.sittedNum > 0) {
              console.log('deleteSeat')
              seat.sitted = false;
              seat.userInfo = {};
              room.sittedNum -= 1;
            }
          }
        })
        roomData = room;
      }
    })

    //通知该房间所有人离开事件
    socket.to(msg.roomId).emit('leave', { //更新roomData
      leaveUserInfo: msg.userInfo,
      roomData: roomData
    })

    io.emit('rooms', rooms); //通知所有人，home页面监听数据改变
  })

  //监听disconnect事件，将其从该房间中删除
  socket.on('disconnect', () => {
    console.log('disconnected', socket.id);
    rooms.forEach(room => {
      if (room.roomId == socketRooms[socket.id]) {
        console.log('find!');
        room.players.forEach((player, index) => {
          if (player.socketId == socket.id) {
            userInfo = player;
            // console.log('players',room.players)
            room.players.splice(index, 1);
            // console.log('players',room.players);
          }

          //更新seats信息
          room.seats.forEach(seat => {
            if (seat.userInfo.uid == userInfo.uid) {
              if (room.sittedNum > 0) {
                console.log('deleteSeat')
                seat.sitted = false;
                seat.userInfo = {};
                room.sittedNum -= 1;
              }
            }
          })
        })
        roomData = room;

        //通知该房间所有人离开事件
        socket.to(room.roomId).emit('leave', {
          leaveUserInfo: userInfo,
          roomData: roomData
        })

        io.emit('rooms', rooms); //通知所有人，home页面监听数据改变
      }
    })
    socketRooms[socket.id] = null;
    // console.log(socketRooms)
  });

  //监听seats事件，更新该房间的seats信息
  socket.on('seats', msg => {
    rooms.forEach(room => {
      if (room.roomId == msg.roomId) {
        console.log('seats changed')
        room.seats = msg.seats;
        room.sittedNum = msg.sittedNum;
        socket.to(msg.roomId).emit('seats', {
          seats: msg.seats,
          sittedNum: msg.sittedNum
        });
      }
    })
  })

  //监听draw事件，为房间内其他人传递画布信息
  socket.on('drawing', msg => {
    console.log('drawing!');
    socket.to(msg.roomId).emit('drawing', msg);
  })

  //监听clearCanvas事件，为房间内所有人清空画布
  socket.on('clearCanvas', roomId => {
    console.log('clearCanvas');
    socket.to(roomId).emit('clearCanvas');
  })

  //监听drawBackCanvas事件，更新两个画布
  socket.on('drawBackCanvas', data => {
    console.log('drawBackCanvas');
    socket.to(data.roomId).emit('drawBackCanvas', data);
  })

  //监听reDraw事件，通过传递两个strokes数组来更新两个画布
  socket.on('reDraw', data => {
    console.log('reDraw');
    socket.to(data.roomId).emit('reDraw', data);
  })

  //监听talk事件
  socket.on('talk', msg => {
    // console.log('talk', msg);
    io.in(msg.roomId).emit('talk', { //发给房间内所有人，包括发送者
      userInfo: msg.userInfo,
      text: msg.text
    });
  })

  //监听enterDraw事件
  socket.on('enterDraw', msg => {
    console.log('enterDraw');
    var gameSeats = [];
    msg.seats.forEach(seat => {
      if (seat.sitted) {
        var userInfo = seat.userInfo
        gameSeats.push({
          uid: userInfo.uid,
          username: userInfo.username,
          roundScore: 0,
          sumScore: 0,
          draw: false,
        });
      }
    })
    var roundNum = gameSeats.length * 3;
    var gameData = {
      roundIndex: -1,
      roundNum: roundNum,
      tips: [],
      roundSec: 80,
      drawerIndex: -1,
      state: '',
      word: '',
      firstCorrect: false, //是否有人第一个答对
    }

    //向gameDatas中添加数据
    gameDatas[msg.roomId] = gameData;
    //向gameSeatsData中添加数据
    gameSeatsData[msg.roomId] = gameSeats;
    io.in(msg.roomId).emit('enterDraw', {
      gameData: gameData,
      gameSeats: gameSeats,
    });

    //发出startGame信息
    wait(startGame(msg.roomId), 3000);

  })

  //startGame处理函数
  function startGame(roomId) {
    return function () {
      console.log('startGame');
      io.in(roomId).emit('startGame');

      //表示该房间已经开始游戏
      startedRooms[roomId] = true;

      wait(startRound(roomId), 4000);
    }
  }

  //startRound处理函数
  function startRound(roomId) {
    console.log('startRound');
    return function () {
      //更新gameData
      let gameData = gameDatas[roomId];
      let gameSeats = gameSeatsData[roomId];
      gameData.firstCorrect = false;

      if (gameData.roundIndex == gameData.roundNum - 1) { //如果已经是最后一局
        let sortedGameSeats = gameSeats.sort((a, b) => b.sumScore < a.sumScore);
        let rankList = [];

        //获取排序后的ranklist
        sortedGameSeats.forEach(player => {
          rankList.push({
            name: player.username,
            score: player.sumScore
          })
        })

        io.in(roomId).emit('end', rankList);
      } else {
        gameData.roundIndex++;
        gameData.drawerIndex = (gameData.drawerIndex + 1) % gameSeats.length;

        //更新gameSeats
        gameSeats.forEach((player, index) => {
          //清空所有人本轮比分
          player.roundScore = 0;
          if (index == gameData.drawerIndex) {
            player.draw = true;
          } else {
            player.draw = false;
          }
        })
        //获取本轮题目
        let topic = getTopic(words);
        gameData.tips = topic.tips;
        gameData.word = topic.word;
        gameData.state = 'round';
        io.in(roomId).emit('startRound', {
          gameData: gameData,
          gameSeats: gameSeats
        });
      }
    }
  }

  //监听correct事件
  socket.on('correct', data => {
    console.log('correct')
    let gameData = gameDatas[data.roomId];
    let drawerIndex = gameData.drawerIndex;
    let gameSeats = gameSeatsData[data.roomId];
    let addScore;

    //更新猜者分数
    gameSeats[drawerIndex].roundScore += 1;
    gameSeats[drawerIndex].sumScore += 1;

    //更新画者分数
    gameSeats.forEach(player => {
      if (player.uid == data.userInfo.uid) {
        if (gameData.firstCorrect) { //如果本轮已经有人答对
          addScore = 2;
          player.roundScore = 2;
          player.sumScore += 2;
        } else {
          addScore = 3;
          gameData.firstCorrect = true;
          player.roundScore = 3;
          player.sumScore += 3;
        }
      }
    })
    io.in(data.roomId).emit('correct', {
      userInfo: data.userInfo,
      index: data.index,
      gameData: gameData,
      gameSeats: gameSeats,
      addScore: addScore,
    });
  })

  //监听endRound事件
  socket.on('endRound', roomId => {
    console.log('endRound')
    let gameData = gameDatas[roomId];
    io.in(roomId).emit('endRound');

    wait(startRound(roomId), 11000);
  })
});

app.get('/start', function (req, res) {
  let roomId = req.query.roomId;
  console.log('roomId', roomId);
  if (startedRooms[roomId]) {
    res.send(true);
    return;
  } else {
    res.send(false);
    return;
  }
})

app.get('/adduser', function (req, res) {
  let username = req.query.username;
	// console.log("​username", username)
  let socketId = req.query.socketId;
	// console.log("​socketId", socketId)
  let joinRoomId = req.query.joinRoomId;
	// console.log("​joinRoomId", joinRoomId)

  if (Object.values(userNames).includes(username)) {
    res.send(false); //用户名已存在
    console.log('用户名已存在！')
    return;
  } else {
    var userInfo = {
      socketId: socketId,
      uid: uid,
      username: username,
      roomId: uuidv1().split('-')[0],
      joinRoomId: '',
      state: 0,
    }
		// // console.log("​userInfo", userInfo)
    users.push(userInfo);
    userNames[uid] = username;
    uid++;
  }

  if (!roomIds.includes(joinRoomId)) {
    res.send({ 
      state:1, //该房间不存在
      userInfo: userInfo
    }) 
    return;
  } else if (startedRooms[joinRoomId]) {
    res.send({
      state: 2, //该房间已经开始游戏
      userInfo: userInfo
    }) 
    return;
  } else {
    res.send({
      state: 3, //可以进入该房间
      userInfo: userInfo
    }) 
    return;
  }
})


server.listen(4000);

Array.prototype.remove = function (val) { //数组删除某一元素
  var index = this.indexOf(val);
  if (index > -1) {
    this.splice(index, 1);
  }
};

function wait(func, msec) { //延时函数
  var timer = setTimeout(function () {
    func();
    clearTimeout(timer);
    timer = null;
  }, msec);
}

//获取本轮word和tips
function getTopic(words) {
  let line = words[Math.floor(Math.random() * words.length)].split(':');
  let word = line[0].trim();
  let tips = line[1].trim().split('，');
  console.log('word', word);
  console.log('tips', tips);
  return {
    word: word,
    tips: tips
  }
}
