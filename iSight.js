'use strict';
var uuid, Service, Characteristic, StreamController;

var imagesnapjs = require('imagesnapjs');
var crypto = require('crypto');
var fs = require('fs');
var ip = require('ip');
var spawn = require('child_process').spawn;

module.exports = {
  iSight: iSight
};

function iSight(hap, config) {
  uuid = hap.uuid;
  Service = hap.Service;
  Characteristic = hap.Characteristic;
  StreamController = hap.StreamController;

  this.config = config;

  this.services = [];
  this.streamControllers = [];

  this.pendingSessions = {};
  this.ongoingSessions = {};

  let options = {
    proxy: false, // Requires RTP/RTCP MUX Proxy
    srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
    video: {
      resolutions: [
        [1920, 1080, 30], // Width, Height, framerate
        [320, 240, 15], // Apple Watch requires this configuration
        [1280, 960, 30],
        [1280, 720, 30],
        [1024, 768, 30],
        [640, 480, 30],
        [640, 360, 30],
        [480, 360, 30],
        [480, 270, 30],
        [320, 240, 30],
        [320, 180, 30]
      ],
      codec: {
        profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
        levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
      }
    },
    audio: {
      codecs: [
        {
          type: "OPUS", // Audio Codec
          samplerate: 24 // 8, 16, 24 KHz
        },
        {
          type: "AAC-eld",
          samplerate: 16
        }
      ]
    }
  }

  this.createCameraControlService();
  this._createStreamControllers(2, options);
}

iSight.prototype.handleCloseConnection = function(connectionID) {
  this.streamControllers.forEach(function(controller) {
    controller.handleCloseConnection(connectionID);
  });
}

iSight.prototype.handleSnapshotRequest = function(request, callback) {
  try {
      fs.unlinkSync("/tmp/0F0E480E-135D-4D11-86FC-B1C0C3ACA6FD.jpg");
  } catch(err) {
    if (err.code != 'ENOENT') {
      debug(err);
    }
  }
  let cliFlags = this.config.video_device ? ("-d '" + this.config.video_device + "'") : '';
  imagesnapjs.capture('/tmp/0F0E480E-135D-4D11-86FC-B1C0C3ACA6FD.jpg', { cliflags: cliFlags }, function(err) {
    if (!err) {
      var snapshot = fs.readFileSync('/tmp/0F0E480E-135D-4D11-86FC-B1C0C3ACA6FD.jpg');
      callback(undefined, snapshot);
    } else {
      callback(err);
    }
  });
}

