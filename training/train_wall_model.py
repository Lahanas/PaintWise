# %% [markdown]
# # PaintWise wall model
#
# This notebook trains the model behind **"Measure a wall from a photo"**. Given a photo of a
# room, the model labels every pixel as **wall**, **door**, **window** or **other**. The app then
# uses a door (or the ceiling height) as a ruler to measure the wall.
#
# - **Model:** [SegFormer-B0](https://arxiv.org/abs/2105.15203), a small, fast segmentation
#   transformer. It starts from the weights named in `START_FROM` (run 1: ImageNet only;
#   run 2: already trained on all 150 ADE20K classes). The 4-class output layer is trained here.
# - **Data:** [ADE20K](https://groups.csail.mit.edu/vision/datasets/ADE20K/) scene parsing
#   (20k training photos, 150 object classes). We keep the photos that show walls and merge
#   the 150 classes down to our 4.
# - **Output:** `wall-seg.onnx`, a ~4 MB file that runs in the browser with ONNX Runtime Web,
#   plus `metrics.json` with the accuracy on photos the model never saw.
#
# **How to run:** in Colab, choose *Runtime → Change runtime type → T4 GPU*, then
# *Runtime → Run all*. It takes about 30–60 minutes (most of it is training). The two files download
# at the end. Put `wall-seg.onnx` in the repo's `models/` folder.

# %%
# Colab already has PyTorch. These are the other libraries we need.
import os, sys
if 'google.colab' in sys.modules:
    os.system('pip -q install transformers onnx onnxruntime onnxscript')

# %%
import json, random, time, zipfile, urllib.request
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import SegformerConfig, SegformerForSemanticSegmentation

# SMOKE=1 runs every step in a few seconds on a CPU, with fake photos and an untrained
# model, just to check the code works end to end. Leave it off for real training.
SMOKE = os.environ.get('SMOKE') == '1'

SIZE = 384            # the model sees 384 × 384 images (a good balance of speed and detail on a phone)
EPOCHS = 1 if SMOKE else 12
BATCH = 4 if SMOKE else 16
LR = 2e-4
SEED = 42
# Which weights to start from:
#   'nvidia/mit-b0': encoder trained on ImageNet only (run 1: door IoU 0.27)
#   'nvidia/segformer-b0-finetuned-ade-512-512': the whole model already trained on all 150
#   ADE20K classes, doors included. Only the last layer (150 classes -> our 4) starts fresh. (run 2)
START_FROM = 'nvidia/segformer-b0-finetuned-ade-512-512'
CLASSES = ['other', 'wall', 'door', 'window']
OUT = Path('out'); OUT.mkdir(exist_ok=True)

random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print('device:', device)

# %% [markdown]
# ## 1. Get the data
#
# ADE20K labels each pixel with one of 150 classes (0 means unlabelled). We only care about
# three of them, so we build a lookup table that turns every ADE20K class into one of ours.

# %%
DATA = Path('ADEChallengeData2016')
URL = 'http://data.csail.mit.edu/places/ADEchallenge/ADEChallengeData2016.zip'

# ADE20K class ids (from the dataset's objectInfo150 list; 0 = unlabelled).
ADE_WALL, ADE_WINDOW, ADE_DOOR = 1, 9, 15

lookup = np.zeros(256, dtype=np.uint8)   # everything else -> 0 (other)
lookup[ADE_WALL] = 1
lookup[ADE_DOOR] = 2
lookup[ADE_WINDOW] = 3


