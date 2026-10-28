"""Synthesises the trailer's soundtrack: python3 trailer-audio.py -> trailer.wav

Every sound is generated (no samples): a low drone, a servo whine, metal
clanks, a noise riser, sub-bass impacts, a drum-and-bass pulse, a beat of
silence and a final hit with a long tail. Event times are the trailer's
ticks (30 per second), so they line up with trailer.ts.
"""

import wave
from pathlib import Path

import numpy as np

RATE = 48000
LENGTH = 25.0
FPS = 30
rng = np.random.default_rng(7)
mix = np.zeros((int(RATE * LENGTH), 2))
send = np.zeros_like(mix)  # reverb bus


def at(tick: float) -> float:
    return tick / FPS


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(RATE * seconds)) / RATE


def band(signal: np.ndarray, low: float, high: float) -> np.ndarray:
    """Band-pass by masking the spectrum (fine for short, one-off sounds)."""
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / RATE)
    spectrum[(freqs < low) | (freqs > high)] = 0
    return np.fft.irfft(spectrum, len(signal))


def place(sound: np.ndarray, start: float, gain: float = 1.0, pan: float = 0.0, reverb: float = 0.0) -> None:
    i = int(start * RATE)
    n = min(len(sound), len(mix) - i)
    if n <= 0:
        return
    left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    stereo = np.stack([sound[:n] * left, sound[:n] * right], axis=1) * gain
    mix[i : i + n] += stereo
    send[i : i + n] += stereo * reverb


def decay(seconds: float, rate: float) -> np.ndarray:
    return np.exp(-t_axis(seconds) * rate)


def clank(pitch: float = 1.0) -> np.ndarray:
    """A struck metal part: a noise transient and inharmonic partials."""
    t = t_axis(0.9)
    hit = band(rng.standard_normal(len(t)), 1500, 6000) * decay(0.9, 60)
    partials = sum(np.sin(2 * np.pi * f * pitch * t) * decay(0.9, d) * a for f, d, a in [(180, 9, 0.7), (523, 7, 0.45), (1187, 11, 0.3), (2290, 16, 0.2), (3610, 22, 0.12)])
    return hit * 0.8 + partials


def impact(seconds: float = 2.5, sub: float = 45.0) -> np.ndarray:
    """A sub-bass hit with a fast attack, plus a noise burst."""
    t = t_axis(seconds)
    sweep = sub * (1 + 1.5 * np.exp(-t * 18))  # the pitch drops into the sub
    body = np.sin(2 * np.pi * np.cumsum(sweep) / RATE) * decay(seconds, 1.6)
    burst = band(rng.standard_normal(len(t)), 80, 4000) * decay(seconds, 14)
    return body * 0.9 + burst * 0.5


def kick() -> np.ndarray:
    t = t_axis(0.3)
    freq = 50 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(freq) / RATE) * decay(0.3, 12)


def hat() -> np.ndarray:
    return band(rng.standard_normal(int(RATE * 0.05)), 7000, 16000) * decay(0.05, 90)


def whoosh(seconds: float, low: float, high: float) -> np.ndarray:
    t = t_axis(seconds)
    envelope = np.sin(np.pi * t / seconds) ** 2
    return band(rng.standard_normal(len(t)), low, high) * envelope


# The drone: two low sines a fifth apart, gently pulsing, under a dark noise
# bed. It fades in, stops dead for the beat of black, and returns under the
# end card.
t = t_axis(LENGTH)
drone = (np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 82.5 * t + 0.4) + 0.3 * np.sin(2 * np.pi * 110.4 * t)) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.25 * t))
drone += band(rng.standard_normal(len(t)), 40, 300) * 0.5
shape = np.clip(t / 2.5, 0, 1) ** 2
shape[(t >= at(618)) & (t < at(630))] = 0
shape[t >= at(630)] = 0.6 * np.clip((LENGTH - t[t >= at(630)]) / 1.2, 0, 1)
place(drone * shape, 0, gain=0.12)

# Shot 1: a slow swell of air as the light rakes the seam.
place(whoosh(2.2, 200, 3000), 0.4, gain=0.08, reverb=0.4)

# Shot 2: the servo whine as the bolt turns, then the clank as it seats.
servo_t = t_axis(at(126) - at(76))
servo_f = 400 + 500 * (servo_t / servo_t[-1]) ** 0.6
servo = np.sin(2 * np.pi * np.cumsum(servo_f) / RATE) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * servo_t))
servo *= np.clip(servo_t / 0.2, 0, 1) * np.clip((servo_t[-1] - servo_t) / 0.05, 0, 1)
place(servo, at(76), gain=0.05, pan=-0.2)
place(clank(1.0), at(130), gain=0.5, reverb=0.35)

