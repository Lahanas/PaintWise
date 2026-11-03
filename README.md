# Wall Paint Estimator

A small web app for contractors and DIY homeowners: enter your rooms and get how much paint to buy for the walls.

## Features (v0.1)

- Multiple rooms (length × width × height), each with doors and windows deducted
- Standard door/window sizes, or custom sizes per room
- Optional ceiling per room
- Number of coats, paint coverage (from the can), and an extra margin %
- Metric (m, litres) or imperial (ft, US gallons), converting your rooms when you switch
- "What to buy" list using common can sizes (10/5/2.5/1 L, or 5 gal/1 gal/quart), picking the combination with the least leftover
- Saves your job in the browser so it is still there when you come back

## How the estimate works

```
wall area   = 2 × (length + width) × height − doors − windows
paint       = total area × coats ÷ coverage × (1 + margin%)
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