def make_fake_data(root, n=24):
    """For SMOKE runs: tiny 'rooms' with a wall, a door and a window, in ADE20K's layout."""
    for split in ('training', 'validation'):
        (root / 'images' / split).mkdir(parents=True, exist_ok=True)
        (root / 'annotations' / split).mkdir(parents=True, exist_ok=True)
        for k in range(n):
            ann = np.zeros((120, 160), np.uint8)
            ann[:90] = ADE_WALL
            x = random.randint(10, 60); ann[30:90, x:x + 20] = ADE_DOOR
            x = random.randint(90, 130); ann[20:50, x:x + 25] = ADE_WINDOW
            colors = {0: (120, 80, 50), ADE_WALL: (220, 210, 190), ADE_DOOR: (90, 60, 40), ADE_WINDOW: (170, 200, 230)}
            img = np.zeros((120, 160, 3), np.uint8)
            for c, rgb in colors.items():
                img[ann == c] = rgb
            Image.fromarray(img).save(root / 'images' / split / f'ADE_{split}_{k:08d}.jpg')
            Image.fromarray(ann).save(root / 'annotations' / split / f'ADE_{split}_{k:08d}.png')


if SMOKE:
    DATA = Path('fake_ade'); make_fake_data(DATA)
elif not DATA.exists():
    print('Downloading ADE20K (about 1 GB)...')
    urllib.request.urlretrieve(URL, 'ade.zip')
    zipfile.ZipFile('ade.zip').extractall('.')


def wall_photos(split, min_wall=0.10):
    """Photos where walls cover at least 10% of the picture (mostly indoor scenes)."""
    keep = []
    for ann_path in sorted((DATA / 'annotations' / split).glob('*.png')):
        ann = lookup[np.array(Image.open(ann_path))]
        if (ann == 1).mean() >= min_wall:
            keep.append((DATA / 'images' / split / (ann_path.stem + '.jpg'), ann_path))
    return keep


train_items = wall_photos('training')
val_items = wall_photos('validation')
print(f'{len(train_items)} training photos, {len(val_items)} validation photos')

# %% [markdown]
# ## 2. Feed the photos to the model
#
# Each photo is resized to 384 × 384. During training we also flip, crop and change the
# brightness at random, so the model copes with different rooms, angles and lighting. The
# label masks are resized with *nearest neighbour*, because labels can't be averaged.

# %%
MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)


class WallPhotos(Dataset):
    def __init__(self, items, train):
        self.items, self.train = items, train

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        img_path, ann_path = self.items[i]
        img = Image.open(img_path).convert('RGB')
        ann = Image.fromarray(lookup[np.array(Image.open(ann_path))])
        if self.train:
            # random crop keeping 70-100% of the photo
            w, h = img.size
            s = random.uniform(0.7, 1.0)
            cw, ch = int(w * s), int(h * s)
            x, y = random.randint(0, w - cw), random.randint(0, h - ch)
            img, ann = img.crop((x, y, x + cw, y + ch)), ann.crop((x, y, x + cw, y + ch))
            if random.random() < 0.5:
                img, ann = img.transpose(Image.FLIP_LEFT_RIGHT), ann.transpose(Image.FLIP_LEFT_RIGHT)
        img = img.resize((SIZE, SIZE), Image.BILINEAR)
        ann = ann.resize((SIZE, SIZE), Image.NEAREST)
        x = torch.from_numpy(np.array(img)).permute(2, 0, 1).float() / 255
        if self.train:
            x = (x * random.uniform(0.75, 1.25) + random.uniform(-0.1, 0.1)).clamp(0, 1)
        return (x - MEAN) / STD, torch.from_numpy(np.array(ann)).long()


workers = 0 if SMOKE else 2
train_dl = DataLoader(WallPhotos(train_items, True), batch_size=BATCH, shuffle=True, num_workers=workers, drop_last=True)
val_dl = DataLoader(WallPhotos(val_items, False), batch_size=BATCH, num_workers=workers)

# %% [markdown]
# ## 3. The model
#
# SegFormer-B0 has 3.7 million parameters. How much it already knows depends on `START_FROM`
# (see the settings above). Starting from the model that was already trained on ADE20K's 150
# classes means it already knows doors and windows; we only teach it our 4-class version.

