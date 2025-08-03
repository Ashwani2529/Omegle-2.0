const express = require("express");
const path = require("path");
const bodyparser = require("body-parser");
const cors = require("cors");
const dotenv = require('dotenv');

// Load environment variables first
dotenv.config();

const app = express();
const connectDB = require("./Server/database/connection");

const PORT = process.env.PORT || 8080;

// Debug: Check if env variables are loaded
console.log("Environment variables loaded:");
console.log("PORT:", process.env.PORT);
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "✓ Loaded" : "✗ Missing");

connectDB();
app.use(bodyparser.urlencoded({ extended: true }));
app.use(cors({origin:'https://omegle-ob2d.onrender.com',
methods:'GET,HEAD,PUT,PATCH,POST,DELETE',
allowedHeaders:'*'}));
app.use(bodyparser.json());

app.set("view engine", "ejs");

app.use("/css", express.static(path.resolve(__dirname, "Assets/css")));
app.use("/img", express.static(path.resolve(__dirname, "Assets/img")));
app.use("/js", express.static(path.resolve(__dirname, "Assets/js")));

app.use("/", require("./Server/routes/router"));

var server = app.listen(PORT, () => {
  console.log(`Server is running on https://omegle-ob2d.onrender.com`);
});

const io = require("socket.io")(server, {
  allowEIO3: true, //False by default
});

// Matchmaking system data structures
var userConnection = [];
var userQueue = []; // Users waiting to be matched
var activeSessions = new Map(); // sessionId -> { user1, user2, sessionId }
var userStates = new Map(); // userId -> { state: 'idle'|'queued'|'matched'|'in-call', sessionId?, socketId }

// Helper functions for matchmaking
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function addToQueue(userId, socketId) {
  // Remove user from queue if already exists (prevent duplicates)
  userQueue = userQueue.filter(user => user.userId !== userId);
  
  // Add user to queue
  userQueue.push({ userId, socketId, timestamp: Date.now() });
  userStates.set(userId, { state: 'queued', socketId });
  
  console.log(`📋 User ${userId} added to queue. Queue length: ${userQueue.length}`);
  console.log(`Current queue:`, userQueue.map(u => ({ id: u.userId, socket: u.socketId })));
  
  // Try to match immediately
  tryMatchUsers();
}

function tryMatchUsers() {
  if (userQueue.length >= 2) {
    const user1 = userQueue.shift();
    const user2 = userQueue.shift();
    
    // Safety check: Don't match user with themselves
    if (user1.userId === user2.userId) {
      console.log("Prevented self-matching for user:", user1.userId);
      // Put user2 back in queue and try again
      userQueue.unshift(user2);
      return;
    }
    
    const sessionId = generateSessionId();
    
    console.log(`Attempting to match users: ${user1.userId} and ${user2.userId}`);
    console.log(`User1 socket: ${user1.socketId}, User2 socket: ${user2.socketId}`);
    
    // Create session - but keep users in connecting state until WebRTC is established
    activeSessions.set(sessionId, {
      user1: user1.userId,
      user2: user2.userId,
      sessionId,
      startTime: Date.now(),
      connectionStatus: 'connecting' // Track connection status
    });
    
    // Update user states to matched (still not fully connected)
    userStates.set(user1.userId, { state: 'matched', sessionId, socketId: user1.socketId });
    userStates.set(user2.userId, { state: 'matched', sessionId, socketId: user2.socketId });
    
    console.log(`✅ Successfully matched users: ${user1.userId} and ${user2.userId} in session ${sessionId}`);
    
    // Notify both users about the match
    io.to(user1.socketId).emit("matchFound", {
      sessionId,
      remoteUser: user2.userId,
      role: 'caller' // user1 will initiate the call
    });
    
    io.to(user2.socketId).emit("matchFound", {
      sessionId,
      remoteUser: user1.userId,
      role: 'callee' // user2 will receive the call
    });
  } else {
    console.log(`Queue has ${userQueue.length} users, need at least 2 to match`);
  }
}

function removeFromQueue(userId) {
  userQueue = userQueue.filter(user => user.userId !== userId);
  console.log(`User ${userId} removed from queue. Queue length: ${userQueue.length}`);
}

function endSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    // Update user states back to idle
    userStates.set(session.user1, { state: 'idle', socketId: userStates.get(session.user1)?.socketId });
    userStates.set(session.user2, { state: 'idle', socketId: userStates.get(session.user2)?.socketId });
    
    // Remove session
    activeSessions.delete(sessionId);
    console.log(`Session ${sessionId} ended`);
  }
}

