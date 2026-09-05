package main

import "embed"

// The GPL encoder core is intentionally excluded and is fetched into a
// verified user cache only when video encoding is requested.
//
//go:embed assets/*.html assets/*.png assets/css/*.css assets/js/*.js assets/js/vendor/*.js assets/js/vendor/ffmpeg/ffmpeg.js assets/js/vendor/ffmpeg/814.ffmpeg.js
var embeddedAssets embed.FS
