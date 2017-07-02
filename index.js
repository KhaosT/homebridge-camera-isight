var Accessory, hap, UUIDGen;

var iSight = require('./iSight').iSight;

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  hap = homebridge.hap;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-camera-isight", "Camera-iSight", iSightPlatform, true);
}

function iSightPlatform(log, config, api) {
  var self = this;

  self.log = log;
  self.config = config;

  if (api) {
    self.api = api;

    if (api.version < 2.1) {
      throw new Error("Unexpected API version.");
    }

    self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
  }
}

iSightPlatform.prototype.configureAccessory = function(accessory) {
  // Won't be invoked
}

iSightPlatform.prototype.didFinishLaunching = function() {
  var self = this;
  if(self.config) {
    var name = "iSight Camera" || self.config.name;
    var uuid = UUIDGen.generate(name);

    var cameraAccessory = new Accessory(name, uuid, hap.Accessory.Categories.CAMERA);
    var cameraSource = new iSight(hap, self.config);
    cameraAccessory.configureCameraSource(cameraSource);

    self.api.publishCameraAccessories("Camera-iSight", [cameraAccessory]);
  }
}