io.on("connection", (socket) => {
  console.log("Socket id is: ", socket.id);

  socket.on("userconnect", (data) => {
    console.log("Logged in username", data.displayName);
    
    // Remove any existing connections for this user
    userConnection = userConnection.filter(conn => conn.user_id !== data.displayName);
    
    // Add new connection
    userConnection.push({
      connectionId: socket.id,
      user_id: data.displayName,
    });

    // Initialize user state as idle
    userStates.set(data.displayName, { state: 'idle', socketId: socket.id });

    var userCount = userConnection.length;
    console.log("UserCount", userCount);
    console.log("Connected users:", userConnection.map(u => u.user_id));
  });

  // New event: User wants to find someone (enters queue)
  socket.on("findMatch", (data) => {
    const userId = data.userId;
    console.log(`User ${userId} looking for a match`);
    
    const userState = userStates.get(userId);
    if (!userState || userState.state === 'idle') {
      addToQueue(userId, socket.id);
      
      // Send queue status to user
      socket.emit("queueStatus", { 
        status: 'queued', 
        queuePosition: userQueue.findIndex(u => u.userId === userId) + 1,
        message: 'Looking for someone to chat with...' 
      });
    } else {
      socket.emit("error", { message: "You are already in a queue or call" });
    }
  });

  // User wants to leave queue
  socket.on("leaveQueue", (data) => {
    const userId = data.userId;
    console.log(`User ${userId} manually leaving queue`);
    removeFromQueue(userId);
    userStates.set(userId, { state: 'idle', socketId: socket.id });
    
    socket.emit("queueStatus", { 
      status: 'idle', 
      message: 'You left the search' 
    });
  });

  // New event: WebRTC connection established successfully
  socket.on("connectionEstablished", (data) => {
    const userId = data.userId;
    const sessionId = data.sessionId;
    
    console.log(`WebRTC connection established for user ${userId} in session ${sessionId}`);
    
    // Update session status
    const session = activeSessions.get(sessionId);
    if (session) {
      session.connectionStatus = 'connected';
      
      // Update user states to in-call (now they're fully connected)
      userStates.set(session.user1, { state: 'in-call', sessionId, socketId: userStates.get(session.user1)?.socketId });
      userStates.set(session.user2, { state: 'in-call', sessionId, socketId: userStates.get(session.user2)?.socketId });
      
      console.log(`Session ${sessionId} is now fully connected`);
    }
  });
  // Session-based WebRTC signaling
  socket.on("offerSentToRemote", (data) => {
    console.log("Session-based offer received:", data.sessionId, "from:", data.username, "to:", data.remoteUser);
    
    // Verify session exists and users are matched
    const session = activeSessions.get(data.sessionId);
    if (session && (session.user1 === data.username || session.user2 === data.username)) {
      var offerReceiver = userConnection.find(o => o.user_id === data.remoteUser);
      if (offerReceiver) {
        socket.to(offerReceiver.connectionId).emit("ReceiveOffer", data);
        console.log("Offer forwarded to receiver in session:", data.sessionId);
      }
    } else {
      console.log("Invalid session or unauthorized offer:", data.sessionId);
    }
  });

  socket.on("answerSentToUser1", (data) => {
    console.log("Session-based answer received:", data.sessionId);
    
    // Verify session
    const session = activeSessions.get(data.sessionId);
    if (session) {
      var answerReceiver = userConnection.find(o => o.user_id === data.receiver);
      if (answerReceiver) {
        socket.to(answerReceiver.connectionId).emit("ReceiveAnswer", data);
        console.log("Answer forwarded in session:", data.sessionId);
      }
    }
  });

  socket.on("candidateSentToUser", (data) => {
    console.log("ICE candidate for session:", data.sessionId);
    
    // Verify session
    const session = activeSessions.get(data.sessionId);
    if (session) {
      var candidateReceiver = userConnection.find(o => o.user_id === data.remoteUser);
      if (candidateReceiver) {
        socket.to(candidateReceiver.connectionId).emit("candidateReceiver", data);
      }
    }
  });

  // End current session and optionally re-enter queue
  socket.on("endSession", (data) => {
    const userId = data.userId;
    const userState = userStates.get(userId);
    
    if (userState && userState.sessionId) {
      const session = activeSessions.get(userState.sessionId);
      if (session) {
        const otherUserId = session.user1 === userId ? session.user2 : session.user1;
        const otherUserState = userStates.get(otherUserId);
        
        // Notify other user that session ended
        if (otherUserState) {
          io.to(otherUserState.socketId).emit("sessionEnded", { 
            reason: 'Other user disconnected',
            endedBy: userId 
          });
        }
        
        endSession(userState.sessionId);
      }
    }
    
    // If user wants to find next person, add to queue
    if (data.findNext) {
      addToQueue(userId, socket.id);
      socket.emit("queueStatus", { 
        status: 'queued', 
        message: 'Looking for someone to chat with...' 
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected, socket id:", socket.id);
    
    // Find the disconnected user
    const disconnectedUser = userConnection.find((p) => p.connectionId === socket.id);
    if (disconnectedUser) {
      const userId = disconnectedUser.user_id;
      console.log("Disconnected user:", userId);
      
      // Remove from queue if queued
      removeFromQueue(userId);
      
      // End active session if in one
      const userState = userStates.get(userId);
      if (userState && userState.sessionId) {
        const session = activeSessions.get(userState.sessionId);
        if (session) {
          const otherUserId = session.user1 === userId ? session.user2 : session.user1;
          const otherUserState = userStates.get(otherUserId);
          
          // Notify other user
          if (otherUserState) {
            io.to(otherUserState.socketId).emit("sessionEnded", { 
              reason: 'Other user disconnected',
              endedBy: userId 
            });
          }
          
          endSession(userState.sessionId);
        }
      }
      
      // Clean up user state
      userStates.delete(userId);
    }
    
    userConnection = userConnection.filter((p) => p.connectionId !== socket.id);
    console.log("Remaining connected users:", userConnection.map(u => u.user_id));
    console.log("Queue length:", userQueue.length);
    console.log("Active sessions:", activeSessions.size);
  });

  // Legacy support - convert old "remoteUserClosed" to new session system
  socket.on("remoteUserClosed", (data) => {
    // This will be handled by the new endSession event
    socket.emit("endSession", { userId: data.username, findNext: false });
  });
});
