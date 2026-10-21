# Loudness measurement (shared with Lokal for Android)

Lokal measures a song's loudness here, for loudness normalization and for the
ReplayGain tags it writes into MP3s (`electron/loudness.js`, `electron/replayGainTag.js`).
Lokal for Android builds **the same source** through JNI (`app/src/main/cpp`, copied by
its `tools/sync-loudness-native.mjs`). Both must measure a file to the same bits: then a
song measured on the PC and on the phone before Syncthing syncs them gets the very same
tag bytes on both, and Syncthing sees one file instead of a conflict.

- `src/lokal_loudness.{h,cpp}`: frame reader, EBU R128 / BS.1770 meter (integrated
  loudness, sample peak), results as integers (`lufs_tenths`, `peak_micro`). Only plain
  double arithmetic: K-filter coefficients are a table per MP3 sample rate, the logarithm
  is our own, no libm. Built with FMA contraction off (`-ffp-contract=off`; MSVC
  `/fp:precise` doesn't contract) and wrapping integers (`-fwrapv`).
- `vendor/pvmp3`: AOSP's software MP3 decoder (`frameworks/av/media/module/codecs/mp3dec`,
  tag `android-15.0.0_r1`, archive SHA-256
  `23b645378c54565d4e96734fd26eb567278f8f2db8c011ae730f3859b22c67ce`), unchanged, without
  `src/asm`. Fixed point (its portable C path), so its PCM is the same everywhere. Licence:
  Apache 2.0 (`vendor/pvmp3/NOTICE`). `src/compat.h` supplies what AOSP's build defines.
- `addon.cc`: N-API `measure(path, maxSeconds)` on libuv's pool. Built by
  `npm run native:prepare` (`scripts/prepare-loudness.js`) into `electron/native`.
- `test/`: fixtures and `expected.json` (measurement and tagged-file SHA-256 per fixture),
  rebuilt by `node native/loudness/test/make-fixtures.mjs [ffmpeg]`. Checked by
  `scripts/loudness-native.test.mjs` here and by Android's `LoudnessTest` (tag bytes) and
  `LoudnessDeviceTest` (measurement on a phone).

**Changing anything that affects the numbers** (decoder, reader, meter, rounding): raise
`LOKAL_LOUDNESS_VERSION` and `electron/loudness.js` `VERSION`, rebuild the fixtures, copy the
source to Android and release both apps together. Files keep the tags they already have.
