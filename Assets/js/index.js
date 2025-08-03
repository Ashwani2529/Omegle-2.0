let localStream;
let username;
let remoteUser;
let currentSessionId = null;
let userState = 'idle'; // 'idle', 'queued', 'matched', 'in-call'
let peerConnection;
let remoteStream;
let sendChannel;
let receiveChannel;
var msgInput = document.querySelector("#msg-input");
var msgSendBtn = document.querySelector(".msg-send-button");
var chatTextArea = document.querySelector(".chat-text-area");

var omeID = localStorage.getItem("omeID");

async function initializeUser() {
if (omeID) {
  username = omeID;
    try {
      await $.ajax({
        url: "/new-user-update/" + omeID,
        type: "PUT"
      });
      console.log("User reactivated:", username);
    } catch (error) {
      console.error("Error reactivating user:", error);
    }
} else {
    try {
      const response = await $.ajax({
    type: "POST",
    url: "/api/users",
        data: { postData: "Demo Data" }
      });
      console.log("New user created:", response);
      localStorage.setItem("omeID", response);
      username = response;
      omeID = response;
    } catch (error) {
      console.error("Error creating user:", error);
    }
  }
}

let init = async () => {
  try {
    // Initialize user first
    await initializeUser();
    
    if (!username) {
      throw new Error("Failed to initialize user");
    }
    
    // Get user media
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  document.getElementById("user-1").srcObject = localStream;
    console.log("Local video stream established");
    
    // Connect to socket after user is initialized
    connectSocket();
    
    // Show initial UI state
    updateUIState('idle');
    
  } catch (error) {
    console.error("Initialization error:", error);
    alert("Error initializing the application. Please check camera/microphone permissions and try again.");
  }
};

// Update UI based on current state
function updateUIState(state, message = '') {
  userState = state;
  const chatArea = document.querySelector(".chat-text-area");
  const nextButton = document.querySelector(".next-chat");
  
  switch (state) {
    case 'idle':
      chatArea.innerHTML = "<div style='color: #666; font-style: italic;'>Press 'Next' to start chatting with strangers! omeID: " + omeID + "</div>";
      nextButton.textContent = "Start";
      nextButton.style.pointerEvents = "auto";
      break;
    case 'queued':
      chatArea.innerHTML = `<div style='color: orange; font-style: italic;'>${message || 'Looking for someone to chat with...'} omeID: ${omeID}</div>`;
      nextButton.textContent = "Cancel";
      nextButton.style.pointerEvents = "auto";
      break;
    case 'matched':
      chatArea.innerHTML = `<div style='color: blue; font-style: italic;'>${message || 'Stranger found! Establishing connection...'}</div>`;
      nextButton.textContent = "Cancel";
      nextButton.style.pointerEvents = "auto"; // Allow canceling during connection
      break;
    case 'in-call':
      if (!chatArea.innerHTML.includes("You are now chatting")) {
        chatArea.innerHTML = "<div style='color: green; font-style: italic;'>You are now chatting with a random stranger</div><div style='color: green; font-style: italic;'>You both speak the same language - English</div><hr class='horizontal-divider'>";
      }
      nextButton.textContent = "Next";
      nextButton.style.pointerEvents = "auto";
      break;
  }
}

// Queue timeout functionality - extended timeout
let queueTimeout = null;
const QUEUE_TIMEOUT_MS = 120000; // 2 minutes - much longer timeout

function startQueueTimeout() {
  if (queueTimeout) {
    clearTimeout(queueTimeout);
  }
  
  queueTimeout = setTimeout(() => {
    if (userState === 'queued') {
      console.log("Queue timeout reached after 2 minutes");
      socket.emit("leaveQueue", { userId: username });
      updateUIState('idle', 'No one available right now. Try again later.');
    }
  }, QUEUE_TIMEOUT_MS);
}

function clearQueueTimeout() {
  if (queueTimeout) {
    clearTimeout(queueTimeout);
    queueTimeout = null;
  }
}

// Initialize everything when page loads
$(document).ready(function() {
  // Add some delay to ensure page is fully loaded
  setTimeout(() => {
    init();
  }, 500);
});

let socket;

