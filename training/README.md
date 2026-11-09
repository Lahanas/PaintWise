# Training the wall model

"Measure this wall" uses a small segmentation model that labels each pixel of a photo as
**wall**, **door**, **window** or **other**. This folder has everything to train it and to check
how accurate the measurements are.

| File | What it is |
| --- | --- |
| `train_wall_model.ipynb` | The training notebook: data, model, training, export to ONNX |
| `train_wall_model.py` | The same code as a plain Python script (handy for reading diffs) |
| `measurements.csv` | Tape measure vs app, one row per wall |

## 1. Train the model (about an hour, free)

1. Open [Google Colab](https://colab.research.google.com), choose **File → Upload notebook**, and pick `train_wall_model.ipynb`.
2. **Runtime → Change runtime type → T4 GPU**, then **Runtime → Run all**.
3. When it finishes, two files download: `wall-seg.onnx` and `metrics.json`.
4. Put `wall-seg.onnx` in the repo's `models/` folder and `metrics.json` in this folder.

What happens inside: it downloads [ADE20K](https://groups.csail.mit.edu/vision/datasets/ADE20K/)
(20,000 labelled photos), keeps the ones that show walls, and merges its 150 classes into our 4.
It then trains SegFormer-B0 (3.7M parameters, encoder pretrained on ImageNet) for 12 epochs,
measures intersection-over-union on validation photos it never saw, and exports a quantized
ONNX file (about 4 MB) that runs in the browser.

To check the code without a GPU, `SMOKE=1 python train_wall_model.py` runs every step in a few
seconds on fake photos.

## 2. Measure how accurate it is

The model's IoU says how well it finds walls. What matters to a painter is how close the
**measurements** are, so compare them with a tape measure:

1. Pick 10–20 walls. Measure each one's width and height with a tape.
2. Take a photo of each wall, straight on, with a door in the photo (or note the ceiling height).
3. In PaintWise, open **Color preview**, load the photo, tap the wall, and press **Measure wall**.
4. Add a row per wall to `measurements.csv`, in metres:
   ```
   wall,tape_width_m,tape_height_m,app_width_m,app_height_m,notes
   living room north,4.12,2.48,4.05,2.51,door as ruler
   ```
5. Run `npm run accuracy`. It prints the error for every wall and the mean and median error.

## Limits

- It assumes the photo is taken roughly straight on. A wall shot at a sharp angle comes out
  narrower than it is.
- Walls that meet at a corner can be read as one wall. Tap the one you want, or take one
  photo per wall.
- A door is assumed to be 2.03 m (80 in) tall unless you type a different height.
