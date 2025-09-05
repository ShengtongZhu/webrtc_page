class WebRTCAV1App {
    constructor() {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.startBtn = document.getElementById('startBtn');
        this.callBtn = document.getElementById('callBtn');
        this.hangupBtn = document.getElementById('hangupBtn');
        
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isInitiator = false;
        this.signalingSocket = null;
        this.isSignalingConnected = false;
        
        // Initialize WebSocket connection with retry
        this.initializeSignaling();
        
        this.initializeEventListeners();
        this.initializeParameterControls();
        
        // Check AV1 support
        this.checkAV1Support();
    }
    
    initializeSignaling() {
        // Connect to signaling server with retry logic
        const connectWebSocket = () => {
            try {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.host}`;
                
                console.log('🔗 Attempting to connect to signaling server:', wsUrl);
                console.log('🔗 Current location:', window.location.href);
                this.signalingSocket = new WebSocket(wsUrl);
                
                this.signalingSocket.onopen = () => {
                    console.log('✅ WebSocket connection opened successfully!');
                    this.isSignalingConnected = true;
                    document.getElementById('status').textContent = '✅ Ready - Signaling connected';
                    document.getElementById('status').style.color = '#28a745';
                    
                    // Enable call button if camera is already started
                    if (this.localStream) {
                        this.callBtn.disabled = false;
                    }
                };
                
                this.signalingSocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        console.log('📨 Received signaling message:', message);
                        this.handleSignalingMessage(message);
                    } catch (error) {
                        console.error('Error parsing signaling message:', error);
                    }
                };
                
                this.signalingSocket.onclose = (event) => {
                    console.log('❌ Disconnected from signaling server', event.code, event.reason);
                    this.isSignalingConnected = false;
                    document.getElementById('status').textContent = 'Signaling disconnected - Retrying...';
                    document.getElementById('status').style.color = '#dc3545';
                    
                    // Retry connection after 3 seconds
                    setTimeout(connectWebSocket, 3000);
                };
                
                this.signalingSocket.onerror = (error) => {
                    console.error('❌ WebSocket error occurred:', error);
                    console.error('❌ WebSocket readyState:', this.signalingSocket.readyState);
                    console.error('❌ Error details:', {
                        type: error.type,
                        target: error.target,
                        timeStamp: error.timeStamp
                    });
                    document.getElementById('status').textContent = '❌ Signaling connection failed';
                    document.getElementById('status').style.color = '#dc3545';
                };
                
            } catch (error) {
                console.error('Failed to create WebSocket:', error);
                document.getElementById('status').textContent = 'Failed to connect to signaling server';
                document.getElementById('status').style.color = '#dc3545';
                
                // Retry after 5 seconds
                setTimeout(connectWebSocket, 5000);
            }
        };
        
        connectWebSocket();
    }
    
    preferAV1Codec(sdp) {
        try {
            // Check if AV1 is available with multiple MIME type formats
            const codecs = RTCRtpSender.getCapabilities('video').codecs;
            const hasAV1 = codecs.some(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                return mimeType.includes('av01') || 
                       mimeType.includes('av1') || 
                       mimeType === 'video/av01';
            });
            
            if (!hasAV1) {
                console.log('⚠️ AV1 codec not supported, using default');
                return sdp;
            }
            
            // Find AV1 codec in SDP and move it to the front
            const lines = sdp.split('\n');
            let mLineIndex = -1;
            let av1PayloadType = null;
            
            // Find the video m-line
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('m=video')) {
                    mLineIndex = i;
                    break;
                }
            }
            
            if (mLineIndex === -1) {
                return sdp;
            }
            
            // Find AV1 payload type with multiple possible formats
            for (let i = mLineIndex; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                if (lines[i].startsWith('a=rtpmap:') && 
                    (line.includes('av01') || line.includes('av1') || line.includes('video/av01'))) {
                    const match = lines[i].match(/a=rtpmap:(\d+)/);
                    if (match) {
                        av1PayloadType = match[1];
                        console.log('✅ Found AV1 codec with payload type:', av1PayloadType);
                        console.log('✅ AV1 rtpmap line:', lines[i]);
                        break;
                    }
                }
            }
            
            if (av1PayloadType) {
                // Move AV1 to the front of the codec list
                const mLine = lines[mLineIndex];
                const parts = mLine.split(' ');
                const payloadTypes = parts.slice(3);
                
                // Remove AV1 from current position and add to front
                const filteredTypes = payloadTypes.filter(pt => pt !== av1PayloadType);
                const newPayloadTypes = [av1PayloadType, ...filteredTypes];
                
                lines[mLineIndex] = parts.slice(0, 3).join(' ') + ' ' + newPayloadTypes.join(' ');
                console.log('✅ AV1 codec prioritized in SDP');
            }
            
            return lines.join('\n');
            
        } catch (error) {
            console.error('❌ Error modifying SDP for AV1:', error);
            return sdp;
        }
    }
    
    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.callBtn.addEventListener('click', () => this.startCall());
        this.hangupBtn.addEventListener('click', () => this.hangUp());
    }
    
    initializeParameterControls() {
        // Bitrate control
        const bitrateSlider = document.getElementById('bitrate');
        const bitrateValue = document.getElementById('bitrateValue');
        
        bitrateSlider.addEventListener('input', (e) => {
            bitrateValue.textContent = e.target.value;
            this.updateEncodingParameters();
        });
        
        // Frame rate control
        const framerateSlider = document.getElementById('framerate');
        const framerateValue = document.getElementById('framerateValue');
        
        framerateSlider.addEventListener('input', (e) => {
            framerateValue.textContent = e.target.value;
            this.updateEncodingParameters();
        });
        
        // Resolution control
        const resolutionSelect = document.getElementById('resolution');
        resolutionSelect.addEventListener('change', () => {
            this.updateEncodingParameters();
        });
        
        // SVC controls
        const enableSvcCheckbox = document.getElementById('enableSvc');
        const spatialLayersSlider = document.getElementById('spatialLayers');
        const spatialLayersValue = document.getElementById('spatialLayersValue');
        const temporalLayersSlider = document.getElementById('temporalLayers');
        const temporalLayersValue = document.getElementById('temporalLayersValue');
        
        enableSvcCheckbox.addEventListener('change', () => {
            this.updateEncodingParameters();
        });
        
        spatialLayersSlider.addEventListener('input', (e) => {
            spatialLayersValue.textContent = e.target.value;
            this.updateEncodingParameters();
        });
        
        temporalLayersSlider.addEventListener('input', (e) => {
            temporalLayersValue.textContent = e.target.value;
            this.updateEncodingParameters();
        });
    }
    
    checkAV1Support() {
        try {
            const codecs = RTCRtpSender.getCapabilities('video').codecs;
            console.log('🔍 Available video codecs:', codecs.map(c => c.mimeType));
            
            // Check for AV1 with multiple possible MIME type formats
            const av1Supported = codecs.some(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                return mimeType.includes('av01') || 
                       mimeType.includes('av1') || 
                       mimeType === 'video/av01';
            });
            
            if (av1Supported) {
                const av1Codec = codecs.find(codec => {
                    const mimeType = codec.mimeType.toLowerCase();
                    return mimeType.includes('av01') || 
                           mimeType.includes('av1') || 
                           mimeType === 'video/av01';
                });
                console.log('✅ AV1 codec is supported:', av1Codec.mimeType);
                document.getElementById('status').textContent = 'AV1 supported - Waiting for signaling...';
            } else {
                console.log('⚠️ AV1 codec not supported, will use fallback');
                console.log('Available codecs:', codecs.map(c => c.mimeType).join(', '));
                document.getElementById('status').textContent = 'AV1 not supported - Using fallback codec';
            }
        } catch (error) {
            console.error('❌ Error checking AV1 support:', error);
            document.getElementById('status').textContent = 'Error checking codec support';
        }
    }
    
    async startCamera() {
        try {
            console.log('📹 Starting camera...');
            
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: true
            };
            
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.localVideo.srcObject = this.localStream;
            
            this.startBtn.disabled = true;
            if (this.isSignalingConnected) {
                this.callBtn.disabled = false;
            }
            
            console.log('✅ Camera started successfully');
            document.getElementById('status').textContent = 'Camera ready - You can start a call';
            document.getElementById('status').style.color = '#28a745';
            
        } catch (error) {
            console.error('❌ Error accessing camera:', error);
            document.getElementById('status').textContent = `Camera error: ${error.message}`;
            document.getElementById('status').style.color = '#dc3545';
        }
    }
    
    async startCall() {
        console.log('📞 START CALL BUTTON CLICKED!');
        console.log('📞 Current signaling status:', this.isSignalingConnected);
        console.log('📞 WebSocket state:', this.signalingSocket ? this.signalingSocket.readyState : 'null');
        console.log('📞 Local stream:', this.localStream ? 'available' : 'not available');
        
        // Check if signaling is connected
        if (!this.isSignalingConnected) {
            console.error('❌ Signaling not connected!');
            alert('❌ Signaling server not connected! Please wait for connection or restart the server.');
            return;
        }
        
        // Check if camera is started
        if (!this.localStream) {
            alert('❌ Please start your camera first!');
            return;
        }
        
        try {
            this.createPeerConnection();
            
            // Add local stream to peer connection
            this.localStream.getTracks().forEach(track => {
                console.log('➕ Adding track to peer connection:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Configure AV1 encoding
            await this.configureAV1Encoding();
            
            this.isInitiator = true;
            
            // Create offer with AV1 codec preference
            console.log('📝 Creating offer...');
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            // Modify SDP to prefer AV1 codec if available
            offer.sdp = this.preferAV1Codec(offer.sdp);
            
            console.log('📝 Setting local description...');
            await this.peerConnection.setLocalDescription(offer);
            
            // Send offer through signaling
            console.log('📤 Sending offer through signaling...');
            this.sendSignalingMessage({
                type: 'offer',
                sdp: offer
            });
            
            this.callBtn.disabled = true;
            this.hangupBtn.disabled = false;
            
            document.getElementById('status').textContent = '📞 Calling... Waiting for answer';
            document.getElementById('status').style.color = '#ffc107';
            
        } catch (error) {
            console.error('❌ Error creating call:', error);
            document.getElementById('status').textContent = `Call failed: ${error.message}`;
            document.getElementById('status').style.color = '#dc3545';
        }
    }
    
    createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        console.log('🔗 Created peer connection');
        
        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('📺 Received remote stream');
            this.remoteStream = event.streams[0];
            this.remoteVideo.srcObject = this.remoteStream;
        };
        
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate');
                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };
        
        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            document.getElementById('status').textContent = `Connection: ${state}`;
            
            if (state === 'connected') {
                document.getElementById('status').style.color = '#28a745';
            } else if (state === 'failed' || state === 'disconnected') {
                document.getElementById('status').style.color = '#dc3545';
            } else {
                document.getElementById('status').style.color = '#ffc107';
            }
        };
        
        // ICE connection state changes
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('🧊 ICE connection state:', this.peerConnection.iceConnectionState);
        };
        
        // Start statistics monitoring
        this.startStatsMonitoring();
    }
    
    async configureAV1Encoding() {
        const sender = this.peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'video');
        
        if (!sender) {
            console.log('⚠️ No video sender found');
            return;
        }
        
        try {
            const params = sender.getParameters();
            console.log('📋 Current sender parameters:', JSON.stringify(params, null, 2));
            
            // Get UI values
            const bitrate = parseInt(document.getElementById('bitrate').value) * 1000;
            const enableSvc = document.getElementById('enableSvc').checked;
            const spatialLayers = parseInt(document.getElementById('spatialLayers').value);
            
            // Ensure encodings array exists
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            
            // Create a clean copy of parameters to avoid read-only field issues
            const newParams = {
                transactionId: params.transactionId,
                encodings: []
            };
            
            if (enableSvc && spatialLayers > 1) {
                // Configure SVC with multiple spatial layers
                for (let i = 0; i < spatialLayers; i++) {
                    const layerBitrate = Math.floor(bitrate * (0.4 + (i * 0.3)));
                    const encoding = {
                        rid: `s${i}`,
                        maxBitrate: layerBitrate,
                        scaleResolutionDownBy: Math.pow(2, spatialLayers - 1 - i)
                    };
                    
                    // Only add active property if it exists in original
                    if (params.encodings[0] && 'active' in params.encodings[0]) {
                        encoding.active = true;
                    }
                    
                    newParams.encodings.push(encoding);
                }
                console.log(`✅ SVC configured with ${spatialLayers} spatial layers`);
            } else {
                // Single layer encoding
                const encoding = {
                    maxBitrate: bitrate
                };
                
                // Copy safe properties from original encoding if it exists
                if (params.encodings[0]) {
                    if ('active' in params.encodings[0]) {
                        encoding.active = params.encodings[0].active;
                    }
                    if ('rid' in params.encodings[0]) {
                        encoding.rid = params.encodings[0].rid;
                    }
                }
                
                newParams.encodings.push(encoding);
                console.log(`✅ Single layer bitrate configured: ${bitrate / 1000}kbps`);
            }
            
            console.log('📋 New parameters to apply:', JSON.stringify(newParams, null, 2));
            
            // Apply parameters with proper error handling
            await sender.setParameters(newParams);
            console.log('✅ Encoding parameters applied successfully');
            
        } catch (error) {
            console.error('❌ Error configuring encoding:', error);
            console.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Try a simpler approach if the complex one fails
            try {
                const simpleParams = sender.getParameters();
                if (simpleParams.encodings && simpleParams.encodings.length > 0) {
                    const bitrate = parseInt(document.getElementById('bitrate').value) * 1000;
                    simpleParams.encodings[0].maxBitrate = bitrate;
                    await sender.setParameters(simpleParams);
                    console.log('✅ Fallback: Simple bitrate configuration applied');
                }
            } catch (fallbackError) {
                console.error('❌ Fallback encoding configuration also failed:', fallbackError);
                console.log('⚠️ Continuing with browser default encoding settings');
            }
        }
    }
    
    async updateEncodingParameters() {
        // This will be called when UI controls change
        if (this.peerConnection) {
            await this.configureAV1Encoding();
        }
    }
    
    startStatsMonitoring() {
        if (!this.peerConnection) return;
        
        setInterval(async () => {
            try {
                const stats = await this.peerConnection.getStats();
                this.updateStatsDisplay(stats);
            } catch (error) {
                console.error('Error getting stats:', error);
            }
        }, 1000);
    }
    
    updateStatsDisplay(stats) {
        let codecInfo = '-';
        let bitrate = '-';
        let resolution = '-';
        let framerate = '-';
        let packetLoss = '-';
        
        stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                if (report.codecId) {
                    stats.forEach(codecReport => {
                        if (codecReport.id === report.codecId) {
                            codecInfo = codecReport.mimeType || 'Unknown';
                        }
                    });
                }
                
                if (report.bytesSent && report.timestamp) {
                    // Calculate bitrate (this is simplified)
                    bitrate = Math.round((report.bytesSent * 8) / 1000) + ' kbps';
                }
                
                if (report.frameWidth && report.frameHeight) {
                    resolution = `${report.frameWidth}x${report.frameHeight}`;
                }
                
                if (report.framesPerSecond) {
                    framerate = report.framesPerSecond + ' fps';
                }
            }
            
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                if (report.packetsLost && report.packetsReceived) {
                    const lossRate = (report.packetsLost / 
                        (report.packetsLost + report.packetsReceived)) * 100;
                    packetLoss = lossRate.toFixed(2) + '%';
                }
            }
        });
        
        document.getElementById('codecInfo').textContent = codecInfo;
        document.getElementById('currentBitrate').textContent = bitrate;
        document.getElementById('currentResolution').textContent = resolution;
        document.getElementById('currentFramerate').textContent = framerate;
        document.getElementById('packetLoss').textContent = packetLoss;
    }
    
    sendSignalingMessage(message) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(message));
            console.log('📤 Sent signaling message:', message.type);
        } else {
            console.error('❌ Signaling socket not connected');
            document.getElementById('status').textContent = 'Signaling not connected!';
            document.getElementById('status').style.color = '#dc3545';
        }
    }
    
    async handleSignalingMessage(message) {
        console.log('📨 Handling signaling message:', message.type);
        
        try {
            switch (message.type) {
                case 'offer':
                    console.log('📨 Received offer');
                    await this.handleOffer(message.sdp);
                    break;
                case 'answer':
                    console.log('📨 Received answer');
                    await this.handleAnswer(message.sdp);
                    break;
                case 'ice-candidate':
                    console.log('📨 Received ICE candidate');
                    await this.handleIceCandidate(message.candidate);
                    break;
                case 'hangup':
                    console.log('📨 Received hangup');
                    this.hangUp();
                    break;
                default:
                    console.log('❓ Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('❌ Error handling signaling message:', error);
        }
    }
    
    async handleOffer(offer) {
        console.log('📨 Processing offer...');
        
        if (!this.peerConnection) {
            this.createPeerConnection();
        }
        
        // Add local stream if available
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        } else {
            // Auto-start camera for incoming call
            await this.startCamera();
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        }
        
        // Modify SDP to prefer AV1 codec if available
        offer.sdp = this.preferAV1Codec(offer.sdp);
        
        await this.peerConnection.setRemoteDescription(offer);
        
        // Configure AV1 encoding
        await this.configureAV1Encoding();
        
        // Create answer
        const answer = await this.peerConnection.createAnswer();
        
        // Modify answer SDP for AV1
        answer.sdp = this.preferAV1Codec(answer.sdp);
        
        await this.peerConnection.setLocalDescription(answer);
        
        // Send answer
        this.sendSignalingMessage({
            type: 'answer',
            sdp: answer
        });
        
        this.callBtn.disabled = true;
        this.hangupBtn.disabled = false;
        
        document.getElementById('status').textContent = '📞 Call connected';
        document.getElementById('status').style.color = '#28a745';
    }
    
    async handleAnswer(answer) {
        console.log('📨 Processing answer...');
        
        // Modify answer SDP for AV1
        answer.sdp = this.preferAV1Codec(answer.sdp);
        
        await this.peerConnection.setRemoteDescription(answer);
    }
    
    async handleIceCandidate(candidate) {
        console.log('📨 Adding ICE candidate...');
        
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
        }
    }
    
    hangUp() {
        console.log('📞 Hanging up call');
        
        // Send hangup message
        this.sendSignalingMessage({ type: 'hangup' });
        
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Reset UI
        this.callBtn.disabled = this.localStream ? false : true;
        this.hangupBtn.disabled = true;
        this.isInitiator = false;
        
        // Clear remote video
        this.remoteVideo.srcObject = null;
        
        document.getElementById('status').textContent = 'Call ended';
        document.getElementById('status').style.color = '#6c757d';
    }
}

// Initialize the application
console.log('🚀 Initializing WebRTC AV1 App');
const app = new WebRTCAV1App();

// Add debugging functions to window for manual testing
window.debugWebRTC = () => {
    console.log('=== WebRTC Debug Info ===');
    console.log('App instance:', app);
    console.log('Signaling connected:', app.isSignalingConnected);
    console.log('WebSocket state:', app.signalingSocket ? app.signalingSocket.readyState : 'null');
    console.log('Local stream:', app.localStream ? 'available' : 'not available');
    console.log('Peer connection:', app.peerConnection ? 'created' : 'not created');
    console.log('Call button disabled:', app.callBtn.disabled);
    console.log('========================');
};

// Add comprehensive codec debugging
window.debugCodecs = () => {
    console.log('=== Codec Debug Info ===');
    
    try {
        // Check sender capabilities
        const senderCaps = RTCRtpSender.getCapabilities('video');
        console.log('📤 Sender video capabilities:');
        senderCaps.codecs.forEach((codec, index) => {
            console.log(`  ${index + 1}. ${codec.mimeType} - ${codec.clockRate}Hz`);
            if (codec.sdpFmtpLine) {
                console.log(`     Parameters: ${codec.sdpFmtpLine}`);
            }
        });
        
        // Check receiver capabilities
        const receiverCaps = RTCRtpReceiver.getCapabilities('video');
        console.log('📥 Receiver video capabilities:');
        receiverCaps.codecs.forEach((codec, index) => {
            console.log(`  ${index + 1}. ${codec.mimeType} - ${codec.clockRate}Hz`);
            if (codec.sdpFmtpLine) {
                console.log(`     Parameters: ${codec.sdpFmtpLine}`);
            }
        });
        
        // Check for AV1 specifically
        const av1Sender = senderCaps.codecs.filter(codec => {
            const mimeType = codec.mimeType.toLowerCase();
            return mimeType.includes('av01') || mimeType.includes('av1');
        });
        
        const av1Receiver = receiverCaps.codecs.filter(codec => {
            const mimeType = codec.mimeType.toLowerCase();
            return mimeType.includes('av01') || mimeType.includes('av1');
        });
        
        console.log('🎯 AV1 Support Summary:');
        console.log('  Sender AV1 codecs:', av1Sender.length > 0 ? av1Sender : 'None found');
        console.log('  Receiver AV1 codecs:', av1Receiver.length > 0 ? av1Receiver : 'None found');
        
        // Check browser info
        console.log('🌐 Browser Info:');
        console.log('  User Agent:', navigator.userAgent);
        console.log('  WebRTC Support:', 'RTCPeerConnection' in window);
        
    } catch (error) {
        console.error('❌ Error debugging codecs:', error);
    }
    
    console.log('========================');
};

// Test signaling after 3 seconds
setTimeout(() => {
    console.log('🧪 Running automatic signaling test...');
    window.debugWebRTC();
    
    if (app.isSignalingConnected) {
        console.log('✅ Signaling is working! You can now test the call functionality.');
        
        // Auto-test camera start after signaling is ready
        setTimeout(() => {
            console.log('🧪 Auto-testing camera start...');
            if (!app.localStream) {
                console.log('📹 Attempting to start camera automatically...');
                app.startCamera().then(() => {
                    console.log('✅ Camera started successfully!');
                    window.debugWebRTC();
                }).catch(error => {
                    console.error('❌ Camera start failed:', error);
                });
            }
        }, 1000);
    } else {
        console.log('❌ Signaling connection failed. Check the server.');
    }
}, 3000);

// Add manual test function for call
window.testCall = () => {
    console.log('🧪 Manual call test initiated...');
    window.debugWebRTC();
    if (app.localStream && app.isSignalingConnected) {
        console.log('🧪 Attempting to start call...');
        app.startCall();
    } else {
        console.log('❌ Prerequisites not met for call:', {
            hasLocalStream: !!app.localStream,
            isSignalingConnected: app.isSignalingConnected
        });
    }
};