function connectSocket() {
  socket = io.connect();

socket.on("connect", () => {
    if (socket.connected && username) {
    socket.emit("userconnect", {
      displayName: username,
    });
      console.log("Socket connected for user:", username);
    }
  });

  // Queue management events
  socket.on("queueStatus", function(data) {
    console.log("Queue status update:", data);
    updateUIState('queued', data.message);
    
    if (data.status === 'queued') {
      startQueueTimeout();
    } else {
      clearQueueTimeout();
    }
  });

  socket.on("matchFound", function(data) {
    console.log("🎯 Match found:", data);
    console.log("My ID:", username, "Remote ID:", data.remoteUser);
    
    // Critical check: Prevent self-matching on client side too
    if (data.remoteUser === username) {
      console.error("❌ ERROR: Matched with self! Rejoining queue...");
      socket.emit("findMatch", { userId: username });
      return;
    }
    
    clearQueueTimeout(); // Stop queue timeout since we found a match
    
    currentSessionId = data.sessionId;
    remoteUser = data.remoteUser;
    updateUIState('matched', 'Stranger found! Establishing connection...');
    
    console.log(`🔗 Session ${currentSessionId}: ${username} (${data.role}) ↔ ${remoteUser}`);
    
    // Start WebRTC connection based on role
    if (data.role === 'caller') {
      // Wait a moment for UI update, then create offer
      setTimeout(() => createOffer(data.remoteUser), 1000);
    }
    // If callee, wait for offer to arrive
  });

  socket.on("sessionEnded", function(data) {
    console.log("Session ended:", data);
    handleSessionEnded(data);
  });
  
  // WebRTC signaling events
  socket.on("ReceiveOffer", function (data) {
    console.log("Received offer from:", data.username, "Session:", data.sessionId);
    if (data.sessionId === currentSessionId) {
      createAnswer(data);
    }
  });
  
  socket.on("ReceiveAnswer", function (data) {
    console.log("Received answer from:", data.sender, "Session:", data.sessionId);
    if (data.sessionId === currentSessionId) {
      addAnswer(data);
    }
  });
  
  socket.on("candidateReceiver", function (data) {
    if (peerConnection && data.sessionId === currentSessionId) {
      console.log("Received ICE candidate for session:", data.sessionId);
      peerConnection.addIceCandidate(data.iceCandidateData)
        .catch(error => console.error("Error adding ICE candidate:", error));
    }
  });

  socket.on("error", function(data) {
    console.error("Socket error:", data);
    alert(data.message);
  });
  
  socket.on("disconnect", () => {
    console.log("Socket disconnected");
    updateUIState('idle', 'Disconnected from server');
  });
}
let servers = {
  iceServers: [
    {
      urls: ["stun:stun1.1.google.com:19302", "stun:stun2.1.google.com:19302"],
    },
  ],
};

