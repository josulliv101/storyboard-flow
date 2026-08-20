---
name: ltx-2-5
description: Running LTX 2.5 locally — ComfyUI and the ltx-pipelines PyTorch route. Use when generating video/audio with LTX 2.5, wiring audio-to-video, retake, dub-it, choosing weights or quantization, or debugging why an LTX model won't load. Covers the weight-format traps, prompting rules, and measured facts from this machine.
---

# LTX 2.5 — working notes

Living document. Every hard-won fact goes in here as we learn it. Dated entries at the bottom.

## Two routes, and they use DIFFERENT weight files

| | ComfyUI | ltx-pipelines (PyTorch) |
|---|---|---|
| Weights | `*-comfy-int8-convrot.safetensors` | **bf16 only** |
| Location | `C:\Users\josul\ComfyUI-Shared\models` | `C:\Users\josul\LTX-2-work\models\ltx-2.5` |
| Repo/env | foobar install, :8188 | `C:\Users\josul\LTX-2-work\repo`, `.venv` |

**The trap:** the model card states `*-comfy-int8-convrot.safetensors` is "**ComfyUI only** — not for `ltx-pipelines` / PyTorch." They are not interchangeable. Budget a second download if switching routes.

nvfp4 weights are NOT an option on this machine — they need Blackwell (SM ≥ 10); the RTX 3080 is Ampere (SM 8.6).

## Which transformer does which pipeline need

This bit is easy to get wrong and costs 42 GB per mistake.

- **DistilledPipeline** → `ltx-2.5-22b-distilled-transformer-*`. Fixed 8-step schedule, CFG=1.
- **A2Vid / TI2Vid two-stage / most others** → `ltx-2.5-22b-**dev**-transformer-bf16` **plus** `loras/ltx-2.5-22b-distilled-lora-450-bf16.safetensors`. Stage 1 runs guided (CFG) on the dev transformer; stage 2 re-uses the *same* transformer with the distilled LoRA appended (`stage_2_loras = (*loras, *distilled_lora)`). The model card confirms the LoRA is for "dev-transformer workflows."

`--distilled-lora` and `--spatial-upsampler-path` are **required** args on A2Vid, not optional.

## CFG=1 means negative prompts are INERT

The distilled model is a fixed 8-step schedule at CFG 1.0. Negative prompts do nothing there — same trap as Krea at cfg 1.0. Don't spend time writing them. The dev transformer *does* take guidance (`--video-cfg-guidance-scale`, `--a2v-guidance-scale`, etc.).

## Hard constraints

- Frame count: `frames % 8 == 1` (81, 97, 121, 193…)
- Width/height divisible by 32
- Omit `--num-frames` entirely → the duration head predicts length from the prompt (2.5+ only)
- Retake additionally requires the SOURCE video to be 8k+1 frames and /32 resolution

## Low-VRAM on the 3080 (10 GB)

```
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  --quantization fp8-cast --offload disk
```

`--offload cpu` holds weights in system RAM; `disk` streams them when RAM is short (slower). Also available: `--max-batch-size`, `--compile`, `--enhance-prompt`, `--lora <path> [strength]`, `--seed`.

**WINDOWS TRAP — `fp8-cast` blows the commit limit on a 42 GB checkpoint.** It fails before generation even starts:

```
OSError: The paging file is too small for this operation to complete. (os error 1455)
  ltx_core/quantization/fp8_cast.py:260 in _read_scales
  safetensors.safe_open(checkpoint_path, framework="pt", device="cpu")
```

`_read_scales()` memory-maps the WHOLE checkpoint up front to read quantization scales. This machine: 48 GB RAM + 38 GB system-managed pagefile ≈ 86 GB commit limit, and one 42 GB mapping on top of everything else running exceeds it. This happens at policy-build time, **before offload is consulted**, so changing `--offload` does not help. Either drop `--quantization` or raise the Windows page file (System → Advanced → Performance → Virtual Memory).

## BLOCKED on Windows: ltx-pipelines dies at the stage-2 transformer rebuild

```
ltx_core/loader/sft_loader.py:36
  value = f.get_tensor(name).to(device=device, non_blocking=True, copy=False)
          ^^^^^^^^^^^^^^^^^^
RuntimeError: Attempted to access the data pointer on an invalid python storage.
```

The carets are under **`f.get_tensor(name)`** — the failure is inside safetensors' read, not the `.to()`. Stage 1 builds the transformer and denoises fine; the SECOND build (start of stage 2) fails every time.

Hypotheses tested and **rejected** — do not re-try these:
1. safetensors/torch version skew — 0.8.0 IS current, uv finds nothing newer.
2. Meta-device context invalidating storage — could not reproduce under `with torch.device("meta")`.
3. `copy=False` aliasing safe_open's mmap past its `with` block — patching to `copy=True` failed identically, and the carets prove the error precedes the copy.

