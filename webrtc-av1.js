class WebRTCAV1App {
    constructor() {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.startBtn = document.getElementById('startBtn');
        this.callBtn = document.getElementById('callBtn');
        
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isInitiator = false;
        this.signalingSocket = null;
        this.isSignalingConnected = false;
        this.inCall = false;
        this.previousStats = null;
        
        // Camera setting selects
        this.resolutionSelect = document.getElementById('resolutionSelect');
        this.fpsSelect = document.getElementById('fpsSelect');
        
        // Initialize WebSocket connection with retry
        this.initializeSignaling();
        
        this.initializeEventListeners();
        this.initializeParameterControls();
        
        // Check AV1 support
        this.checkAV1Support();
    }
    
    initializeSignaling() {
        const connect = () => {
            this.signalingSocket = new WebSocket('ws://192.168.80.99:3000');
            
            this.signalingSocket.onopen = () => {
                console.log('✅ Signaling connected');
                this.isSignalingConnected = true;
                if (this.localStream) {
                    this.callBtn.disabled = false;
                }
                document.getElementById('status').textContent = 'Signaling connected - Start your camera';
                document.getElementById('status').style.color = '#ffc107';
            };
            
            this.signalingSocket.onclose = () => {
                console.log('❌ Signaling disconnected');
                this.isSignalingConnected = false;
                this.callBtn.disabled = true;
                document.getElementById('status').textContent = 'Signaling disconnected - Retrying...';
                document.getElementById('status').style.color = '#dc3545';
                setTimeout(connect, 3000);
            };
            
            this.signalingSocket.onmessage = async (event) => {
                try {
                    let data = event.data;
                    if (data instanceof Blob) {
                        data = await data.text();
                    }
                    const message = JSON.parse(data);
                    console.log('📨 Received signaling message:', message.type);
                    
                    switch (message.type) {
                        case 'offer':
                            console.log('📥 Received SDP offer:\n', message.sdp?.sdp || message.sdp);
                            await this.handleOffer(message.sdp);
                            break;
                        case 'answer':
                            console.log('📥 Received SDP answer:\n', message.sdp?.sdp || message.sdp);
                            await this.handleAnswer(message.sdp);
                            break;
                        case 'ice-candidate':
                            await this.handleIceCandidate(message.candidate);
                            break;
                        default:
                            console.log('❓ Unknown message type:', message.type);
                    }
                } catch (error) {
                    console.error('❌ Error parsing signaling message:', error);
                }
            };
            
            this.signalingSocket.onerror = (error) => {
                console.error('❌ Signaling error:', error);
            };
        };
        
        connect();
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
                
                // Add Dependency Descriptor extension for AV1 (insert after m=video line)
                const ddExtLine = 'a=extmap:12 https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension';
                lines.splice(mLineIndex + 1, 0, ddExtLine);
                console.log('✅ Added AV1 Dependency Descriptor extension to SDP');
            }
            
            return lines.join('\n');
            
        } catch (error) {
            console.error('❌ Error modifying SDP for AV1:', error);
            return sdp;
        }
    }
    
    // Class: WebRTCAV1App
    // Method: initializeEventListeners
    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.callBtn.addEventListener('click', () => this.startCall());
    }
    
    // Method: initializeParameterControls
    // Class: WebRTCAV1App
    // Method: initializeParameterControls
    initializeParameterControls() {
        const enableSvcCheckbox = document.getElementById('enableSvc');
        const spatialLayersSlider = document.getElementById('spatialLayers');
        const spatialLayersValue = document.getElementById('spatialLayersValue');
        const temporalLayersSlider = document.getElementById('temporalLayers');
        const temporalLayersValue = document.getElementById('temporalLayersValue');
        
        if (this.resolutionSelect) {
            this.resolutionSelect.addEventListener('change', async () => {
                if (this.inCall) return; // lock after call starts
                if (this.localStream) {
                    await this.applySelectedCameraConstraints();
                }
            });
        }
        if (this.fpsSelect) {
            this.fpsSelect.addEventListener('change', async () => {
                if (this.inCall) return; // lock after call starts
                if (this.localStream) {
                    await this.applySelectedCameraConstraints();
                }
            });
        }
        
        if (spatialLayersSlider && spatialLayersValue) {
            spatialLayersValue.textContent = spatialLayersSlider.value;
        }
        if (temporalLayersSlider && temporalLayersValue) {
            temporalLayersValue.textContent = temporalLayersSlider.value;
        }
        
        if (enableSvcCheckbox) {
            enableSvcCheckbox.addEventListener('change', () => {
                this.updateEncodingParameters();
            });
        }
        if (spatialLayersSlider && spatialLayersValue) {
            spatialLayersSlider.addEventListener('input', (e) => {
                spatialLayersValue.textContent = e.target.value;
                this.updateEncodingParameters();
            });
        }
        if (temporalLayersSlider && temporalLayersValue) {
            temporalLayersSlider.addEventListener('input', (e) => {
                temporalLayersValue.textContent = e.target.value;
                this.updateEncodingParameters();
            });
        }
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
    
    // Class: WebRTCAV1App
    // Method: startCamera
    async startCamera() {
        try {
            console.log('📹 Starting camera...');
    
            // Build constraints from UI (use 'ideal' to allow browser negotiation)
            const videoConstraints = {};
            if (this.resolutionSelect && this.resolutionSelect.value !== 'auto') {
                const [w, h] = this.resolutionSelect.value.split('x').map(v => parseInt(v, 10));
                if (!isNaN(w) && !isNaN(h)) {
                    videoConstraints.width = { ideal: w };
                    videoConstraints.height = { ideal: h };
                }
            }
            if (this.fpsSelect && this.fpsSelect.value !== 'auto') {
                const fps = parseFloat(this.fpsSelect.value);
                if (!isNaN(fps)) {
                    videoConstraints.frameRate = { ideal: fps };
                }
            }
    
            const constraints = {
                video: Object.keys(videoConstraints).length ? videoConstraints : true,
                audio: true
            };
    
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.localVideo.srcObject = this.localStream;
    
            // Log the actual resolution to see what the camera provides
            const videoTrack = this.localStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            console.log(`📹 Camera started with resolution: ${settings.width}x${settings.height}, ${settings.frameRate || '-'} fps`);
    
            // Populate capability info and dropdowns based on real camera capabilities
            this.populateCameraOptions(videoTrack);
    
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
    
    // Class: WebRTCAV1App
    // Method: startCall
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
            
            // Configure AV1 encoding (applies scalabilityMode pre-call)
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
            this.inCall = true;
            this.setSvcControlsDisabled(true);
            
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
    
    // Method: configureAV1Encoding
    async configureAV1Encoding() {
        const sender = this.peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'video');
        
        if (!sender) {
            console.log('⚠️ No video sender found');
            return;
        }
        
        try {
            let params = sender.getParameters();
            console.log('📋 Current sender parameters:', JSON.stringify(params, null, 2));
            
            const enableSvc = document.getElementById('enableSvc').checked;
            const spatialLayers = parseInt(document.getElementById('spatialLayers').value);
            const temporalLayers = parseInt(document.getElementById('temporalLayers').value);
            
            // Ensure encodings exist (should be at least 1)
            if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
            }
            const encoding = params.encodings[0];
            
            if (!this.inCall) {
                if (enableSvc) {
                    encoding.scalabilityMode = `L${spatialLayers}T${temporalLayers}`;
                    console.log(`✅ SVC enabled with scalabilityMode: ${encoding.scalabilityMode}`);
                } else {
                    delete encoding.scalabilityMode;
                    console.log('✅ Standard single-layer encoding configured');
                }
            } else {
                console.log('ℹ️ In call: keeping existing scalabilityMode unchanged');
            }
            
            encoding.active = true;
            
            await sender.setParameters(params);
            console.log('✅ Encoding parameters applied successfully');
            
        } catch (error) {
            console.error('❌ Error configuring encoding:', error);
            console.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
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
        let totalBitrate = 0;
        let mainResolution = '-';
        let mainFramerate = '-';
        let packetLoss = '-';
        let scalabilityMode = '-';

        const outboundRtpReports = [];
        stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                outboundRtpReports.push(report);
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                if (report.packetsLost && report.packetsReceived && (report.packetsLost + report.packetsReceived) > 0) {
                    const lossRate = (report.packetsLost / (report.packetsLost + report.packetsReceived)) * 100;
                    packetLoss = lossRate.toFixed(2) + '%';
                }
            }
        });

        if (outboundRtpReports.length > 0) {
            // Get codec info from the first report
            const firstReport = outboundRtpReports[0];
            if (firstReport.codecId) {
                const codec = stats.get(firstReport.codecId);
                if (codec) {
                    codecInfo = codec.mimeType || 'Unknown';
                    if (codec.sdpFmtpLine) {
                        codecInfo += ` (${codec.sdpFmtpLine})`;
                    }
                }
            }

            let highestResolution = 0;
            
            for (const report of outboundRtpReports) {
                if (report.scalabilityMode) {
                    scalabilityMode = report.scalabilityMode;
                }

                if (this.previousStats) {
                    const prevReport = this.previousStats.get(report.id);
                    if (prevReport) {
                        const bytesSent = report.bytesSent - prevReport.bytesSent;
                        const timeDiff = (report.timestamp - prevReport.timestamp) / 1000;

                        // Only calculate bitrate for active layers sending data
                        if (timeDiff > 0 && bytesSent > 0) {
                            const layerBitrate = Math.round((bytesSent * 8) / timeDiff);
                            totalBitrate += layerBitrate;
                        }
                    }
                }

                const currentResolution = (report.frameWidth || 0) * (report.frameHeight || 0);
                if (currentResolution > highestResolution) {
                    highestResolution = currentResolution;
                    mainResolution = `${report.frameWidth}x${report.frameHeight}`;
                    mainFramerate = `${report.framesPerSecond || '-'} fps`;
                }
            }
        }

        document.getElementById('codecInfo').textContent = codecInfo;
        document.getElementById('currentBitrate').textContent = `${Math.round(totalBitrate / 1000)} kbps`;
        document.getElementById('currentResolution').textContent = mainResolution;
        document.getElementById('currentFramerate').textContent = mainFramerate;
        document.getElementById('packetLoss').textContent = packetLoss;

        const scalabilityModeEl = document.getElementById('scalabilityModeInfo');
        if (scalabilityModeEl) {
            scalabilityModeEl.textContent = scalabilityMode;
        }

        this.previousStats = stats;
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
        this.inCall = true;
        this.setSvcControlsDisabled(true);
        
        document.getElementById('status').textContent = '📞 Call connected';
        document.getElementById('status').style.color = '#28a745';
    }
    
    async handleIceCandidate(candidate) {
        console.log('📨 Adding ICE candidate...');
        
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
        }
    }
    
    // Class: WebRTCAV1App
    async handleAnswer(answer) {
        console.log('📨 Processing answer...');
        
        // Modify answer SDP for AV1
        answer.sdp = this.preferAV1Codec(answer.sdp);
        
        await this.peerConnection.setRemoteDescription(answer);
        this.inCall = true;
        this.setSvcControlsDisabled(true);
    }
    
    // Class: WebRTCAV1App
    setSvcControlsDisabled(disabled) {
        const enableSvcCheckbox = document.getElementById('enableSvc');
        const spatialLayersSlider = document.getElementById('spatialLayers');
        const temporalLayersSlider = document.getElementById('temporalLayers');
        if (enableSvcCheckbox) enableSvcCheckbox.disabled = disabled;
        if (spatialLayersSlider) spatialLayersSlider.disabled = disabled;
        if (temporalLayersSlider) temporalLayersSlider.disabled = disabled;
    
        // Also lock camera resolution/fps after call starts
        const resolutionSelect = document.getElementById('resolutionSelect');
        const fpsSelect = document.getElementById('fpsSelect');
        if (resolutionSelect) resolutionSelect.disabled = disabled;
        if (fpsSelect) fpsSelect.disabled = disabled;
    }

    async applySelectedCameraConstraints() {
        try {
            const track = this.localStream.getVideoTracks()[0];
            if (!track) return;
        
            const constraints = {};
            if (this.resolutionSelect && this.resolutionSelect.value !== 'auto') {
                const [w, h] = this.resolutionSelect.value.split('x').map(v => parseInt(v, 10));
                if (!isNaN(w) && !isNaN(h)) {
                    constraints.width = { ideal: w };
                    constraints.height = { ideal: h };
                }
            }
            if (this.fpsSelect && this.fpsSelect.value !== 'auto') {
                const fps = parseFloat(this.fpsSelect.value);
                if (!isNaN(fps)) {
                    constraints.frameRate = { ideal: fps };
                }
            }
        
            console.log('🔁 Applying camera constraints:', constraints);
            await track.applyConstraints(constraints);
        
            const settings = track.getSettings();
            console.log(`✅ Applied camera settings: ${settings.width}x${settings.height}, ${settings.frameRate || '-'} fps`);
        } catch (err) {
            console.error('❌ Failed to apply camera constraints:', err);
        }
    }

    populateCameraOptions(videoTrack) {
        if (!videoTrack || !videoTrack.getCapabilities) {
            console.warn('⚠️ Video track capabilities not available');
            return;
        }
        
        const caps = videoTrack.getCapabilities();
        const capsText = [
            `width ${caps.width ? `${caps.width.min}-${caps.width.max}` : '-'}`,
            `height ${caps.height ? `${caps.height.min}-${caps.height.max}` : '-'}`,
            `fps ${caps.frameRate ? `${Math.round(caps.frameRate.min)}-${Math.round(caps.frameRate.max)}` : '-'}`
        ].join(', ');
        const capsEl = document.getElementById('cameraCaps');
        if (capsEl) capsEl.textContent = capsText;
        
        // Generate sensible resolution presets and filter by capability ranges
        const resolutionPresets = [
            '320x240', '640x360', '640x480', '960x540', '1024x576',
            '1280x720', '1280x960', '1920x1080', '2560x1440', '3840x2160'
        ];
        const withinRange = (w, h) => {
            const wOk = !caps.width || (caps.width.min <= w && w <= caps.width.max);
            const hOk = !caps.height || (caps.height.min <= h && h <= caps.height.max);
            return wOk && hOk;
        };
        
        if (this.resolutionSelect) {
            const prev = this.resolutionSelect.value;
            this.resolutionSelect.innerHTML = '';
            const addOpt = (val, label) => {
                const o = document.createElement('option');
                o.value = val; o.textContent = label;
                this.resolutionSelect.appendChild(o);
            };
            addOpt('auto', 'Auto');
            const filtered = resolutionPresets.filter(r => {
                const [w, h] = r.split('x').map(n => parseInt(n, 10));
                return withinRange(w, h);
            });
            filtered.forEach(r => addOpt(r, r));
            if ([...this.resolutionSelect.options].some(o => o.value === prev)) {
                this.resolutionSelect.value = prev;
            }
        }
        
        if (this.fpsSelect) {
            const prev = this.fpsSelect.value;
            this.fpsSelect.innerHTML = '';
            const addOpt = (val, label) => {
                const o = document.createElement('option');
                o.value = val; o.textContent = label;
                this.fpsSelect.appendChild(o);
            };
            addOpt('auto', 'Auto');
            const fpsCandidates = [15, 24, 30, 60, 90, 120];
            fpsCandidates.forEach(f => {
                const ok = !caps.frameRate || (caps.frameRate.min <= f && f <= caps.frameRate.max);
                if (ok) addOpt(String(f), `${f} fps`);
            });
            if ([...this.fpsSelect.options].some(o => o.value === prev)) {
                this.fpsSelect.value = prev;
            }
        }
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