let createPeerConnection = async () => {
  console.log("🔗 Creating peer connection for session:", currentSessionId);
  console.log("Local user:", username, "Remote user:", remoteUser);
  
  peerConnection = new RTCPeerConnection(servers);

  // Create separate remote stream
  remoteStream = new MediaStream();
  const remoteVideo = document.getElementById("user-2");
  
  // Important: Clear any existing source first
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }
  
  remoteVideo.srcObject = remoteStream;
  console.log("🎥 Remote video element prepared");

  // Add local tracks to peer connection
  localStream.getTracks().forEach((track) => {
    console.log("➕ Adding local track:", track.kind);
    peerConnection.addTrack(track, localStream);
  });

  // Handle incoming remote stream - CRITICAL FIX
  peerConnection.ontrack = async (event) => {
    console.log("📡 Remote track received:", event.track.kind);
    console.log("Stream ID:", event.streams[0].id);
    
    // Clear existing tracks first
    remoteStream.getTracks().forEach(track => {
      remoteStream.removeTrack(track);
    });
    
    // Add new remote tracks
    event.streams[0].getTracks().forEach((track) => {
      console.log("Adding remote track to stream:", track.kind, track.id);
      remoteStream.addTrack(track);
    });
    
    // Ensure video element gets the stream
    const remoteVideo = document.getElementById("user-2");
    if (remoteVideo.srcObject !== remoteStream) {
      remoteVideo.srcObject = remoteStream;
      console.log("🎥 Remote video stream updated");
    }
  };

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log("🔄 Connection state:", peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      updateUIState('in-call');
      console.log("✅ WebRTC connection established for session:", currentSessionId);
      
      // Update chat status
      const chatArea = document.querySelector(".chat-text-area");
      if (!chatArea.innerHTML.includes("You are now chatting")) {
        chatArea.innerHTML += "<div style='color: green; font-style: italic;'>✅ Connection established!</div>";
      }
      
      // Notify server that connection is fully established
      socket.emit("connectionEstablished", {
        userId: username,
        sessionId: currentSessionId
      });
      
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      console.log("❌ WebRTC connection lost/failed");
      if (userState === 'in-call') {
        updateUIState('idle', 'Connection lost. Press Next to try again.');
      } else if (userState === 'matched') {
        // Connection failed during initial setup, put user back in queue
        console.log("🔄 Connection failed during setup, rejoining queue");
        updateUIState('idle', 'Connection failed. Trying again...');
        setTimeout(() => {
          socket.emit("findMatch", { userId: username });
        }, 2000);
      }
    }
  };

  // Handle ICE connection state
  peerConnection.oniceconnectionstatechange = () => {
    console.log("🧊 ICE connection state:", peerConnection.iceConnectionState);
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = async (event) => {
    if (event.candidate && currentSessionId) {
      console.log("🧊 Sending ICE candidate for session:", currentSessionId);
      socket.emit("candidateSentToUser", {
        sessionId: currentSessionId,
        username: username,
        remoteUser: remoteUser,
        iceCandidateData: event.candidate,
      });
    }
  };

  // Create data channel for chat
  sendChannel = peerConnection.createDataChannel("sendDataChannel");
  sendChannel.onopen = () => {
    console.log("💬 Data channel is now open and ready to use");
    onSendChannelStateChange();
  };

  peerConnection.ondatachannel = receiveChannelCallback;
  
  console.log("🔗 Peer connection setup complete");
};
function sendData() {
  const msgData = msgInput.value.trim();
  
  if (!msgData) {
    return; // Don't send empty messages
  }
  
  chatTextArea.innerHTML +=
    "<div style='margin-top:2px; margin-bottom:2px;'><b>Me: </b>" +
    msgData +
    "</div>";
    
  // Auto-scroll to bottom
  chatTextArea.scrollTop = chatTextArea.scrollHeight;
  
  if (sendChannel && sendChannel.readyState === "open") {
    sendChannel.send(msgData);
  } else if (receiveChannel && receiveChannel.readyState === "open") {
    receiveChannel.send(msgData);
  } else {
    console.warn("No data channel available to send message");
  }
  
  msgInput.value = "";
}
function receiveChannelCallback(event) {
  console.log("Receive Channel Callback");
  receiveChannel = event.channel;
  receiveChannel.onmessage = onReceiveChannelMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;
}
function onReceiveChannelMessageCallback(event) {
  console.log("Received Message");
  chatTextArea.innerHTML +=
    "<div style='margin-top:2px; margin-bottom:2px;'><b>Stranger: </b>" +
    event.data +
    "</div>";
    
  // Auto-scroll to bottom
  chatTextArea.scrollTop = chatTextArea.scrollHeight;
}
function onReceiveChannelStateChange() {
  const readystate = receiveChannel.readystate;
  console.log("Receive channel state is: " + readystate);
  if (readystate === "open") {
    console.log(
      "Data channel ready state is open - onReceiveChannelStateChange"
    );
  } else {
    console.log(
      "Data channel ready state is NOT open - onReceiveChannelStateChange"
    );
  }
}
function onSendChannelStateChange() {
  const readystate = sendChannel.readystate;
  console.log("Send channel state is: " + readystate);
  if (readystate === "open") {
    console.log("Data channel ready state is open - onSendChannelStateChange");
  } else {
    console.log(
      "Data channel ready state is NOT open - onSendChannelStateChange"
    );
  }
}
async function fetchNextUser(currentRemoteUser) {
  try {
    console.log("Fetching next user. Current user:", username, "Previous remote:", currentRemoteUser);
    
    const data = await $.post("/get-next-user", { 
      omeID: omeID, 
      remoteUser: currentRemoteUser 
    });
    
    console.log("Next user found:", data);
    if (data && data.length > 0) {
      const nextUser = data[0];
      if (nextUser._id !== username) { // Only exclude current user, allow reconnection to previous
        remoteUser = nextUser._id;
        console.log("Connecting to user:", remoteUser);
        
        // Clear previous status messages
        const chatArea = document.querySelector(".chat-text-area");
        chatArea.innerHTML = "<div style='color: blue; font-style: italic;'>Connecting to stranger...</div>";
        
        createOffer(nextUser._id);
        } else {
        console.log("Got same user as self, retrying...");
        setTimeout(() => fetchNextUser(currentRemoteUser), 2000);
      }
    } else {
      console.log("No next user available, retrying...");
      
      // Update status message
      const chatArea = document.querySelector(".chat-text-area");
      chatArea.innerHTML = "<div style='color: orange; font-style: italic;'>Looking for strangers...</div>";
      
      setTimeout(() => fetchNextUser(currentRemoteUser), 3000);
    }
  } catch (error) {
    console.error("Error fetching next user:", error);
    setTimeout(() => fetchNextUser(currentRemoteUser), 5000);
  }
}
let createOffer = async (remoteU) => {
  try {
    console.log("📞 Creating offer for remote user:", remoteU, "Session:", currentSessionId);
    
    // Safety check
    if (remoteU === username) {
      console.error("❌ ERROR: Trying to create offer to self!");
      return;
    }
    
    createPeerConnection();
    let offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(offer);
    
    console.log("📤 Sending offer to:", remoteU);
    socket.emit("offerSentToRemote", {
      sessionId: currentSessionId,
      username: username,
      remoteUser: remoteU,
      offer: peerConnection.localDescription,
    });
    
    console.log("✅ Offer sent to remote user:", remoteU);
  } catch (error) {
    console.error("❌ Error creating offer:", error);
    updateUIState('idle', 'Failed to connect. Try again.');
  }
};

