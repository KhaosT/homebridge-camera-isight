# homebridge-camera-isight

iSight camera plugin for [Homebridge](https://github.com/nfarina/homebridge)

** This plugin only works on macOS **

## Installation

1. Install ffmpeg on your Mac
2. Install this plugin using: npm install -g homebridge-camera-isight
3. Edit ``config.json`` and add the camera.
4. Run Homebridge
5. Add the "iSight Camera" in Home app.

### Config.json Example

    {
      "platform": "Camera-iSight",
      "name": "iSight Camera",
      "fps": 30
    }
