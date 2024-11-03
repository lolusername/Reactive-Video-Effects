// IIFE to avoid polluting global scope
(() => {
    'use strict';
  
    // Declare audioStream at the top level inside the IIFE
    let audioStream = null;
    let audioContext, sourceNode, analyserNode;
  
    // Add these variables at the top level inside the IIFE
    let lastBeatTime = 0;
    const BEAT_THRESHOLD = 0.80;  // Higher threshold for only strong beats
    const MIN_BEAT_INTERVAL = 100;  // Shorter interval to allow quick changes on strong beats
    const CHROMATIC_THRESHOLD = 0.80;  // Medium-strong beats threshold
    let chromaticStrength = 0;  // Will control the effect strength
  
    // Add at the top level inside the IIFE
    let lastVideoTime = 0;
  
    // Add at the top level inside the IIFE
    const videoTimestamps = new Map(); // Stores the last timestamp for each video URL
  
    // Add at the top level of your IIFE
    let mediaSources = [];  // Add this line to store both video and image sources
  
    // Functional helper to create and configure a video element
    const createVideoElement = (src) => {
      const video = document.createElement('video');
      video.src = src;
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.style.display = 'none';
      document.body.appendChild(video);
      return video;
    };
  
    // Main function to initialize and run the application
    const init = async () => {
      const canvas = document.getElementById('glCanvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
      if (!gl) {
        console.error('WebGL not supported');
        return;
      }
  
      // Adjust canvas size
      const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      window.addEventListener('resize', resizeCanvas);
      resizeCanvas();
  
      // Video sources array
      let videoSources = ['vid/C0008.MP4_Rendered_001.mp4', 'vid/C0016.MP4_Rendered_001.mp4', 'vid/C0014.MP4_Rendered_001.mp4', 'vid/C0022.MP4_Rendered_001.mp4'];
      let currentVideoIndex = 0;
  
      // Initialize video
      let video = createVideoElement(videoSources[currentVideoIndex]);
      video.play();
  
      // Modified initAudio function
      const initAudio = async () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (!analyserNode) {
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 256;
        }
        
        // Only create new source node if we don't have one AND we're not using audioStream
        if (!sourceNode && video && !audioStream) {
            sourceNode = audioContext.createMediaElementSource(video);
            sourceNode.connect(analyserNode);
        }
      };
  
      // Modified audio capture button listeners
      document.getElementById('startAudio').addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true,
                audio: true 
            });
            
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                if (sourceNode) {
                    sourceNode.disconnect();
                }
                
                audioStream = new MediaStream([audioTrack]);
                sourceNode = audioContext.createMediaStreamSource(audioStream);
                sourceNode.connect(analyserNode);
                
                document.getElementById('startAudio').style.display = 'none';
                document.getElementById('stopAudio').style.display = 'block';
            }
            
            stream.getVideoTracks().forEach(track => track.stop());
            
        } catch (error) {
            console.error('Error starting audio capture:', error);
        }
        updateControlsVisibility();
      });
  
      // Modified stop audio handler
      document.getElementById('stopAudio').addEventListener('click', () => {
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }

        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }

        // Close and null out the existing audio context
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        
        // Null out the analyser node as well
        analyserNode = null;

        // Reinitialize audio for video
        initAudio();

        document.getElementById('startAudio').style.display = 'block';
        document.getElementById('stopAudio').style.display = 'none';
        
        updateControlsVisibility();
      });
  
      // Add shader sources here
      const vertexShaderSource = `
          attribute vec4 a_position;
          attribute vec2 a_texCoord;
          uniform vec2 u_resolution;
          varying vec2 v_texCoord;

          void main() {
              float videoAspect = 16.0/9.0;
              float screenAspect = u_resolution.x/u_resolution.y;
              vec2 position = a_position.xy;
              
              if (screenAspect > videoAspect) {
                  float scale = screenAspect / videoAspect;
                  position.x /= scale;
              } else {
                  float scale = videoAspect / screenAspect;
                  position.y /= scale;
              }
              
              gl_Position = vec4(position, 0.0, 1.0);
              v_texCoord = a_texCoord;
          }
      `;

      const fragmentShaderSource = `
          precision mediump float;
          
          uniform sampler2D u_videoTexture;
          uniform vec2 u_mouse;
          uniform float u_audioFreq;
          uniform float u_chromaticStrength;
          
          varying vec2 v_texCoord;

          vec3 chromaticAberration(sampler2D tex, vec2 uv, float strength) {
              float aberration = strength * 0.01;
              
              vec2 redOffset = vec2(aberration, 0.0);
              vec2 greenOffset = vec2(0.0, 0.0);
              vec2 blueOffset = vec2(-aberration, 0.0);
              
              float r = texture2D(tex, uv + redOffset).r;
              float g = texture2D(tex, uv + greenOffset).g;
              float b = texture2D(tex, uv + blueOffset).b;
              
              return vec3(r, g, b);
          }

          vec3 sophisticatedContrast(vec3 color, float contrastLevel) {
              // Store original luminance
              float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
              
              // Basic contrast adjustment as foundation
              float basicContrast = mix(0.6, 1.6, contrastLevel);
              color = pow(color, vec3(basicContrast));
              
              // Professional Lift/Gamma/Gain on top
              float lift = mix(-0.05, 0.02, contrastLevel);
              float gamma = mix(1.1, 0.9, contrastLevel);
              float gain = mix(0.95, 1.1, contrastLevel);
              
              // Apply LGG adjustments
              color = pow(max(vec3(0.0), color + lift), vec3(1.0 / gamma)) * gain;
              
              // Cinematic highlight rolloff
              float highlightCompress = mix(1.1, 0.9, contrastLevel);
              vec3 highlights = smoothstep(0.7, 0.95, color);
              color = mix(color, pow(color, vec3(highlightCompress)), highlights);
              
              // Natural saturation compensation
              float saturationCompensation = mix(1.1, 0.9, contrastLevel);
              vec3 desaturated = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
              color = mix(desaturated, color, saturationCompensation);
              
              return color;
          }

          vec3 colorGrade(vec3 color, float temperature, float audioLevel) {
              // Your existing color temperature controls
              vec3 coolHighlights = vec3(0.85, 0.95, 1.15);
              vec3 coolShadows = vec3(0.85, 0.95, 1.1);
              vec3 warmHighlights = vec3(1.15, 0.95, 0.85);
              vec3 warmShadows = vec3(1.1, 0.95, 0.85);
              
              float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
              
              vec3 highlights = mix(
                  coolHighlights,
                  warmHighlights,
                  smoothstep(0.2, 0.8, temperature)
              );
              
              vec3 shadows = mix(
                  coolShadows,
                  warmShadows,
                  smoothstep(0.2, 0.8, temperature)
              );
              
              vec3 highlightAdjust = mix(vec3(1.0), highlights, smoothstep(0.4, 0.8, luminance));
              vec3 shadowAdjust = mix(vec3(1.0), shadows, smoothstep(0.6, 0.2, luminance));
              
              color *= highlightAdjust * shadowAdjust;
              
              return color;
          }

          void main() {
              vec3 color = chromaticAberration(u_videoTexture, v_texCoord, u_chromaticStrength);
              
              color = colorGrade(color, u_mouse.x, u_audioFreq);
              color = sophisticatedContrast(color, u_mouse.y);
              
              gl_FragColor = vec4(color, 1.0);
          }
      `;

      // Create shader program
      const createShader = (gl, type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
              console.error(gl.getShaderInfoLog(shader));
              gl.deleteShader(shader);
              return null;
          }
          return shader;
      };

      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
      
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error(gl.getProgramInfoLog(program));
          return;
      }

      // Set up buffers
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      const positions = new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const texCoordBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      const texCoords = new Float32Array([
          0, 1,
          1, 1,
          0, 0,
          0, 0,
          1, 1,
          1, 0,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

      // Set up attributes
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');

      // Set up uniforms
      const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
      const mouseLocation = gl.getUniformLocation(program, 'u_mouse');
      const timeLocation = gl.getUniformLocation(program, 'u_time');
      const audioFreqLocation = gl.getUniformLocation(program, 'u_audioFreq');
      const cursorSpeedLocation = gl.getUniformLocation(program, 'u_cursorSpeed');
      const oldFilmEffectLocation = gl.getUniformLocation(program, 'u_oldFilmEffect');
      const chromaticStrengthLocation = gl.getUniformLocation(program, 'u_chromaticStrength');

      // Create and set up texture
      const videoTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      // Mouse tracking
      const mouse = {
          x: 0.5,
          y: 0.5,
          lastX: 0,
          lastY: 0,
          velocity: 0,
          lastTime: 0
      };

      let oldFilmEffect = false;

      // Event listeners
      window.addEventListener('mousemove', (e) => {
          const currentTime = performance.now();
          const deltaTime = (currentTime - mouse.lastTime) / 1000;
          
          const dx = e.clientX - mouse.lastX;
          const dy = e.clientY - mouse.lastY;
          mouse.velocity = Math.sqrt(dx*dx + dy*dy) / deltaTime;
          mouse.velocity = Math.min(mouse.velocity / 1000, 1.0);
          
          mouse.lastX = e.clientX;
          mouse.lastY = e.clientY;
          mouse.x = e.clientX / gl.canvas.width;
          mouse.y = 1 - e.clientY / gl.canvas.height;
          mouse.lastTime = currentTime;

          // Update UI to reflect cursor position
          if (!audioStream) {
              // Update temperature bar (mouse.x)
              const tempFill = document.querySelector('.temp-fill');
              const tempValue = document.querySelector('.temp-value');
              const tempPercentage = Math.round(mouse.x * 100);
              tempFill.style.width = `${tempPercentage}%`;
              tempValue.textContent = `${tempPercentage}%`;

              // Update contrast bar (mouse.y)
              const contrastFill = document.querySelector('.contrast-fill');
              const contrastValue = document.querySelector('.contrast-value');
              const contrastPercentage = Math.round(mouse.y * 100);
              contrastFill.style.width = `${contrastPercentage}%`;
              contrastValue.textContent = `${contrastPercentage}%`;
          }
      });

      canvas.addEventListener('click', (e) => {
          // Only toggle if the click was on the canvas, not the buttons
          if (e.target === canvas) {
              oldFilmEffect = !oldFilmEffect;
          }
      });

      // Modified double-click handler
      window.addEventListener('dblclick', () => {
          video.pause();
          currentVideoIndex = (currentVideoIndex + 1) % videoSources.length;
          video.src = videoSources[currentVideoIndex];
          video.play();
          
          // Don't reinitialize audio if we have a stream
          if (!audioStream) {
              initAudio();
          }
      });

      // Render loop
      let startTime = null;
      const render = (timestamp) => {
          if (!startTime) startTime = timestamp;
          const elapsedTime = (timestamp - startTime) / 1000;

          gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(program);

          // Update attributes
          gl.enableVertexAttribArray(positionLocation);
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

          gl.enableVertexAttribArray(texCoordLocation);
          gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
          gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

          // Update uniforms
          gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);
          gl.uniform2f(mouseLocation, mouse.x, mouse.y);
          gl.uniform1f(timeLocation, elapsedTime);
          gl.uniform1f(cursorSpeedLocation, mouse.velocity);
          gl.uniform1i(oldFilmEffectLocation, oldFilmEffect);
          gl.uniform1f(chromaticStrengthLocation, chromaticStrength);

          // Update audio frequency data
          if (analyserNode) {
              const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
              analyserNode.getByteFrequencyData(frequencyData);
              
              // Focus on bass and mid frequencies for better beat detection
              let bassSum = 0;
              let midSum = 0;
              
              // Bass frequencies (first few bins)
              for (let i = 0; i < 4; i++) {
                  bassSum += frequencyData[i];
              }
              
              // Mid frequencies (next few bins)
              for (let i = 4; i < 12; i++) {
                  midSum += frequencyData[i];
              }
              
              const bassAverage = bassSum / (4 * 255); // Normalize to 0-1
              const midAverage = midSum / (8 * 255);  // Normalize to 0-1
              
              // Combined beat detection
              const beatStrength = (bassAverage * 0.7) + (midAverage * 0.3);
              gl.uniform1f(audioFreqLocation, beatStrength);

              // Update chromatic aberration strength
              if (beatStrength > CHROMATIC_THRESHOLD) {
                  chromaticStrength = beatStrength;
              } else {
                  // Decay the effect
                  chromaticStrength *= 0.9;
              }
              gl.uniform1f(chromaticStrengthLocation, chromaticStrength);

              // Only switch on very strong beats
              const currentTime = performance.now();
              if (beatStrength > BEAT_THRESHOLD && 
                  currentTime - lastBeatTime > MIN_BEAT_INTERVAL) {
                  lastBeatTime = currentTime;
                  lastVideoTime = video.currentTime / video.duration; // Store relative position (0-1)
                  video.pause();
                  currentVideoIndex = (currentVideoIndex + 1) % videoSources.length;
                  video.src = videoSources[currentVideoIndex];
                  video.play().then(() => {
                      video.currentTime = lastVideoTime * video.duration; // Restore relative position
                  });
              }
          }

          // Update video texture
          if (video.readyState >= video.HAVE_CURRENT_DATA) {
              gl.bindTexture(gl.TEXTURE_2D, videoTexture);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          }

          // Draw
          gl.drawArrays(gl.TRIANGLES, 0, 6);

          requestAnimationFrame(render);
      };

      // Modified video canplay listener
      video.addEventListener('canplay', async () => {
          if (!audioContext) {
              await initAudio();
          }
          requestAnimationFrame(render);
      });

      // Add this event listener after your other event listeners
      window.addEventListener('keydown', (e) => {
          // Only allow arrow key controls when not connected to audio
          if (!audioStream) {
              switch(e.code) {
                  case 'ArrowRight':
                  case 'ArrowDown':
                      lastVideoTime = video.currentTime / video.duration;
                      video.pause();
                      currentVideoIndex = (currentVideoIndex + 1) % videoSources.length;
                      video.src = videoSources[currentVideoIndex];
                      video.play().then(() => {
                          video.currentTime = lastVideoTime * video.duration;
                      });
                      break;
                      
                  case 'ArrowLeft':
                  case 'ArrowUp':
                      lastVideoTime = video.currentTime / video.duration;
                      video.pause();
                      currentVideoIndex = (currentVideoIndex - 1 + videoSources.length) % videoSources.length;
                      video.src = videoSources[currentVideoIndex];
                      video.play().then(() => {
                          video.currentTime = lastVideoTime * video.duration;
                      });
                      break;
              }
          }
      });

      // Add at the top level inside init()
      const videoControls = document.querySelector('.video-controls');
      const tempBar = document.querySelector('.temp-bar');
      const contrastBar = document.querySelector('.contrast-bar');
      const tempValue = document.querySelector('.temp-value');
      const contrastValue = document.querySelector('.contrast-value');

      // Show/hide controls based on audio connection
      const updateControlsVisibility = () => {
          videoControls.style.display = audioStream ? 'none' : 'block';
      };

      // Update initial visibility
      updateControlsVisibility();

      // Handle control bar clicks
      const handleBarClick = (e, bar, fill, value, isTemp) => {
          const rect = bar.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
          
          fill.style.width = `${percentage}%`;
          value.textContent = `${Math.round(percentage)}%`;
          
          if (isTemp) {
              mouse.x = percentage / 100;
          } else {
              mouse.y = percentage / 100;
          }
      };

      tempBar.addEventListener('click', (e) => {
          if (!audioStream) {
              handleBarClick(e, tempBar, tempBar.querySelector('.temp-fill'), tempValue, true);
          }
      });

      contrastBar.addEventListener('click', (e) => {
          if (!audioStream) {
              handleBarClick(e, contrastBar, contrastBar.querySelector('.contrast-fill'), contrastValue, false);
          }
      });

      // Add to your JavaScript initialization
      const mediaUpload = document.getElementById('mediaUpload');
      if (mediaUpload) {
          mediaUpload.addEventListener('change', (e) => {
              const files = Array.from(e.target.files);
              
              if (files.length > 0) {
                  // Filter for both video and image files
                  const newMediaSources = files
                      .filter(file => file.type.startsWith('video/') || file.type.startsWith('image/'))
                      .map(file => ({
                          url: URL.createObjectURL(file),
                          type: file.type.startsWith('video/') ? 'video' : 'image'
                      }));
                  
                  if (newMediaSources.length > 0) {
                      // Clean up old object URLs
                      videoSources.forEach(url => {
                          if (url.startsWith('blob:')) {
                              URL.revokeObjectURL(url);
                          }
                      });
                      
                      // Store all media sources
                      mediaSources = newMediaSources;
                      videoSources = newMediaSources.map(media => media.url);
                      currentVideoIndex = 0;
                      
                      // Load first media
                      loadMedia(0);
                  }
              }
          });
      } else {
          console.log('Upload element not found');
      }

      // Add cleanup on page unload
      window.addEventListener('beforeunload', () => {
          videoSources.forEach(url => {
              if (url.startsWith('blob:')) {
                  URL.revokeObjectURL(url);
              }
          });
      });

      // Add to your init function
      window.addEventListener('load', () => {
          // Remove banner after animation
          setTimeout(() => {
              const banner = document.querySelector('.intro-banner');
              if (banner) {
                  banner.remove();
              }
          }, 2500); // Slightly longer than animation to ensure smooth fade
      });

      // Update the loadMedia function
      function loadMedia(index) {
          const media = mediaSources[index];
          
          if (media.type === 'video') {
              // Store current video's timestamp before switching
              if (video.src) {
                  const currentVideoKey = videoSources[currentVideoIndex];
                  videoTimestamps.set(currentVideoKey, video.currentTime);
              }
              
              video.src = media.url;
              video.play().catch(console.error);
          } else {
              // Handle image
              const img = new Image();
              img.onload = () => {
                  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
                  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
              };
              img.src = media.url;
          }
          
          currentVideoIndex = index;
      }

      // Add video ended handler to restart video
      video.addEventListener('ended', () => {
          const currentVideoKey = videoSources[currentVideoIndex];
          videoTimestamps.set(currentVideoKey, 0); // Reset timestamp
          video.currentTime = 0;
          video.play();
      });

      // Debug helper - log all timestamps
      function logTimestamps() {
          console.log('Current timestamps:');
          videoTimestamps.forEach((time, url) => {
              console.log(url, ':', time);
          });
      }

      // Make sure video is ready to seek
      video.preload = 'auto';
    };
  
    // Run the application
    window.addEventListener('load', init);
  })();