let createAnswer = async (data) => {
  try {
    console.log("📞 Creating answer for session:", data.sessionId);
    console.log("Offer from:", data.username, "to me:", username);
    
    // Safety check
    if (data.username === username) {
      console.error("❌ ERROR: Received offer from self!");
      return;
    }
    
    createPeerConnection();
    await peerConnection.setRemoteDescription(data.offer);
    let answer = await peerConnection.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(answer);
    
    console.log("📤 Sending answer back to:", data.username);
    socket.emit("answerSentToUser1", {
      sessionId: currentSessionId,
      answer: answer,
      sender: username,
      receiver: data.username,
    });
    
    console.log("✅ Answer created and sent for session:", currentSessionId);
  } catch (error) {
    console.error("❌ Error creating answer:", error);
    updateUIState('idle', 'Failed to connect. Try again.');
  }
};

let addAnswer = async (data) => {
  if (peerConnection && !peerConnection.currentRemoteDescription) {
    await peerConnection.setRemoteDescription(data.answer);
    document.querySelector(".next-chat").style.pointerEvents = "auto";
    
    try {
      await $.ajax({
        url: "/update-on-engagement/" + username,
        type: "PUT"
      });
      console.log("User engagement updated");
    } catch (error) {
      console.error("Error updating engagement:", error);
    }
  }
};

function handleRemoteUserClosed() {
  if (peerConnection) {
    try {
  const remoteStream = peerConnection.getRemoteStreams()[0];
      if (remoteStream) {
  remoteStream.getTracks().forEach((track) => track.stop());
      }

  peerConnection.close();
  const remoteVid = document.getElementById("user-2");

  if (remoteVid.srcObject) {
    remoteVid.srcObject.getTracks().forEach((track) => track.stop());
    remoteVid.srcObject = null;
  }
      
  $.ajax({
        url: "/update-on-next/" + username,
    type: "PUT",
    success: function (response) {
      fetchNextUser(remoteUser);
    },
        error: function (error) {
          console.error("Error updating user status:", error);
        }
      });
    } catch (error) {
      console.error("Error handling remote user closed:", error);
    }
  }
}

msgSendBtn.addEventListener("click", function (event) {
  sendData();
});

// Add Enter key support for message input
msgInput.addEventListener("keypress", function(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendData();
  }
});