# Shot 3: a riser as the blades slide in, then the lock.
riser_t = t_axis(at(198) - at(152))
riser = np.zeros(len(riser_t))
noise = rng.standard_normal(len(riser_t))
for k, (low, high) in enumerate([(200, 800), (600, 2000), (1500, 5000), (4000, 12000)]):
    weight = np.clip((riser_t / riser_t[-1]) * 4 - k, 0, 1) * np.clip(k + 1 - (riser_t / riser_t[-1]) * 4, 0, 1)
    riser += band(noise, low, high) * (weight + (k == 3) * (riser_t / riser_t[-1]))
place(riser * (riser_t / riser_t[-1]) ** 2, at(152), gain=0.18)
place(impact(2.0, 50), at(198), gain=0.7, reverb=0.5)
place(clank(1.3), at(198), gain=0.45, reverb=0.4)

# The cards: a short electric tick as each cuts in.
for tick in [100, 206, 300, 404, 500, 594]:
    blip = np.sin(2 * np.pi * 2200 * t_axis(0.04)) * decay(0.04, 80)
    place(blip, at(tick), gain=0.18)

# Shots 4-6: the pulse, a drum-and-bass kick and offbeat hats; faster in the
# montage, and gone for the card and the black.
beat = 0.35
time = at(240)
while time < at(540):
    place(kick(), time, gain=0.42)
    place(hat(), time + beat / 2, gain=0.1, pan=0.3)
    time += beat
while time < at(594):
    place(kick(), time, gain=0.45)
    place(hat(), time + beat / 4, gain=0.12, pan=-0.3)
    time += beat / 2

# Shot 5: each helper plate locks with a clank, rising in pitch.
for i in range(5):
    place(clank(1.0 + i * 0.08), at(352 + i * 11), gain=0.32, pan=(i - 2) * 0.15, reverb=0.25)

# Shot 6: the doors slam, then the bolts drive in.
place(whoosh(0.8, 100, 1500), at(462), gain=0.15)
place(impact(2.2, 38), at(488), gain=0.85, reverb=0.6)
place(clank(0.7), at(488), gain=0.5, reverb=0.5)
for i in range(4):
    place(clank(1.5 + i * 0.05), at(495 + i * 6), gain=0.28, pan=(-1) ** i * 0.3)

# Shot 7: a hit on every montage cut.
for i, tick in enumerate([540, 550, 560, 570, 580, 590]):
    place(whoosh(0.18, 800, 8000), at(tick) - 0.12, gain=0.2)
    place(impact(0.5, 60), at(tick), gain=0.35)
    place(clank(1.2 + (i % 3) * 0.2), at(tick), gain=0.18)

# Shot 8: silence, then the impact, with a long tail.
place(impact(4.0, 40), at(630), gain=1.0, reverb=0.8)
place(clank(0.6), at(630), gain=0.5, reverb=0.8)
shimmer_t = t_axis(3.0)
shimmer = sum(np.sin(2 * np.pi * f * shimmer_t) for f in [1318, 1975, 2637]) * decay(3.0, 1.4) * np.clip(shimmer_t / 0.3, 0, 1)
place(shimmer, at(652), gain=0.03, reverb=0.6)

# Reverb: the send bus convolved with a decaying noise tail.
ir_t = t_axis(1.6)
ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t * 3.2)[:, None]
size = len(mix) + len(ir)
wet = np.stack([np.fft.irfft(np.fft.rfft(send[:, c], size) * np.fft.rfft(ir[:, c], size), size)[: len(mix)] for c in range(2)], axis=1)
mix += wet * (0.25 / np.max(np.abs(wet)))

# Soft-clip and normalise to -1 dBFS; nothing sounds past the end.
mix = np.tanh(mix * 1.4)
mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))
fade = np.clip((LENGTH - t) / 0.3, 0, 1)
mix *= fade[:, None]

out = Path(__file__).with_name("trailer.wav")
with wave.open(str(out), "wb") as file:
    file.setnchannels(2)
    file.setsampwidth(2)
    file.setframerate(RATE)
    file.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"{out.name}: {LENGTH:.0f} s, {RATE} Hz stereo")
