// Lokal's loudness measurement, shared by Lokal for PC (native/loudness, N-API)
// and Lokal for Android (app/src/main/cpp, JNI): the same source on both, so a
// song measured on either gives the same numbers, to the bit. That is what lets
// both write the same ReplayGain tags into a file synced between them.
//
//   - MP3 decoding: AOSP's pvmp3dec (Android's own software MP3 decoder). It is
//     fixed point, so its PCM is the same on x64 and ARM with any compiler.
//   - Measuring: EBU R128 / ITU-R BS.1770 integrated loudness (K-weighting,
//     400 ms blocks every 100 ms, gates at -70 LUFS and 10 LU below), and the
//     sample peak. Plain double arithmetic only (+ - * /, no FMA, no libm): the
//     K-filter coefficients are a table, the logarithm is our own.
//   - Results are integers, so nothing is left to each platform's formatting.
#ifndef LOKAL_LOUDNESS_H
#define LOKAL_LOUDNESS_H

#include <stdint.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Raise when anything changes the numbers a file measures to. */
#define LOKAL_LOUDNESS_VERSION 1

enum {
  LOKAL_LOUDNESS_OK = 0,
  /** Decoded, but nothing above -70 LUFS: no loudness (the peak is still set). */
  LOKAL_LOUDNESS_SILENT = 1,
  /** Not an MP3 (layer III) the decoder can read. */
  LOKAL_LOUDNESS_NOT_MP3 = 2,
  LOKAL_LOUDNESS_READ_ERROR = 3,
  LOKAL_LOUDNESS_CANCELLED = 4,
  LOKAL_LOUDNESS_NO_MEMORY = 5,
};

typedef struct {
  int32_t status;
  /** Integrated loudness in tenths of a LUFS, rounded to the nearest (-143 = -14.3 LUFS). */
  int32_t lufs_tenths;
  /** Sample peak, linear, in millionths of full scale, rounded (1000000 = 0 dBFS). */
  int32_t peak_micro;
  int32_t sample_rate;
  int32_t channels;
  /** Sample frames measured. */
  int64_t frames;
} lokal_loudness_result;

/**
 * Measures up to max_seconds of the MP3 open in `file` (read from its start;
 * the file's size is found by seeking). `cancelled` (may be NULL) is asked now
 * and then; returning non-zero stops with LOKAL_LOUDNESS_CANCELLED.
 */
lokal_loudness_result lokal_loudness_measure(FILE *file, int32_t max_seconds,
                                             int (*cancelled)(void *), void *user);

#ifdef __cplusplus
}
#endif

#endif
