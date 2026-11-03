# Wall Paint Estimator

A small web app for contractors and DIY homeowners: enter your rooms and get how much paint to buy for the walls.

## Features

- Multiple rooms (length × width × height), each with doors and windows deducted
- Standard door/window sizes, or custom sizes per room
- Optional ceiling per room
- Number of coats, paint coverage (from the can), and an extra margin %
- Metric (m, litres) or imperial (ft, US gallons), converting your rooms when you switch
- "What to buy" list using common can sizes (10/5/2.5/1 L, or 5 gal/1 gal/quart), picking the combination with the least leftover
- Saves your job in the browser so it is still there when you come back
- Custom walls: enter each wall separately for L-shaped rooms, slopes or a single feature wall (v0.2)
- Wall surface: smooth, light texture or rough/porous, which adds 0%, 15% or 30% paint (v0.2)
- Optional primer coat with its own coverage and shopping list (v0.2)

## How the estimate works

```
wall area   = 2 × (length + width) × height − doors − windows
              (or the sum of each wall's width × height in custom walls mode)
paint       = total area × coats × surface factor ÷ coverage × (1 + margin%)
primer      = total area × surface factor ÷ primer coverage × (1 + margin%)
```

## Run it

No build step. Serve the folder with any static server:

```sh
npx serve .            # or: python3 -m http.server
```

Run the tests (Node 20+):

```sh
npm test
```

## Deploy

Works as-is on GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

## Project layout

- `index.html`, `styles.css`: the page
- `src/estimator.js`: pure calculation logic (unit-tested)
- `src/app.js`: UI wiring
- `tests/`: Node test runner tests
