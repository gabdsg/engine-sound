# Engine synth

A synthesized car engine in a single web page. The sound follows your speed. Drive it with on-screen pedals, play a scripted demo run, or put your phone in the car and let its accelerometer and GPS drive it.

There are no samples. Every sound is generated in real time by a small DSP engine in the browser.

**Live:** https://gabdsg.com/engine-sound/ (once GitHub Pages is enabled, see [Deploying](#deploying))

## Features

- **Six engines**: cross-plane V8, flat-six, V12, turbo four (whistle and blow-off), 45° V-twin and an electric motor.
- **Three ways to drive**:
  - *On-screen pedals*: press higher on a pedal to press harder. Neutral revs the engine without moving the car.
  - *Demo run*: a 30-second scripted run with revs in neutral, full-throttle pulls through the gears, a cruise, a lift-off and braking.
  - *Phone sensors*: accelerometer and GPS are fused into speed and an estimated throttle. The page includes live readouts and a 30-second chart.
- **Tuning**: volume, character (stock to open pipes), crackle (overrun and limiter pops), aggression (shift points and throttle sensitivity), km/h or mph.
- **Tachometer and gear display** that rescale to each engine's redline.

### Keyboard

| Key | Action |
| --- | --- |
| `↑` / `W` | Gas |
| `↓` / `S` | Brake |
| `N` | Toggle neutral |

## Running locally

It's a single static file with no build step or dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works in most browsers. Pedals and the demo run work anywhere. **Phone sensors need HTTPS**: browsers only expose motion and location to secure pages, so test sensor mode on the deployed site. On a desktop, `localhost` counts as secure, but desktops have no motion sensors.

## Using phone sensors

1. Open the page from its own HTTPS address. It must not be embedded in an iframe: iOS drops motion events inside frames even after you allow them.
2. Mount the phone so it can't slide.
3. While stopped, tap **Start engine**, switch to **Phone sensors** and tap **Enable sensors**. Allow motion and location when asked.
4. Pull away firmly in a straight line. The first strong acceleration sets which way is forward. If it guesses wrong, GPS flips it automatically, or you can use **Flip forward** or **Re-learn forward**.

On iPhone the page plays a silent looping audio element so the engine stays audible with the ringer switch off. It also holds a screen wake lock while the engine runs.

## How it works

Everything is in `index.html`:

- **`EngineDSP`**: the sound engine, run in an `AudioWorklet` with a `ScriptProcessor` fallback.
  - A virtual crankshaft fires each cylinder at its real angle in the 720° cycle. The cross-plane V8's uneven per-bank firing order is what gives it the burble.
  - Each firing sends an exhaust pulse into a damped waveguide per bank, which models pipe resonance.
  - The result runs through a state-variable "muffler" lowpass that opens with load and revs, then gets intake roar, turbo whistle and blow-off, and soft-clip saturation.
  - The electric motor is a set of harmonics plus inverter switching whine.
- **`Car`**: a simple longitudinal vehicle model (traction limit, drag, regen, brakes) for pedal mode.
- **`Drivetrain`**: a virtual gearbox that turns speed and throttle into rpm and load. It handles the start-up crank, up- and downshifts with throttle blips, clutch slip in first, rev limiter cut and overrun detection.
- **`PhoneSensors`**: separates gravity from linear acceleration, learns the forward axis, integrates longitudinal acceleration into speed, and corrects drift with lag-compensated GPS speed. It also uses stillness detection to zero the speed and bias at stops.

Engine presets live in the `PRESETS` array: firing angles, gear ratios, pipe resonance, muffler cutoff and so on. Add or tweak entries there.

## Deploying

The site is a static `index.html`, so any static host works.

### GitHub Pages

1. On a free GitHub plan, the repository must be **public** for Pages to work. Change this under *Settings → General → Danger Zone → Change visibility*.
2. *Settings → Pages → Build and deployment*: set **Source** to *Deploy from a branch*, then choose branch `main` and folder `/ (root)`, and save.
3. After a minute the site is live at `https://gabdsg.com/engine-sound/`. It inherits the custom domain from the `gabdsg.github.io` user site, and `gabdsg.github.io/engine-sound/` redirects there. Every push to `main` redeploys it.

### Keeping the repo private

Cloudflare Pages, Netlify and Vercel all have free tiers that deploy from a private GitHub repo. Create a project, connect this repository, leave the build command empty, and set the output directory to `/`. Each one gives you an HTTPS URL, so sensor mode works there too.
