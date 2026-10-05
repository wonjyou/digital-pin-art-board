# Digital Pin Art Board

Turns a live picture into a 3D pin art board in the browser. Each pin rises and falls in real time with the brightness of the pixel under it.

## Run

```bash
node serve.js
```

Then open http://localhost:8771. There is no build step. Three.js loads from a CDN, so the page needs a network connection, and the camera only works on localhost or https.

## Use

- Pick a source from the menu: the built-in demo animation, your camera, an image file, or a video file. You can also drag an image or video onto the page.
- Drag the board to rotate it. Scroll or pinch to zoom. Double-click or press "Reset view" to return to the starting angle.
- Click the "Menu Options" header to collapse or expand the menu.

## Menu options

- Pins: how many pins are on the board, from 400 to 80,000. The board takes the shape of the source.
- Pin travel: how far the brightest pins rise.
- Response: how quickly pins follow changes in the picture.
- Mirror the picture: flips it left to right.
- Raise dark areas instead: dark pixels push pins up, rather than bright ones.
- Tint pins with the picture's colors: colors each pin from the source instead of plain chrome.

The camera starts mirrored with dark areas raised. Other sources start with both off.

## How it works

Each frame, the source is drawn to a small canvas with one pixel per pin, and each pixel's luminance becomes that pin's target height. Heights ease toward their targets and are sent to the GPU as one value per pin. All pins are a single instanced mesh, and the vertex shader lifts each head and stretches its shaft up from the board.

## Files

- `index.html`: page and menu markup
- `style.css`: menu and page styles
- `main.js`: scene, sources, pin animation and controls
- `serve.js`: static server for local use