iSight.prototype.prepareStream = function(request, callback) {
  var sessionInfo = {};

  let sessionID = request["sessionID"];
  let targetAddress = request["targetAddress"];

  sessionInfo["address"] = targetAddress;

  var response = {};

  let videoInfo = request["video"];
  if (videoInfo) {
    let targetPort = videoInfo["port"];
    let srtp_key = videoInfo["srtp_key"];
    let srtp_salt = videoInfo["srtp_salt"];
    
    // SSRC is a 32 bit integer that is unique per stream
    let ssrcSource = crypto.randomBytes(4);
    ssrcSource[0] = 0;
    let ssrc = ssrcSource.readInt32BE(0, true);

    let videoResp = {
      port: targetPort,
      ssrc: ssrc,
      srtp_key: srtp_key,
      srtp_salt: srtp_salt
    };

    response["video"] = videoResp;

    sessionInfo["video_port"] = targetPort;
    sessionInfo["video_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
    sessionInfo["video_ssrc"] = ssrc;
  }

  let audioInfo = request["audio"];
  if (audioInfo) {
    let targetPort = audioInfo["port"];
    let srtp_key = audioInfo["srtp_key"];
    let srtp_salt = audioInfo["srtp_salt"];
    
    // SSRC is a 32 bit integer that is unique per stream
    let ssrcSource = crypto.randomBytes(4);
    ssrcSource[0] = 0;
    let ssrc = ssrcSource.readInt32BE(0, true);

    let audioResp = {
      port: targetPort,
      ssrc: ssrc,
      srtp_key: srtp_key,
      srtp_salt: srtp_salt
    };

    response["audio"] = audioResp;

    sessionInfo["audio_port"] = targetPort;
    sessionInfo["audio_srtp"] = Buffer.concat([srtp_key, srtp_salt]);
    sessionInfo["audio_ssrc"] = ssrc;
  }

  let currentAddress = ip.address();
  var addressResp = {
    address: currentAddress
  };

  if (ip.isV4Format(currentAddress)) {
    addressResp["type"] = "v4";
  } else {
    addressResp["type"] = "v6";
  }

  response["address"] = addressResp;
  this.pendingSessions[uuid.unparse(sessionID)] = sessionInfo;

  callback(response);
}

iSight.prototype.handleStreamRequest = function(request) {
  var sessionID = request["sessionID"];
  var requestType = request["type"];
  if (sessionID) {
    let sessionIdentifier = uuid.unparse(sessionID);

    if (requestType == "start") {
      var sessionInfo = this.pendingSessions[sessionIdentifier];
      if (sessionInfo) {
        var width = 1280;
        var height = 720;
        var fps = 30;
        var bitrate = 300;

        let videoInfo = request["video"];
        if (videoInfo) {
          width = videoInfo["width"];
          height = videoInfo["height"];

          let expectedFPS = videoInfo["fps"];
          if (expectedFPS < fps) {
            fps = expectedFPS;
          }

          bitrate = videoInfo["max_bit_rate"];
        }

        let targetAddress = sessionInfo["address"];
        let targetVideoPort = sessionInfo["video_port"];
        let videoKey = sessionInfo["video_srtp"];
        let videoSsrc = sessionInfo["video_ssrc"];

        let ffmpegCommandStart = ['-re', '-f', 'avfoundation', '-r', '' + this.config.fps];
        let ffmpegCommandEnd = ['-threads', '0', '-vcodec', 'libx264', '-an', '-pix_fmt', 'yuv420p', '-r', '' + fps,
                                '-f', 'rawvideo', '-tune', 'zerolatency', '-vf',
                                'scale=' + width + ':' + height,
                                '-b:v', bitrate +'k',
                                '-bufsize', bitrate +'k',
                                '-payload_type', '99', '-ssrc', videoSsrc, '-f', 'rtp',
                                '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
                                '-srtp_out_params', videoKey.toString('base64'),
                                'srtp://' + targetAddress + ':' + targetVideoPort + '?rtcpport=' + targetVideoPort + '&localrtcpport=' + targetVideoPort + '&pkt_size=1378'];
        let ffmpegInputDevice = (this.config.video_device || "0") + ":" + (this.config.audio_device || "0");
        let ffmpegCommand = ffmpegCommandStart.concat(["-i", ffmpegInputDevice]).concat(ffmpegCommandEnd);
        console.log("ffmpeg", ffmpegCommand);
        let ffmpeg = spawn('ffmpeg', ffmpegCommand, {env: process.env});
        ffmpeg.stderr.on('data', function(data) {
            console.error('stderr: ' + data);
        });
        ffmpeg.on('close', function(code) {
            console.log('closing code: ' + code);
        });
        this.ongoingSessions[sessionIdentifier] = ffmpeg;
      }

      delete this.pendingSessions[sessionIdentifier];
    } else if (requestType == "stop") {
      var ffmpegProcess = this.ongoingSessions[sessionIdentifier];
      if (ffmpegProcess) {
        ffmpegProcess.kill();
      }

      delete this.ongoingSessions[sessionIdentifier];
    }
  }
}

iSight.prototype.createCameraControlService = function() {
  var controlService = new Service.CameraControl();

  this.services.push(controlService);
}

// Private

iSight.prototype._createStreamControllers = function(maxStreams, options) {
  let self = this;

  for (var i = 0; i < maxStreams; i++) {
    var streamController = new StreamController(i, options, self);

    self.services.push(streamController.service);
    self.streamControllers.push(streamController);
  }
}