window.addEventListener("beforeunload", function (event) {
  // Clean up connections and update user status
  if (username) {
    navigator.sendBeacon("/leaving-user-update/" + username, "");
    console.log("User leaving:", username);
  }
  
  if (remoteUser) {
    navigator.sendBeacon("/update-on-otherUser-closing/" + remoteUser, "");
    console.log("Notifying remote user of disconnection:", remoteUser);
  }
  
  // Close peer connection
  if (peerConnection) {
    peerConnection.close();
  }
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
});

async function closeConnection() {
  try {
    console.log("Closing connection with user:", remoteUser);
    
    if (peerConnection) {
      // Close data channels
      if (sendChannel) {
        sendChannel.close();
        sendChannel = null;
      }
      if (receiveChannel) {
        receiveChannel.close();
        receiveChannel = null;
      }
      
      // Stop remote tracks
  const remoteStream = peerConnection.getRemoteStreams()[0];
      if (remoteStream) {
  remoteStream.getTracks().forEach((track) => track.stop());
      }
      
      peerConnection.close();
      peerConnection = null;
    }
    
    // Clear remote video
  const remoteVid = document.getElementById("user-2");
    if (remoteVid) {
  if (remoteVid.srcObject) {
    remoteVid.srcObject.getTracks().forEach((track) => track.stop());
      }
    remoteVid.srcObject = null;
  }
    
    // Store current remote user before clearing
    const currentRemoteUser = remoteUser;
    
    // Notify server and remote user BEFORE updating status
    if (socket && remoteUser) {
  socket.emit("remoteUserClosed", {
    username: username,
    remoteUser: remoteUser,
  });
    }
    
    // Clear remote user reference
    remoteUser = null;
    
    // Update user status to available (status: "0") 
    try {
      await $.ajax({
        url: "/update-on-next/" + username,
        type: "PUT"
      });
      console.log("User status updated to available");
    } catch (ajaxError) {
      console.error("Error updating user status:", ajaxError);
    }
    
    // Wait a moment before searching for next user
    setTimeout(() => {
      fetchNextUser(currentRemoteUser);
    }, 1000);
    
    console.log("Connection closed successfully");
  } catch (error) {
    console.error("Error closing connection:", error);
  }
}
$(document).on("click", ".next-chat", function () {
  console.log("Next button clicked. Current state:", userState);
  
  switch (userState) {
    case 'idle':
      // Start looking for someone
      socket.emit("findMatch", { userId: username });
      break;
      
    case 'queued':
      // Cancel search
      clearQueueTimeout();
      socket.emit("leaveQueue", { userId: username });
      updateUIState('idle');
      break;
      
    case 'in-call':
      // End current session and look for next person
      endCurrentSession(true);
      break;
      
    case 'matched':
      // During connection phase, allow canceling
      console.log("Canceling connection attempt");
      endCurrentSession(false);
      updateUIState('idle', 'Connection canceled');
      break;
  }
});

function endCurrentSession(findNext = false) {
  console.log("Ending current session:", currentSessionId);
  
  // Close WebRTC connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  // Clear remote video
  const remoteVid = document.getElementById("user-2");
  if (remoteVid && remoteVid.srcObject) {
    remoteVid.srcObject.getTracks().forEach(track => track.stop());
    remoteVid.srcObject = null;
  }
  
  // Close data channels
  if (sendChannel) {
    sendChannel.close();
    sendChannel = null;
  }
  if (receiveChannel) {
    receiveChannel.close();
    receiveChannel = null;
  }
  
  // Notify server
  if (currentSessionId) {
    socket.emit("endSession", { 
      userId: username, 
      findNext: findNext 
    });
  }
  
  // Reset state
  currentSessionId = null;
  remoteUser = null;
  
  if (!findNext) {
    updateUIState('idle');
  }
  
  // Clear chat area
  document.querySelector(".chat-text-area").innerHTML = "";
}

function handleSessionEnded(data) {
  console.log("Session ended by other user:", data);
  
  // Clean up local state
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  const remoteVid = document.getElementById("user-2");
  if (remoteVid && remoteVid.srcObject) {
    remoteVid.srcObject.getTracks().forEach(track => track.stop());
    remoteVid.srcObject = null;
  }
  
  currentSessionId = null;
  remoteUser = null;
  
  updateUIState('idle', data.reason || 'The other user disconnected');
}
