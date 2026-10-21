# Engine synth

A synthesized car engine in a single web page. The sound follows your speed. Drive it with on-screen pedals, play a scripted demo run, or let real driving drive it: open it in a Tesla's browser and it follows the car's speed, or put your phone in the car and let its accelerometer and GPS drive it.

There are no samples. Every sound is generated in real time by a small DSP engine in the browser.

**Live:** https://gabdsg.com/engine-sound/ (once GitHub Pages is enabled, see [Deploying](#deploying))

## Features

- **Six engines**: cross-plane V8, flat-six, V12, turbo four (whistle and blow-off), 45° V-twin and an electric motor.
- **Three ways to drive**:
  - *On-screen pedals*: press higher on a pedal to press harder. Neutral revs the engine without moving the car.
  - *Demo run*: a 30-second scripted run with revs in neutral, full-throttle pulls through the gears, a cruise, a lift-off and braking.
  - *Real driving*: the page picks its inputs by device, and shows live readouts and a 30-second chart.
    - **Tesla and other car or desktop browsers ("Car GPS")**: GPS only. It uses the speed the car reports when available, otherwise distance between GPS fixes. Acceleration, and so throttle, come from speed changes, and road grade from altitude.
    - **iPhone and Android ("Phone sensors")**: the accelerometer is fused with GPS for instant throttle response. If motion access is denied or unavailable, it falls back to GPS alone.
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

Opening `index.html` directly from disk also works in most browsers. Pedals and the demo run work anywhere. **Real-driving mode needs HTTPS**: browsers only expose motion and location to secure pages, so test it on the deployed site. On a desktop, `localhost` counts as secure.

## Using it in a Tesla

1. While parked, open the page in the car's browser, tap **Start engine**, switch to **Car GPS** and tap **Enable GPS**. Allow location when asked.
2. Drive. On cars from about 2022 onward (AMD Ryzen computer), the browser reports the car's own speed, and the readouts show **Speed source: Car's speed**. Older Intel cars report a speed of 0 while moving, so the page detects that and works speed out from GPS positions instead. Expect a lag of two seconds or so in that case.
3. Keep the page on screen. Location stops while the browser is minimised (for example, behind a full-screen map or the reverse camera), so the engine settles to idle until you come back.

What the car's browser can and can't provide:

- **Speed** arrives about once a second, roughly a second late. Acceleration is worked out from consecutive speeds, and the speed is projected a little ahead to hide the lag. Expect the engine to follow the car about a second behind.
- **Altitude** gives road grade, measured over the last 100–150 m, so climbs load the engine and descents let it run on the overrun.
- **No accelerator pedal, brake, gear or motor data.** The car doesn't pass these to web pages. Tesla's Fleet Telemetry API has them, but only every 1–10 s through a server, which is too slow for live sound.
- **The steering-wheel buttons don't reach the page.** They stay with the car's media player.
- The Tesla browser can keep old copies of a page for a long time. After updating the site, open it with a query string such as `https://gabdsg.com/engine-sound/?v=2` to force a fresh copy.

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
- **`GpsSpeed`**: turns position fixes into speed, acceleration and road grade.
  - **Speed:** the reported speed when it's usable. Otherwise, straight-line distance over the last ~5 s, so parked jitter averages out.
  - **Filtering:** it drops cached repeats (the Tesla browser replays old fixes), and stops trusting a speed stuck at 0 while positions show movement.
  - **Acceleration:** from speed changes. Between fixes, the speed is carried forward by that acceleration, levelling off so a lift-off doesn't overshoot.
  - **Grade:** filtered altitude change over distance travelled.
- **`LiveSensors`**: picks the inputs by device.
  - **Phones:** separates gravity from linear acceleration, learns the forward axis, integrates longitudinal acceleration into speed, and corrects drift with lag-compensated GPS speed. It uses stillness detection to zero the speed and bias at stops.
  - **Everything else:** polls `getCurrentPosition` once at a time, because `watchPosition` has been reported to crash the Tesla browser, and drives from `GpsSpeed` alone.
  - **Throttle:** in both cases it's estimated from acceleration plus rolling resistance, drag and grade. Holding speed counts as light throttle, while braking or rolling downhill counts as lifting off.

Engine presets live in the `PRESETS` array: firing angles, gear ratios, pipe resonance, muffler cutoff and so on. Add or tweak entries there.

## Deploying

The site is a static `index.html`, so any static host works.

### GitHub Pages

1. On a free GitHub plan, the repository must be **public** for Pages to work. Change this under *Settings → General → Danger Zone → Change visibility*.
2. *Settings → Pages → Build and deployment*: set **Source** to *Deploy from a branch*, then choose branch `main` and folder `/ (root)`, and save.
3. After a minute the site is live at `https://gabdsg.com/engine-sound/`. It inherits the custom domain from the `gabdsg.github.io` user site, and `gabdsg.github.io/engine-sound/` redirects there. Every push to `main` redeploys it.

### Keeping the repo private

Cloudflare Pages, Netlify and Vercel all have free tiers that deploy from a private GitHub repo. Create a project, connect this repository, leave the build command empty, and set the output directory to `/`. Each one gives you an HTTPS URL, so real-driving mode works there too.