# %%
labels = dict(id2label=dict(enumerate(CLASSES)), label2id={c: i for i, c in enumerate(CLASSES)})
if SMOKE:
    model = SegformerForSemanticSegmentation(SegformerConfig(num_labels=len(CLASSES), **labels))
else:
    # ignore_mismatched_sizes: the last layer has 4 outputs here instead of 150, so it starts fresh.
    model = SegformerForSemanticSegmentation.from_pretrained(START_FROM, num_labels=len(CLASSES),
                                                             ignore_mismatched_sizes=True, **labels)
model.to(device)
print(f'{sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters')

# %% [markdown]
# ## 4. Train
#
# Doors and windows cover far fewer pixels than walls, so mistakes on them count double in the
# loss. Otherwise the model could ignore them and still look accurate.

# %%
class_weights = torch.tensor([1.0, 1.0, 2.0, 2.0], device=device)
optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
steps = EPOCHS * len(train_dl)
scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=LR, total_steps=max(steps, 1), pct_start=0.1)
scaler = torch.amp.GradScaler(enabled=device == 'cuda')


def loss_fn(logits, target):
    # SegFormer predicts at 1/4 of the input size; scale up to compare with the labels.
    logits = F.interpolate(logits, size=target.shape[-2:], mode='bilinear', align_corners=False)
    return F.cross_entropy(logits, target, weight=class_weights)


@torch.no_grad()
def evaluate(net):
    """Intersection over union (IoU) per class: overlap ÷ union of predicted and true pixels."""
    net.eval()
    inter = torch.zeros(len(CLASSES)); union = torch.zeros(len(CLASSES)); correct = total = 0
    for x, y in val_dl:
        x, y = x.to(device), y.to(device)
        with torch.autocast(device_type=device, enabled=device == 'cuda'):
            logits = net(pixel_values=x).logits
        pred = F.interpolate(logits.float(), size=y.shape[-2:], mode='bilinear', align_corners=False).argmax(1)
        for c in range(len(CLASSES)):
            inter[c] += ((pred == c) & (y == c)).sum().item()
            union[c] += ((pred == c) | (y == c)).sum().item()
        correct += (pred == y).sum().item(); total += y.numel()
    iou = (inter / union.clamp(min=1)).tolist()
    return {'iou': dict(zip(CLASSES, iou)), 'mean_iou': sum(iou) / len(iou), 'pixel_accuracy': correct / total}


start = time.time()
history = []
for epoch in range(EPOCHS):
    model.train(); running = 0.0
    for step, (x, y) in enumerate(train_dl):
        x, y = x.to(device), y.to(device)
        with torch.autocast(device_type=device, enabled=device == 'cuda'):
            loss = loss_fn(model(pixel_values=x).logits, y)
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update(); scheduler.step()
        running += loss.item()
        if SMOKE and step >= 2:
            break
    scores = evaluate(model)
    history.append({'epoch': epoch + 1, 'loss': running / max(step + 1, 1), **scores})
    print(f"epoch {epoch + 1}/{EPOCHS}  loss {history[-1]['loss']:.3f}  "
          f"wall IoU {scores['iou']['wall']:.3f}  door IoU {scores['iou']['door']:.3f}  "
          f"window IoU {scores['iou']['window']:.3f}  ({(time.time() - start) / 60:.0f} min)")

model.save_pretrained(OUT / 'segformer-wall')

# %% [markdown]
# ## 5. Export for the browser
#
# We wrap the model so the browser can stay simple: it passes in the photo's RGB values
# (0 to 1, 384 × 384), and gets back one label per pixel. Normalising, scaling up and picking
# the most likely class all happen inside the model file.
#
# Then we **quantize** it: the weights are stored as 8-bit integers instead of 32-bit floats,
# which makes the file about 4× smaller to download on a phone (and faster to run).

# %%
import onnx, onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType


class ForBrowser(torch.nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net
        self.register_buffer('mean', MEAN.view(1, 3, 1, 1))
        self.register_buffer('std', STD.view(1, 3, 1, 1))

    def forward(self, image):                       # image: (1, 3, 384, 384), RGB in 0..1
        logits = self.net(pixel_values=(image - self.mean) / self.std).logits
        logits = F.interpolate(logits, size=image.shape[-2:], mode='bilinear', align_corners=False)
        return logits.argmax(1).to(torch.uint8)     # (1, 384, 384) class per pixel


wrapped = ForBrowser(model.float().cpu().eval()).eval()
dummy = torch.rand(1, 3, SIZE, SIZE)
torch.onnx.export(wrapped, (dummy,), OUT / 'wall-seg-fp32.onnx', input_names=['image'],
                  output_names=['labels'], opset_version=17, dynamo=False)

# Check the exported file gives the same answers as PyTorch, on a few validation photos.
check = [WallPhotos(val_items[i:i + 1], False)[0][0] for i in range(min(8, len(val_items)))]
photos = [(x * STD + MEAN).unsqueeze(0) for x in check]  # back to 0..1 RGB, like the browser sends
expected = [wrapped(p).numpy() for p in photos]


def agreement_of(path):
    session = ort.InferenceSession(str(path))
    return float(np.mean([(session.run(None, {'image': p.numpy()})[0] == e).mean() for p, e in zip(photos, expected)]))


# Quantize the matrix multiplications and the convolutions (about 4 MB). If that changes too
# many answers, quantize only the matrix multiplications (about 8 MB).
quantize_dynamic(str(OUT / 'wall-seg-fp32.onnx'), str(OUT / 'wall-seg.onnx'),
                 weight_type=QuantType.QUInt8, op_types_to_quantize=['MatMul', 'Conv'])
agreement = agreement_of(OUT / 'wall-seg.onnx')
if agreement < 0.97:
    print(f'Full quantization agrees on only {agreement:.1%} of pixels, so keeping convolutions in full precision.')
    quantize_dynamic(str(OUT / 'wall-seg-fp32.onnx'), str(OUT / 'wall-seg.onnx'),
                     weight_type=QuantType.QUInt8, op_types_to_quantize=['MatMul'])
    agreement = agreement_of(OUT / 'wall-seg.onnx')
onnx.checker.check_model(str(OUT / 'wall-seg.onnx'))
size_mb = (OUT / 'wall-seg.onnx').stat().st_size / 1e6
print(f'ONNX model: {size_mb:.1f} MB, agrees with PyTorch on {agreement:.1%} of pixels')

# %% [markdown]
# ## 6. Results
#
# These numbers are measured on ADE20K validation photos the model never trained on.
# They describe how well it finds walls, doors and windows. How accurate the *measurements*
# are is a separate question, answered by comparing against a tape measure
# (see `training/README.md`).

# %%
final = history[-1]
metrics = {
    'model': f'SegFormer-B0 from {START_FROM}, 4 classes',
    'dataset': 'ADE20K scene parsing, photos with >=10% wall',
    'train_photos': len(train_items), 'validation_photos': len(val_items),
    'epochs': EPOCHS, 'image_size': SIZE,
    'iou': final['iou'], 'mean_iou': final['mean_iou'], 'pixel_accuracy': final['pixel_accuracy'],
    'onnx_size_mb': round(size_mb, 2), 'onnx_agreement': agreement,
    'training_minutes': round((time.time() - start) / 60, 1), 'device': device,
    'smoke_test': SMOKE, 'history': history,
}
(OUT / 'metrics.json').write_text(json.dumps(metrics, indent=2))
print(json.dumps({k: metrics[k] for k in ('iou', 'mean_iou', 'pixel_accuracy', 'onnx_size_mb')}, indent=2))

if 'google.colab' in sys.modules:
    from google.colab import files
    files.download(str(OUT / 'wall-seg.onnx'))
    files.download(str(OUT / 'metrics.json'))