The same call works in isolation (open the 42 GB file, `get_tensor`, `.to("cuda")` — all fine). So it is state-dependent on the second build.

Unexplored lead for a future attempt: `safe_open(shard_path, framework="pt", device=str(device))` passes **cuda** to safetensors, so it reads straight to GPU; the pipelines clean GPU memory between stages, and that teardown may be what invalidates it. Forcing a CPU read then moving would be the thing to try.

Environment: Windows 11, torch 2.13.0+cu132, safetensors 0.8.0, Python 3.12.11. Likely a genuine upstream bug — worth reporting. Also note `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` is a **no-op on Windows** (the run logs a UserWarning saying so).

**Speed finding, which is the good news:** stage 1 denoised 97 frames at 384x224 in **~10 seconds** (8 steps, ~1.2 s/it) on the 3080 with CPU offload. This model is fast here; earlier fears about hour-long renders were unfounded.

## ALWAYS embed the workflow when submitting via the API

`POST /prompt` with only `{"prompt": api_json}` produces a run whose `extra_data` is **empty** — and the queue item's 3-dot **"Open as workflow in new tab"** then has nothing to open. Saving a graph-format file into `user/default/workflows` does NOT fix that; it is a different code path (sidebar list, cached at page load, needs Ctrl+Shift+R).

Send the graph too:

```python
payload = {"prompt": api_json, "client_id": "...",
           "extra_data": {"extra_pnginfo": {"workflow": graph_format}}}
```

Tools built for this, in `C:\Users\josul\LTX-2-work`:
- `api2graph.py <api.json> <Name>` — converts API format → openable graph format (walks `/object_info` to decide link-vs-widget inputs, emits positions/links/slot indices), writes to the workflows folder.
- `submit.py <api.json> [--save=NAME]` — converts AND submits with the graph embedded. **Use this, not a bare POST.**

Verified by loading the result in the real frontend via `app.loadGraphData()`: 22 nodes, no error. Cosmetic gap: generated nodes get a generic 300x120 size and no titles, so they render as bare boxes until resized.

## Prompting (from the official guide)

ONE flowing paragraph, present tense, 4–8 sentences, in this order: shot type → scene setting (lighting, palette, texture, mood) → action → character (age, hair, clothing, distinguishing features; emotion via PHYSICAL CUES, not abstract labels) → camera movement → audio.

- Camera verbs it responds to: follows, tracks, pans across, circles around, tilts upward, pushes in / pulls back, overhead, handheld. Say how the subject looks AFTER the move.
- Dialogue in "quotation marks", with language/accent and delivery style.
- Dub-It template: `[Speaker] speaking [Language], saying: '[Dialogue]'` in native script. Validated: EN, FR, ES, DE, RU.
- Multi-shot: still one paragraph, name each transition ("a hard cut transitions to…"). Prefer 2–4 shots.
- Avoid: chaotic physics, mixed lighting in one shot, crowded frames, on-screen text, unexplained costume/geography changes.

### Screenplay format is supported — and often better for dialogue

The official blog's own examples use screenplay form, not just flowing prose:

```
INT. OVEN – DAY. Static camera from inside the oven, looking outward through the
slightly fogged glass door. …
Baker (whispering dramatically): "Today… I achieve perfection."
…
Cut to side view — coworker pops into frame, chewing casually.
Coworker (mouth full): "Nope. You forgot the sugar."
Quick zoom back to the baker's horrified face…
pixar style acting and timing
```

Character name + **parenthetical delivery direction** + quoted line. Handles multiple speakers, cuts, and to-camera address in one prompt. Use this for two-handers instead of forcing everything into prose.

Note that example ends with the literal words **"pixar style acting and timing"** — LTX's own guide uses the plain style word, which matches our measured house-style finding.

Also: "Match your detail to the shot scale — closeups need more precise detail than wide shots," and when describing camera movement "focus on the camera's relationship to the subject."

**House-style override:** the official guide pushes generic cinematography vocabulary. Our own measurement says "cinematic / desaturated / film grain" silently costs the Pixar look. Say "In the style of a Pixar film" literally and keep analytic camera words minimal. Ours wins.

## A2V DOES NOT LIP-SYNC — confirmed on the reference implementation

**Settled 2026-08-12.** Supplied-audio-to-video does not drive lips, on 2.5, on either route:

- ComfyUI hand-built graph (frozen audio latent) — lips off in spots
- Lightricks' own `a2vid_two_stage.py`, audio verified intact (out 100.0 Hz vs in 100.3 Hz, voiced 2.26s vs 2.29s) — **still off**

Since the reference implementation fails with provably correct audio, this is the model's behaviour, not a wiring fault. [[ltx-cannot-audio-drive-lips]] STANDS — it was measured on 2.3 and the frozen-latent pathway does not rescue it.

