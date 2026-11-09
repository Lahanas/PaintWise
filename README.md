# PaintWise

**How much paint do I actually need? And will this color even look good?** PaintWise answers both.

You enter your rooms, and it tells you how many litres (or gallons) of paint to buy, and which cans to pick up at the store. Then you can snap a photo of your wall with your phone and see it in a new color before you buy a single can. It's made for painting contractors writing up a job and for homeowners doing it themselves.

**Try it:** [lahanas.github.io/PaintWise](https://lahanas.github.io/PaintWise)

![PaintWise screenshot](docs/screenshot.png)

## Why I built it

This past summer, my parents decided to repaint the house and change the colors. The hardest part wasn't choosing the colors. It was figuring out how much paint we'd actually need. Between measuring every wall, skipping the doors and windows, and counting coats, we ended up guessing, and we overbought. A lot of paint went unused.

So I built PaintWise: a tool that does that math properly and still feels simple, so the next family (or the next contractor) buys the right amount the first time.

## What it does

- **Room by room:** add as many rooms as you need, and see how much paint each one takes.
- **Doors and windows are taken out** automatically, using standard sizes or your own measurements.
- **Odd-shaped rooms:** switch a room to "custom walls" and enter each wall on its own (for L-shaped rooms, a sloped ceiling or a single feature wall).
- **Real-world details:** number of coats, the coverage printed on your can, rough or textured walls (which soak up more paint), and an optional primer coat.
- **A shopping list, not just a number:** it picks the mix of can sizes that leaves you with the least paint left over. Add your store's prices and it picks the cheapest mix instead (one big bucket often costs less than three small tins).
- **Costs and quotes for contractors:** add paint prices, a labour rate and tax to get the full job cost. Fill in your client's details and print a clean, one-page quote, or save it as a PDF to send.
- **Metric or imperial:** switch between metres/litres and feet/gallons at any time, and your measurements convert automatically.
- **See the color before you paint:** point your phone's live camera at the wall (or take or upload a photo), tap the wall, and it repaints it in the color you pick. In live mode the new color follows the camera as you move. It keeps the light and shadows of the room, so it looks natural. Hold a button to compare before and after, and save the result to share it. The photo never leaves your phone.
- **Save and share projects:** keep several jobs (the living room, the kitchen, a client's house) and switch between them. Share any project as a link: whoever opens it gets their own copy, with no account needed.
- **Remembers your job:** close the page, come back later, and everything is still there.

## How the estimate works

```
wall area = 2 × (length + width) × height − doors − windows
paint     = wall area × coats × surface factor ÷ coverage + safety margin
```

Rough walls add 15–30% paint, and the safety margin (10% by default) covers spills and touch-ups.

## How the color preview works

When you tap the wall, PaintWise spreads out from that spot and selects every connected pixel that has a similar color, stopping at sharp edges like door frames, furniture or a picture on the wall. It compares colors in a way that cares more about hue than brightness, so a wall that is lighter near the window and darker in the corner is still picked up as one wall. Then it swaps in the new color while keeping each pixel's original brightness, so shadows and lighting stay realistic. Everything runs in the browser on a `<canvas>`, without any server. In live mode the same steps run on every camera frame at a smaller size, so it stays smooth on a phone.

## How it's built

- **Plain HTML, CSS and JavaScript.** There's no framework and no build step, so the app loads instantly and is free to host on GitHub Pages.
- **The logic is separate from the page.** The paint math lives in [`src/estimator.js`](src/estimator.js) and the wall recoloring in [`src/recolor.js`](src/recolor.js). Neither depends on the browser, which makes them easy to test and reuse.
- **No backend, still shareable.** A shared project travels inside the link itself: the project is compressed and encoded into the URL, so there's no database or sign-up to manage.
- **Tested.** Unit tests cover the math, the recoloring and project sharing with Node's built-in test runner, and they run on every push with GitHub Actions.
- **Responsive and accessible.** It works on a phone on the job site, and it supports dark mode.

## Run it yourself

```sh
git clone https://github.com/Lahanas/PaintWise.git
cd PaintWise
npx serve .     # then open the link it prints
npm test        # run the tests
```

## What's next

- [x] v0.1: rooms, doors and windows, coats, coverage, can sizes
- [x] v0.2: custom walls, surface types, primer
- [x] v0.3: color preview on a photo of your wall
- [x] v0.4: paint prices and a printable quote for clients
- [x] v0.5: live camera preview, and save and share projects
- [ ] Next: measure a wall from a photo, and color palettes from real paint brands

## License

MIT