Consistent with LTX's own wording: audio features become "character movement, camera motion, and scene animation, aligned to rhythm, energy, and timing." Motion and timing — never lips.

**What this leaves for dialogue:** generate audio and video TOGETHER from prompted dialogue text, where sync comes for free because both are produced in one pass. That is the route that hit Pat's voice at 109.7 Hz vs his documented 110.3. Use A2V for motion/rhythm against an existing track, not for talking heads.

## Audio-to-video — the mechanism

From `a2vid_two_stage.py`: stage 1 denoises **video only with the audio FROZEN** as the initial audio latent (VAE-encoded); stage 2 upsamples 2x keeping audio fixed. The ORIGINAL waveform is returned, not a VAE round-trip, so supplied audio keeps its fidelity.

This is a different pathway from `LTXVReferenceAudio` in ComfyUI, whose own tooltip says it transfers *speaker identity* (~5 s clip) — not timing or content. Our earlier "LTX cannot audio-drive lips" result was measured on the reference pathway, so it does not rule out the frozen-latent pathway.

ComfyUI equivalents that exist but are unverified as a working graph: `LTXVConcatAVLatent` (takes `video_latent` + `audio_latent`) and `model_base.LTXAV`'s `audio_denoise_mask`.

## ComfyUI-side facts (verified on this machine)

- Transformer goes in `diffusion_models/`. `load_diffusion_model_state_dict` strips the `model.diffusion_model.` prefix itself (`unet_prefix_from_state_dict`), so UNETLoader handles it. Do NOT move it to `checkpoints/` — the official workflow looks in `diffusion_models/` and moving it makes ComfyUI try to re-fetch from the gated repo.
- Text encoder detects as `TEModel.GEMMA_4_12B`. The 2.3 gemma-3 TE will NOT work with 2.5.
- VAEs need their safetensors metadata: `load_torch_file(p, return_metadata=True)` then `VAE(sd=sd, metadata=md)`. Without it you get size-mismatch or "Metadata is required for audio VAE". VAELoader does this itself.
- `ltx-2.5-video-vae-conv-bf16` → VideoVAE ✅. `ltx-2.5-video-vae-bf16` (the DiffVAE, higher quality) **fails to load** on the Aug-8-2026 build — size mismatch in AutoencodingEngine. May resolve on a ComfyUI update. DiffVAE decode also wants the `natten` extra and has `--diffvae-optimization` presets.
- 2.3 IC-LoRAs are structurally compatible with the 2.5 transformer — measured on LipDub: 2688/2688 tensors mapped, all dims matched, both 48 blocks. They will *attach*; output quality on 2.5 is unproven.

## Gating

Every Lightricks repo is separately gated (`auto`, click-through) — accepting LTX-2.5 does NOT cover the IC-LoRA repos. Token via `python -m huggingface_hub.cli.hf auth login` (`hf.exe` is not on PATH). Accept at the repo page while logged in, then download.

## The 12 pipelines

`DistilledPipeline` (fastest) · `TI2VidTwoStages` / `HQ` / `OneStage` · `ICLora` (video-to-video, control signals) · `KeyframeInterpolation` · **`A2VidPipelineTwoStage`** (audio-driven) · **`RetakePipeline`** (regenerate ONE time region, independent `regenerate_video`/`regenerate_audio`) · `HDRICLora` · **`DubItPipeline`** · `T2AOneStage` (audio only) · `DFRPipeline` (detailing + temporal 2x/4x).

Selection guide: `packages/ltx-pipelines/docs/pipeline-selection.md` in the repo.

## Generated keyframe slots (2.5 only)

Extra frames at interior positions that relax temporal compression where motion is too fast. `--num-generated-keyframes N`. ~+16% tokens at 512x768/241f, ~+31% at 1088x1920/121f. Requires `use_keyframes_abs_pos_embedding` — 2.5 has it, older checkpoints raise rather than silently ignore. Decode each slot as a standalone single-frame clip, not as part of a causal decode.

## Image conditioning has two modes

- **Replacing latents** — swaps the latent at a frame with the encoded image. Hard control at that frame.
- **Adding guiding latents** — image as a guiding signal. Better for smooth interpolation between keyframes.

---

## Log

**2026-08-12** — Installed. ComfyUI route verified end-to-end by detection (transformer → LTXAV, TE → GEMMA_4_12B, conv VAE → VideoVAE, audio VAE → AudioVAE). ltx-pipelines env built: Python 3.12.11, torch 2.13.0+cu132, CUDA available on the 3080. Downloaded the **distilled** bf16 transformer before establishing that A2Vid needs the **dev** transformer + distilled LoRA — 42 GB spent on the wrong file for that goal. Jack driver audio extracted to `LTX-2-work/inputs/jack_driver.wav` (10.005 s, mean -24.6 dB, no silence gaps).
